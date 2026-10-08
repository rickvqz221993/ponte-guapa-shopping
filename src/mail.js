// Ponte Guapa Shopping — mail per CONTRACT §9.
// sendMail(): SMTP via nodemailer when SMTP_HOST+SMTP_USER are set,
// otherwise appends a JSON line to data/email-fallback.log (+ console.log).
const fs = require('fs');
const path = require('path');
const dbm = require('./db');

const LOG_PATH = path.join(__dirname, '..', 'data', 'email-fallback.log');

function smtpReady() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER);
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: String(process.env.SMTP_PORT) === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

async function sendMail({ to, subject, html }) {
  if (!to) return { via: 'none' };
  if (smtpReady()) {
    await getTransporter().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to, subject, html,
    });
    console.log(`[mail] SMTP -> ${to}: ${subject}`);
    return { via: 'smtp' };
  }
  const line = JSON.stringify({ ts: new Date().toISOString(), to, subject, html }) + '\n';
  fs.appendFileSync(LOG_PATH, line);
  console.log(`[mail] fallback log -> ${to}: ${subject}`);
  return { via: 'fallback' };
}

function notifyAdmins(subject, html) {
  const raw = dbm.getSetting('alert_emails', '');
  const list = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  return Promise.all(list.map((to) => sendMail({ to, subject, html })));
}

function notifyCustomer(user, subject, html) {
  if (!user || !user.email) return Promise.resolve({ via: 'none' });
  return sendMail({ to: user.email, subject, html });
}

// Admin alert for a newly created order (called from checkout).
function sendOrderAlertToAdmins(order) {
  const items = dbm.getOrderItems(order.id);
  const customer = dbm.getUser(order.user_id);
  const lines = items.map((it) =>
    `<li>${it.qty} x ${(it.title_es || 'producto')} — ${it.unit_price_mxn == null ? 'TBD' : Number(it.unit_price_mxn).toFixed(2) + ' MXN'}</li>`
  ).join('');
  const subject = `Nuevo pedido #${order.id} — Ponte Guapa (${order.channel})`;
  const html = `<p>Nuevo pedido <b>#${order.id}</b> (${order.channel}).</p>`
    + `<p>Clienta: ${customer ? customer.name : ''} (${customer ? customer.email : ''})<br>`
    + `WhatsApp: ${customer ? customer.whatsapp : ''}</p>`
    + `<ul>${lines}</ul>`
    + `<p>Subtotal: ${Number(order.subtotal_mxn).toFixed(2)} MXN · Crédito aplicado: ${Number(order.credit_applied).toFixed(2)} MXN</p>`;
  return notifyAdmins(subject, html);
}

module.exports = { sendMail, notifyAdmins, notifyCustomer, sendOrderAlertToAdmins, smtpReady };
