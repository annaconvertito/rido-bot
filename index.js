/**
 * 🟢 RIDO LOGISTICS ULTIMATE 2026
 * Funzioni: Foto Obbligatoria, GPS, Calcolo Prezzo, Stripe/PayPal, Email Admin
 */

const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
app.use(express.json());

// --- CONFIGURAZIONE ---
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'rido-verify-2026';
const PORT = process.env.PORT || 3000;
const TELEFONO_ASSISTENZA = process.env.TELEFONO_DRIVER || "+390000000000";

const transporter = nodemailer.createTransport({
  service: 'gmail',
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

// --- WEBHOOK VERIFICA ---
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
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
    await send(senderId, "📸 Foto ricevuta! Ora sappiamo cosa trasportare.");
    return send(senderId, "📍 Inviaci l'indirizzo di RITIRO (o usa la posizione GPS 📎):");
  }

  if (att.type === 'location' && session.step === 'await_pickup') {
    const { lat, long } = att.payload.coordinates;
    session.data.pickup = `https://www.google.com/maps?q=${lat},${long}`;
    session.step = 'await_drop';
    return send(senderId, "📍 Posizione GPS salvata. Ora scrivi l'indirizzo di CONSEGNA:");
  }
}

// --- LOGICA PULSANTI (PAYLOAD) ---
async function handlePayload(senderId, payload) {
  const session = getSession(senderId);

  if (payload === 'PRENOTA') {
    session.step = 'await_item';
    return sendQuickReplies(senderId, "📦 Cosa dobbiamo trasportare?", [
      { title: '🛋️ Mobili', payload: 'ITEM_Mobili' },
      { title: '📺 Elettrodomestici', payload: 'ITEM_Elettrodomestici' },
      { title: '📦 Altro', payload: 'ITEM_Altro' }
    ]);
  }

  if (payload.startsWith('ITEM_')) {
    session.data.item = payload.split('_')[1];
    session.step = 'await_photo';
    return send(senderId, `Hai scelto: ${session.data.item}.\n\n📸 Per favore, scatta o invia una FOTO dell'oggetto.`);
  }

  if (payload.startsWith('VEH_')) {
    const p = payload.split('_');
    session.data.vehicle = p[1];
    session.data.priceBase = parseFloat(p[2]);
    session.data.priceKm = parseFloat(p[3]);
    session.step = 'await_email';
    return send(senderId, "📧 Inserisci la tua EMAIL per la conferma:");
  }

  if (payload === 'CONFIRM_PAY') return createPaymentLink(senderId);
  if (payload === 'RESET') { resetSession(senderId); return sendMenu(senderId); }
}

// --- LOGICA TESTO ---
async function handleText(senderId, text) {
  const session = getSession(senderId);
  const msg = text.toLowerCase().trim();

  if (['menu', 'reset', 'ciao'].includes(msg)) { resetSession(senderId); return sendMenu(senderId); }

  switch (session.step) {
    case 'await_pickup':
      session.data.pickup = text;
      session.step = 'await_drop';
      return send(senderId, "🏠 Ricevuto. Indirizzo di CONSEGNA?");

    case 'await_drop':
      session.data.drop = text;
      session.step = 'await_vehicle';
      return sendVehicleChoice(senderId);

    case 'await_email':
      if (!text.includes('@')) return send(senderId, "⚠️ Email non valida. Riprova:");
      session.data.email = text;
      return confirmBooking(senderId);

    default: return sendMenu(senderId);
  }
}

// --- INTERFACCIA E PAGAMENTI ---
async function sendMenu(senderId) {
  return sendQuickReplies(senderId, "🚚 Benvenuto su Ri-Do 🟢\nCosa desideri fare?", [
    { title: '📦 Prenota ritiro', payload: 'PRENOTA' }
  ]);
}

async function sendVehicleChoice(senderId) {
  return sendQuickReplies(senderId, "🚐 Scegli il veicolo:", [
    { title: '🛵 Scooter (€6)', payload: 'VEH_Scooter_6_0.9' },
    { title: '🚐 Furgone (€18)', payload: 'VEH_Furgone_18_1.8' },
    { title: '🚛 Camion (€42)', payload: 'VEH_Camion_42_2.8' }
  ]);
}

async function confirmBooking(senderId) {
  const d = getSession(senderId).data;
  const totale = (d.priceBase + (10 * d.priceKm)).toFixed(2);
  const summary = `📋 RIEPILOGO:\n📦 ${d.item}\n📍 Ritiro: ${d.pickup.includes('http') ? 'Posizione GPS' : d.pickup}\n🏠 Consegna: ${d.drop}\n🚐 ${d.vehicle}\n💰 Totale stimato: €${totale}\n\nConfermi e procedi al pagamento?`;
  return sendQuickReplies(senderId, summary, [
    { title: '💳 Paga ora', payload: 'CONFIRM_PAY' },
    { title: '❌ Annulla', payload: 'RESET' }
  ]);
}

async function createPaymentLink(senderId) {
  const d = getSession(senderId).data;
  const totaleCent = Math.round((d.priceBase + (10 * d.priceKm)) * 100);

  try {
    const sessionStripe = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'paypal'],
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: `Trasporto Ri-Do: ${d.item}` },
          unit_amount: totaleCent,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: 'https://www.facebook.com/messages/t/IL_TUO_PAGE_ID', 
      cancel_url: 'https://www.facebook.com/messages/t/IL_TUO_PAGE_ID',
    });

    await sendGenericTemplate(senderId, "Completa il Pagamento", "Paga in sicurezza con Carta o PayPal", sessionStripe.url);
    await finalizeOrderAdmin(senderId); // Invia l'email all'admin subito dopo il link
  } catch (e) {
    console.error(e);
    await send(senderId, "⚠️ Errore pagamento. Riprova più tardi.");
  }
}

async function finalizeOrderAdmin(senderId) {
  const d = getSession(senderId).data;
  const orderId = 'RD-' + Math.floor(100000 + Math.random() * 900000);
  
  const mailOptions = {
    from: `Ri-Do Bot 🟢 <${process.env.GMAIL_USER}>`,
    to: process.env.ADMIN_EMAIL || process.env.GMAIL_USER,
    subject: `🚚 NUOVO ORDINE #${orderId}`,
    html: `<h2>Nuovo Ordine #${orderId}</h2>
           <p>📦 Oggetto: ${d.item}</p>
           <p>🖼️ Foto: <a href="${d.photoUrl}">Vedi Foto</a></p>
           <p>📍 Ritiro: ${d.pickup}</p>
           <p>🏠 Consegna: ${d.drop}</p>
           <p>📧 Email Cliente: ${d.email}</p>`
  };

  try { await transporter.sendMail(mailOptions); } catch (e) { console.log("Mail Error"); }
  resetSession(senderId);
}

// --- HELPER API FACEBOOK ---
async function send(id, text) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    recipient: { id }, message: { text }
  });
}

async function sendQuickReplies(id, text, replies) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    recipient: { id },
    message: { text, quick_replies: replies.map(r => ({ content_type: 'text', title: r.title, payload: r.payload })) }
  });
}

async function sendGenericTemplate(id, title, subtitle, url) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
    recipient: { id },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "generic",
          elements: [{
            title, subtitle,
            buttons: [{ type: "web_url", url, title: "PAGA ORA" }, { type: "phone_number", title: "CHIAMA", payload: TELEFONO_ASSISTENZA }]
          }]
        }
      }
    }
  });
}

app.listen(PORT, () => console.log(`🟢 Servizio Ri-Do Attivo sulla porta ${PORT}`));
