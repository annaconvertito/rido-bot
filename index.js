/**
 * 🟢 RIDO LOGISTICS - HYBRID VERSION (GPS + TEXT)
 * Ver. 4.0.0 - Sistema Completo Professionale
 */

const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
app.use(express.json());

// --- 1. CONFIGURAZIONE EMAIL ---
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", 
  port: 465, 
  secure: true, 
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

const sessions = {};
const getS = (id) => { 
    if (!sessions[id]) sessions[id] = { step: 0, data: {} }; 
    return sessions[id]; 
};

// --- 2. TRASFORMA TESTO IN COORDINATE (GOOGLE API) ---
async function getCoords(address) {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${process.env.GOOGLE_MAPS_API_KEY}`;
    const res = await axios.get(url);
    if (res.data.status === 'OK') {
      const loc = res.data.results[0].geometry.location;
      return { 
        lat: loc.lat, 
        lon: loc.lng, 
        full: res.data.results[0].formatted_address 
      };
    }
    return null;
  } catch (e) { return null; }
}

// --- 3. ALGORITMO CALCOLO KM ---
const calcKm = (l1, n1, l2, n2) => {
  const R = 6371; 
  const dL = (l2-l1)*Math.PI/180; 
  const dN = (n2-n1)*Math.PI/180;
  const a = Math.sin(dL/2)**2 + Math.cos(l1*Math.PI/180)*Math.cos(l2*Math.PI/180)*Math.sin(dN/2)**2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
};

// --- 4. VERIFICA WEBHOOK FACEBOOK ---
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

// --- 5. LOGICA PRINCIPALE ---
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object !== 'page') return res.sendStatus(404);

  // ✅ BLOCCA MESSAGGI RIPETUTI (Risposta immediata a Meta)
  res.status(200).send('EVENT_RECEIVED');

  for (let entry of body.entry) {
    if (!entry.messaging) continue;
    let event = entry.messaging[0];
    let sid = event.sender.id;
    let s = getS(sid);

    // --- A. GESTIONE PULSANTI ---
    if (event.postback) {
      const p = event.postback.payload;
      if (p === 'START') {
        s.step = 1;
        return sendBtn(sid, "📦 Cosa dobbiamo trasportare?", [
          {t:"🛋️ Mobili", p:"SET_Mobili"}, {t:"📺 Elettro", p:"SET_Elettro"}, {t:"📦 Altro", p:"SET_Altro"}
        ]);
      }
      if (p.startsWith('SET_')) {
        s.data.item = p.split('_')[1]; s.step = 2;
        return sendMsg(sid, `✅ Hai scelto: ${s.data.item}.\n\n📸 Invia una FOTO dell'oggetto da trasportare:`);
      }
      if (p === 'PAY_NOW') return handlePay(sid, s.data);
    }

    // --- B. GESTIONE MESSAGGI (GPS O TESTO) ---
    if (event.message) {
      const msg = event.message;
      const txt = msg.text ? msg.text.trim() : "";

      // Benvenuto / Reset
      if (txt.toLowerCase() === 'reset' || txt.toLowerCase() === 'ciao' || s.step === 0) {
        sessions[sid] = { step: 0, data: {} };
        return sendBtn(sid, "🚚 Benvenuto su Ri-Do 🟢\nTrasporti Low-Cost a Caserta.\n\nSiamo pronti per il tuo trasporto.", [{t:"📦 Prenota ora", p:"START"}]);
      }

      // STEP 2: Foto
      if (s.step === 2 && msg.attachments?.[0].type === 'image') {
        s.data.foto = msg.attachments[0].payload.url;
        s.step = 3;
        return sendMsg(sid, "📸 Foto ricevuta!\n\n📍 Dove dobbiamo RITIRARE?\n👉 Invia la POSIZIONE GPS oppure SCRIVI l'indirizzo (es: Via Roma 1, Caserta):");
      }

      // STEP 3: Ritiro (GPS o Scritto)
      if (s.step === 3) {
        let loc = null;
        if (msg.attachments?.[0].type === 'location') {
          loc = { lat: msg.attachments[0].payload.coordinates.lat, lon: msg.attachments[0].payload.coordinates.long, full: "Posizione GPS" };
        } else if (txt.length > 5) {
          loc = await getCoords(txt);
        }

        if (loc) {
          s.data.l1 = loc.lat; s.data.n1 = loc.lon; s.data.addr1 = loc.full;
          s.step = 4;
          return sendMsg(sid, `✅ Ritiro: ${loc.full}\n\n📍 Ora invia la POSIZIONE di CONSEGNA (GPS o Scritta):`);
        }
      }

      // STEP 4: Consegna + Calcolo
      if (s.step === 4) {
        let loc = null;
        if (msg.attachments?.[0].type === 'location') {
          loc = { lat: msg.attachments[0].payload.coordinates.lat, lon: msg.attachments[0].payload.coordinates.long, full: "Posizione GPS" };
        } else if (txt.length > 5) {
          loc = await getCoords(txt);
        }

        if (loc) {
          const km = calcKm(s.data.l1, s.data.n1, loc.lat, loc.lon);
          s.data.km = km.toFixed(2);
          let prezzo = 10 + (km * 1.2); 
          s.data.tot = (prezzo < 15 ? 15 : prezzo).toFixed(2);
          s.data.m1 = `https://www.google.com/maps?q=${s.data.l1},${s.data.n1}`;
          s.data.m2 = `https://www.google.com/maps?q=${loc.lat},${loc.lon}`;
          s.step = 5;
          return sendMsg(sid, `📏 Distanza: ${s.data.km} km.\n💰 Prezzo Ri-Do: €${s.data.tot}.\n\n📧 Scrivi la tua EMAIL per confermare:`);
        }
      }

      // STEP 5: Email e Riepilogo
      if (s.step === 5 && txt.includes('@')) {
        s.data.mail = txt;
        return sendBtn(sid, `📋 RIEPILOGO:\n📦 ${s.data.item}\n📏 ${s.data.km} km\n💰 €${s.data.tot}\n\nConfermi l'ordine?`, [{t:"💳 Paga ora", p:"PAY_NOW"}]);
      }
    }
  }
});

// --- 6. FUNZIONI HELPER ---
async function sendMsg(id, text) {
  await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, { recipient: {id}, message: {text} });
}

async function sendBtn(id, text, btns) {
  await axios.post(`https://graph.facebook.com/v20.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    recipient: {id}, message: { attachment: { type:"template", payload: { template_type:"button", text:text, buttons: btns.map(b => ({type:"postback", title:b.t, payload:b.p})) }}}
  });
}

async function handlePay(id, d) {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `Trasporto Ri-Do: ${d.item}` }, unit_amount: Math.round(d.tot * 100) }, quantity: 1 }],
      mode: 'payment', success_url: 'https://m.me/rido', cancel_url: 'https://m.me/rido',
    });
    await sendMsg(id, `🔗 Paga in sicurezza qui: ${session.url}`);
    await transporter.sendMail({
      from: process.env.GMAIL_USER, to: process.env.GMAIL_USER,
      subject: `🚚 ORDINE €${d.tot} - ${d.item}`,
      html: `<h3>Nuovo Ordine</h3><b>Guadagno Admin: 5€</b><br>Rider: ${(d.tot-5).toFixed(2)}€<hr>Ritiro: ${d.addr1}<br>Mappa Ritiro: ${d.m1}<br>Mappa Consegna: ${d.m2}<br>Foto: ${d.foto}`
    });
  } catch (e) { console.log(e); }
}

app.listen(process.env.PORT || 10000);
