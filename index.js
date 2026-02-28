/**
 * RIDO BOT — Messenger Webhook + Email
 * Versione Pulita e Ottimizzata
 */

const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(express.json());

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'rido-verify-2026';
const PORT = process.env.PORT || 3000;

// =====================================================
// CONFIGURAZIONE EMAIL
// =====================================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.GMAIL_USER;
const FROM_EMAIL = `Ri-Do 🟢 <${process.env.GMAIL_USER}>`;

// =====================================================
// GESTIONE SESSIONI
// =====================================================
const sessions = {};

function getSession(senderId) {
  if (!sessions[senderId]) {
    sessions[senderId] = { step: 'idle', data: {} };
  }
  return sessions[senderId];
}

function resetSession(senderId) {
  sessions[senderId] = { step: 'idle', data: {} };
}

// =====================================================
// WEBHOOK (GET & POST)
// =====================================================

// Verifica per Meta
app.get('/webhook', (req, res) => {
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

// Ricezione Messaggi
app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    body.entry.forEach(entry => {
      if (entry.messaging && entry.messaging[0]) {
        const event = entry.messaging[0];
        const senderId = event.sender.id;
        if (event.message) {
          handleMessage(senderId, event.message);
        } else if (event.postback) {
          handlePostback(senderId, event.postback.payload);
        }
      }
    });
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// =====================================================
// LOGICA DI MESSAGGISTICA
// =====================================================

async function handleMessage(senderId, message) {
  const session = getSession(senderId);
  const text = message.text ? message.text.trim().toLowerCase() : '';

  if (text === 'annulla' || text === 'menu' || text === 'stop') {
    resetSession(senderId);
    return sendMenu(senderId);
  }

  switch (session.step) {
    case 'idle':
      if (text.includes('prenot') || text.includes('ritiro') || text === '1') {
        return startBooking(senderId);
      } else if (text.includes('stato') || text.includes('ordine') || text === '2') {
        return askOrderStatus(senderId);
      } else if (text.includes('ciao') || text.includes('salve') || text === 'start') {
        return sendWelcome(senderId);
      } else {
        return sendMenu(senderId);
      }

    case 'await_item_type':
      session.data.item = message.text;
      session.step = 'await_pickup_address';
      return send(senderId, `✅ Annotato: *${message.text}*\n\n📍 Qual è l'indirizzo di *ritiro*?`);

    case 'await_pickup_address':
      session.data.pickup = message.text;
      session.step = 'await_drop_address';
      return send(senderId, '🏠 Perfetto! Ora dimmi l\'indirizzo di *consegna*:');

    case 'await_drop_address':
      session.data.drop = message.text;
      return sendVehicleChoice(senderId);

    case 'await_notes':
      session.data.notes = text === 'nessuna' ? '' : message.text;
      session.step = 'await_email';
      return send(senderId, '📧 Scrivi la tua email per la conferma o scrivi *"salta"*:');

    case 'await_email':
      if (text !== 'salta' && text.includes('@')) {
        session.data.email = text;
      }
      return confirmBooking(senderId);

    case 'await_order_id':
      return checkOrderStatus(senderId, text.toUpperCase());

    default:
      return sendMenu(senderId);
  }
}

async function handlePostback(senderId, payload) {
  const session = getSession(senderId);

  if (payload === 'PRENOTA') return startBooking(senderId);
  if (payload === 'STATO_ORDINE') return askOrderStatus(senderId);
  
  if (payload.startsWith('ITEM_')) {
    session.data.item = payload.replace('ITEM_', '');
    session.step = 'await_pickup_address';
    return send(senderId, `✅ Hai scelto: *${session.data.item}*\n\n📍 Indirizzo di *ritiro*?`);
  }

  if (payload.startsWith('VEH_')) {
    const [, veh, base, km] = payload.split('_');
    session.data.vehicle = veh;
    session.data.priceBase = parseFloat(base);
    session.data.priceKm = parseFloat(km);
    session.step = 'await_notes';
    const est = (parseFloat(base) + 5 * parseFloat(km)).toFixed(2);
    return send(senderId, `🚐 Scelto: *${veh}* (~€${est})\n\n📝 Note per il driver? (o scrivi *"nessuna"*)`);
  }

  if (payload === 'CONFIRM_YES') return finalizeBooking(senderId);
  if (payload === 'CONFIRM_NO') {
    resetSession(senderId);
    return send(senderId, 'Prenotazione annullata. Scrivi *"prenota"* per ricominciare.');
  }
}

// =====================================================
// FLUSSI E HELPER
// =====================================================

async function sendWelcome(senderId) {
  await send(senderId, '👋 Ciao! Sono il bot di *Ri-Do* 🟢\nTrasportiamo mobili e traslochi a Caserta.');
  return sendMenu(senderId);
}

async function sendMenu(senderId) {
  return sendQuickReplies(senderId, 'Cosa vuoi fare?', [
    { title: '📦 Prenota ritiro', payload: 'PRENOTA' },
    { title: '📋 Stato ordine', payload: 'STATO_ORDINE' },
  ]);
}

async function startBooking(senderId) {
  getSession(senderId).step = 'await_item_type';
  return sendQuickReplies(senderId, '📦 Cosa dobbiamo trasportare?', [
    { title: '🛋️ Mobili', payload: 'ITEM_Mobili' },
    { title: '📺 Elettrodomestici', payload: 'ITEM_Elettrodomestici' },
    { title: '📦 Scatoloni', payload: 'ITEM_Scatoloni' },
  ]);
}

async function sendVehicleChoice(senderId) {
  getSession(senderId).step = 'await_vehicle';
  return sendQuickReplies(senderId, '🚐 Che veicolo serve?', [
    { title: '🛵 Scooter - €6', payload: 'VEH_Scooter_6_0.9' },
    { title: '🚐 Furgone - €18', payload: 'VEH_Furgone_18_1.8' },
  ]);
}

async function confirmBooking(senderId) {
  const d = getSession(senderId).data;
  const est = ((d.priceBase || 18) + 5 * (d.priceKm || 1.8)).toFixed(2);
  const summary = `📋 *Riepilogo:*\n📦 ${d.item}\n📍 Da: ${d.pickup}\n🏠 A: ${d.drop}\n💰 Stima: €${est}\n\nConfermi?`;
  return sendQuickReplies(senderId, summary, [
    { title: '✅ Conferma', payload: 'CONFIRM_YES' },
    { title: '❌ Annulla', payload: 'CONFIRM_NO' },
  ]);
}

async function finalizeBooking(senderId) {
  const orderId = 'ORD-' + Date.now().toString().slice(-6);
  sendEmails(orderId, getSession(senderId).data);
  await send(senderId, `🎉 *Ordine confermato!* ID: #${orderId}`);
  resetSession(senderId);
}

async function askOrderStatus(senderId) {
  getSession(senderId).step = 'await_order_id';
  return send(senderId, '📋 Inserisci il numero ordine (es: ORD-123456):');
}

async function checkOrderStatus(senderId, orderId) {
  await send(senderId, `🔎 Ordine ${orderId}: in lavorazione.`);
  resetSession(senderId);
  return sendMenu(senderId);
}

// =====================================================
// INVIO EMAIL & MESSAGGI
// =====================================================

async function sendEmails(orderId, data) {
  try {
    const est = ((data.priceBase || 18) + 5 * (data.priceKm || 1.8)).toFixed(2);
    const mailOptions = {
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `📋 Nuovo ordine Ri-Do #${orderId}`,
      html: `<h2>Nuovo Ordine #${orderId}</h2><p>Oggetto: ${data.item}</p><p>Prezzo: €${est}</p>`
    };
    await transporter.sendMail(mailOptions);
    console.log("📧 Email admin inviata.");
  } catch (err) {
    console.error("❌ Errore email:", err.message);
  }
}

async function send(recipientId, text) {
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      recipient: { id: recipientId },
      message: { text },
    });
  } catch (err) { console.error('Errore invio:', err.response?.data || err.message); }
}

async function sendQuickReplies(recipientId, text, replies) {
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      recipient: { id: recipientId },
      message: {
        text,
        quick_replies: replies.map(r => ({ content_type: 'text', title: r.title, payload: r.payload }))
      },
    });
  } catch (err) { console.error('Errore replies:', err.response?.data || err.message); }
}

app.listen(PORT, () => console.log(`🟢 Ri-Do Bot attivo su porta ${PORT}`));
