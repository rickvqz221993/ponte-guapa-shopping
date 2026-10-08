// Public routes per CONTRACT §5.
const express = require('express');
const dbm = require('../db');

const router = express.Router();
const AGES = ['<20', '20-30', '30-40', '40-50', '50-60', '60+'];

router.get('/', (req, res) => {
  const featured = dbm.listProducts(true).slice(0, 8);
  const latest = dbm.listProducts(true).slice(0, 8);
  const announcements = dbm.listAnnouncements().slice(0, 5);
  res.render('home', { featured, latest, announcements });
});

router.get('/catalogo', (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '');
  const age = String(req.query.age || '');
  const price = String(req.query.price || '');
  let sql = 'SELECT * FROM products WHERE active=1';
  const params = [];
  if (q) {
    sql += ' AND (title_es LIKE ? OR title_en LIKE ? OR desc_es LIKE ? OR desc_en LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (category) { sql += ' AND category=?'; params.push(category); }
  if (age) { sql += " AND (',' || age_groups || ',') LIKE ?"; params.push(`%,${age},%`); }
  if (price === 'with_price') sql += ' AND price_mxn IS NOT NULL';
  if (price === 'tbd_only') sql += ' AND price_mxn IS NULL';
  sql += ' ORDER BY id DESC';
  const products = dbm.db.prepare(sql).all(...params);
  const categories = dbm.db.prepare(
    "SELECT DISTINCT category FROM products WHERE active=1 AND category<>'' ORDER BY category"
  ).all().map((r) => r.category);
  res.render('catalog', {
    products,
    filters: { q, category, age, price },
    categories,
    ages: AGES,
  });
});

router.get('/producto/:id', (req, res) => {
  const product = dbm.getProduct(req.params.id);
  if (!product || !product.active) return res.status(404).render('404');
  const related = dbm.db.prepare(
    'SELECT * FROM products WHERE active=1 AND id<>? ORDER BY id DESC LIMIT 4'
  ).all(product.id);
  res.render('product', { product, related });
});

router.get('/como-comprar', (req, res) => res.render('page', { pageKey: 'how_to_buy' }));
router.get('/politica-envio', (req, res) => res.render('page', { pageKey: 'shipping_policy' }));

router.get('/lang/:lang', (req, res) => {
  const lang = req.params.lang === 'en' ? 'en' : 'es';
  res.cookie('pg_lang', lang, { maxAge: 365 * 24 * 60 * 60 * 1000, path: '/' });
  req.session.lang = lang;
  if (req.user) dbm.updateUser(req.user.id, { lang });
  res.redirect(req.get('Referer') || '/');
});

// manifest + sw are served static from public/ once the frontend agent creates them.
router.get('/offline.html', (req, res) => res.render('offline'));

module.exports = router;
