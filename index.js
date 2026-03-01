// 🟢 RIDO LOGISTICS - MAIN SERVER FILE
// 🚀 Benvenuto nel sistema di gestione trasporti Ri-Do

const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

const app = express();
app.use(express.json());

// --- CONFIGURAZIONE EMAIL ---
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", port: 465, secure: true, 
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
});

const sessions = {};
const getS = (id) => { if (!sessions[id]) sessions[id] = { step: 0, data: {} }; return sessions[id]; };

// --- FUNZIONE CALCOLO KM ---
const calcKm = (l1, n1, l2, n2) => {
  const R = 6371; const dL = (l2-l1)*Math.PI/180; const dN = (n2-n1)*Math.PI/180;
  const a = Math.sin(dL/2)**2 + Math.cos(l1*Math.PI/180)*Math.cos(l2*Math.PI/180)*Math.sin(dN/2)**2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
};

// --- WEBHOOK VERIFICA ---
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === process.env.VERIFY_TOKEN) res.send(req.query['hub.challenge']);
  else res.sendStatus(403);
});

// --- LOGICA BOT ---
app.post('/webhook', async (req, res) => {
  const body = req.body;
  if (body.object !== 'page') return res.sendStatus(404);

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
          {t:"🛋️ Mobili", p:"SET_Mobili"}, 
          {t:"📺 Elettrodomestici", p:"SET_Elettrodomestici"}, 
          {t:"📦 Altro", p:"SET_Altro"}
        ]);
      }
      if (p.startsWith('SET_')) {
        s.data.item = p.split('_')[1]; s.step = 2;
        return sendMsg(sid, `✅ Hai scelto: ${s.data.item}.\n\n📸 Per favore, invia una FOTO dell'oggetto da trasportare:`);
      }
      if (p === 'PAY') return handlePay(sid, s.data);
    }

    // --- GESTIONE MESSAGGI ---
    if (event.message) {
      let txt = event.message.text ? event.message.text.toLowerCase() : "";
      
      if (txt === 'reset' || txt === 'ciao' || s.step === 0) {
        sessions[sid] = { step: 0, data: {} };
        return sendBtn(sid, "🚚 Benvenuto su Ri-Do 🟢\nTrasporti Low-Cost a Caserta e provincia.\n\nVuoi prenotare un rider?", [{t:"📦 Prenota ora", p:"START"}]);
      }

      if (s.step === 2 && event.message.attachments?.[0].type === 'image') {
        s.data.foto = event.message.attachments[0].payload.url; s.step = 3;
        return sendMsg(sid, "📸 Foto ricevuta perfettamente!\n\n📍 Adesso inviaci la POSIZIONE GPS di RITIRO:");
      }

      if (s.step === 3 && event.message.attachments?.[0].type === 'location') {
        s.data.l1 = event.message.attachments[0].payload.coordinates.lat;
        s.data.n1 = event.message.attachments[0].payload.coordinates.long;
        s.step = 4; 
        return sendMsg(sid, "✅ Ritiro impostato con successo.\n\n📍 Ora inviaci la POSIZIONE GPS di CONSEGNA:");
      }

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
        return sendMsg(sid, `📏 Percorso calcolato: ${s.data.km} km.\n💰 Prezzo Low-Cost: €${s.data.tot}.\n\n📧 Scrivi la tua EMAIL per confermare l'ordine:`);
      }

      if (s.step === 5 && txt.includes('@')) {
        s.data.mail = txt;
        return sendBtn(sid, `📋 RIEPILOGO ORDINE:\n📦 Oggetto: ${s.data.item}\n📏 Distanza: ${s.data.km} km\n💰 Totale: €${s.data.tot}\n\nConfermi e procedi al pagamento?`, [{t:"💳 Paga Ora", p:"PAY"}]);
      }
    }
  }
  res.sendStatus(200);
});

async function sendMsg(id, text) { await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { text } }); }

async function sendBtn(id, text, btns) {
  await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${process.env.PAGE_ACCESS_TOKEN}`, {
    recipient: { id }, message: { attachment: { type: "template", payload: { template_type: "button", text, buttons: btns.map(b => ({ type: "postback", title: b.t, payload: b.p })) } } }
  });
}

async function handlePay(id, d) {
  try {
    const sess = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price_data: { currency: 'eur', product_data: { name: `Trasporto Ri-Do: ${d.item}` }, unit_amount: Math.round(d.tot * 100) }, quantity: 1 }],
      mode: 'payment', success_url: 'https://www.facebook.com/profile.php?id=61588660651078', cancel_url: 'https://www.facebook.com/profile.php?id=61588660651078',
    });
    await sendMsg(id, `🔗 Clicca qui per completare il pagamento sicuro: ${sess.url}`);
    await transporter.sendMail({ 
      from: process.env.GMAIL_USER, to: process.env.GMAIL_USER, 
      subject: `🚚 NUOVO ORDINE DA €${d.tot}`, 
      html: `<h2>Dettagli Ordine Ri-Do</h2><p><b>Tua Commissione: €5.00</b></p><hr><p>📦 Oggetto: ${d.item}</p><p>📧 Email: ${d.mail}</p><p>📍 Ritiro: <a href="${d.m1}">Mappa</a></p><p>🏠 Consegna: <a href="${d.m2}">Mappa</a></p>` 
    });
  } catch (e) { console.log(e); }
}

app.listen(process.env.PORT || 10000);
