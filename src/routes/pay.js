// Payments + order page + reorder per CONTRACT §5. Login required; owner or admin.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const dbm = require('../db');
const logic = require('../logic');
const mail = require('../mail');
const stripeUtil = require('../stripeUtil');
const { requireLogin } = require('./auth');

const router = express.Router();

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

// multipart routes are exempted from the global CSRF middleware (body not parsed
// yet); verify the token here after multer ran.
function checkCsrf(req, res) {
  if (!req.body._csrf || req.body._csrf !== req.session.csrfToken) {
    res.status(403).send('CSRF check failed');
    return false;
  }
  return true;
}

function loadOrder(req, res, next) {
  const order = dbm.getOrder(req.params.id);
  if (!order) return res.status(404).render('404');
  if (req.user.role !== 'admin' && order.user_id !== req.user.id) return res.status(403).send('Forbidden');
  req.order = order;
  next();
}

function baseUrl(req) {
  return process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
}

router.get('/pedido/:id', requireLogin, loadOrder, (req, res) => {
  const order = req.order;
  const items = dbm.getOrderItems(order.id);
  const payments = dbm.getPayments(order.id);
  const acc = logic.accumulated(dbm.db, order.user_id);
  const sem = logic.semaforo(order.user_id, res.locals.cap, dbm.db);
  let daysLeft = null;
  if (order.status === 'pickup_ready' && order.pickup_deadline) {
    daysLeft = Math.ceil((new Date(order.pickup_deadline) - Date.now()) / 86400000);
  }
  res.render('order', { order, items, payments, acc, sem, daysLeft });
});

router.get('/pedido/:id/pagar', requireLogin, loadOrder, (req, res) => {
  const order = req.order;
  const kind = req.query.kind === 'balance' ? 'balance' : 'deposit';
  // payment only in correct status
  if (kind === 'deposit' && order.status !== 'accepted') {
    return res.status(403).render('pay', { order, kind, error: 'deposit_not_allowed' });
  }
  if (kind === 'balance' && order.status !== 'balance_due') {
    return res.status(403).render('pay', { order, kind, error: 'balance_not_allowed' });
  }
  const amount = kind === 'deposit' ? logic.depositDue(order) : logic.round2(order.balance_due);
  res.render('pay', {
    order, kind, amount,
    stripeEnabled: !!stripeUtil.getClient(),
    stripePublishable: stripeUtil.getPublishable(),
    transferInstructions: '',
  });
});

router.post('/pedido/:id/pagar-transferencia', requireLogin, loadOrder, upload.single('proof'), (req, res) => {
  if (!checkCsrf(req, res)) return;
  const order = req.order;
  const kind = req.body.kind === 'balance' ? 'balance' : 'deposit';
  if (kind === 'deposit' && order.status !== 'accepted') return res.status(403).send('deposit not allowed in this status');
  if (kind === 'balance' && order.status !== 'balance_due') return res.status(403).send('balance not allowed in this status');
  const amount = kind === 'deposit' ? logic.depositDue(order) : logic.round2(order.balance_due);
  dbm.addPayment({
    order_id: order.id, kind, method: 'transfer', amount_mxn: amount,
    currency: order.currency || 'MXN',
    proof_path: req.file ? '/uploads/' + req.file.filename : null,
    status: 'pending',
  });
  res.redirect(`/pedido/${order.id}`);
});

router.get('/pedido/:id/pagar-tarjeta', requireLogin, loadOrder, async (req, res) => {
  const order = req.order;
  const kind = req.query.kind === 'balance' ? 'balance' : 'deposit';
  if (kind === 'deposit' && order.status !== 'accepted') return res.status(403).send('deposit not allowed in this status');
  if (kind === 'balance' && order.status !== 'balance_due') return res.status(403).send('balance not allowed in this status');
  const stripe = stripeUtil.getClient();
  if (!stripe) return res.status(400).render('pay', { order, kind, error: 'stripe_unavailable' });
  const amount = kind === 'deposit' ? logic.depositDue(order) : logic.round2(order.balance_due);
  try {
    const sess = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'mxn',
          product_data: { name: `Ponte Guapa — pedido #${order.id} (${kind === 'deposit' ? 'anticipo 60%' : 'saldo'})` },
          unit_amount: Math.round(amount * 100),
        },
        quantity: 1,
      }],
      success_url: `${baseUrl(req)}/pedido/${order.id}/pago-exito?session_id={CHECKOUT_SESSION_ID}&kind=${kind}`,
      cancel_url: `${baseUrl(req)}/pedido/${order.id}`,
      metadata: { order_id: String(order.id), kind },
    });
    res.redirect(303, sess.url);
  } catch (e) {
    console.error('[stripe] checkout session failed:', e.message);
    res.status(500).render('pay', { order, kind, error: 'stripe_error' });
  }
});

// Stripe return (GET, CSRF-exempt per CONTRACT §8).
router.get('/pedido/:id/pago-exito', requireLogin, loadOrder, async (req, res) => {
  const order = req.order;
  const stripe = stripeUtil.getClient();
  if (!stripe || !req.query.session_id) return res.status(400).send('stripe unavailable');
  try {
    const s = await stripe.checkout.sessions.retrieve(String(req.query.session_id));
    if (s.payment_status === 'paid') {
      const kind = req.query.kind === 'balance' ? 'balance' : 'deposit';
      const already = dbm.db.prepare('SELECT id FROM payments WHERE stripe_ref=?').get(s.id);
      if (!already) {
        const amount = logic.round2(s.amount_total / 100);
        dbm.addPayment({
          order_id: order.id, kind, method: 'card', amount_mxn: amount,
          currency: 'MXN', stripe_ref: s.id, status: 'confirmed',
        });
        const fresh = dbm.getOrder(order.id);
        if (kind === 'deposit' && fresh.status === 'accepted' && logic.canTransition('accepted', 'deposit_paid')) {
          dbm.updateOrder(order.id, {
            deposit_paid_amount: logic.round2((Number(fresh.deposit_paid_amount) || 0) + amount),
            status: 'deposit_paid',
          });
        } else if (kind === 'balance' && fresh.status === 'balance_due' && logic.canTransition('balance_due', 'fully_paid')) {
          dbm.updateOrder(order.id, { status: 'fully_paid' });
        }
        const customer = dbm.getUser(order.user_id);
        await mail.notifyCustomer(customer, `Pago confirmado — pedido #${order.id}`,
          `<p>Hola ${customer ? customer.name : ''}, confirmamos tu pago de ${amount.toFixed(2)} MXN del pedido #${order.id}.</p>`);
      }
    }
  } catch (e) {
    console.error('[stripe] pago-exito failed:', e.message);
  }
  res.redirect(`/pedido/${order.id}`);
});

router.post('/pedido/:id/reordenar', requireLogin, loadOrder, (req, res) => {
  const items = dbm.getOrderItems(req.order.id);
  req.session.cart = req.session.cart || [];
  for (const it of items) {
    const ex = req.session.cart.find((i) => String(i.productId) === String(it.product_id));
    if (ex) ex.qty += it.qty;
    else req.session.cart.push({ productId: it.product_id, qty: it.qty });
  }
  res.redirect('/carrito');
});

module.exports = router;
