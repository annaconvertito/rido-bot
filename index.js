/**
 * 🟢 RIDO LOGISTICS ULTIMATE 2026 - VERSIONE ECONOMICA GPS + FOTO
 * ID PAGINA: 61588660651078
 */

const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
app.use(express.json());

// --- CONFIGURAZIONE EMAIL SICURA ---
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 465,
  secure: true, 
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

const sessions = {};
function getSession(id) {
  if (!sessions[id]) sessions[id] = { step: 'idle', data: {} };
  return sessions[id];
}
function resetSession(id) { sessions[id] = { step: 'idle', data: {} }; }

// --- FUNZIONE MATEMATICA DISTANZA ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; 
}

// --- WEBHOOK VERIFICA ---
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else { res.sendStatus(403); }
});

// --- WEBHOOK RICEZIONE ---
app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    body.entry.forEach(entry => {
      if (!entry.messaging) return;
      const event = entry.messaging[0];
      const senderId = event.sender.id;

      if (event.message && event.message.attachments) {
        handleAttachments(senderId, event.message.attachments);
      } else if (event.postback || (event.message && event.message.quick_reply)) {
        const payload = event.postback ? event.postback.payload : event.message.quick_reply.payload;
        handlePayload(senderId, payload);
      } else if (event.message && event.message.text) {
        handleText(senderId, event.message.text);
      }
    });
    res.status(200).send('EVENT_RECEIVED');
  }
});

// --- LOGICA ALLEGATI (FOTO E GPS) ---
async function handleAttachments(senderId, attachments) {
  const session = getSession(senderId);
  const att = attachments[0];

  if (att.type === 'image' && session.step === 'await_photo') {
    session.data.photoUrl = att.payload.url;
    session.step = 'await_pickup';
    await send(senderId, "📸 Foto ricevuta perfettamente!");
    return send(senderId, "📍 Adesso inviaci la posizione GPS di RITIRO:");
  }

  if (att.type === 'location' && session.step === 'await_pickup') {
    session.data.lat1 = att.payload.coordinates.lat;
    session.data.lon1 = att.payload.coordinates.long;
    session.data.pickup = `https://www.google.com/maps?q=${session.data.lat1},${session.data.lon1}`;
    session.step = 'await_drop';
    return send(senderId, "📍 Ritiro salvato. Ora invia la posizione GPS di CONSEGNA:");
  }

  if (att.type === 'location' && session.step === 'await_drop') {
    session.data.lat2 = att.payload.coordinates.lat;
    session.data.lon2 = att.payload.coordinates.long;
    session.data.drop = `https://www.google.com/maps?q=${session.data.lat2},${session.data.lon2}`;
    
    const km = calculateDistance(session.data.lat1, session.data.lon1, session.data.lat2, session.data.lon2);
    session.data.km = km.toFixed(2);
    let calcolo = 10 + (km * 1.0);
    session.data.total = (calcolo < 15 ? 15 : calcolo).toFixed(2);
    
    session.step = 'await_email';
    await send(senderId, `📏 Percorso: ${session.data.km} km.`);
    return send(senderId, `💰 Prezzo Low-Cost: €${session.data.total}.\n\nScrivi la tua EMAIL per la conferma:`);
  }
}

// --- LOGICA PULSANTI ---
async function handlePayload(senderId, payload) {
  const session = getSession(senderId);
  if (payload === 'PRENOTA') {
    session.step = 'await_item';
    return sendQuickReplies(senderId, "📦 Cosa trasportiamo?", [
      { title: '🛋️ Mobili', payload: 'ITEM_Mobili' },
      { title: '📺 Elettrodomestici', payload: 'ITEM_Elettrodomestici' },
      { title: '📦 Altro', payload: 'ITEM_Altro' }
    ]);
  }
  if (payload.startsWith('ITEM_')) {
    session.data.item = payload.split('_')[1];
    session.step = 'await_photo';
    return send(senderId, `Hai scelto: ${session.data.item}.\n\n📸 Invia una FOTO dell'oggetto.`);
  }
  if (payload === 'CONFIRM_PAY') return createPaymentLink(senderId);
  if (payload === 'RESET') { resetSession(senderId); return sendMenu(senderId); }
}

// --- LOGICA TESTO ---
async function handleText(senderId, text) {
  const session = getSession(senderId);
  const msg = text.toLowerCase().trim();
  if (['menu', 'reset', 'ciao'].includes(msg)) { resetSession(senderId); return sendMenu(senderId); }
  if (session.step === 'await_email') {
    if (!text.includes('@')) return send(senderId, "⚠️ Email errata. Riprova:");
    session.data.email = text;
    return confirmBooking(senderId);
  }
  return sendMenu(senderId);
}

// --- INTERFACCIA ---
async function sendMenu(senderId) {
  return sendQuickReplies(senderId, "🚚 Benvenuto su Ri-Do 🟢\nIl trasporto più economico di Caserta.", [
    { title: '📦 Prenota ora', payload: 'PRENOTA' }
  ]);
}

async function confirmBooking(senderId) {
  const d = getSession(senderId).data;
  const summary = `📋 RIEPILOGO:\n📦 Oggetto: ${d.item}\n📏 Distanza: ${d.km} km\n💰 Totale: €${d.total}\n\nConfermi e paghi?`;
  return sendQuickReplies(senderId, summary, [
    { title: '💳 Paga ora', payload: 'CONFIRM_PAY' },
    { title: '❌ Annulla', payload: 'RESET' }
  ]);
}

async function createPaymentLink(senderId) {
  const d = getSession(senderId).data;
  const totaleCent = Math.round(parseFloat(d.total) * 100);
  try {
    const sessionStripe = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'paypal'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Trasporto Ri-Do (${d.km} km)` },
          unit_amount: totaleCent,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://www.facebook.com/messages/t/61588660651078',
      cancel_url: 'https://www.facebook.com/messages/t/61588660651078',
    });
    await send(senderId, `🔗 Clicca per pagare €${d.total}: ${sessionStripe.url}`);
    await finalizeOrderAdmin(senderId); 
  } catch (e) { await send(senderId, "⚠️ Errore. Riprova."); }
}

async function finalizeOrderAdmin(senderId) {
  const d = getSession(senderId).data;
  const spettanzaRider = (parseFloat(d.total) - 5.00).toFixed(2);
  const mailOptions = {
    from: `Ri-Do Bot 🟢 <${process.env.GMAIL_USER}>`,
    to: process.env.ADMIN_EMAIL || process.env.GMAIL_USER,
    subject: `🚚 ORDINE: €${d.total} (Tuo: €5.00)`,
    html: `<h2>Nuovo Ordine Economico</h2>
           <p style="font-size:20px; color:green;"><b>Guadagno per te: €5.00</b></p>
           <p style="font-size:18px; color:blue;">Da dare al Rider: €${spettanzaRider}</p>
           <hr>
           <p>📦 Oggetto: ${d.item}</p>
           <p>🖼️ Foto: <a href="${d.photoUrl}">Vedi Foto</a></p>
           <p>📍 Ritiro: <a href="${d.pickup}">Apri Mappa</a></p>
           <p>🏠 Consegna: <a href="${d.drop}">Apri Mappa</a></p>
           <p>📧 Cliente: ${d.email}</p>`
  };
  try { await transporter.sendMail(mailOptions); } catch (e) { console.log("Mail Error"); }
  resetSession(senderId);
}

async function send(id, text) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    recipient: { id }, message: { text }
  }).catch(e => {});
}

async function sendQuickReplies(id, text, replies) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    recipient: { id },
    message: { text, quick_replies: replies.map(r => ({ content_type: 'text', title: r.title, payload: r.payload })) }
  }).catch(e => {});
}

app.listen(PORT, () => console.log(`🚀 Bot Ri-Do Attivo su porta ${PORT}`));
