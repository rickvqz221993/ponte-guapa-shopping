// Render-test every EJS view with mock locals + real es.json translations.
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');

const es = JSON.parse(fs.readFileSync(path.join(__dirname, 'src/i18n/es.json'), 'utf8'));
function lookup(key) {
  return key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), es);
}
const t = (key, params) => {
  let v = lookup(key);
  if (v === undefined) return '!!MISSING:' + key + '!!';
  if (typeof v === 'string' && params) {
    Object.keys(params).forEach(k => { v = v.split('{' + k + '}').join(params[k]); });
  }
  return v;
};

const product = {
  id: 1, image_path: 'prod1.jpg', title_es: 'Vestido kawaii', title_en: 'Kawaii dress',
  desc_es: 'Descripción en español', desc_en: 'English description',
  price_mxn: 1299.5, age_groups: '<20,20-30', category: 'Ropa', active: 1
};
const productTbd = Object.assign({}, product, { id: 2, price_mxn: null, title_es: 'Bolso sorpresa' });

const base = {
  t, lang: 'es', user: null, cartCount: 3, csrfToken: 'TESTCSRF',
  waNumber: '+971 52 686 4330', fx: { usd: 17, cad: 12.5, eur: 18.5 }, cap: 20000
};
const userLocals = Object.assign({}, base, {
  user: { id: 7, name: 'María', email: 'maria@example.com', whatsapp: '521234567890', phone: '521234567890', role: 'customer', credit_mxn: 150 }
});
const adminLocals = Object.assign({}, base, {
  user: { id: 1, name: 'Administradora', email: 'admin@ponteguapa.shop', role: 'admin' }
});

const order = {
  id: 42, user_id: 7, channel: 'web', status: 'accepted', subtotal_mxn: 2000, credit_applied: 150,
  deposit_due: 1110, deposit_paid_amount: 0, balance_due: 0, shipping_cost_mxn: 0,
  ship_name: 'María', ship_phone: '521234', ship_city: 'CDMX', ship_postal: '06600', ship_address: 'Calle 1',
  pickup: 0, tracking: '', pickup_deadline: null, created_at: '2026-10-08T10:00:00'
};
const items = [
  { id: 11, qty: 2, unit_price_mxn: 1000, product },
  { id: 12, qty: 1, unit_price_mxn: null, product: productTbd }
];
const payments = [
  { id: 5, order_id: 42, kind: 'deposit', method: 'transfer', amount_mxn: 1110, proof_path: 'proof1.jpg', status: 'pending' }
];

const views = {
  'home': Object.assign({}, base, { featured: [product], latest: [productTbd], announcements: [{ title_es: 'Aviso', title_en: 'Notice', body_es: 'Cuerpo', body_en: 'Body', created_at: '2026-10-08' }] }),
  'catalog': Object.assign({}, base, { products: [product, productTbd], filters: { q: '', category: '', age: '', price: '' }, categories: ['Ropa'], ages: ['<20', '20-30'] }),
  'product': Object.assign({}, base, { product, related: [productTbd] }),
  'cart': Object.assign({}, base, { items: [{ product, qty: 2 }, { product: productTbd, qty: 1 }] }),
  'checkout': Object.assign({}, userLocals, { creditApplied: 150 }),
  'order': Object.assign({}, userLocals, { order, items, payments, semaforo: 'yellow' }),
  'pay': Object.assign({}, userLocals, { order, kind: 'deposit', amount: 1110, stripeEnabled: false, transferInstructions: 'CLABE 123' }),
  'login': Object.assign({}, base, { error: 'auth.err_login' }),
  'register': Object.assign({}, base, { errors: ['auth.err_email_taken'], old: { name: 'Ana' } }),
  'account': Object.assign({}, userLocals, { acumulado: 12500, semaforo: 'yellow', inventory: [{ title_es: 'Vestido', qty: 2, paid: 1000, pending: 500, status: 'deposit_paid' }], credit: 150 }),
  'my-orders': Object.assign({}, userLocals, { orders: [order] }),
  'announcements': Object.assign({}, base, { announcements: [{ title_es: 'A', title_en: 'A', body_es: 'B', body_en: 'B', created_at: '2026-10-08' }] }),
  'page': Object.assign({}, base, { pageKey: 'how_to_buy' }),
  'page2': null, // shipping_policy variant, handled below
  'offline': Object.assign({}, base, {}),
  '404': Object.assign({}, base, {}),
  '500': Object.assign({}, base, {}),
  'layout': Object.assign({}, base, { body: '<p>body</p>' }),
  'admin/layout': Object.assign({}, adminLocals, { body: '<p>admin body</p>' }),
  'admin/dashboard': Object.assign({}, adminLocals, { pendingOrders: [order], redFlagCustomers: [{ id: 7, name: 'María', email: 'm@x.com', acumulado: 21000 }], pendingProofs: payments, stats: { customers: 10, orders: 5, openRevenue: 9999 }, overduePickups: [] }),
  'admin/orders': Object.assign({}, adminLocals, { orders: [order], filter: 'pending' }),
  'admin/order-detail': Object.assign({}, adminLocals, { order, items, payments, customer: { id: 7, name: 'María', email: 'm@x.com', whatsapp: '123', credit_mxn: 0 }, acumulado: 12500, semaforo: 'yellow' }),
  'admin/products': Object.assign({}, adminLocals, { products: [product, productTbd] }),
  'admin/product-form': Object.assign({}, adminLocals, { product }),
  'admin/product-form-new': null,
  'admin/customers': Object.assign({}, adminLocals, { customers: [{ id: 7, name: 'María', email: 'm@x.com', whatsapp: '123', created_at: '2026-01-01', acumulado: 12500, semaforo: 'yellow' }], q: '' }),
  'admin/customer-detail': Object.assign({}, adminLocals, { customer: { id: 7, name: 'María', email: 'm@x.com', credit_mxn: 150, notes: 'VIP' }, orders: [order], patterns: { totalOrders: 3, totalSpent: 5000, avgOrder: 1666, ordersPerMonth: 1, topCategories: ['Ropa'] }, acumulado: 12500, semaforo: 'yellow' }),
  'admin/whatsapp-order': Object.assign({}, adminLocals, { customers: [{ id: 7, name: 'María', email: 'm@x.com' }], products: [product, productTbd] }),
  'admin/announcements': Object.assign({}, adminLocals, { announcements: [{ title_es: 'A', title_en: 'A', body_es: 'B', body_en: 'B', created_at: '2026-10-08' }] }),
  'admin/settings': Object.assign({}, adminLocals, { settings: { alert_emails: 'a@b.com' }, saved: true }),
  'admin/email-log': Object.assign({}, adminLocals, { smtpOk: false, log: ['{"ts":"x","to":"a@b.com"}'] })
};

const fileFor = { 'page2': 'page', 'admin/product-form-new': 'admin/product-form' };
let pass = 0, fail = 0;
const missingKeys = new Set();
Object.keys(views).forEach(name => {
  let locals = views[name];
  if (name === 'page2') locals = Object.assign({}, base, { pageKey: 'shipping_policy' });
  if (name === 'admin/product-form-new') locals = Object.assign({}, adminLocals, {});
  const file = path.join(__dirname, 'src/views', (fileFor[name] || name) + '.ejs');
  try {
    const html = ejs.render(fs.readFileSync(file, 'utf8'), locals, { filename: file });
    const miss = html.match(/!!MISSING:[^!]+!!/g);
    if (miss) miss.forEach(m => missingKeys.add(name + ': ' + m));
    // sanity: must contain closing html (except none) and csrf where forms exist
    if (!html.includes('</html>')) throw new Error('no closing </html>');
    if (html.includes('<form') && !html.includes('TESTCSRF') && name !== 'layout' && name !== 'admin/layout') {
      // forms may legitimately omit csrf only if none — flag it
      throw new Error('form without csrf token rendered');
    }
    console.log('PASS ' + name + ' (' + html.length + ' chars)');
    pass++;
  } catch (err) {
    console.log('FAIL ' + name + ' :: ' + err.message.split('\n')[0]);
    fail++;
  }
});
console.log('\n' + pass + ' passed, ' + fail + ' failed');
if (missingKeys.size) { console.log('MISSING KEYS:'); missingKeys.forEach(k => console.log('  ' + k)); }
else console.log('No missing i18n keys referenced.');
process.exit(fail ? 1 : 0);
