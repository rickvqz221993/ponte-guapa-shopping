// Ponte Guapa Shopping — pure business logic per CONTRACT §4. NO express here.
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function ageGroup(age) {
  if (age == null || age === '') return null;
  age = Number(age);
  if (isNaN(age)) return null;
  if (age < 20) return '<20';
  if (age < 30) return '20-30';
  if (age < 40) return '30-40';
  if (age < 50) return '40-50';
  if (age < 60) return '50-60';
  return '60+';
}

const OPEN_STATUSES = ['pending', 'accepted', 'deposit_paid', 'purchased', 'balance_due', 'fully_paid', 'shipped', 'pickup_ready'];

function accumulated(db, userId) {
  const r = db.prepare(
    `SELECT COALESCE(SUM(subtotal_mxn - credit_applied),0) AS acc FROM orders
     WHERE user_id=? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})`
  ).get(userId, ...OPEN_STATUSES);
  return round2(r.acc);
}

function semaforo(userId, cap, db) {
  const acc = accumulated(db, userId);
  cap = Number(cap) || 20000;
  if (acc >= cap) return 'red';
  if (acc >= 10000) return 'yellow';
  return 'green';
}

function canCheckout(userId, cap, db) {
  return semaforo(userId, cap, db) !== 'red';
}

function depositDue(order) {
  return round2(0.60 * ((Number(order.subtotal_mxn) || 0) - (Number(order.credit_applied) || 0)));
}

function balanceDue(order) {
  return round2(((Number(order.subtotal_mxn) || 0) - (Number(order.credit_applied) || 0))
    - (Number(order.deposit_paid_amount) || 0) + (Number(order.shipping_cost_mxn) || 0));
}

const TRANSITIONS = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['deposit_paid', 'rejected', 'cancelled'],
  deposit_paid: ['purchased', 'cancelled'],
  purchased: ['balance_due'],
  balance_due: ['fully_paid'],
  fully_paid: ['shipped', 'pickup_ready'],
  shipped: ['closed'],
  pickup_ready: ['picked_up'],
  picked_up: ['closed'],
};

function canTransition(from, to) {
  return !!(TRANSITIONS[from] || []).includes(to);
}

function orderSubtotal(items) {
  return round2((items || []).reduce((a, it) => {
    if (it.unit_price_mxn == null) return a; // TBD prices ignored
    const p = Number(it.unit_price_mxn);
    if (isNaN(p)) return a;
    return a + (Number(it.qty) || 0) * p;
  }, 0));
}

function hasTbd(items) {
  return (items || []).some((it) => it.unit_price_mxn == null);
}

function pickupDeadline(days) {
  const d = Number(days) || 15;
  return new Date(Date.now() + d * 86400000).toISOString();
}

module.exports = {
  round2, ageGroup, OPEN_STATUSES, accumulated, semaforo, canCheckout,
  depositDue, balanceDue, TRANSITIONS, canTransition, orderSubtotal, hasTbd, pickupDeadline,
};
