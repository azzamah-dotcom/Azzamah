// Offline support: app files are served from cache and refreshed in the background;
// the adhkar list (azkar.json) is fetched fresh when online and falls back to cache offline.
var CACHE = "azkar-v4";
var SHELL = ["./", "index.html", "app.js", "azkar.json", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: "reload" }); })); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.hostname === "api.github.com") return;

  if (url.origin === location.origin && url.pathname.endsWith("/azkar.json")) {
    e.respondWith(fetch(req).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put("azkar.json", copy); }); }
      return res;
    }).catch(function () { return caches.match("azkar.json"); }));
    return;
  }

  // App files and fonts: cache first, update in background.
  e.respondWith(caches.match(req, { ignoreSearch: url.origin === location.origin }).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && (res.ok || res.type === "opaque")) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});
