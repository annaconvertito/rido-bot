/**
 * 🟢 RIDO LOGISTICS - SISTEMA DI PRENOTAZIONE TRASPORTI
 * Versione: 2.1.0 - Full Production
 * Righe di configurazione e logica integrate
 */

// 1. IMPORTAZIONE MODULI FONDAMENTALI
const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

// 2. INIZIALIZZAZIONE APPLICAZIONE
const app = express();
app.use(express.json());

// 3. CONFIGURAZIONE TRASPORTATORE EMAIL (SMTP)
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, 
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS
  }
});

// 4. GESTIONE SESSIONE UTENTE (MEMORIA VOLATILE)
const sessions = {};
const getSession = (id) => {
  if (!sessions[id]) {
    sessions[id] = { step: 0, data: {} };
  }
  return sessions[id];
};

// 5. ALGORITMO DI CALCOLO DISTANZA (HAVERSINE)
const calculateKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Raggio della Terra in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// 6. ENDPOINT DI VERIFICA WEBHOOK (TOKEN)
app.get('/webhook', (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ WEBHOOK_VERIFIED');
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

// 7. LOGICA DI RICEZIONE E RISPOSTA (WEBHOOK POST)
app.post('/webhook', async (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    for (const entry of body.entry) {
      if (!entry.messaging) continue;
      const event = entry.messaging[0];
      const senderId = event.sender.id;
      const session = getSession(senderId);

      // --- GESTIONE DEI PULSANTI (POSTBACK) ---
      if (event.postback) {
        const payload = event.postback.payload;

        if (payload === 'START_PRENOTAZIONE') {
          session.step = 1;
          return sendButtons(senderId, "📦 Cosa dobbiamo trasportare oggi?", [
            { title: "🛋️ Mobili", payload: "ART_Mobili" },
            { title: "📺 Elettrodomestici", payload: "ART_Elettrodomestici" },
            { title: "📦 Altro", payload: "ART_Altro" }
          ]);
        }

        if (payload.startsWith('ART_')) {
          session.data.item = payload.split('_')[1];
          session.step = 2;
          return sendMessage(senderId, `✅ Hai selezionato: ${session.data.item}.\n\n📸 Per favore, scatta o invia una FOTO dell'oggetto da trasportare:`);
        }

        if (payload === 'PAGA_ORA') {
          return handleStripePayment(senderId, session.data);
        }
      }

      // --- GESTIONE MESSAGGI E ALLEGATI ---
      if (event.message) {
        const text = event.message.text ? event.message.text.toLowerCase() : "";

        // Reset o Primo Contatto
        if (text === 'reset' || text === 'ciao' || session.step === 0) {
          sessions[senderId] = { step: 0, data: {} };
          return sendButtons(senderId, "🚚 Benvenuto su Ri-Do 🟢\nTrasporti Low-Cost a Caserta e provincia.\n\nVuoi prenotare un rider subito?", [
            { title: "📦 Prenota ora", payload: "START_PRENOTAZIONE" }
          ]);
        }

        // Step 2: Ricezione Foto
        if (session.step === 2 && event.message.attachments?.[0].type === 'image') {
          session.data.photoUrl = event.message.attachments[0].payload.url;
          session.step = 3;
          return sendMessage(senderId, "📸 Foto ricevuta perfettamente!\n\n📍 Adesso inviaci la POSIZIONE GPS di RITIRO (usa il tasto 📎 o +):");
        }

        // Step 3: GPS Ritiro
        if (session.step === 3 && event.message.attachments?.[0].type === 'location') {
          const coords = event.message.attachments[0].payload.coordinates;
          session.data.lat1 = coords.lat;
          session.data.lon1 = coords.long;
          session.step = 4;
          return sendMessage(senderId, "✅ Ritiro impostato.\n\n📍 Ora inviaci la POSIZIONE GPS di CONSEGNA:");
        }

        // Step 4: GPS Consegna e Calcolo
        if (session.step === 4 && event.message.attachments?.[0].type === 'location') {
          const coords = event.message.attachments[0].payload.coordinates;
          const km = calculateKm(session.data.lat1, session.data.lon1, coords.lat, coords.long);
          
          session.data.km = km.toFixed(2);
          let price = 10 + (km * 1.0);
          session.data.total = (price < 15 ? 15 : price).toFixed(2);
          
          session.data.mapRitiro = `https://www.google.com/maps?q=${session.data.lat1},${session.data.lon1}`;
          session.data.mapConsegna = `https://www.google.com/maps?q=${coords.lat},${coords.long}`;
          
          session.step = 5;
          return sendMessage(senderId, `📏 Percorso calcolato: ${session.data.km} km.\n💰 Prezzo Ri-Do: €${session.data.total}.\n\n📧 Scrivi la tua EMAIL per ricevere la conferma:`);
        }

        // Step 5: Email e Riepilogo Finale
        if (session.step === 5 && text.includes('@')) {
          session.data.email = text;
          return sendButtons(senderId, `📋 RIEPILOGO ORDINE:\n📦 Oggetto: ${session.data.item}\n📏 Distanza: ${session.data.km} km\n💰 Totale: €${session.data.total}\n📧 Email: ${session.data.email}\n\nConfermi e procedi al pagamento?`, [
            { title: "💳 Paga Ora", payload: "PAGA_ORA" }
          ]);
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  }
});

// 8. FUNZIONI DI SUPPORTO MESSAGGISTICA
async function sendMessage(id, text) {
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
      recipient: { id },
      message: { text }
    });
  } catch (err) { console.error("❌ Errore Invio Messaggio"); }
}

async function sendButtons(id, text, buttons) {
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
      recipient: { id },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: text,
            buttons: buttons.map(b => ({ type: "postback", title: b.title, payload: b.payload }))
          }
        }
      }
    });
  } catch (err) { console.error("❌ Errore Invio Pulsanti"); }
}

// 9. GESTIONE PAGAMENTO STRIPE E NOTIFICA EMAIL
async function handleStripePayment(id, d) {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Trasporto Ri-Do: ${d.item}` },
          unit_amount: Math.round(d.total * 100),
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://www.facebook.com/profile.php?id=61588660651078',
      cancel_url: 'https://www.facebook.com/profile.php?id=61588660651078',
    });

    await sendMessage(id, `🔗 Clicca qui per pagare in modo sicuro: ${session.url}`);

    // INVIO NOTIFICA ADMIN
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.GMAIL_USER,
      subject: `🚚 NUOVO ORDINE: €${d.total}`,
      html: `
        <h3>Nuovo Ordine Ri-Do Logistics</h3>
        <p><b>Commissione Admin: €5.00</b></p>
        <p>Da corrispondere al Rider: €${(d.total - 5).toFixed(2)}</p>
        <hr>
        <p>📦 <b>Oggetto:</b> ${d.item}</p>
        <p>📏 <b>Km:</b> ${d.km}</p>
        <p>📍 <b>Ritiro:</b> <a href="${d.mapRitiro}">Vedi su Mappa</a></p>
        <p>🏠 <b>Consegna:</b> <a href="${d.mapConsegna}">Vedi su Mappa</a></p>
        <p>🖼️ <b>Foto:</b> <a href="${d.photoUrl}">Visualizza Foto</a></p>
      `
    });
  } catch (err) { console.error("❌ Errore Stripe/Email", err); }
}

// 10. AVVIO DEL SERVER
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Server Ri-Do attivo sulla porta ${PORT}`);
});
