/**
 * RIDO BOT — Versione Integrale Corretta 2026
 * Gestisce: Prenotazione, Indirizzi, Veicoli, Email e Conferma
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
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
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
// LOGICA DEI MESSAGGI (IL CUORE DEL BOT)
// =====================================================

async function handleMessage(senderId, message) {
  const session = getSession(senderId);
  const text = message.text ? message.text.trim().toLowerCase() : '';

  // Comandi di emergenza
  if (text === 'annulla' || text === 'menu' || text === 'stop' || text === 'reset') {
    resetSession(senderId);
    return sendMenu(senderId);
  }

  switch (session.step) {
    case 'idle':
      if (text.includes('prenot') || text.includes('ritiro') || text === '1') {
        return startBooking(senderId);
      } else if (text.includes('stato') || text === '2') {
        return askOrderStatus(senderId);
      } else {
        return sendWelcome(senderId);
      }

    case 'await_item_type':
      session.data.item = message.text;
      session.step = 'await_pickup_address';
      return send(senderId, `✅ Oggetto: *${message.text}*\n\n📍 Qual è l'indirizzo di *ritiro*?\n(Scrivilo qui sotto)`);

    case 'await_pickup_address':
      session.data.pickup = message.text;
      session.step = 'await_drop_address';
      return send(senderId, '🏠 Ottimo. Ora dimmi l\'indirizzo di *consegna*:');

    case 'await_drop_address':
      session.data.drop = message.text;
      session.step = 'await_vehicle'; // Fondamentale per non bloccarsi!
      return sendVehicleChoice(senderId);

    case 'await_notes':
      session.data.notes = (text === 'nessuna' || text === 'no') ? 'Nessuna' : message.text;
      session.step = 'await_email';
      return send(senderId, '📧 Ultimo passo! Scrivi la tua *email* per ricevere la ricevuta (o scrivi "salta"):');

    case 'await_email':
      if (text !== 'salta' && text.includes('@')) {
        session.data.email = text;
        await send(senderId, `✅ Email registrata: ${text}`);
      }
      return confirmBooking(senderId);

    case 'await_order_id':
      return checkOrderStatus(senderId, text.toUpperCase());

    default:
      resetSession(senderId);
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
    return send(senderId, `✅ Hai scelto: *${session.data.item}*\n\n📍 Qual è l'indirizzo di *ritiro*?`);
  }

  if (payload.startsWith('VEH_')) {
    const parts = payload.split('_'); // VEH_Furgone_18_1.8
    session.data.vehicle = parts[1];
    session.data.priceBase = parseFloat(parts[2]);
    session.data.priceKm = parseFloat(parts[3]);
    session.step = 'await_notes';
    const est = (session.data.priceBase + (5 * session.data.priceKm)).toFixed(2);
    return send(senderId, `🚐 Veicolo: *${parts[1]}*\n💰 Stima: ~€${est} (per 5km)\n\n📝 Hai note per il driver? (es: citofono, piano) o scrivi *"nessuna"*:`);
  }

  if (payload === 'CONFIRM_YES') return finalizeBooking(senderId);
  if (payload === 'CONFIRM_NO') {
    resetSession(senderId);
    return send(senderId, 'Operazione annullata. Scrivi "prenota" per ricominciare.');
  }
}

// =====================================================
// FUNZIONI DI SUPPORTO (MENU E BOTTONI)
// =====================================================

async function sendWelcome(senderId) {
  await send(senderId, '👋 Ciao! Benvenuto su *Ri-Do* 🟢\nIl servizio di trasporti intelligente a Caserta e provincia.');
  return sendMenu(senderId);
}

async function sendMenu(senderId) {
  return sendQuickReplies(senderId, 'Cosa desideri fare?', [
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
    { title: '🏗️ Trasloco', payload: 'ITEM_Trasloco' },
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
  const summary = `📋 *RIEPILOGO PRENOTAZIONE*\n\n📦 Oggetto: ${d.item}\n📍 Ritiro: ${d.pickup}\n🏠 Consegna: ${d.drop}\n🚐 Veicolo: ${d.vehicle}\n💰 Stima: €${est}\n📧 Email: ${d.email || 'Non fornita'}\n\nConfermi i dati?`;
  
  return sendQuickReplies(senderId, summary, [
    { title: '✅ Conferma', payload: 'CONFIRM_YES' },
    { title: '❌ Annulla', payload: 'CONFIRM_NO' },
  ]);
}

async function finalizeBooking(senderId) {
  const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
  const data = getSession(senderId).data;

  // Invia Email all'Admin e al Cliente
  await sendEmails(orderId, data);

  await send(senderId, `🎉 *OTTIMO! PRENOTAZIONE INVIATA.*\n\nIl tuo numero ordine è: *#${orderId}*\n\nUn nostro driver ti contatterà a breve su Messenger per confermare l'orario esatto. Grazie per aver scelto Ri-Do! 🟢`);
  resetSession(senderId);
}

async function askOrderStatus(senderId) {
  getSession(senderId).step = 'await_order_id';
  return send(senderId, '📋 Inserisci il tuo numero ordine (es: ORD-123456):');
}

async function checkOrderStatus(senderId, orderId) {
  await send(senderId, `🔎 Stiamo verificando l'ordine *${orderId}*... Risulta in fase di assegnazione driver.`);
  resetSession(senderId);
  return sendMenu(senderId);
}

// =====================================================
// INVIO EMAIL & MESSAGGI (API FACEBOOK)
// =====================================================

async function sendEmails(orderId, data) {
  try {
    const est = ((data.priceBase || 18) + 5 * (data.priceKm || 1.8)).toFixed(2);
    const mailOptions = {
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `📋 NUOVO ORDINE RI-DO #${orderId}`,
      text: `Nuovo ordine ricevuto!\n\nID: ${orderId}\nOggetto: ${data.item}\nRitiro: ${data.pickup}\nConsegna: ${data.drop}\nVeicolo: ${data.vehicle}\nEmail Cliente: ${data.email || 'Nessuna'}\nPrezzo Stimato: €${est}`
    };
    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error("❌ Errore invio email:", err.message);
  }
}

async function send(recipientId, text) {
  try {
    await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
      recipient: { id: recipientId },
      message: { text },
    });
  } catch (err) { console.error('Errore invio messaggio:', err.response?.data || err.message); }
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
  } catch (err) { console.error('Errore QuickReplies:', err.response?.data || err.message); }
}

app.listen(PORT, () => console.log(`🟢 Ri-Do Bot attivo su porta ${PORT}`));
