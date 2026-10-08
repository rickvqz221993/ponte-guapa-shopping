// Cart + checkout per CONTRACT §5. Cart lives in req.session.cart = [{productId, qty}].
const express = require('express');
const dbm = require('../db');
const logic = require('../logic');
const mail = require('../mail');
const { requireLogin } = require('./auth');

const router = express.Router();

function cartItems(req) {
  const cart = req.session.cart || [];
  return cart
    .map((ci) => ({ ...ci, product: dbm.getProduct(ci.productId) }))
    .filter((ci) => ci.product && ci.product.active);
}

router.post('/carrito/agregar/:id', (req, res) => {
  const p = dbm.getProduct(req.params.id);
  if (!p || !p.active) return res.status(404).send('product not found');
  const qty = Math.max(1, parseInt(req.body.qty, 10) || 1);
  req.session.cart = req.session.cart || [];
  const ex = req.session.cart.find((i) => String(i.productId) === String(p.id));
  if (ex) ex.qty += qty;
  else req.session.cart.push({ productId: p.id, qty });
  res.redirect('/carrito');
});

router.post('/carrito/quitar/:id', (req, res) => {
  req.session.cart = (req.session.cart || []).filter((i) => String(i.productId) !== String(req.params.id));
  res.redirect('/carrito');
});

router.get('/carrito', (req, res) => {
  res.render('cart', { items: cartItems(req) });
});

router.get('/checkout', requireLogin, (req, res) => {
  const items = cartItems(req);
  if (!items.length) return res.redirect('/carrito');
  const cap = res.locals.cap;
  const acc = logic.accumulated(dbm.db, req.user.id);
  const sem = logic.semaforo(req.user.id, cap, dbm.db);
  if (sem === 'red') {
    // CONTRACT §4: red semaforo blocks checkout with checkout.red_blocked_* message.
    return res.status(403).render('checkout', { blocked: true, acc, sem, items: [], credit: 0 });
  }
  res.render('checkout', { blocked: false, acc, sem, items, credit: req.user.credit_mxn });
});

router.post('/checkout', requireLogin, async (req, res) => {
  const items = cartItems(req);
  if (!items.length) return res.redirect('/carrito');
  const cap = res.locals.cap;
  if (!logic.canCheckout(req.user.id, cap, dbm.db)) {
    return res.status(403).render('checkout', { blocked: true, items: [] });
  }
  const b = req.body || {};
  if (b.final_sale_accepted !== '1') {
    return res.status(400).render('checkout', { blocked: false, items, error: 'final_accept_required' });
  }

  const pickup = b.pickup === '1';
  const orderFields = { user_id: req.user.id, channel: 'web', status: 'pending', currency: 'MXN', final_sale_accepted: 1 };
  if (pickup) {
    orderFields.pickup = 1;
  } else {
    if (!b.ship_name || !b.ship_phone || !b.ship_city || !b.ship_address) {
      return res.status(400).render('checkout', { blocked: false, items, error: 'shipping_required' });
    }
    orderFields.pickup = 0;
    orderFields.ship_name = String(b.ship_name);
    orderFields.ship_phone = String(b.ship_phone);
    orderFields.ship_city = String(b.ship_city);
    orderFields.ship_postal = String(b.ship_postal || '');
    orderFields.ship_address = String(b.ship_address);
  }
  orderFields.alt_name = String(b.alt_name || '') || null;
  orderFields.alt_phone = String(b.alt_phone || '') || null;
  orderFields.alt_city = String(b.alt_city || '') || null;
  orderFields.alt_postal = String(b.alt_postal || '') || null;
  orderFields.alt_address = String(b.alt_address || '') || null;

  const lines = items.map((ci) => ({
    product_id: ci.product.id, qty: ci.qty, unit_price_mxn: ci.product.price_mxn, // may be NULL = TBD
  }));
  const subtotal = logic.orderSubtotal(lines);

  // Credit: apply min(credit, subtotal), decrement user credit.
  const creditApplied = Math.min(Number(req.user.credit_mxn) || 0, subtotal);
  orderFields.subtotal_mxn = subtotal;
  orderFields.credit_applied = creditApplied;

  const orderId = dbm.createOrder(orderFields);
  for (const l of lines) dbm.addOrderItem({ order_id: orderId, product_id: l.product_id, qty: l.qty, unit_price_mxn: l.unit_price_mxn });
  if (creditApplied > 0) {
    dbm.updateUser(req.user.id, { credit_mxn: logic.round2((Number(req.user.credit_mxn) || 0) - creditApplied) });
  }
  req.session.cart = [];

  const order = dbm.getOrder(orderId);
  try { await mail.sendOrderAlertToAdmins(order); }
  catch (e) { console.error('[mail] order alert failed:', e.message); }

  res.redirect(`/pedido/${orderId}`);
});

module.exports = router;
