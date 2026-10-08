// Ponte Guapa Shopping — i18n loader + middleware per CONTRACT §2/§8.
// Loads src/i18n/es.json + en.json. Tolerant: missing/invalid file -> {} + console warning
// (the content agent fills translations later; the server must not crash).
const path = require('path');

function loadLocale(code) {
  const p = path.join(__dirname, 'i18n', code + '.json');
  try {
    delete require.cache[require.resolve(p)];
    const dict = require(p);
    return dict && typeof dict === 'object' ? dict : {};
  } catch (e) {
    console.warn(`[i18n] locale file missing or invalid: i18n/${code}.json — using empty dict`);
    return {};
  }
}

const dicts = { es: loadLocale('es'), en: loadLocale('en') };

function lookup(dict, key) {
  let cur = dict;
  for (const part of String(key).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// t(key, params): dotted key lookup in req.lang, fallback to es, then the key itself.
// {placeholders} are replaced from params.
function tFor(lang) {
  return function t(key, params) {
    let s = lookup(dicts[lang] || {}, key);
    if (s === undefined) s = lookup(dicts.es, key);
    if (s === undefined) return key;
    if (typeof s !== 'string') return s; // arrays/objects (steps, sections) pass through
    if (params) {
      for (const k of Object.keys(params)) {
        s = s.split('{' + k + '}').join(String(params[k]));
      }
    }
    return s;
  };
}

// Middleware: req.lang from cookie pg_lang -> session -> user.lang -> 'es';
// exposes res.locals.t and res.locals.lang.
function middleware(req, res, next) {
  let lang = req.cookies && req.cookies.pg_lang;
  if (lang !== 'es' && lang !== 'en') lang = req.session && req.session.lang;
  if (lang !== 'es' && lang !== 'en' && req.user && req.user.lang) lang = req.user.lang;
  if (lang !== 'es' && lang !== 'en') lang = 'es';
  req.lang = lang;
  res.locals.t = tFor(lang);
  res.locals.lang = lang;
  next();
}

module.exports = { dicts, tFor, middleware };
