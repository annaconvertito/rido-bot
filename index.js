/**
 * RIDO BOT — Messenger Webhook + Email
 * Gestisce prenotazioni ritiro, notifiche stato ordine e invio email
 * 
 * Avvio: node index.js
 * Richiede: .env con PAGE_ACCESS_TOKEN, VERIFY_TOKEN, GMAIL_USER, GMAIL_PASS
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
// CONFIGURAZIONE EMAIL (Gmail)
// =====================================================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,   // es. rido.caserta@gmail.com
    pass: process.env.GMAIL_PASS,   // App Password Gmail (non la password normale!)
  },
});

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || process.env.GMAIL_USER;
const FROM_EMAIL = `Ri-Do 🟢 <${process.env.GMAIL_USER}>`;

// =====================================================
// TEMPLATE EMAIL
// =====================================================

/** Email di conferma al cliente */
function emailCliente(orderId, data) {
  const est = ((data.priceBase || 18) + 5 * (data.priceKm || 1.8)).toFixed(2);
  return {
    subject: `✅ Prenotazione confermata — Ri-Do #${orderId}`,
    html: `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #F0FBF4; margin: 0; padding: 20px; }
    .card { background: white; border-radius: 16px; max-width: 520px; margin: 0 auto; overflow: hidden; box-shadow: 0 4px 20px rgba(27,67,50,0.10); }
    .header { background: #1B4332; padding: 32px 28px; text-align: center; }
    .logo { font-size: 42px; font-weight: 900; color: white; letter-spacing: -2px; }
    .logo span { color: #F4C430; }
    .header p { color: rgba(255,255,255,0.65); font-size: 13px; margin-top: 6px; letter-spacing: 2px; text-transform: uppercase; }
    .badge { background: #F4C430; color: #0F1F17; font-size: 13px; font-weight: 700; padding: 6px 16px; border-radius: 20px; display: inline-block; margin-top: 14px; }
    .body { padding: 28px; }
    .title { font-size: 20px; font-weight: 700; color: #1B4332; margin-bottom: 6px; }
    .subtitle { font-size: 14px; color: #6B7280; margin-bottom: 24px; }
    .order-id { background: #F0FBF4; border: 1px solid #D8F3DC; border-radius: 10px; padding: 12px 16px; font-size: 13px; color: #2D6A4F; font-weight: 700; letter-spacing: 1px; margin-bottom: 24px; text-align: center; }
    .section { margin-bottom: 20px; }
    .section-title { font-size: 11px; font-weight: 700; color: #9CA3AF; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 10px; }
    .row { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid #F0FBF4; font-size: 14px; }
    .row:last-child { border-bottom: none; }
    .row .lbl { color: #6B7280; min-width: 100px; }
    .row .val { color: #0F1F17; font-weight: 600; }
    .price-box { background: #1B4332; border-radius: 12px; padding: 18px; text-align: center; margin: 20px 0; }
    .price-lbl { font-size: 12px; color: rgba(255,255,255,0.6); text-transform: uppercase; letter-spacing: 1px; }
    .price-val { font-size: 36px; font-weight: 900; color: #F4C430; margin-top: 4px; }
    .price-note { font-size: 11px; color: rgba(255,255,255,0.4); margin-top: 4px; }
    .cta { display: block; background: #2D6A4F; color: white; text-align: center; padding: 16px; border-radius: 12px; font-size: 15px; font-weight: 700; text-decoration: none; margin-top: 24px; }
    .footer { background: #F0FBF4; padding: 20px 28px; text-align: center; font-size: 12px; color: #9CA3AF; line-height: 1.7; }
    .footer a { color: #2D6A4F; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">Ri<span>-</span>Do</div>
      <p>Trasporta · Svuota · Dona</p>
      <div class="badge">🎉 Prenotazione confermata!</div>
    </div>
    <div class="body">
      <div class="title">Ciao! Il tuo ritiro è prenotato.</div>
      <div class="subtitle">Stiamo assegnando il driver più vicino a te. Ti avviseremo su Messenger.</div>

      <div class="order-id">📌 ORDINE #${orderId}</div>

      <div class="section">
        <div class="section-title">Dettagli ritiro</div>
        <div class="row"><span class="lbl">📦 Oggetto</span><span class="val">${data.item || '—'}</span></div>
        <div class="row"><span class="lbl">📍 Ritiro</span><span class="val">${data.pickup || '—'}</span></div>
        <div class="row"><span class="lbl">🏠 Consegna</span><span class="val">${data.drop || '—'}</span></div>
        <div class="row"><span class="lbl">🚐 Veicolo</span><span class="val">${data.vehicle || 'Furgone'}</span></div>
        <div class="row"><span class="lbl">📝 Note</span><span class="val">${data.notes || 'Nessuna'}</span></div>
      </div>

      <div class="price-box">
        <div class="price-lbl">Stima prezzo</div>
        <div class="price-val">€ ${est}</div>
        <div class="price-note">Prezzo finale confermato dal driver</div>
      </div>

      <a href="https://m.me/rido.caserta" class="cta">📱 Torna su Messenger per seguire il ritiro</a>
    </div>
    <div class="footer">
      Ri-Do · Caserta e provincia<br>
      <a href="mailto:info@rido.it">info@rido.it</a> · <a href="https://rido.it">rido.it</a><br><br>
      Hai bisogno di aiuto? Rispondi a questa email o scrivici su Messenger.
    </div>
  </div>
</body>
</html>`,
  };
}

/** Email di notifica al driver */
function emailDriver(orderId, data, driverName) {
  return {
    subject: `🚐 Nuova corsa assegnata — Ri-Do #${orderId}`,
    html: `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; background: #0F1F17; margin: 0; padding: 20px; }
    .card { background: #162A1E; border-radius: 16px; max-width: 480px; margin: 0 auto; overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
    .header { background: #1E3828; padding: 24px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.08); }
    .logo { font-size: 32px; font-weight: 900; color: white; }
    .logo span { color: #F4C430; }
    .earn { font-size: 48px; font-weight: 900; color: #F4C430; text-align: center; padding: 20px; }
    .earn-lbl { font-size: 12px; color: rgba(255,255,255,0.4); text-align: center; margin-top: -16px; padding-bottom: 20px; text-transform: uppercase; letter-spacing: 1px; }
    .body { padding: 20px 24px; }
    .row { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 14px; color: rgba(255,255,255,0.7); }
    .row:last-child { border-bottom: none; }
    .row .lbl { min-width: 80px; color: rgba(255,255,255,0.4); }
    .row .val { color: white; font-weight: 600; }
    .alert { background: rgba(244,196,48,0.1); border: 1px solid rgba(244,196,48,0.3); border-radius: 10px; padding: 12px 16px; font-size: 13px; color: #F4C430; margin: 16px 0; }
    .footer { padding: 16px 24px; font-size: 12px; color: rgba(255,255,255,0.3); text-align: center; border-top: 1px solid rgba(255,255,255,0.06); }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logo">Ri<span>-</span>Do</div>
    </div>
    <div class="earn">€ ${((data.priceBase || 18) + 5 * (data.priceKm || 1.8)).toFixed(2)}</div>
    <div class="earn-lbl">Guadagno stimato · Ordine #${orderId}</div>
    <div class="body">
      <div class="row"><span class="lbl">📦 Oggetto</span><span class="val">${data.item || '—'}</span></div>
      <div class="row"><span class="lbl">📍 Ritiro</span><span class="val">${data.pickup || '—'}</span></div>
      <div class="row"><span class="lbl">🏠 Consegna</span><span class="val">${data.drop || '—'}</span></div>
      <div class="row"><span class="lbl">🚐 Veicolo</span><span class="val">${data.vehicle || 'Furgone'}</span></div>
      <div class="row"><span class="lbl">📝 Note</span><span class="val">${data.notes || 'Nessuna'}</span></div>
      <div class="alert">⚠️ Accetta la corsa sull'app entro 3 minuti, altrimenti verrà assegnata ad un altro driver.</div>
    </div>
    <div class="footer">Ri-Do · info@rido.it</div>
  </div>
</body>
</html>`,
  };
}

/** Email riepilogo all'admin */
function emailAdmin(orderId, data) {
  const est = ((data.priceBase || 18) + 5 * (data.priceKm || 1.8)).toFixed(2);
  return {
    subject: `📋 Nuovo ordine Ri-Do #${orderId}`,
    html: `
<div style="font-family:Arial,sans-serif;padding:20px;max-width:480px;">
  <h2 style="color:#1B4332;">📋 Nuovo ordine #${orderId}</h2>
  <p><b>Oggetto:</b> ${data.item}</p>
  <p><b>Ritiro:</b> ${data.pickup}</p>
  <p><b>Consegna:</b> ${data.drop}</p>
  <p><b>Veicolo:</b> ${data.vehicle || 'Furgone'}</p>
  <p><b>Note:</b> ${data.notes || 'Nessuna'}</p>
  <p><b>Stima:</b> €${est}</p>
  <p><b>Email cliente:</b> ${data.email || 'non fornita'}</p>
  <hr>
  <p style="color:#9CA3AF;font-size:12px;">${new Date().toLocaleString('it-IT')}</p>
</div>`,
  };
}

// =====================================================
// FUNZIONE INVIO EMAIL
// =====================================================
async function sendEmails(orderId, data) {
  try {
    // 1. Email al cliente (se ha fornito email)
    if (data.email) {
      const { subject, html } = emailCliente(orderId, data);
      await transporter.sendMail({
        from: FROM_EMAIL,
        to: data.email,
        subject,
        html,
      });
      console.log(`📧 Email cliente inviata a ${data.email}`);
    }

    // 2. Email al driver (in produzione: email del driver assegnato)
    const driverEmail = process.env.DRIVER_EMAIL;
    if (driverEmail) {
      const { subject, html } = emailDriver(orderId, data, 'Giovanni P.');
      await transporter.sendMail({
        from: FROM_EMAIL,
        to: driverEmail,
        subject,
        html,
      });
      console.log(`📧 Email driver inviata a ${driverEmail}`);
    }

    // 3. Email all'admin
    if (ADMIN_EMAIL) {
      const { subject, html } = emailAdmin(orderId, data);
      await transporter.sendMail({
        from: FROM_EMAIL,
        to: ADMIN_EMAIL,
        subject,
        html,
      });
      console.log(`📧 Email admin inviata a ${ADMIN_EMAIL}`);
    }
  } catch (err) {
    console.error('❌ Errore invio email:', err.message);
  }
}


// =====================================================
// STATO SESSIONI UTENTI (in memoria — per produzione usa Redis/DB)
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
// WEBHOOK VERIFY (richiesto da Meta)
// =====================================================
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
    console.log('================ DEBUG WEBHOOK ================');
  console.log('1️⃣ Tutti i parametri ricevuti:', req.query);
  console.log('2️⃣ mode:', mode);
  console.log('3️⃣ token:', token);
  console.log('4️⃣ challenge:', challenge);
  console.log('5️⃣ VERIFY_TOKEN nel codice:', VERIFY_TOKEN);
  console.log('6️⃣ tipo del token ricevuto:', typeof token);
  console.log('7️⃣ lunghezza token ricevuto:', token ? token.length : 'null');
  console.log('8️⃣ token === VERIFY_TOKEN?', token === VERIFY_TOKEN);
  console.log('================================================');

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificato!');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Verifica webhook fallita');
    res.sendStatus(403);
  }
});

// =====================================================
// WEBHOOK RECEIVE — riceve messaggi da Messenger
// =====================================================
app.post('/webhook', (req, res) => {
  const body = req.body;

  if (body.object === 'page') {
    body.entry.forEach(entry => {
      const event = entry.messaging[0];
      const senderId = event.sender.id;

      if (event.message) {
        handleMessage(senderId, event.message);
      } else if (event.postback) {
        handlePostback(senderId, event.postback.payload);
      }
    });
    res.status(200).send('EVENT_RECEIVED');
  } else {
    res.sendStatus(404);
  }
});

// =====================================================
// GESTIONE MESSAGGI
// =====================================================
async function handleMessage(senderId, message) {
  const session = getSession(senderId);
  const text = message.text ? message.text.trim().toLowerCase() : '';

  // Comando reset sempre disponibile
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
      } else if (text.includes('ciao') || text.includes('salve') || text.includes('hello') || text === 'start') {
        return sendWelcome(senderId);
      } else {
        return sendMenu(senderId);
      }

    case 'await_item_type':
      return handleItemType(senderId, text, message.text);

    case 'await_pickup_address':
      session.data.pickup = message.text;
      session.step = 'await_drop_address';
      return send(senderId, '📍 Perfetto! Ora dimmi l\'indirizzo di *consegna*:\n(es. Via Napoli 88, Caserta)');

    case 'await_drop_address':
      session.data.drop = message.text;
      session.step = 'await_vehicle';
      return sendVehicleChoice(senderId);

    case 'await_vehicle':
      return handleVehicleChoice(senderId, text, message.text);

    case 'await_notes':
      session.data.notes = message.text === 'nessuna' ? '' : message.text;
      session.step = 'await_email';
      return send(senderId, '📧 Vuoi ricevere la conferma via email?\nScrivi la tua email oppure *"salta"* per continuare senza.');

    case 'await_email':
      if (text !== 'salta' && text !== 'no' && text.includes('@')) {
        session.data.email = message.text.trim();
        await send(senderId, `✅ Email salvata: ${session.data.email}`);
      }
      return confirmBooking(senderId);

    case 'await_order_id':
      return checkOrderStatus(senderId, message.text.trim().toUpperCase());

    default:
      return sendMenu(senderId);
  }
}

// =====================================================
// GESTIONE POSTBACK (bottoni quick reply)
// =====================================================
async function handlePostback(senderId, payload) {
  const session = getSession(senderId);

  if (payload === 'GET_STARTED' || payload === 'MENU') {
    resetSession(senderId);
    return sendWelcome(senderId);
  }

  if (payload === 'PRENOTA') return startBooking(senderId);
  if (payload === 'STATO_ORDINE') return askOrderStatus(senderId);

  if (payload.startsWith('ITEM_')) {
    const item = payload.replace('ITEM_', '');
    session.data.item = item;
    session.step = 'await_pickup_address';
    return send(senderId, `✅ Hai scelto: *${item}*\n\n📍 Qual è l\'indirizzo di *ritiro*?\n(es. Via Roma 12, Caserta)`);
  }

  if (payload.startsWith('VEH_')) {
    const [, veh, base, km] = payload.split('_');
    session.data.vehicle = veh;
    session.data.priceBase = parseFloat(base);
    session.data.priceKm = parseFloat(km);
    session.step = 'await_notes';

    const est = (parseFloat(base) + 5 * parseFloat(km)).toFixed(2);
    return send(senderId,
      `🚐 Veicolo scelto: *${veh}*\n💰 Stima prezzo: circa €${est} (5 km)\n\n📝 Hai note per il driver?\n(piano, citofono, orari...) oppure scrivi *"nessuna"*`
    );
  }

  if (payload === 'CONFIRM_YES') return finalizeBooking(senderId);
  if (payload === 'CONFIRM_NO') {
    resetSession(senderId);
    return send(senderId, 'Ok, prenotazione annullata. Scrivi *"prenota"* quando vuoi riprovare.');
  }
}

// =====================================================
// FLUSSO PRENOTAZIONE
// =====================================================
async function sendWelcome(senderId) {
  await send(senderId,
    '👋 Ciao! Sono il bot di *Ri-Do* 🟢\n\nTrasportiamo mobili, elettrodomestici, traslochi e molto altro nella zona di Caserta.\n\nCosa vuoi fare?'
  );
  return sendMenu(senderId);
}

async function sendMenu(senderId) {
  return sendQuickReplies(senderId, 'Scegli un\'opzione:', [
    { title: '📦 Prenota un ritiro', payload: 'PRENOTA' },
    { title: '📋 Stato del mio ordine', payload: 'STATO_ORDINE' },
  ]);
}

async function startBooking(senderId) {
  const session = getSession(senderId);
  session.step = 'await_item_type';

  return sendQuickReplies(senderId, '📦 *Cosa dobbiamo trasportare?*\nScegli la categoria:', [
    { title: '🛋️ Mobili', payload: 'ITEM_Mobili' },
    { title: '📺 Elettrodomestici', payload: 'ITEM_Elettrodomestici' },
    { title: '📦 Scatoloni', payload: 'ITEM_Scatoloni' },
    { title: '🏗️ Trasloco completo', payload: 'ITEM_Trasloco completo' },
    { title: '🏋️ Attrezzi/Sport', payload: 'ITEM_Attrezzi sportivi' },
    { title: '✏️ Altro', payload: 'ITEM_Altro' },
  ]);
}

async function handleItemType(senderId, text, originalText) {
  const session = getSession(senderId);
  session.data.item = originalText;
  session.step = 'await_pickup_address';
  return send(senderId, `✅ Annotato: *${originalText}*\n\n📍 Qual è l\'indirizzo di *ritiro*?\n(es. Via Roma 12, Caserta)`);
}

async function sendVehicleChoice(senderId) {
  const session = getSession(senderId);
  session.step = 'await_vehicle';

  return sendQuickReplies(senderId, '🚐 *Che veicolo serve?*', [
    { title: '🛵 Scooter (max 20kg) - €6', payload: 'VEH_Scooter_6_0.9' },
    { title: '🚐 Furgone piccolo - €18', payload: 'VEH_Furgone piccolo_18_1.8' },
    { title: '🚐 Furgone medio - €24', payload: 'VEH_Furgone medio_24_2.0' },
    { title: '🚛 Camion - €42', payload: 'VEH_Camion_42_2.8' },
  ]);
}

async function handleVehicleChoice(senderId, text, originalText) {
  const session = getSession(senderId);
  // Se arriva come testo libero
  session.data.vehicle = originalText;
  session.data.priceBase = 18;
  session.data.priceKm = 1.8;
  session.step = 'await_notes';
  const est = (18 + 5 * 1.8).toFixed(2);
  return send(senderId, `✅ Veicolo: *${originalText}*\n💰 Stima: circa €${est}\n\n📝 Note per il driver? (piano, citofono...) oppure *"nessuna"*`);
}

async function confirmBooking(senderId) {
  const session = getSession(senderId);
  const d = session.data;
  const est = ((d.priceBase || 18) + 5 * (d.priceKm || 1.8)).toFixed(2);

  const summary =
    `📋 *Riepilogo prenotazione:*\n\n` +
    `📦 Oggetto: ${d.item}\n` +
    `📍 Ritiro: ${d.pickup}\n` +
    `🏠 Consegna: ${d.drop}\n` +
    `🚐 Veicolo: ${d.vehicle || 'Furgone'}\n` +
    `💰 Stima: ~€${est}\n` +
    `📝 Note: ${d.notes || 'nessuna'}\n\n` +
    `Confermi la prenotazione?`;

  session.step = 'await_confirm';
  return sendQuickReplies(senderId, summary, [
    { title: '✅ Conferma', payload: 'CONFIRM_YES' },
    { title: '❌ Annulla', payload: 'CONFIRM_NO' },
  ]);
}

async function finalizeBooking(senderId) {
  const session = getSession(senderId);
  const orderId = 'ORD-' + Date.now().toString().slice(-6);
  const data = session.data;

  // Invia tutte le email in background
  sendEmails(orderId, data);

  await send(senderId,
    `🎉 *Prenotazione confermata!*\n\n` +
    `📌 Numero ordine: *#${orderId}*\n` +
    (data.email ? `📧 Conferma inviata a: ${data.email}\n` : '') +
    `⏱ Stiamo cercando un driver disponibile...\n` +
    `📱 Ti avviseremo appena assegnato!\n\n` +
    `Per controllare lo stato scrivi: *stato ordine*`
  );

  resetSession(senderId);

  // Simula notifica driver assegnato dopo 3 secondi
  setTimeout(async () => {
    await send(senderId,
      `🚐 *Driver assegnato!*\n\n` +
      `👤 Giovanni P. · ⭐ 4.9\n` +
      `🚐 Fiat Doblò · CA 123 AB\n` +
      `⏱ Arrivo stimato: ~12 minuti\n\n` +
      `Puoi chattare con il driver rispondendo qui.`
    );
  }, 3000);
}

// =====================================================
// STATO ORDINE
// =====================================================
async function askOrderStatus(senderId) {
  const session = getSession(senderId);
  session.step = 'await_order_id';
  return send(senderId, '📋 Dimmi il numero del tuo ordine:\n(es. ORD-123456)');
}

async function checkOrderStatus(senderId, orderId) {
  // In produzione: cerca su DB
  // Qui simuliamo
  const fakeStatuses = {
    'ORD-123456': { status: '🚐 Driver in arrivo', eta: '8 minuti', driver: 'Giovanni P.' },
    'ORD-000000': { status: '✅ Consegnato', eta: null, driver: 'Marco R.' },
  };

  const order = fakeStatuses[orderId];

  if (order) {
    let msg = `📋 *Ordine ${orderId}*\n\nStato: ${order.status}\n👤 Driver: ${order.driver}`;
    if (order.eta) msg += `\n⏱ ETA: ${order.eta}`;
    await send(senderId, msg);
  } else if (orderId.startsWith('ORD-')) {
    await send(senderId,
      `📋 *Ordine ${orderId}*\n\n✅ Confermato · Driver assegnato\n⏱ In lavorazione\n\nPer assistenza scrivi a info@rido.it`
    );
  } else {
    await send(senderId, `❌ Ordine "${orderId}" non trovato.\nControlla il numero e riprova.`);
  }

  resetSession(senderId);
  return sendMenu(senderId);
}

// =====================================================
// HELPER: invia messaggio semplice
// =====================================================
async function send(recipientId, text) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: { text },
        messaging_type: 'RESPONSE',
      },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
  } catch (err) {
    console.error('Errore invio messaggio:', err.response?.data || err.message);
  }
}

// =====================================================
// HELPER: invia quick replies (bottoni)
// =====================================================
async function sendQuickReplies(recipientId, text, replies) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/me/messages`,
      {
        recipient: { id: recipientId },
        message: {
          text,
          quick_replies: replies.map(r => ({
            content_type: 'text',
            title: r.title.substring(0, 20), // max 20 char
            payload: r.payload,
          })),
        },
        messaging_type: 'RESPONSE',
      },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
  } catch (err) {
    console.error('Errore quick replies:', err.response?.data || err.message);
  }
}

// =====================================================
// AVVIA SERVER
// =====================================================
    app.listen(PORT, '0.0.0.0', () => {
  console.log(`🟢 Ri-Do Bot attivo su porta ${PORT}`);
  console.log(`🌐 URL pubblico: https://rido-bot.onrender.com`);
  console.log(`🔑 Verify Token: rido-verify-2026`);
  console.log(`📡 Endpoint webhook: /webhook`);
});
