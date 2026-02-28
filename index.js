/**
 * RIDO BOT — VERSIONE DEFINITIVA 2026 🟢
 * Funzionalità: Prenotazione completa, Veicoli, Note, Email Grafiche, Stato Ordine
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
    pass: process.env.GMAIL_PASS, // App Password di Gmail
  },
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.GMAIL_USER;
const FROM_EMAIL = `Ri-Do 🟢 <${process.env.GMAIL_USER}>`;

// =====================================================
// GESTIONE SESSIONI UTENTI
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
// WEBHOOK (VERIFICA E RICEZIONE)
// =====================================================
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
// LOGICA DI CONVERSAZIONE
// =====================================================
async function handleMessage(senderId, message) {
  const session = getSession(senderId);
  const text = message.text ? message.text.trim().toLowerCase() : '';

  // Comandi Reset
  if (['annulla', 'menu', 'stop', 'reset', 'ciao', 'start'].includes(text)) {
    resetSession(senderId);
    if (text === 'ciao' || text === 'start') return sendWelcome(senderId);
    return sendMenu(senderId);
  }

  switch (session.step) {
    case 'await_item_type':
      session.data.item = message.text;
      session.step = 'await_pickup_address';
      return send(senderId, `✅ Hai inserito: *${message.text}*\n\n📍 Adesso dimmi l'indirizzo di *ritiro* (Via e città):`);

    case 'await_pickup_address':
      session.data.pickup = message.text;
      session.step = 'await_drop_address';
      return send(senderId, '🏠 Ricevuto. Qual è l\'indirizzo di *consegna*?');

    case 'await_drop_address':
      session.data.drop = message.text;
      session.step = 'await_vehicle'; 
      return sendVehicleChoice(senderId);

    case 'await_notes':
      session.data.notes = (text === 'nessuna' || text === 'no') ? 'Nessuna nota' : message.text;
      session.step = 'await_email';
      return send(senderId, '📧 Per concludere, scrivi la tua *email* per la conferma (o scrivi "salta"):');

    case 'await_email':
      if (text !== 'salta' && text.includes('@')) {
        session.data.email = text;
        await send(senderId, `✅ Email salvata: ${text}`);
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
    return send(senderId, `📦 Hai scelto: *${session.data.item}*\n\n📍 Qual è l'indirizzo di *ritiro*?`);
  }

  if (payload.startsWith('VEH_')) {
    const parts = payload.split('_'); 
    session.data.vehicle = parts[1];
    session.data.priceBase = parseFloat(parts[2]);
    session.data.priceKm = parseFloat(parts[3]);
    session.step = 'await_notes';
    const est = (session.data.priceBase + (5 * session.data.priceKm)).toFixed(2);
    return send(senderId, `🚐 Veicolo scelto: *${parts[1]}*\n💰 Stima: €${est} (5km incl.)\n\n📝 Hai delle note per il driver? (es. piano, orario) o scrivi *"nessuna"*:`);
  }

  if (payload === 'CONFIRM_YES') return finalizeBooking(senderId);
  if (payload === 'CONFIRM_NO') {
    resetSession(senderId);
    return send(senderId, 'Prenotazione annullata. Scrivi "prenota" quando vuoi.');
  }
}

// =====================================================
// FUNZIONI DI INTERFACCIA (MENU E BOTTONI)
// =====================================================
async function sendWelcome(senderId) {
  await send(senderId, '👋 Ciao! Benvenuto su *Ri-Do* 🟢\nIl tuo assistente per trasporti e traslochi a Caserta.');
  return sendMenu(senderId);
}

async function sendMenu(senderId) {
  return sendQuickReplies(senderId, 'Scegli un\'opzione:', [
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
  const summary = `📋 *RIEPILOGO PRENOTAZIONE*\n\n📦 Oggetto: ${d.item}\n📍 Ritiro: ${d.pickup}\n🏠 Consegna: ${d.drop}\n🚐 Veicolo: ${d.vehicle}\n💰 Prezzo stimato: €${est}\n📧 Email: ${d.email || '—'}\n\nConfermi i dati?`;
  
  return sendQuickReplies(senderId, summary, [
    { title: '✅ Conferma', payload: 'CONFIRM_YES' },
    { title: '❌ Modifica/Annulla', payload: 'CONFIRM_NO' },
  ]);
}

async function finalizeBooking(senderId) {
  const orderId = 'RD-' + Math.floor(100000 + Math.random() * 900000);
  const data = getSession(senderId).data;
  await sendEmails(orderId, data);
  await send(senderId, `🎉 *RICHIESTA INVIATA!*\n\nOrdine: *#${orderId}*\n\nUn driver si metterà in contatto con te qui su Messenger a breve. Grazie! 🟢`);
  resetSession(senderId);
}

async function askOrderStatus(senderId) {
  getSession(senderId).step = 'await_order_id';
  return send(senderId, '📋 Inserisci il codice ordine (es: RD-123456):');
}

async function checkOrderStatus(senderId, orderId) {
  await send(senderId, `🔎 Ordine *${orderId}*: in fase di ricerca driver nelle vicinanze.`);
  resetSession(senderId);
  return sendMenu(senderId);
}

// =====================================================
// INVIO EMAIL GRAFICHE (ADMIN E CLIENTE)
// =====================================================
async function sendEmails(orderId, data) {
  try {
    const est = ((data.priceBase || 18) + 5 * (data.priceKm || 1.8)).toFixed(2);
    
    // Template Admin (Grafica originale Ri-Do)
    const htmlAdmin = `
      <div style="font-family: sans-serif; padding: 20px; background-color: #f4f4f4;">
        <div style="max-width: 600px; margin: auto; background: white; padding: 20px; border-radius: 15px; border: 1px solid #1b4332;">
          <h2 style="color: #1b4332; text-align: center;">📋 Nuovo Ordine #${orderId}</h2>
          <hr>
          <p><b>📦 Oggetto:</b> ${data.item}</p>
          <p><b>📍 Ritiro:</b> ${data.pickup}</p>
          <p><b>🏠 Consegna:</b> ${data.drop}</p>
          <p><b>🚐 Veicolo:</b> ${data.vehicle}</p>
          <p><b>📝 Note:</b> ${data.notes}</p>
          <div style="background: #1b4332; color: white; padding: 15px; text-align: center; border-radius: 10px; margin-top: 20px;">
            <span style="font-size: 20px;">Stima Guadagno: <b>€${est}</b></span>
          </div>
          <p style="margin-top: 20px; font-size: 12px; color: #666;">Cliente: ${data.email || 'Messenger User'}</p>
        </div>
      </div>
    `;

    // Email all'Amministratore
    await transporter.sendMail({
      from: FROM_EMAIL,
      to: ADMIN_EMAIL,
      subject: `🚚 NUOVA CORSA RI-DO #${orderId}`,
      html: htmlAdmin
    });

    // Email al Cliente (se disponibile)
    if (data.email) {
      await transporter.sendMail({
        from: FROM_EMAIL,
        to: data.email,
        subject: `✅ Conferma Prenotazione #${orderId} - Ri-Do`,
        html: `<h3>Il tuo ritiro è stato prenotato!</h3><p>Ciao, abbiamo ricevuto la tua richiesta per il trasporto di <b>${data.item}</b>. Un driver ti contatterà presto.</p>`
      });
    }
  } catch (err) { console.error("❌ Errore Email:", err.message); }
}

// =====================================================
// API FACEBOOK (AXIOS)
// =====================================================
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
