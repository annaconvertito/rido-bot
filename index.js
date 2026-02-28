/**
 * 🟢 RI-DO BOT — VERSIONE COMPLETA 2026
 * Flusso: Benvenuto -> Oggetto -> Ritiro -> Consegna -> Veicolo -> Note -> Email -> Fine
 */

const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(express.json());

// CONFIGURAZIONE AMBIENTE
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'rido-verify-2026';
const PORT = process.env.PORT || 3000;

// CONFIGURAZIONE EMAIL
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS, // App Password Gmail
  },
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.GMAIL_USER;
const FROM_EMAIL = `Ri-Do 🟢 <${process.env.GMAIL_USER}>`;

// GESTIONE SESSIONI
const sessions = {};
function getSession(senderId) {
  if (!sessions[senderId]) sessions[senderId] = { step: 'idle', data: {} };
  return sessions[senderId];
}
function resetSession(senderId) {
  sessions[senderId] = { step: 'idle', data: {} };
}

// WEBHOOK VERIFICA (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ WEBHOOK_VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// WEBHOOK RICEZIONE (POST)
app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    body.entry.forEach(entry => {
      if (entry.messaging && entry.messaging[0]) {
        const event = entry.messaging[0];
        const senderId = event.sender.id;
        if (event.message) handleMessage(senderId, event.message);
        else if (event.postback) handlePostback(senderId, event.postback.payload);
      }
    });
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// GESTIONE MESSAGGI
async function handleMessage(senderId, message) {
  const session = getSession(senderId);
  const text = message.text ? message.text.trim().toLowerCase() : '';

  // Comandi di reset universali
  if (['annulla', 'menu', 'reset', 'ciao', 'start'].includes(text)) {
    resetSession(senderId);
    return (text === 'ciao' || text === 'start') ? sendWelcome(senderId) : sendMenu(senderId);
  }

  switch (session.step) {
    case 'await_item_type':
      session.data.item = message.text;
      session.step = 'await_pickup';
      return send(senderId, `✅ Oggetto: *${message.text}*\n\n📍 Dimmi l'indirizzo di *ritiro*:`);

    case 'await_pickup':
      session.data.pickup = message.text;
      session.step = 'await_drop';
      return send(senderId, '🏠 Ricevuto. Qual è l\'indirizzo di *consegna*?');

    case 'await_drop':
      session.data.drop = message.text;
      session.step = 'await_vehicle';
      return sendVehicleChoice(senderId);

    case 'await_notes':
      session.data.notes = (text === 'nessuna' || text === 'no') ? 'Nessuna' : message.text;
      session.step = 'await_email';
      return send(senderId, '📧 Scrivi la tua *email* per la conferma (o scrivi "salta"):');

    case 'await_email':
      if (text !== 'salta' && text.includes('@')) session.data.email = text;
      return confirmBooking(senderId);

    case 'await_order_id':
      return checkOrderStatus(senderId, text.toUpperCase());

    default:
      return sendMenu(senderId);
  }
}

// GESTIONE POSTBACK
async function handlePostback(senderId, payload) {
  const session = getSession(senderId);
  if (payload === 'PRENOTA') return startBooking(senderId);
  if (payload === 'STATO_ORDINE') return askOrderStatus(senderId);
  
  if (payload.startsWith('ITEM_')) {
    session.data.item = payload.replace('ITEM_', '');
    session.step = 'await_pickup';
    return send(senderId, `📦 Scelto: *${session.data.item}*\n\n📍 Indirizzo di *ritiro*?`);
  }

  if (payload.startsWith('VEH_')) {
    const parts = payload.split('_'); 
    session.data.vehicle = parts[1];
    session.data.priceBase = parseFloat(parts[2]);
    session.data.priceKm = parseFloat(parts[3]);
    session.step = 'await_notes';
    const est = (session.data.priceBase + (5 * session.data.priceKm)).toFixed(2);
    return send(senderId, `🚐 Veicolo: *${parts[1]}* (~€${est})\n\n📝 Note per il driver? (o scrivi *"nessuna"*)`);
  }

  if (payload === 'CONFIRM_YES') return finalizeBooking(senderId);
  if (payload === 'CONFIRM_NO') { resetSession(senderId); return sendMenu(senderId); }
}

// FUNZIONI INTERFACCIA
async function sendWelcome(senderId) {
  await send(senderId, '👋 Ciao! Benvenuto su *Ri-Do* 🟢\nTrasporti e traslochi rapidi a Caserta.');
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
  return sendQuickReplies(senderId, '📦 Cosa trasportiamo?', [
    { title: '🛋️ Mobili', payload: 'ITEM_Mobili' },
    { title: '📺 Elettrodomestici', payload: 'ITEM_Elettrodomestici' },
    { title: '📦 Scatoloni', payload: 'ITEM_Scatoloni' },
  ]);
}

async function sendVehicleChoice(senderId) {
  return sendQuickReplies(senderId, '🚐 Scegli il veicolo:', [
    { title: '🛵 Scooter (€6)', payload: 'VEH_Scooter_6_0.9' },
    { title: '🚐 Furgone (€18)', payload: 'VEH_Furgone_18_1.8' },
    { title: '🚛 Camion (€42)', payload: 'VEH_Camion_42_2.8' },
  ]);
}

async function confirmBooking(senderId) {
  const d = getSession(senderId).data;
  const est = ((d.priceBase || 18) + 5 * (d.priceKm || 1.8)).toFixed(2);
  const summary = `📋 *RIEPILOGO*\n📦 ${d.item}\n📍 Da: ${d.pickup}\n🏠 A: ${d.drop}\n🚐 ${d.vehicle}\n💰 Stima: €${est}\n📧 ${d.email || '—'}\n\nConfermi?`;
  return sendQuickReplies(senderId, summary, [
    { title: '✅ Conferma', payload: 'CONFIRM_YES' },
    { title: '❌ Annulla', payload: 'CONFIRM_NO' },
  ]);
}

async function finalizeBooking(senderId) {
  const orderId = 'RD-' + Math.floor(100000 + Math.random() * 900000);
  const data = getSession(senderId).data;
  await sendEmails(orderId, data);
  await send(senderId, `🎉 *ORDINE INVIATO!* # ${orderId}\n\nUn driver ti scriverà a breve qui su Messenger.`);
  resetSession(senderId);
}

async function askOrderStatus(senderId) {
  getSession(senderId).step = 'await_order_id';
  return send(senderId, '📋 Scrivi il tuo codice ordine:');
}

async function checkOrderStatus(senderId, id) {
  await send(senderId, `🔎 Ordine ${id}: Ricerca driver in corso.`);
  resetSession(senderId); return sendMenu(senderId);
}

// EMAIL E API
async function sendEmails(orderId, data) {
  try {
    const est = ((data.priceBase || 18) + 5 * (data.priceKm || 1.8)).toFixed(2);
    const html = `<div style="font-family:sans-serif;border:2px solid #1b4332;padding:20px;border-radius:15px;">
      <h2 style="color:#1b4332;">🚚 Nuovo Ordine #${orderId}</h2>
      <p><b>📦 Oggetto:</b> ${data.item}</p>
      <p><b>📍 Ritiro:</b> ${data.pickup}</p>
      <p><b>🏠 Consegna:</b> ${data.drop}</p>
      <p><b>🚐 Veicolo:</b> ${data.vehicle}</p>
      <p><b>💰 Prezzo:</b> €${est}</p>
    </div>`;
    await transporter.sendMail({ from: FROM_EMAIL, to: ADMIN_EMAIL, subject: `📦 Nuova Corsa Ri-Do #${orderId}`, html });
  } catch (e) { console.error("Email err:", e.message); }
}

async function send(recipientId, text) {
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      recipient: { id: recipientId }, message: { text }
    });
  } catch (e) { console.error("Send err:", e.response?.data || e.message); }
}

async function sendQuickReplies(recipientId, text, replies) {
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      recipient: { id: recipientId },
      message: { text, quick_replies: replies.map(r => ({ content_type: 'text', title: r.title, payload: r.payload })) }
    });
  } catch (e) { console.error("QR err:", e.response?.data || e.message); }
}

app.listen(PORT, () => console.log(`🟢 Ri-Do Bot Online!`));
