/* Ponte Guapa Shopping service worker */
var CACHE = 'pg-v1';
var PRECACHE = [
  '/offline.html',
  '/style.css',
  '/app.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(PRECACHE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isStaticAsset(url) {
  return /(\/style\.css|\/app\.js|\/icons\/|\/offline\.html)$/.test(url.pathname);
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isStaticAsset(url)) {
    /* cache-first for css/js/icons/offline */
    e.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        }).catch(function () { return caches.match('/offline.html'); });
      })
    );
    return;
  }

  /* network-first for pages, offline fallback */
  e.respondWith(
    fetch(req).then(function (res) {
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        if (hit) return hit;
        if (req.headers.get('accept') && req.headers.get('accept').indexOf('text/html') !== -1) {
          return caches.match('/offline.html');
        }
        return Response.error();
      });
    })
  );
});
