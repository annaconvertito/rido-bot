/**
 * 🟢 RIDO BOT — VERSIONE DEFINITIVA E CORRETTA
 * Risolve il loop dei pulsanti e il blocco degli indirizzi
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

app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    body.entry.forEach(entry => {
      if (entry.messaging && entry.messaging[0]) {
        const event = entry.messaging[0];
        const senderId = event.sender.id;

        // PRIORITÀ 1: Clic sui pulsanti (Quick Replies o Postback)
        if (event.postback || (event.message && event.message.quick_reply)) {
          const payload = event.postback ? event.postback.payload : event.message.quick_reply.payload;
          handlePayload(senderId, payload);
        } 
        // PRIORITÀ 2: Messaggi di testo semplici
        else if (event.message && event.message.text) {
          handleText(senderId, event.message.text);
        }
      }
    });
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// =====================================================
// LOGICA PULSANTI (PAYLOAD)
// =====================================================

async function handlePayload(senderId, payload) {
  const session = getSession(senderId);

  if (payload === 'PRENOTA') return startBooking(senderId);
  if (payload === 'STATO_ORDINE') return askOrderStatus(senderId);
  
  if (payload.startsWith('ITEM_')) {
    session.data.item = payload.replace('ITEM_', '');
    session.step = 'await_pickup_address';
    return send(senderId, `✅ Oggetto: *${session.data.item}*\n\n📍 Qual è l'indirizzo di *ritiro*?`);
  }

  if (payload.startsWith('VEH_')) {
    const parts = payload.split('_'); // VEH_Furgone_18_1.8
    session.data.vehicle = parts[1];
    session.data.priceBase = parseFloat(parts[2]);
    session.data.priceKm = parseFloat(parts[3]);
    session.step = 'await_notes';
    const est = (session.data.priceBase + (5 * session.data.priceKm)).toFixed(2);
    return send(senderId, `🚐 Veicolo: *${parts[1]}*\n💰 Stima: ~€${est} (per 5km)\n\n📝 Note per il driver? (es: piano, citofono) o scrivi *"nessuna"*:`);
  }

  if (payload === 'CONFIRM_YES') return finalizeBooking(senderId);
  if (payload === 'CONFIRM_NO') {
    resetSession(senderId);
    return sendMenu(senderId);
  }
}

// =====================================================
// LOGICA TESTO SCRITTO
// =====================================================

async function handleText(senderId, text) {
  const session = getSession(senderId);
  const cleanText = text.trim().toLowerCase();

  // Comandi reset
  if (['annulla', 'menu', 'reset', 'ciao'].includes(cleanText)) {
    resetSession(senderId);
    return sendMenu(senderId);
  }

  // Gestione degli step testuali
  switch (session.step) {
    case 'idle':
      return sendMenu(senderId);

    case 'await_pickup_address':
      session.data.pickup = text;
      session.step = 'await_drop_address';
      return send(senderId, '🏠 Ricevuto. Ora dimmi l\'indirizzo di *consegna*:');

    case 'await_drop_address':
      session.data.drop = text;
      session.step = 'await_vehicle';
      return sendVehicleChoice(senderId);

    case 'await_notes':
      session.data.notes = (cleanText === 'nessuna' || cleanText === 'no') ? 'Nessuna' : text;
      session.step = 'await_email';
      return send(senderId, '📧 Ultimo passo! Scrivi la tua *email* per la conferma (o scrivi "salta"):');

    case 'await_email':
      if (cleanText !== 'salta' && cleanText.includes('@')) {
        session.data.email = text;
      }
      return confirmBooking(senderId);

    case 'await_order_id':
      return checkOrderStatus(senderId, text.toUpperCase());

    default:
      // Se l'utente scrive a caso fuori dagli step, rimandiamo al menu
      return sendMenu(senderId);
  }
}

// =====================================================
// FUNZIONI DI INTERFACCIA
// =====================================================

async function sendMenu(senderId) {
  return sendQuickReplies(senderId, '👋 Benvenuto su Ri-Do 🟢\nCosa desideri fare?', [
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
  return sendQuickReplies(senderId, '🚐 Quale veicolo ti serve?', [
    { title: '🛵 Scooter (€6)', payload: 'VEH_Scooter_6_0.9' },
    { title: '🚐 Furgone P (€18)', payload: 'VEH_FurgonePiccolo_18_1.8' },
    { title: '🚐 Furgone M (€24)', payload: 'VEH_FurgoneMedio_24_2.0' },
    { title: '🚛 Camion (€42)', payload: 'VEH_Camion_42_2.8' },
  ]);
}

async function confirmBooking(senderId) {
  const d = getSession(senderId).data;
  const est = ((d.priceBase || 18) + 5 * (d.priceKm || 1.8)).toFixed(2);
  const summary = `📋 *RIEPILOGO:*\n📦 ${d.item}\n📍 Da: ${d.pickup}\n🏠 A: ${d.drop}\n🚐 ${d.vehicle}\n💰 Stima: €${est}\n📧 ${d.email || '—'}\n\nConfermi i dati?`;
  
  return sendQuickReplies(senderId, summary, [
    { title: '✅ Conferma', payload: 'CONFIRM_YES' },
    { title: '❌ Annulla', payload: 'CONFIRM_NO' },
  ]);
}

async function finalizeBooking(senderId) {
  const orderId = 'RD-' + Math.floor(100000 + Math.random() * 900000);
  const data = getSession(senderId).data;
  await sendEmails(orderId, data);
  await send(senderId, `🎉 *RICHIESTA INVIATA!*\nID Ordine: *#${orderId}*\n\nUn driver ti contatterà a breve su Messenger.`);
  resetSession(senderId);
}

async function askOrderStatus(senderId) {
  getSession(senderId).step = 'await_order_id';
  return send(senderId, '📋 Inserisci il numero ordine (es: RD-123456):');
}

async function checkOrderStatus(senderId, orderId) {
  await send(senderId, `🔎 Ordine *${orderId}*: ricerca driver in corso.`);
  resetSession(senderId);
  return sendMenu(senderId);
}

// =====================================================
// EMAIL & API FACEBOOK
// =====================================================

async function sendEmails(orderId, data) {
  try {
    const est = ((data.priceBase || 18) + 5 * (data.priceKm || 1.8)).toFixed(2);
    const htmlBody = `
      <div style="font-family:sans-serif; border:2px solid #1b4332; padding:20px; border-radius:15px;">
        <h2 style="color:#1b4332;">🚚 Nuovo Ordine Ri-Do #${orderId}</h2>
        <p><b>📦 Oggetto:</b> ${data.item}</p>
        <p><b>📍 Ritiro:</b> ${data.pickup}</p>
        <p><b>🏠 Consegna:</b> ${data.drop}</p>
        <p><b>🚐 Veicolo:</b> ${data.vehicle}</p>
        <p><b>📝 Note:</b> ${data.notes || 'Nessuna'}</p>
        <hr>
        <p style="font-size:18px;"><b>💰 Stima Prezzo: €${est}</b></p>
        <p>📧 Email Cliente: ${data.email || 'Messenger User'}</p>
      </div>
    `;
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `🚚 NUOVA PRENOTAZIONE RI-DO #${orderId}`,
      html: htmlBody
    });
  } catch (err) { console.error("❌ Errore email:", err.message); }
}

async function send(recipientId, text) {
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      recipient: { id: recipientId },
      message: { text },
    });
  } catch (err) { console.error('Invio err:', err.response?.data || err.message); }
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
  } catch (err) { console.error('QR err:', err.response?.data || err.message); }
}

app.listen(PORT, () => console.log(`🟢 Ri-Do Bot attivo su porta ${PORT}`));
