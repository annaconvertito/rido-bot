/**
 * 🟢 RIDO LOGISTICS - VERSIONE DEFINITIVA 2026
 * Funzioni: Foto -> GPS Ritiro -> GPS Consegna -> Calcolo KM -> Email con split 5€
 */

const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
app.use(express.json());

// --- TRASPORTATORE EMAIL ---
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

// --- FUNZIONE CALCOLO KM (HARVERSINE) ---
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

// --- WEBHOOK RICEZIONE MESSAGGI ---
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object === 'page') {
    for (const entry of body.entry) {
      if (!entry.messaging) continue;
      const event = entry.messaging[0];
      const senderId = event.sender.id;
      const session = getSession(senderId);

      // 1. GESTIONE ALLEGATI (FOTO E GPS)
      if (event.message && event.message.attachments) {
        const att = event.message.attachments[0];
        console.log(`Allegato ricevuto tipo: ${att.type} dallo step: ${session.step}`);

        // Ricezione Foto
        if (att.type === 'image' && session.step === 'await_photo') {
          session.data.photoUrl = att.payload.url;
          session.step = 'await_pickup';
          await sendText(senderId, "📸 Foto salvata! Ora clicca sulla graffetta 📎 (o +) e invia la POSIZIONE GPS di RITIRO.");
        } 
        
        // Ricezione GPS
        else if (att.type === 'location') {
          const lat = att.payload.coordinates.lat;
          const lon = att.payload.coordinates.long;

          if (session.step === 'await_pickup') {
            session.data.lat1 = lat; session.data.lon1 = lon;
            session.data.pickup = `https://www.google.com/maps?q=${lat},${lon}`;
            session.step = 'await_drop';
            await sendText(senderId, "✅ Ritiro impostato! Ora invia la posizione GPS di CONSEGNA.");
          } 
          else if (session.step === 'await_drop') {
            session.data.lat2 = lat; session.data.lon2 = lon;
            session.data.drop = `https://www.google.com/maps?q=${lat},${lon}`;
            
            const km = calculateDistance(session.data.lat1, session.data.lon1, lat, lon);
            session.data.km = km.toFixed(2);
            
            // Tariffa: 10€ + 1€/km (Minimo 15€)
            let calcolo = 10 + (km * 1.0);
            session.data.total = (calcolo < 15 ? 15 : calcolo).toFixed(2);
            
            session.step = 'await_email';
            await sendText(senderId, `📏 Distanza: ${session.data.km} km.\n💰 Prezzo Ri-Do: €${session.data.total}.\n\nScrivi la tua EMAIL per confermare:`);
          }
        }
      } 

      // 2. GESTIONE TESTO (CIAO / EMAIL)
      else if (event.message && event.message.text) {
        const text = event.message.text.toLowerCase().trim();
        console.log(`Testo ricevuto: ${text} dallo step: ${session.step}`);

        if (['ciao', 'menu', 'reset', 'inizia'].includes(text)) {
          sessions[senderId] = { step: 'start', data: {} };
          await sendStartButton(senderId);
        } 
        else if (session.step === 'await_email' && text.includes('@')) {
          session.data.email = text;
          await sendSummary(senderId, session.data);
        }
      }

      // 3. GESTIONE PULSANTI (POSTBACK)
      else if (event.postback) {
        const payload = event.postback.payload;
        console.log(`Postback ricevuto: ${payload}`);

        if (payload === 'PRENOTA') {
          session.step = 'await_item';
          await sendQuickReplies(senderId, "📦 Cosa dobbiamo trasportare?", [
            { title: '🛋️ Mobili', payload: 'ITEM_Mobili' },
            { title: '📺 Elettro', payload: 'ITEM_Elettro' },
            { title: '📦 Altro', payload: 'ITEM_Altro' }
          ]);
        } 
        else if (payload.startsWith('ITEM_')) {
          session.data.item = payload.split('_')[1];
          session.step = 'await_photo';
          await sendText(senderId, `Hai scelto ${session.data.item}.\n\n📸 Per favore, invia una FOTO dell'oggetto.`);
        } 
        else if (payload === 'CONFIRM_PAY') {
          await startStripePayment(senderId, session.data);
          sessions[senderId] = { step: 'start', data: {} }; // Reset dopo invio link
        }
      }
    }
    res.status(200).send('EVENT_RECEIVED');
  }
});

// --- FUNZIONI DI INTERFACCIA ---

async function sendStartButton(id) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    recipient: { id },
    message: { attachment: { type: "template", payload: { template_type: "button", text: "🚚 Benvenuto su Ri-Do!\nTrasporti facili a Caserta.", buttons: [{ type: "postback", title: "📦 Prenota ora", payload: "PRENOTA" }] } } }
  });
}

async function sendQuickReplies(id, text, replies) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    recipient: { id },
    message: { text, quick_replies: replies.map(r => ({ content_type: "text", title: r.title, payload: r.payload })) }
  });
}

async function sendSummary(id, d) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    recipient: { id },
    message: { attachment: { type: "template", payload: { template_type: "button", text: `📋 RIEPILOGO:\n📦 Oggetto: ${d.item}\n📏 Distanza: ${d.km} km\n💰 Totale: €${d.total}\n\nConfermi e paghi?`, buttons: [{ type: "postback", title: "💳 Paga ora", payload: "CONFIRM_PAY" }] } } }
  });
}

async function startStripePayment(id, d) {
  try {
    const stripeSess = await stripe.checkout.sessions.create({
      payment_method_types: ['card', 'paypal'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `Trasporto Ri-Do (${d.km} km)` }, unit_amount: Math.round(parseFloat(d.total) * 100) }, quantity: 1 }],
      mode: 'payment',
      success_url: 'https://www.facebook.com/messages/t/61588660651078',
      cancel_url: 'https://www.facebook.com/messages/t/61588660651078',
    });
    
    await sendText(id, `🔗 Clicca qui per pagare €${d.total} e confermare il rider: ${stripeSess.url}`);
    
    // Invia Email Admin
    const spettanzaRider = (parseFloat(d.total) - 5.0).toFixed(2);
    await transporter.sendMail({
      from: process.env.GMAIL_USER, to: process.env.GMAIL_USER,
      subject: `🚚 ORDINE: €${d.total} (Tuo: €5.00)`,
      html: `<h3>Nuovo Ordine Ri-Do</h3><p><b>Guadagno per te: 5€</b></p><p>Da dare al rider: ${spettanzaRider}€</p><hr><p>Ritiro: ${d.pickup}</p><p>Consegna: ${d.drop}</p><p>Email: ${d.email}</p><p>Foto: <a href="${d.photoUrl}">Vedi Foto</a></p>`
    });
  } catch (e) { console.log("Stripe/Email Error:", e); }
}

async function sendText(id, text) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { text } });
}

app.listen(process.env.PORT || 10000, () => console.log("🚀 Server Ri-Do Online!"));
