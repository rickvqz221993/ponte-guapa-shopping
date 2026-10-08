// Admin routes per CONTRACT §5. All requireAdmin; all POST check csrf
// (global middleware; multipart product routes verify post-multer).
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const dbm = require('../db');
const logic = require('../logic');
const mail = require('../mail');
const { requireAdmin } = require('./auth');

const router = express.Router();
// Scoped to /admin/* so unknown (non-admin) paths fall through to the 404 handler
// instead of being hijacked by the admin guard.
router.use('/admin', requireAdmin);

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, (file.mimetype || '').startsWith('image/')),
});

function checkCsrf(req, res) {
  if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
    res.status(403).send('CSRF check failed');
    return false;
  }
  return true;
}

function semaforoFor(userId, cap) {
  const acc = logic.accumulated(dbm.db, userId);
  return { acc, sem: logic.semaforo(userId, cap, dbm.db) };
}

// ---------- dashboard ----------
router.get('/admin', (req, res) => {
  const cap = res.locals.cap;
  const pendingOrders = dbm.listOrders({ status: 'pending' });
  const pendingProofs = dbm.pendingProofs();
  const customers = dbm.listCustomers();
  const redFlagCustomers = customers
    .map((c) => ({ ...c, ...semaforoFor(c.id, cap) }))
    .filter((c) => c.sem === 'red');
  const openOrders = dbm.db.prepare(
    `SELECT COUNT(*) AS c FROM orders WHERE status IN (${logic.OPEN_STATUSES.map(() => '?').join(',')})`
  ).get(...logic.OPEN_STATUSES).c;
  const openRevenue = dbm.db.prepare(
    `SELECT COALESCE(SUM(subtotal_mxn - credit_applied),0) AS s FROM orders
     WHERE status IN (${logic.OPEN_STATUSES.map(() => '?').join(',')})`
  ).get(...logic.OPEN_STATUSES).s;
  const overduePickups = dbm.db.prepare(
    `SELECT o.*, u.name AS customer_name FROM orders o LEFT JOIN users u ON u.id=o.user_id
     WHERE o.status='pickup_ready' AND o.pickup_deadline IS NOT NULL AND o.pickup_deadline < ?
     ORDER BY o.pickup_deadline`
  ).all(new Date().toISOString());
  res.render('admin/dashboard', {
    pendingOrders, redFlagCustomers, pendingProofs, overduePickups,
    stats: {
      customers: customers.length,
      orders_open: openOrders,
      revenue_open: logic.round2(openRevenue),
    },
  });
});

// ---------- orders ----------
router.get('/admin/pedidos', (req, res) => {
  const status = String(req.query.status || '');
  const orders = status ? dbm.listOrders({ status }) : dbm.listOrders();
  res.render('admin/orders', { orders, filter: status });
});

router.get('/admin/pedidos/:id', (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  const items = dbm.getOrderItems(order.id);
  const payments = dbm.getPayments(order.id);
  const customer = dbm.getUser(order.user_id);
  const { acc, sem } = semaforoFor(order.user_id, res.locals.cap);
  res.render('admin/order-detail', { order, items, payments, customer, acumulado: acc, semaforo: sem });
});

// Accept: TBD prices MUST be set here (form fields price_<itemId>); then
// subtotal + deposit_due are computed. pending -> accepted.
router.post('/admin/pedidos/:id/aceptar', async (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  if (!logic.canTransition(order.status, 'accepted')) return res.status(400).send('bad transition');
  const items = dbm.getOrderItems(order.id);
  for (const it of items) {
    if (it.unit_price_mxn == null) {
      const p = parseFloat(req.body['price_' + it.id]);
      if (!(p > 0)) return res.status(400).send(`TBD price required for item ${it.id}`);
      dbm.updateOrderItem(it.id, { unit_price_mxn: logic.round2(p) });
    }
  }
  const fresh = dbm.getOrderItems(order.id);
  const subtotal = logic.orderSubtotal(fresh);
  const deposit_due = logic.depositDue({ subtotal_mxn: subtotal, credit_applied: order.credit_applied });
  dbm.updateOrder(order.id, { subtotal_mxn: subtotal, deposit_due, status: 'accepted' });
  const customer = dbm.getUser(order.user_id);
  await mail.notifyCustomer(customer, `Pedido #${order.id} aceptado — Ponte Guapa`,
    `<p>Hola ${customer.name}, tu pedido <b>#${order.id}</b> fue aceptado.</p>`
    + `<p>Anticipo (60%): <b>${deposit_due.toFixed(2)} MXN</b>. Sin anticipo no hay pedido.</p>`);
  res.redirect(`/admin/pedidos/${order.id}`);
});

router.post('/admin/pedidos/:id/rechazar', (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  if (!logic.canTransition(order.status, 'rejected')) return res.status(400).send('bad transition');
  dbm.updateOrder(order.id, { status: 'rejected' });
  res.redirect(`/admin/pedidos/${order.id}`);
});

router.post('/admin/pedidos/:id/cancelar', (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  if (!logic.canTransition(order.status, 'cancelled')) return res.status(400).send('bad transition');
  dbm.updateOrder(order.id, { status: 'cancelled' });
  res.redirect(`/admin/pedidos/${order.id}`);
});

// Confirm a pending payment (transfer proof or manual). Advances:
// deposit payment on accepted -> deposit_paid; balance payment on balance_due
// -> fully_paid (only once confirmed balance covers balance_due).
router.post('/admin/pedidos/:id/confirmar-deposito', async (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  const payment = dbm.getPayment(req.query.payment);
  if (!payment || payment.order_id !== order.id) return res.status(400).send('payment not found');
  if (payment.status !== 'pending') return res.status(400).send('payment already processed');
  dbm.updatePayment(payment.id, { status: 'confirmed' });
  const customer = dbm.getUser(order.user_id);

  if (payment.kind === 'deposit') {
    if (!logic.canTransition(order.status, 'deposit_paid')) return res.status(400).send('bad transition');
    dbm.updateOrder(order.id, {
      deposit_paid_amount: logic.round2((Number(order.deposit_paid_amount) || 0) + Number(payment.amount_mxn)),
      status: 'deposit_paid',
    });
    await mail.notifyCustomer(customer, `Anticipo confirmado — pedido #${order.id}`,
      `<p>Hola ${customer.name}, confirmamos tu anticipo de <b>${Number(payment.amount_mxn).toFixed(2)} MXN</b> del pedido <b>#${order.id}</b>. Ya estamos comprando tus artículos en Japón.</p>`);
  } else if (payment.kind === 'balance') {
    const confirmed = dbm.db.prepare(
      `SELECT COALESCE(SUM(amount_mxn),0) AS s FROM payments WHERE order_id=? AND kind='balance' AND status='confirmed'`
    ).get(order.id).s;
    if (Number(confirmed) >= Number(order.balance_due) && logic.canTransition(order.status, 'fully_paid')) {
      dbm.updateOrder(order.id, { status: 'fully_paid' });
    }
  }
  res.redirect(`/admin/pedidos/${order.id}`);
});

router.post('/admin/pedidos/:id/marcar-comprado', (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  if (!logic.canTransition(order.status, 'purchased')) return res.status(400).send('bad transition');
  dbm.updateOrder(order.id, { status: 'purchased' });
  res.redirect(`/admin/pedidos/${order.id}`);
});

// Set shipping cost -> balance_due computed -> status balance_due.
router.post('/admin/pedidos/:id/fijar-envio', async (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  if (!logic.canTransition(order.status, 'balance_due')) return res.status(400).send('bad transition');
  const shipping = parseFloat(req.body.shipping_cost_mxn);
  if (!(shipping >= 0)) return res.status(400).send('shipping_cost_mxn required');
  const balance_due = logic.balanceDue({ ...order, shipping_cost_mxn: shipping });
  dbm.updateOrder(order.id, { shipping_cost_mxn: logic.round2(shipping), balance_due, status: 'balance_due' });
  const customer = dbm.getUser(order.user_id);
  await mail.notifyCustomer(customer, `Saldo pendiente — pedido #${order.id}`,
    `<p>Hola ${customer.name}, tus artículos del pedido <b>#${order.id}</b> ya fueron comprados en Japón.</p>`
    + `<p>Saldo restante + envío: <b>${balance_due.toFixed(2)} MXN</b>. Nada se envía sin el pago completo.</p>`);
  res.redirect(`/admin/pedidos/${order.id}`);
});

// HARD RULE: ship / pickup-ready ONLY when status === 'fully_paid'.
router.post('/admin/pedidos/:id/marcar-enviado', async (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  if (order.status !== 'fully_paid') return res.status(400).send('order must be fully_paid before shipping');
  if (!logic.canTransition(order.status, 'shipped')) return res.status(400).send('bad transition');
  dbm.updateOrder(order.id, { status: 'shipped', tracking: String(req.body.tracking || '') });
  const customer = dbm.getUser(order.user_id);
  await mail.notifyCustomer(customer, `Tu pedido #${order.id} fue enviado`,
    `<p>Hola ${customer.name}, tu pedido <b>#${order.id}</b> va en camino.</p>`
    + (req.body.tracking ? `<p>Guía: <b>${String(req.body.tracking)}</b></p>` : ''));
  res.redirect(`/admin/pedidos/${order.id}`);
});

router.post('/admin/pedidos/:id/listo-recoger', async (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  if (order.status !== 'fully_paid') return res.status(400).send('order must be fully_paid before pickup');
  if (!logic.canTransition(order.status, 'pickup_ready')) return res.status(400).send('bad transition');
  const days = parseInt(dbm.getSetting('pickup_days', '15'), 10) || 15;
  const pickup_deadline = logic.pickupDeadline(days);
  dbm.updateOrder(order.id, { status: 'pickup_ready', pickup_deadline });
  const customer = dbm.getUser(order.user_id);
  await mail.notifyCustomer(customer, `Tu pedido #${order.id} está listo para recoger`,
    `<p>Hola ${customer.name}, tu pedido <b>#${order.id}</b> está listo para recoger.</p>`
    + `<p>Tienes <b>${days} días</b> para recogerlo (fecha límite: ${pickup_deadline.slice(0, 10)}).</p>`);
  res.redirect(`/admin/pedidos/${order.id}`);
});

router.post('/admin/pedidos/:id/marcar-recogido', (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  if (!logic.canTransition(order.status, 'picked_up')) return res.status(400).send('bad transition');
  dbm.updateOrder(order.id, { status: 'picked_up' });
  res.redirect(`/admin/pedidos/${order.id}`);
});

router.post('/admin/pedidos/:id/cerrar', (req, res) => {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  if (!logic.canTransition(order.status, 'closed')) return res.status(400).send('bad transition');
  dbm.updateOrder(order.id, { status: 'closed' });
  res.redirect(`/admin/pedidos/${order.id}`);
});

// ---------- products ----------
router.get('/admin/productos', (req, res) => {
  res.render('admin/products', { products: dbm.listProducts(false) });
});

router.get('/admin/productos/nuevo', (req, res) => {
  res.render('admin/product-form', { product: null, ages: ['<20', '20-30', '30-40', '40-50', '50-60', '60+'] });
});

router.get('/admin/productos/:id/editar', (req, res) => {
  const product = dbm.getProduct(req.params.id);
  if (!product) return res.status(404).render('404');
  res.render('admin/product-form', { product, ages: ['<20', '20-30', '30-40', '40-50', '50-60', '60+'] });
});

function productFieldsFromBody(b, file) {
  const ag = b.age_groups;
  const ageGroups = Array.isArray(ag) ? ag.join(',') : (ag ? String(ag) : '');
  const priceRaw = String(b.price_mxn || '').trim();
  const fields = {
    title_es: String(b.title_es || ''), title_en: String(b.title_en || ''),
    desc_es: String(b.desc_es || ''), desc_en: String(b.desc_en || ''),
    price_mxn: priceRaw === '' ? null : parseFloat(priceRaw), // empty = TBD
    age_groups: ageGroups,
    category: String(b.category || ''),
    active: b.active === '1' || b.active === 'on' ? 1 : 0,
  };
  if (file) fields.image_path = '/uploads/' + file.filename;
  if (fields.price_mxn != null && isNaN(fields.price_mxn)) fields.price_mxn = null;
  return fields;
}

router.post('/admin/productos', upload.single('image'), (req, res) => {
  if (!checkCsrf(req, res)) return;
  const fields = productFieldsFromBody(req.body, req.file);
  if (!fields.title_es.trim()) return res.status(400).send('title_es required');
  const id = dbm.createProduct(fields);
  res.redirect(`/admin/productos/${id}/editar`);
});

router.post('/admin/productos/:id', upload.single('image'), (req, res) => {
  if (!checkCsrf(req, res)) return;
  const product = dbm.getProduct(req.params.id);
  if (!product) return res.status(404).render('404');
  const fields = productFieldsFromBody(req.body, req.file);
  dbm.updateProduct(product.id, fields);
  res.redirect(`/admin/productos/${product.id}/editar`);
});

router.post('/admin/productos/:id/eliminar', (req, res) => {
  const product = dbm.getProduct(req.params.id);
  if (!product) return res.status(404).render('404');
  dbm.updateProduct(product.id, { active: 0 });
  res.redirect('/admin/productos');
});

// ---------- customers ----------
router.get('/admin/clientes', (req, res) => {
  const q = String(req.query.q || '').trim();
  const cap = res.locals.cap;
  const customers = dbm.listCustomers(q).map((c) => ({ ...c, ...semaforoFor(c.id, cap) }));
  res.render('admin/customers', { customers, q });
});

router.get('/admin/clientes/:id', (req, res) => {
  const customer = dbm.getUser(req.params.id);
  if (!customer || customer.role !== 'customer') return res.status(404).render('404');
  const orders = dbm.listOrders({ userId: customer.id });
  const live = orders.filter((o) => !['cancelled', 'rejected'].includes(o.status));
  const totalSpent = logic.round2(live.reduce((a, o) => a + (Number(o.subtotal_mxn) || 0) - (Number(o.credit_applied) || 0), 0));
  const months = Math.max(1, (Date.now() - new Date(customer.created_at).getTime()) / (30 * 86400000));
  const catRows = dbm.db.prepare(
    `SELECT p.category AS category, SUM(oi.qty) AS qty FROM order_items oi
     JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id
     WHERE o.user_id=? GROUP BY p.category ORDER BY qty DESC LIMIT 5`
  ).all(customer.id);
  const { acc, sem } = semaforoFor(customer.id, res.locals.cap);
  res.render('admin/customer-detail', {
    customer, orders, acumulado: acc, semaforo: sem,
    patterns: {
      totalOrders: orders.length,
      totalSpent,
      avgOrder: orders.length ? logic.round2(totalSpent / orders.length) : 0,
      ordersPerMonth: logic.round2(orders.length / months),
      topCategories: catRows,
    },
  });
});

router.post('/admin/clientes/:id/nota', (req, res) => {
  const customer = dbm.getUser(req.params.id);
  if (!customer) return res.status(404).render('404');
  dbm.updateUser(customer.id, { notes: String(req.body.notes || '') });
  res.redirect(`/admin/clientes/${customer.id}`);
});

router.post('/admin/clientes/:id/credito', (req, res) => {
  const customer = dbm.getUser(req.params.id);
  if (!customer) return res.status(404).render('404');
  const amount = parseFloat(req.body.amount);
  if (!(amount > 0)) return res.status(400).send('amount must be > 0');
  dbm.updateUser(customer.id, { credit_mxn: logic.round2((Number(customer.credit_mxn) || 0) + amount) });
  res.redirect(`/admin/clientes/${customer.id}`);
});

// ---------- whatsapp orders (admin enters them manually) ----------
router.get('/admin/pedido-whatsapp', (req, res) => {
  res.render('admin/whatsapp-order', { customers: dbm.listCustomers(), products: dbm.listProducts(true) });
});

router.post('/admin/pedido-whatsapp', (req, res) => {
  const b = req.body || {};
  const customer = dbm.getUser(b.customer_id);
  if (!customer) return res.status(400).send('customer required');
  let pids = b.product_id, qtys = b.qty;
  if (!Array.isArray(pids)) pids = pids ? [pids] : [];
  if (!Array.isArray(qtys)) qtys = qtys ? [qtys] : [];
  const lines = [];
  for (let i = 0; i < pids.length; i++) {
    const p = dbm.getProduct(pids[i]);
    const qty = Math.max(1, parseInt(qtys[i], 10) || 1);
    if (p && p.active) lines.push({ product_id: p.id, qty, unit_price_mxn: p.price_mxn });
  }
  if (!lines.length) return res.status(400).send('at least one product required');
  const orderId = dbm.createOrder({
    user_id: customer.id, channel: 'whatsapp', status: 'pending',
    subtotal_mxn: logic.orderSubtotal(lines), currency: 'MXN', final_sale_accepted: 0,
  });
  for (const l of lines) dbm.addOrderItem({ order_id: orderId, ...l });
  res.redirect(`/admin/pedidos/${orderId}`);
});

// ---------- announcements ----------
router.get('/admin/avisos', (req, res) => {
  res.render('admin/announcements', { announcements: dbm.listAnnouncements() });
});

router.post('/admin/avisos', (req, res) => {
  const b = req.body || {};
  if (!String(b.title_es || '').trim()) return res.status(400).send('title_es required');
  dbm.createAnnouncement({
    title_es: String(b.title_es), title_en: String(b.title_en || ''),
    body_es: String(b.body_es || ''), body_en: String(b.body_en || ''),
  });
  res.redirect('/admin/avisos');
});

// ---------- config ----------
router.get('/admin/config', (req, res) => {
  res.render('admin/settings', { settings: dbm.allSettings(), smtp: mail.smtpReady() });
});

router.post('/admin/config', (req, res) => {
  const b = req.body || {};
  for (const k of ['alert_emails', 'whatsapp_number', 'accumulation_cap', 'pickup_days', 'fx_usd', 'fx_cad', 'fx_eur']) {
    if (b[k] !== undefined) dbm.setSetting(k, String(b[k]));
  }
  if (String(b.new_password || '').length >= 6) {
    dbm.updateUser(req.user.id, { password_hash: bcrypt.hashSync(String(b.new_password), 10) });
  }
  res.redirect('/admin/config');
});

// ---------- email log ----------
router.get('/admin/emails', (req, res) => {
  const logPath = path.join(__dirname, '..', '..', 'data', 'email-fallback.log');
  let entries = [];
  if (fs.existsSync(logPath)) {
    entries = fs.readFileSync(logPath, 'utf8').split('\n')
      .map((l) => l.trim()).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (e) { return { ts: '', to: '', subject: 'unparseable', html: l }; } })
      .reverse(); // newest first
  }
  res.render('admin/email-log', { entries, smtpOk: mail.smtpReady() });
});

module.exports = router;
