// Ponte Guapa Shopping — boot. Middleware order per CONTRACT §8:
// helmet-lite headers -> static -> cookie/session (connect-sqlite3, same db file)
// -> i18n -> csrf -> cartCount -> routes -> 404 -> 500.
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStoreFactory = require('connect-sqlite3');

const dbm = require('./db');
const i18n = require('./i18n');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 1) helmet-lite headers (manual, no extra dep)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// 2) static: public at /, uploads at /uploads
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));

// 3) session via connect-sqlite3 on the SAME db file (data/shop.db)
const SQLiteStore = SQLiteStoreFactory(session);
app.use(session({
  store: new SQLiteStore({ db: 'shop.db', dir: path.join(__dirname, '..', 'data'), table: 'sessions' }),
  secret: process.env.SESSION_SECRET || 'ponte-guapa-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' },
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// tiny cookie parser (avoids adding cookie-parser to the dep set)
app.use((req, res, next) => {
  req.cookies = {};
  const h = req.headers.cookie;
  if (h) {
    h.split(';').forEach((p) => {
      const i = p.indexOf('=');
      if (i > 1) {
        try { req.cookies[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
        catch (e) { /* ignore malformed cookie */ }
      }
    });
  }
  next();
});

// attach logged-in user (before i18n so user.lang is visible)
app.use((req, res, next) => {
  req.user = (req.session && req.session.userId) ? dbm.getUser(req.session.userId) : null;
  next();
});

// 4) i18n
app.use(i18n.middleware);

// shared view locals per CONTRACT §7
app.use((req, res, next) => {
  res.locals.user = req.user || null;
  res.locals.waNumber = dbm.getSetting('whatsapp_number', '');
  res.locals.fx = {
    usd: parseFloat(dbm.getSetting('fx_usd', '17')) || 0,
    cad: parseFloat(dbm.getSetting('fx_cad', '12.5')) || 0,
    eur: parseFloat(dbm.getSetting('fx_eur', '18.5')) || 0,
  };
  res.locals.cap = parseFloat(dbm.getSetting('accumulation_cap', '20000')) || 20000;
  next();
});

// 5) csrf: token in session + res.locals.csrfToken; checked on all POST
// except /pedido/:id/pago-exito (Stripe return, GET). Multipart uploads are
// verified post-multer inside their routes (body is not parsed yet here).
app.use((req, res, next) => {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  res.locals.csrfToken = req.session.csrfToken;
  if (req.method === 'POST') {
    if (/^\/pedido\/\d+\/pago-exito/.test(req.path)) return next();
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) return next();
    const tok = (req.body && req.body._csrf) || req.query._csrf;
    if (!tok || tok !== req.session.csrfToken) return res.status(403).send('CSRF check failed');
  }
  next();
});

// 6) cartCount
app.use((req, res, next) => {
  const cart = (req.session && req.session.cart) || [];
  res.locals.cartCount = cart.reduce((a, i) => a + (Number(i.qty) || 0), 0);
  next();
});

// 7) routes
app.use('/', require('./routes/public'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/cart'));
app.use('/', require('./routes/pay'));
app.use('/', require('./routes/account'));
app.use('/', require('./routes/admin'));

// 8) 404
app.use((req, res) => { res.status(404).render('404'); });

// 9) 500
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[500]', err);
  res.status(500).render('500');
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Ponte Guapa Shopping listening on :${PORT}`));
}
module.exports = app;
