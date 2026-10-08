// Auth routes per CONTRACT §5. Also exports requireLogin/requireAdmin guards.
const express = require('express');
const bcrypt = require('bcryptjs');
const dbm = require('../db');

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.role !== 'admin') return res.status(403).send('Forbidden');
  next();
}

router.get('/registro', (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { error: null, form: {} });
});

router.post('/registro', (req, res) => {
  const b = req.body || {};
  const form = {
    name: String(b.name || ''), whatsapp: String(b.whatsapp || ''),
    email: String(b.email || ''), phone: String(b.phone || ''),
    birthdate: String(b.birthdate || ''), found_via: String(b.found_via || ''),
    recommended_by: String(b.recommended_by || ''),
    product_interests: String(b.product_interests || ''),
  };
  const fail = (error) => res.status(400).render('register', { error, form });
  if (!form.name.trim() || !form.whatsapp.trim() || !form.email.trim() || !form.phone.trim() || !b.password) {
    return fail('err_required');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return fail('err_email_invalid');
  if (dbm.getUserByEmail(form.email.trim().toLowerCase())) return fail('err_email_taken');
  if (String(b.password).length < 6) return fail('err_password_short');
  if (b.password !== b.password2) return fail('err_password_mismatch');

  let age = null;
  if (form.birthdate) {
    const d = new Date(form.birthdate);
    if (!isNaN(d)) {
      const t = new Date();
      age = t.getFullYear() - d.getFullYear();
      const m = t.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && t.getDate() < d.getDate())) age--;
    }
  }

  const id = dbm.createUser({
    name: form.name.trim(),
    whatsapp: form.whatsapp.trim(),
    email: form.email.trim().toLowerCase(),
    phone: form.phone.trim(),
    password_hash: bcrypt.hashSync(String(b.password), 10),
    birthdate: form.birthdate || null,
    age,
    found_via: form.found_via,
    recommended_by: form.recommended_by,
    product_interests: form.product_interests,
    role: 'customer',
    lang: req.lang,
  });
  req.session.userId = id;
  res.redirect('/');
});

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(req.user.role === 'admin' ? '/admin' : '/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const u = dbm.getUserByEmail(String(req.body.email || '').trim().toLowerCase());
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) {
    return res.status(401).render('login', { error: 'err_login' });
  }
  req.session.userId = u.id;
  res.redirect(u.role === 'admin' ? '/admin' : '/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;
module.exports.requireLogin = requireLogin;
module.exports.requireAdmin = requireAdmin;
