// Customer account routes per CONTRACT §5. Login required.
const express = require('express');
const dbm = require('../db');
const logic = require('../logic');
const { requireLogin } = require('./auth');

const router = express.Router();

// statuses where money is considered paid vs still pending, for the inventory view
const PAID_STATUSES = ['deposit_paid', 'purchased', 'balance_due', 'fully_paid', 'shipped', 'pickup_ready', 'picked_up', 'closed'];
const PENDING_STATUSES = ['pending', 'accepted'];

router.get('/mi-cuenta', requireLogin, (req, res) => {
  const uid = req.user.id;
  const acc = logic.accumulated(dbm.db, uid);
  const sem = logic.semaforo(uid, res.locals.cap, dbm.db);
  const rows = dbm.db.prepare(
    `SELECT p.id, p.title_es, p.title_en, oi.qty, oi.unit_price_mxn, o.status
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     JOIN products p ON p.id = oi.product_id
     WHERE o.user_id = ?`
  ).all(uid);
  const byProduct = {};
  for (const r of rows) {
    const k = r.id;
    if (!byProduct[k]) {
      byProduct[k] = { product_id: r.id, title_es: r.title_es, title_en: r.title_en, qty: 0, paid: 0, pending: 0, statuses: [] };
    }
    const e = byProduct[k];
    const lineTotal = r.unit_price_mxn == null ? 0 : r.qty * Number(r.unit_price_mxn);
    e.qty += r.qty;
    if (PAID_STATUSES.includes(r.status)) e.paid = logic.round2(e.paid + lineTotal);
    else if (PENDING_STATUSES.includes(r.status)) e.pending = logic.round2(e.pending + lineTotal);
    if (!e.statuses.includes(r.status)) e.statuses.push(r.status);
  }
  res.render('account', {
    user: req.user,
    acumulado: acc,
    semaforo: sem,
    inventory: Object.values(byProduct),
    credit: Number(req.user.credit_mxn) || 0,
  });
});

router.get('/mis-pedidos', requireLogin, (req, res) => {
  const orders = dbm.listOrders({ userId: req.user.id });
  res.render('my-orders', { orders });
});

router.get('/avisos', requireLogin, (req, res) => {
  const announcements = dbm.listAnnouncements();
  res.render('announcements', { announcements });
});

module.exports = router;
