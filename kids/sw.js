// Offline support. The app's own files are fetched fresh from the server on every open (so edits
// show up as soon as the app is reopened) and fall back to the saved copy when there is no internet.
// Fonts are served from the saved copy first since they never change.
var CACHE = "kids-v3";
var SHELL = ["./", "index.html", "kids.js", "../prayer.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: "reload" }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    // Only clean up this app's own old caches; the family app shares the same site.
    return Promise.all(keys.filter(function (k) { return k.indexOf("kids-") === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function cacheKey(url) {
  // One saved copy per file, whatever query string was used (e.g. azkar.json?t=...).
  return url.origin + url.pathname;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.hostname === "api.github.com" || url.hostname === "api.bigdatacloud.net") return;

  if (url.origin === location.origin) {
    // Network first, bypassing the browser cache, then the saved copy.
    e.respondWith(fetch(req.url, { cache: "no-store" }).then(function (res) {
      if (res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(cacheKey(url), copy); }); }
      return res;
    }).catch(function () {
      return caches.match(cacheKey(url)).then(function (hit) {
        return hit || caches.match(req, { ignoreSearch: true }) || caches.match(location.origin + location.pathname.replace(/sw\.js$/, ""));
      });
    }));
    return;
  }

  // Fonts and other outside files: saved copy first, refreshed in the background.
  e.respondWith(caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && (res.ok || res.type === "opaque")) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  }));
});

// Tapping a notification opens the app on the right section.
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ("focus" in list[i]) { list[i].navigate && list[i].navigate(target); return list[i].focus(); }
    }
    return self.clients.openWindow(target);
  }));
});

// Ready for server-sent reminders (Web Push) when a push server is connected.
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: e.data && e.data.text() }; }
  // If the app is on screen it shows its own alert with sound, so the notification stays silent.
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
    var onScreen = list.some(function (c) { return c.visibilityState === "visible"; });
    return self.registration.showNotification(d.title || "صلاتي", {
      body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: d.tag, silent: onScreen,
      data: { url: d.url || "./" }, lang: "ar", dir: "rtl"
    });
  }));
});
