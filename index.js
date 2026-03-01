/**
 * 🟢 RIDO LOGISTICS - FULL PRODUCTION SUITE
 * Sistema di Gestione Trasporti Low-Cost - Caserta
 * Ver. 3.0.1 - Configurazione Completa
 */

// ==========================================
// 1. DIPENDENZE E CONFIGURAZIONE SISTEMA
// ==========================================
const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
app.use(express.json());

// Configurazione SMTP Professionale per notifiche ordini
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, 
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// Database temporaneo in RAM per le sessioni attive
const sessions = {};
const getS = (id) => {
  if (!sessions[id]) {
    sessions[id] = { step: 0, data: { timestamp: Date.now() } };
  }
  return sessions[id];
};

// ==========================================
// 2. MOTORE GEOGRAFICO (CALCOLO DISTANZE)
// ==========================================
const calcKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Raggio terrestre
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// ==========================================
// 3. AUTENTICAZIONE WEBHOOK FACEBOOK
// ==========================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    console.log("✅ Webhook Validato con Successo");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ==========================================
// 4. LOGICA DI BUSINESS E WORKFLOW UTENTE
// ==========================================
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object !== 'page') return res.sendStatus(404);

  // ✅ ANTI-LOOP: Conferma ricezione immediata a Meta
  res.status(200).send('EVENT_RECEIVED');

  for (let entry of body.entry) {
    if (!entry.messaging) continue;
    let event = entry.messaging[0];
    let sid = event.sender.id;
    let s = getS(sid);

    // --- GESTIONE INTERAZIONI PULSANTI (POSTBACK) ---
    if (event.postback) {
      const payload = event.postback.payload;

      if (payload === 'START_BOOKING') {
        s.step = 1;
        return sendBtn(sid, "📦 Cosa dobbiamo trasportare oggi?", [
          {t: "🛋️ Mobili", p: "SET_Mobili"},
          {t: "📺 Elettrodomestici", p: "SET_Elettro"},
          {t: "📦 Altro / Varie", p: "SET_Altro"}
        ]);
      }

      if (payload.startsWith('SET_')) {
        s.data.item = payload.split('_')[1];
        s.step = 2;
        return sendMsg(sid, `✅ Hai selezionato: ${s.data.item}.\n\n📸 Per favore, scatta o invia una FOTO dell'oggetto da trasportare per il rider:`);
      }

      if (payload === 'CONFIRM_PAYMENT') {
        return handleStripe(sid, s.data);
      }
    }

    // --- GESTIONE MESSAGGI DI TESTO E ALLEGATI ---
    if (event.message) {
      const text = event.message.text ? event.message.text.toLowerCase() : "";

      // Comando di Emergenza / Inizio
      if (text === 'reset' || text === 'ciao' || text === 'inizia' || s.step === 0) {
        sessions[sid] = { step: 0, data: {} };
        return sendBtn(sid, "🚚 Benvenuto su Ri-Do 🟢\nTrasporti Low-Cost a Caserta e provincia.\n\nSiamo pronti a spostare i tuoi oggetti in modo rapido ed economico.", [
          {t: "📦 Prenota un Rider", p: "START_BOOKING"}
        ]);
      }

      // Gestione Step 2: Foto
      if (s.step === 2 && event.message.attachments && event.message.attachments[0].type === 'image') {
        s.data.fotoUrl = event.message.attachments[0].payload.url;
        s.step = 3;
        return sendMsg(sid, "📸 Foto acquisita correttamente!\n\n📍 Adesso, per favore, inviaci la POSIZIONE GPS di RITIRO (clicca sulla graffetta 📎 o sul tasto +):");
      }

      // Gestione Step 3: GPS Ritiro
      if (s.step === 3 && event.message.attachments && event.message.attachments[0].type === 'location') {
        const coords = event.message.attachments[0].payload.coordinates;
        s.data.lat1 = coords.lat; s.data.lon1 = coords.long;
        s.step = 4;
        return sendMsg(sid, "✅ Punto di ritiro salvato.\n\n📍 Ora inviaci la POSIZIONE GPS di CONSEGNA:");
      }

      // Gestione Step 4: GPS Consegna + Logica Prezzi
      if (s.step === 4 && event.message.attachments && event.message.attachments[0].type === 'location') {
        const coords = event.message.attachments[0].payload.coordinates;
        const distanza = calcKm(s.data.lat1, s.data.lon1, coords.lat, coords.long);
        
        s.data.km = distanza.toFixed(2);
        let costoBase = 10 + (distanza * 1.0);
        s.data.totalePrezzo = (costoBase < 15 ? 15 : costoBase).toFixed(2);
        
        s.data.mappaRitiro = `https://www.google.com/maps?q=${s.data.lat1},${s.data.lon1}`;
        s.data.mappaConsegna = `https://www.google.com/maps?q=${coords.lat},${coords.long}`;
        
        s.step = 5;
        return sendMsg(sid, `📏 Percorso analizzato: ${s.data.km} km.\n💰 Prezzo Ri-Do calcolato: €${s.data.totalePrezzo}.\n\n📧 Scrivi la tua EMAIL per ricevere il riepilogo e la conferma:`);
      }

      // Gestione Step 5: Validazione Email e Riepilogo
      if (s.step === 5 && text.includes('@')) {
        s.data.customerEmail = text;
        return sendBtn(sid, `📋 RIEPILOGO PRENOTAZIONE:\n📦 Oggetto: ${s.data.item}\n📏 Percorso: ${s.data.km} km\n💰 Totale: €${s.data.totalePrezzo}\n📧 Email: ${s.data.customerEmail}\n\nProcediamo con il pagamento sicuro?`, [
          {t: "💳 Paga e Conferma", p: "CONFIRM_PAYMENT"}
        ]);
      }
    }
  }
});

// ==========================================
// 5. FUNZIONI DI COMUNICAZIONE E PAGAMENTI
// ==========================================
async function sendMsg(id, text) {
  try {
    await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
      recipient: { id }, message: { text }
    });
  } catch (err) { console.error("❌ Errore API Facebook (Testo)"); }
}

async function sendBtn(id, text, buttons) {
  try {
    await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
      recipient: { id },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: text,
            buttons: buttons.map(b => ({ type: "postback", title: b.t, payload: b.p }))
          }
        }
      }
    });
  } catch (err) { console.error("❌ Errore API Facebook (Pulsanti)"); }
}

async function handleStripe(id, d) {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Trasporto Ri-Do: ${d.item}` },
          unit_amount: Math.round(d.totalePrezzo * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://www.facebook.com/profile.php?id=61588660651078',
      cancel_url: 'https://www.facebook.com/profile.php?id=61588660651078',
    });

    await sendMsg(id, `🔗 Clicca qui per completare l'ordine su Stripe: ${session.url}`);

    // Invio Email Professionale all'Amministratore
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.GMAIL_USER,
      subject: `🚚 NUOVO TRASPORTO: €${d.totalePrezzo}`,
      html: `
        <div style="font-family: sans-serif; border: 1px solid #eee; padding: 20px;">
          <h2 style="color: #2ecc71;">Nuovo Ordine Ri-Do Logistics</h2>
          <p><b>Commissione Netta: €5.00</b></p>
          <p>Spettanza Rider: €${(d.totalePrezzo - 5).toFixed(2)}</p>
          <hr>
          <p>📦 <b>Oggetto:</b> ${d.item}</p>
          <p>📏 <b>Distanza:</b> ${d.km} km</p>
          <p>📍 <b>Punto Ritiro:</b> <a href="${d.mappaRitiro}">Apri su Google Maps</a></p>
          <p>🏠 <b>Punto Consegna:</b> <a href="${d.mappaConsegna}">Apri su Google Maps</a></p>
          <p>🖼️ <b>Foto Oggetto:</b> <a href="${d.fotoUrl}">Visualizza Allegato</a></p>
        </div>
      `
    });
  } catch (err) { console.error("❌ Errore Stripe/Email"); }
}

// 6. AVVIO SERVER
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Motore Ri-Do Online sulla porta ${PORT}`));
