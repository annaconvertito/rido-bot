/**
 * 🟢 RIDO LOGISTICS - VERSIONE DEFINITIVA 2026
 * Logica: Articoli Predefiniti + Opzione "Altro" manuale
 */

const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
app.use(express.json());

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, 
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

const sessions = {};
function getSession(id) {
  if (!sessions[id]) sessions[id] = { step: 'START', data: {} };
  return sessions[id];
}

// Calcolo Distanza
function calculateKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else { res.sendStatus(403); }
});

app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object !== 'page') return res.sendStatus(404);

  for (let entry of body.entry) {
    if (!entry.messaging) continue;
    let event = entry.messaging[0];
    let senderId = event.sender.id;
    let session = getSession(senderId);

    // --- RESET COMANDO ---
    if (event.message && event.message.text) {
      let msg = event.message.text.toLowerCase();
      if (['reset', 'ciao', 'menu', 'inizia'].includes(msg)) {
        sessions[senderId] = { step: 'START', data: {} };
        return sendWelcome(senderId);
      }
    }

    // --- GESTIONE PULSANTI (POSTBACK) ---
    if (event.postback) {
      let payload = event.postback.payload;
      
      if (payload === 'START_BOOKING') {
        session.step = 'SELECT_ITEM';
        return sendItemMenu(senderId);
      }

      if (payload.startsWith('SET_')) {
        session.data.item = payload.replace('SET_', '');
        if (session.data.item === 'ALTRO') {
          session.step = 'TYPE_MANUAL';
          return sendText(senderId, "✍️ Scrivi pure cosa dobbiamo trasportare:");
        } else {
          session.step = 'AWAIT_PHOTO';
          return sendText(senderId, `Hai scelto: ${session.data.item}.\n\n📸 Adesso invia una FOTO dell'oggetto.`);
        }
      }

      if (payload === 'CONFIRM_PAY') {
        return handleStripe(senderId, session.data);
      }
    }

    // --- LOGICA AGLI STEP (MESSAGGI E ALLEGATI) ---
    if (event.message) {
      
      // Step: Scrittura manuale se scelto "Altro"
      if (session.step === 'TYPE_MANUAL' && event.message.text) {
        session.data.item = event.message.text;
        session.step = 'AWAIT_PHOTO';
        return sendText(senderId, `Ok: ${session.data.item}.\n\n📸 Adesso invia una FOTO dell'oggetto.`);
      }

      // Step: Ricezione Foto
      if (session.step === 'AWAIT_PHOTO' && event.message.attachments && event.message.attachments[0].type === 'image') {
        session.data.photo = event.message.attachments[0].payload.url;
        session.step = 'GPS_PICKUP';
        return sendText(senderId, "📸 Foto salvata!\n\n📍 Invia la POSIZIONE GPS di RITIRO:");
      }

      // Step: GPS Ritiro
      if (session.step === 'GPS_PICKUP' && event.message.attachments && event.message.attachments[0].type === 'location') {
        let coords = event.message.attachments[0].payload.coordinates;
        session.data.lat1 = coords.lat; session.data.lon1 = coords.long;
        session.step = 'GPS_DROP';
        return sendText(senderId, "✅ Ritiro impostato.\n\n📍 Ora invia la POSIZIONE GPS di CONSEGNA:");
      }

      // Step: GPS Consegna + Calcolo
      if (session.step === 'GPS_DROP' && event.message.attachments && event.message.attachments[0].type === 'location') {
        let coords = event.message.attachments[0].payload.coordinates;
        let km = calculateKm(session.data.lat1, session.data.lon1, coords.lat, coords.long);
        session.data.km = km.toFixed(2);
        let prezzo = 10 + (km * 1.0);
        session.data.total = (prezzo < 15 ? 15 : prezzo).toFixed(2);
        
        session.data.map1 = `https://www.google.com/maps?q=${session.data.lat1},${session.data.lon1}`;
        session.data.map2 = `https://www.google.com/maps?q=${coords.lat},${coords.long}`;
        
        session.step = 'AWAIT_EMAIL';
        return sendText(senderId, `📏 Distanza: ${session.data.km} km.\n💰 Prezzo: €${session.data.total}.\n\n📧 Scrivi la tua EMAIL per il riepilogo:`);
      }

      // Step: Email Finale
      if (session.step === 'AWAIT_EMAIL' && event.message.text && event.message.text.includes('@')) {
        session.data.email = event.message.text;
        return sendFinalSummary(senderId, session.data);
      }
    }
  }
  res.status(200).send('EVENT_RECEIVED');
});

// --- FUNZIONI DI INVIO ---

async function sendText(id, text) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    recipient: { id }, message: { text }
  });
}

async function sendWelcome(id) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    recipient: { id },
    message: { 
      attachment: { type: "template", payload: { template_type: "button", text: "🚚 Benvenuto su Ri-Do!\nTrasporti Low-Cost a Caserta.\nVuoi iniziare una prenotazione?", 
      buttons: [{ type: "postback", title: "📦 Prenota ora", payload: "START_BOOKING" }] } } 
    }
  });
}

async function sendItemMenu(id) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    recipient: { id },
    message: {
      attachment: { type: "template", payload: {
        template_type: "button", text: "Cosa dobbiamo trasportare?",
        buttons: [
          { type: "postback", title: "🛋️ Mobili", payload: "SET_Mobili" },
          { type: "postback", title: "📺 Elettrodomestici", payload: "SET_Elettrodomestici" },
          { type: "postback", title: "📦 Altro / Scrivi tu", payload: "SET_ALTRO" }
        ]
      }}
    }
  });
}

async function sendFinalSummary(id, d) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    recipient: { id },
    message: { attachment: { type: "template", payload: {
      template_type: "button", text: `📋 RIEPILOGO:\n📦 ${d.item}\n📏 ${d.km} km\n💰 €${d.total}\n📧 ${d.email}\n\nConfermi l'ordine?`,
      buttons: [{ type: "postback", title: "💳 Paga Ora", payload: "CONFIRM_PAY" }]
    }}}
  });
}

async function handleStripe(id, d) {
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `Trasporto Ri-Do: ${d.item}` }, unit_amount: Math.round(d.total * 100) }, quantity: 1 }],
      mode: 'payment',
      success_url: 'https://www.facebook.com/profile.php?id=61588660651078',
      cancel_url: 'https://www.facebook.com/profile.php?id=61588660651078',
    });
    
    await sendText(id, `🔗 Clicca qui per pagare €${d.total}: ${session.url}`);
    
    // Email a te
    await transporter.sendMail({
      from: process.env.GMAIL_USER, to: process.env.GMAIL_USER,
      subject: `🚚 ORDINE RICEVUTO: €${d.total}`,
      html: `<h3>Dettagli Ordine</h3><p>Guadagno Admin: <b>5.00€</b></p><p>Rider: ${(d.total - 5).toFixed(2)}€</p><hr><p>Oggetto: ${d.item}</p><p>Email: ${d.email}</p><p>Ritiro: <a href="${d.map1}">Apri Mappa</a></p><p>Consegna: <a href="${d.map2}">Apri Mappa</a></p><p>Foto: <a href="${d.photo}">Vedi Immagine</a></p>`
    });
  } catch (e) { console.log(e); }
}

app.listen(process.env.PORT || 10000);
