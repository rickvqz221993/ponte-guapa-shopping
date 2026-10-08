// Ponte Guapa Shopping — SQLite via better-sqlite3 (WAL mode).
// Schema + seeds per CONTRACT §3. Exports db plus small data-access helpers.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'shop.db'));
db.pragma('journal_mode = WAL');

db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, whatsapp TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE, phone TEXT NOT NULL, password_hash TEXT NOT NULL,
 birthdate TEXT, age INTEGER, found_via TEXT, recommended_by TEXT,
 product_interests TEXT, role TEXT NOT NULL DEFAULT 'customer', lang TEXT NOT NULL DEFAULT 'es',
 credit_mxn REAL NOT NULL DEFAULT 0, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT, image_path TEXT, title_es TEXT NOT NULL, title_en TEXT NOT NULL,
 desc_es TEXT NOT NULL, desc_en TEXT NOT NULL, price_mxn REAL,
 age_groups TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 channel TEXT NOT NULL DEFAULT 'web', status TEXT NOT NULL DEFAULT 'pending',
 subtotal_mxn REAL NOT NULL DEFAULT 0, credit_applied REAL NOT NULL DEFAULT 0,
 deposit_due REAL NOT NULL DEFAULT 0, deposit_paid_amount REAL NOT NULL DEFAULT 0,
 balance_due REAL NOT NULL DEFAULT 0, shipping_cost_mxn REAL NOT NULL DEFAULT 0,
 currency TEXT NOT NULL DEFAULT 'MXN', ship_name TEXT, ship_phone TEXT, ship_city TEXT,
 ship_postal TEXT, ship_address TEXT, pickup INTEGER NOT NULL DEFAULT 0,
 alt_name TEXT, alt_phone TEXT, alt_city TEXT, alt_postal TEXT, alt_address TEXT,
 final_sale_accepted INTEGER NOT NULL DEFAULT 0, tracking TEXT NOT NULL DEFAULT '',
 pickup_deadline TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE TABLE IF NOT EXISTS order_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
 product_id INTEGER NOT NULL REFERENCES products(id), qty INTEGER NOT NULL, unit_price_mxn REAL);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE TABLE IF NOT EXISTS payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
 kind TEXT NOT NULL, method TEXT NOT NULL, amount_mxn REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'MXN',
 proof_path TEXT, stripe_ref TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE TABLE IF NOT EXISTS announcements(
 id INTEGER PRIMARY KEY AUTOINCREMENT, title_es TEXT NOT NULL, title_en TEXT NOT NULL,
 body_es TEXT NOT NULL, body_en TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// ---- seeds (only when empty) ----
const now = () => new Date().toISOString();

const settingsCount = db.prepare('SELECT COUNT(*) AS c FROM settings').get().c;
if (!settingsCount) {
  const ins = db.prepare('INSERT INTO settings(key,value) VALUES (?,?)');
  const seed = db.transaction((rows) => { for (const r of rows) ins.run(r[0], r[1]); });
  seed([
    ['alert_emails', 'rickvqzinfo@gmail.com'],
    ['whatsapp_number', '+971 52 686 4330'],
    ['accumulation_cap', '20000'],
    ['pickup_days', '15'],
    ['fx_usd', '17.00'],
    ['fx_cad', '12.50'],
    ['fx_eur', '18.50'],
  ]);
  console.log('[db] seeded settings');
}

const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE email='admin@ponteguapa.shop'").get().c;
if (!adminCount) {
  const hash = bcrypt.hashSync('PonteGuapa2026!', 10);
  db.prepare(`INSERT INTO users(name,whatsapp,email,phone,password_hash,role,created_at)
              VALUES (?,?,?,?,?,?,?)`)
    .run('Administradora', '', 'admin@ponteguapa.shop', '', hash, 'admin', now());
  console.log('[db] seeded admin admin@ponteguapa.shop (CHANGE PASSWORD in /admin/config)');
}

// ---- helpers ----
function getSetting(key, dflt = '') {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : dflt;
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO settings(key,value) VALUES(?,?)
              ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));
}
function allSettings() {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const o = {};
  for (const r of rows) o[r.key] = r.value;
  return o;
}

function updateFields(table, id, fields, allowed) {
  const keys = Object.keys(fields || {}).filter((k) => allowed.includes(k));
  if (!keys.length) return 0;
  const sql = `UPDATE ${table} SET ${keys.map((k) => k + '=?').join(', ')} WHERE id=?`;
  return db.prepare(sql).run(...keys.map((k) => fields[k]), id).changes;
}

// users
const USER_FIELDS = ['name', 'whatsapp', 'email', 'phone', 'password_hash', 'birthdate', 'age',
  'found_via', 'recommended_by', 'product_interests', 'role', 'lang', 'credit_mxn', 'notes'];
function getUserByEmail(email) { return db.prepare('SELECT * FROM users WHERE email=?').get(email) || null; }
function getUser(id) { return db.prepare('SELECT * FROM users WHERE id=?').get(id) || null; }
function createUser(u) {
  const r = db.prepare(`INSERT INTO users(name,whatsapp,email,phone,password_hash,birthdate,age,found_via,
    recommended_by,product_interests,role,lang,credit_mxn,notes,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    u.name, u.whatsapp, u.email, u.phone, u.password_hash, u.birthdate || null,
    u.age == null ? null : u.age, u.found_via || '', u.recommended_by || '',
    u.product_interests || '', u.role || 'customer', u.lang || 'es',
    u.credit_mxn || 0, u.notes || '', now());
  return r.lastInsertRowid;
}
function updateUser(id, fields) { return updateFields('users', id, fields, USER_FIELDS); }
function listCustomers(q) {
  if (q) {
    const like = `%${q}%`;
    return db.prepare(`SELECT * FROM users WHERE role='customer' AND (name LIKE ? OR email LIKE ? OR whatsapp LIKE ?) ORDER BY id DESC`).all(like, like, like);
  }
  return db.prepare(`SELECT * FROM users WHERE role='customer' ORDER BY id DESC`).all();
}

// products
const PRODUCT_FIELDS = ['image_path', 'title_es', 'title_en', 'desc_es', 'desc_en', 'price_mxn', 'age_groups', 'category', 'active'];
function getProduct(id) { return db.prepare('SELECT * FROM products WHERE id=?').get(id) || null; }
function listProducts(activeOnly) {
  return db.prepare(activeOnly
    ? 'SELECT * FROM products WHERE active=1 ORDER BY id DESC'
    : 'SELECT * FROM products ORDER BY id DESC').all();
}
function createProduct(p) {
  const r = db.prepare(`INSERT INTO products(image_path,title_es,title_en,desc_es,desc_en,price_mxn,age_groups,category,active,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    p.image_path || null, p.title_es, p.title_en, p.desc_es, p.desc_en,
    p.price_mxn == null ? null : p.price_mxn, p.age_groups || '', p.category || '',
    p.active == null ? 1 : p.active, now());
  return r.lastInsertRowid;
}
function updateProduct(id, fields) { return updateFields('products', id, fields, PRODUCT_FIELDS); }

// orders
const ORDER_FIELDS = ['user_id', 'channel', 'status', 'subtotal_mxn', 'credit_applied', 'deposit_due',
  'deposit_paid_amount', 'balance_due', 'shipping_cost_mxn', 'currency', 'ship_name', 'ship_phone',
  'ship_city', 'ship_postal', 'ship_address', 'pickup', 'alt_name', 'alt_phone', 'alt_city',
  'alt_postal', 'alt_address', 'final_sale_accepted', 'tracking', 'pickup_deadline', 'created_at'];
function getOrder(id) { return db.prepare('SELECT * FROM orders WHERE id=?').get(id) || null; }
function createOrder(o) {
  const r = db.prepare(`INSERT INTO orders(user_id,channel,status,subtotal_mxn,credit_applied,deposit_due,
    deposit_paid_amount,balance_due,shipping_cost_mxn,currency,ship_name,ship_phone,ship_city,ship_postal,
    ship_address,pickup,alt_name,alt_phone,alt_city,alt_postal,alt_address,final_sale_accepted,tracking,
    pickup_deadline,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    o.user_id, o.channel || 'web', o.status || 'pending', o.subtotal_mxn || 0, o.credit_applied || 0,
    o.deposit_due || 0, o.deposit_paid_amount || 0, o.balance_due || 0, o.shipping_cost_mxn || 0,
    o.currency || 'MXN', o.ship_name || null, o.ship_phone || null, o.ship_city || null,
    o.ship_postal || null, o.ship_address || null, o.pickup ? 1 : 0,
    o.alt_name || null, o.alt_phone || null, o.alt_city || null, o.alt_postal || null,
    o.alt_address || null, o.final_sale_accepted ? 1 : 0, o.tracking || '',
    o.pickup_deadline || null, now());
  return r.lastInsertRowid;
}
function updateOrder(id, fields) { return updateFields('orders', id, fields, ORDER_FIELDS); }
function listOrders({ status, userId } = {}) {
  let sql = `SELECT o.*, u.name AS customer_name, u.email AS customer_email
             FROM orders o LEFT JOIN users u ON u.id=o.user_id`;
  const conds = [], params = [];
  if (status) { conds.push('o.status=?'); params.push(status); }
  if (userId) { conds.push('o.user_id=?'); params.push(userId); }
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY o.id DESC';
  return db.prepare(sql).all(...params);
}

// order items
function addOrderItem(it) {
  const r = db.prepare(`INSERT INTO order_items(order_id,product_id,qty,unit_price_mxn) VALUES (?,?,?,?)`)
    .run(it.order_id, it.product_id, it.qty, it.unit_price_mxn == null ? null : it.unit_price_mxn);
  return r.lastInsertRowid;
}
function getOrderItems(orderId) {
  return db.prepare(`SELECT oi.*, p.title_es, p.title_en, p.image_path, p.category
    FROM order_items oi LEFT JOIN products p ON p.id=oi.product_id
    WHERE oi.order_id=? ORDER BY oi.id`).all(orderId);
}
function updateOrderItem(id, fields) { return updateFields('order_items', id, fields, ['unit_price_mxn', 'qty']); }

// payments
function addPayment(p) {
  const r = db.prepare(`INSERT INTO payments(order_id,kind,method,amount_mxn,currency,proof_path,stripe_ref,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    p.order_id, p.kind, p.method, p.amount_mxn, p.currency || 'MXN',
    p.proof_path || null, p.stripe_ref || null, p.status || 'pending', now());
  return r.lastInsertRowid;
}
function getPayment(id) { return db.prepare('SELECT * FROM payments WHERE id=?').get(id) || null; }
function getPayments(orderId) { return db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id').all(orderId); }
function updatePayment(id, fields) { return updateFields('payments', id, fields, ['status', 'proof_path', 'stripe_ref']); }
function pendingProofs() {
  return db.prepare(`SELECT p.*, o.user_id, u.name AS customer_name
    FROM payments p JOIN orders o ON o.id=p.order_id LEFT JOIN users u ON u.id=o.user_id
    WHERE p.status='pending' ORDER BY p.id DESC`).all();
}

// announcements
function listAnnouncements() { return db.prepare('SELECT * FROM announcements ORDER BY id DESC').all(); }
function createAnnouncement(a) {
  const r = db.prepare(`INSERT INTO announcements(title_es,title_en,body_es,body_en,created_at) VALUES (?,?,?,?,?)`)
    .run(a.title_es, a.title_en, a.body_es, a.body_en, now());
  return r.lastInsertRowid;
}

module.exports = {
  db, now, getSetting, setSetting, allSettings,
  getUserByEmail, getUser, createUser, updateUser, listCustomers,
  getProduct, listProducts, createProduct, updateProduct,
  getOrder, createOrder, updateOrder, listOrders,
  addOrderItem, getOrderItems, updateOrderItem,
  addPayment, getPayment, getPayments, updatePayment, pendingProofs,
  listAnnouncements, createAnnouncement,
};
