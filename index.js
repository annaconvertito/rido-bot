// 🟢 RIDO LOGISTICS - SISTEMA COMPLETO ANTI-ERRORE
// Inizializzazione Ambiente e Librerie
const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
app.use(express.json());

// Configurazione Email
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", port: 465, secure: true, 
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

const sessions = {};
const getS = (id) => { if (!sessions[id]) sessions[id] = { step: 0, data: {} }; return sessions[id]; };

// Funzione Calcolo Distanza
const calcKm = (l1, n1, l2, n2) => {
  const R = 6371; const dL = (l2-l1)*Math.PI/180; const dN = (n2-n1)*Math.PI/180;
  const a = Math.sin(dL/2)**2 + Math.cos(l1*Math.PI/180)*Math.cos(l2*Math.PI/180)*Math.sin(dN/2)**2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
};

// Webhook di Verifica per Facebook
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

// LOGICA PRINCIPALE
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object !== 'page') return res.sendStatus(404);

  // ✅ 1. RISPOSTA IMMEDIATA (Blocca i messaggi ripetuti di Facebook)
  res.status(200).send('EVENT_RECEIVED');

  for (let entry of body.entry) {
    if (!entry.messaging) continue;
    let event = entry.messaging[0];
    let sid = event.sender.id;
    let s = getS(sid);

    // --- GESTIONE PULSANTI ---
    if (event.postback) {
      let p = event.postback.payload;
      if (p === 'START') {
        s.step = 1;
        return sendBtn(sid, "📦 Cosa dobbiamo trasportare?", [
          {t:"🛋️ Mobili", p:"SET_Mobili"}, {t:"📺 Elettrodomestici", p:"SET_Elettro"}, {t:"📦 Altro", p:"SET_Altro"}
        ]);
      }
      if (p.startsWith('SET_')) {
        s.data.item = p.split('_')[1]; s.step = 2;
        return sendMsg(sid, `✅ Hai scelto: ${s.data.item}.\n\n📸 Per favore, invia una FOTO dell'oggetto:`);
      }
      if (p === 'PAY') return handlePay(sid, s.data);
    }

    // --- GESTIONE MESSAGGI ---
    if (event.message) {
      let txt = event.message.text ? event.message.text.toLowerCase() : "";
      
      // Benvenuto Iniziale e Reset
      if (txt === 'reset' || txt === 'ciao' || s.step === 0) {
        sessions[sid] = { step: 0, data: {} };
        return sendBtn(sid, "🚚 Benvenuto su Ri-Do 🟢\nTrasporti Low-Cost a Caserta.\n\nVuoi prenotare un rider?", [{t:"📦 Prenota ora", p:"START"}]);
      }

      // Ricezione Foto
      if (s.step === 2 && event.message.attachments?.[0].type === 'image') {
        s.data.foto = event.message.attachments[0].payload.url; s.step = 3;
        return sendMsg(sid, "📸 Foto ricevuta perfettamente!\n\n📍 Adesso inviaci la POSIZIONE GPS di RITIRO:");
      }

      // GPS Ritiro
      if (s.step === 3 && event.message.attachments?.[0].type === 'location') {
        s.data.l1 = event.message.attachments[0].payload.coordinates.lat;
        s.data.n1 = event.message.attachments[0].payload.coordinates.long;
        s.step = 4; 
        return sendMsg(sid, "✅ Ritiro impostato.\n\n📍 Ora inviaci la POSIZIONE GPS di CONSEGNA:");
      }

      // GPS Consegna e Calcolo
      if (s.step === 4 && event.message.attachments?.[0].type === 'location') {
        let l2 = event.message.attachments[0].payload.coordinates.lat;
        let n2 = event.message.attachments[0].payload.coordinates.long;
        let km = calcKm(s.data.l1, s.data.n1, l2, n2);
        s.data.km = km.toFixed(2);
        let prezzo = 10 + (km * 1.0);
        s.data.tot = (prezzo < 15 ? 15 : prezzo).toFixed(2);
        
        s.data.m1 = `https://www.google.com/maps?q=${s.data.l1},${s.data.n1}`;
        s.data.m2 = `https://www.google.com/maps?q=${l2},${n2}`;
        
        s.step = 5; 
        return sendMsg(sid, `📏 Percorso: ${s.data.km} km.\n💰 Prezzo Low-Cost: €${s.data.tot}.\n\n📧 Scrivi la tua EMAIL per confermare:`);
      }

      // Email e Riepilogo
      if (s.step === 5 && txt.includes('@')) {
        s.data.mail = txt;
        return sendBtn(sid, `📋 RIEPILOGO:\n📦 ${s.data.item}\n📏 ${s.data.km} km\n💰 €${s.data.tot}\n\nConfermi l'ordine?`, [{t:"💳 Paga Ora", p:"PAY"}]);
      }
    }
  }
});

// Funzioni Helper (Invio Messaggi)
async function sendMsg(id, text) { await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { text } }); }

async function sendBtn(id, text, btns) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    recipient: { id }, message: { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns.map(b => ({ type: "postback", title: b.t, payload: b.p })) } } }
  });
}

// Gestione Pagamento e Notifica
async function handlePay(id, d) {
  try {
    const sess = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `Trasporto Ri-Do: ${d.item}` }, unit_amount: Math.round(d.tot * 100) }, quantity: 1 }],
      mode: 'payment', success_url: 'https://facebook.com', cancel_url: 'https://facebook.com',
    });
    await sendMsg(id, `🔗 Paga qui in sicurezza: ${sess.url}`);
    
    await transporter.sendMail({ 
      from: process.env.GMAIL_USER, to: process.env.GMAIL_USER, 
      subject: `🚚 ORDINE €${d.tot}`, 
      html: `<b>Guadagno Admin: 5€</b><br>Articolo: ${d.item}<br>Email: ${d.mail}<br>Ritiro: <a href="${d.m1}">Mappa</a><br>Consegna: <a href="${d.m2}">Mappa</a><br>Foto: <a href="${d.foto}">Vedi Foto</a>` 
    });
  } catch (e) { console.log("Errore Stripe/Email:", e); }
}

app.listen(process.env.PORT || 10000);
