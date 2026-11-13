// Native layer for the iPhone app (loaded only inside the app, before app.js).
// It leaves the shared website code untouched and adds what a web page can't do on iPhone:
// real vibration, notifications scheduled on the phone itself, and the newest adhkar list.
(function () {
  "use strict";
  var Cap = window.Capacitor;
  if (!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  var P = Cap.Plugins || {};
  var REMOTE = "https://azzamah-dotcom.github.io/Azzamah/";
  document.documentElement.classList.add("native-app");

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsJSON(k) { try { return JSON.parse(lsGet(k) || "null"); } catch (e) { return null; } }

  // ---------- newest adhkar list from the website, with the built-in copy as a fallback ----------
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    if (/^(\.\/)?azkar\.json/.test(url)) {
      var local = url.split("?")[0];
      return origFetch(REMOTE + url.replace(/^\.\//, ""), { cache: "no-store" })
        .then(function (r) { return r.ok ? r : origFetch(local, init); })
        .catch(function () { return origFetch(local, init); });
    }
    return origFetch(input, init);
  };

  // ---------- real vibration through the iPhone's haptic engine ----------
  var H = P.Haptics;
  if (H) {
    navigator.vibrate = function (pattern) {
      try {
        if (typeof pattern === "number" || (Array.isArray(pattern) && pattern.length === 1)) {
          var ms = Array.isArray(pattern) ? pattern[0] : pattern;
          H.impact({ style: ms < 40 ? "LIGHT" : ms < 90 ? "MEDIUM" : "HEAVY" });
          return true;
        }
        if (Array.isArray(pattern)) {
          var t = 0;
          for (var i = 0; i < pattern.length; i += 2) {
            (function (on, at) { setTimeout(function () { H.impact({ style: on >= 100 ? "HEAVY" : on >= 50 ? "MEDIUM" : "LIGHT" }); }, at); })(pattern[i], t);
            t += (pattern[i] || 0) + (pattern[i + 1] || 0);
          }
          return true;
        }
      } catch (e) {}
      return false;
    };
  }

  // ---------- notifications scheduled on the phone (no internet or server needed) ----------
  var LN = P.LocalNotifications;
  var PC = window.PrayerCalc;
  var PNAMES = { fajr: "الفجر", dhuhr: "الظهر", asr: "العصر", maghrib: "المغرب", isha: "العشاء" };
  var NDEF = { adhan: true, iqama: true, after: true, adhkar: true, sound: true, iq: { fajr: 20, dhuhr: 15, asr: 15, maghrib: 10, isha: 15 } };
  var DAYS = 3; // iPhone keeps at most 64 pending notifications; 3 days fits comfortably

  function settings() {
    var s = lsJSON("azkar-notif") || {}, out = {};
    for (var k in NDEF) out[k] = s[k] == null ? NDEF[k] : s[k];
    out.iq = Object.assign({}, NDEF.iq, s.iq || {});
    return out;
  }
  function method(place) {
    var m = lsGet("azkar-pt-method") || "auto";
    if (m !== "auto" && PC.METHODS[m]) return m;
    return (place && place.cc && PC.COUNTRY[place.cc]) || "mwl";
  }
  function hanafi(place) {
    var a = lsGet("azkar-pt-asr") || "auto";
    if (a === "auto") return !!(place && place.cc && PC.HANAFI[place.cc]);
    return a === "hanafi";
  }
  function eventsForDay(date, place, n) {
    var t = PC.compute(date, place.lat, place.lon, method(place), hanafi(place));
    var fri = date.getDay() === 5, key = date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();
    var where = place.city ? " حسب توقيت " + String(place.city).split("،")[0] : "";
    var ev = [];
    ["fajr", "dhuhr", "asr", "maghrib", "isha"].forEach(function (k) {
      var name = k === "dhuhr" && fri ? "الجمعة" : PNAMES[k], at = t[k].getTime();
      if (n.adhan) ev.push({ key: key + k + "a", at: at, adhan: true, title: "🕌 أذان " + name, body: "حان الآن موعد صلاة " + name + where + ".", url: "#times" });
      if (n.iqama && !(k === "dhuhr" && fri)) ev.push({ key: key + k + "i", at: at + (n.iq[k] || 0) * 60000, title: "إقامة صلاة " + name, body: "حان موعد الإقامة تقريبًا، أدرك صلاة الجماعة.", url: "#times" });
      if (n.after) ev.push({ key: key + k + "h", at: at + 3600000, title: "هل صليت " + name + "؟", body: "مضت ساعة على أذان " + name + ". «أحب الأعمال إلى الله: الصلاة على وقتها».", url: "#times" });
    });
    if (n.adhkar) {
      ev.push({ key: key + "am", at: t.fajr.getTime() + 40 * 60000, title: "☀️ أذكار الصباح", body: "حان وقت أذكار الصباح، اغتنمها قبل أن يشغلك يومك.", url: "#morning" });
      ev.push({ key: key + "pm", at: t.asr.getTime() + 30 * 60000, title: "🌙 أذكار المساء", body: "حان وقت أذكار المساء قبل غروب الشمس.", url: "#evening" });
      ev.push({ key: key + "sl", at: t.isha.getTime() + 150 * 60000, title: "أذكار النوم", body: "لا تنسَ أذكار النوم قبل أن تنام.", url: "#sleep" });
      if (fri) ev.push({ key: key + "fr", at: t.sunrise.getTime() + 90 * 60000, title: "🕌 اليوم الجمعة", body: "سورة الكهف، والإكثار من الصلاة على النبي ﷺ، والتبكير إلى الصلاة، وساعة الإجابة آخر ساعة بعد العصر.", url: "#friday" });
    }
    return ev;
  }
  function idFor(key) { var h = 0; for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0; return Math.abs(h) % 2000000000 + 1; }

  var lastSig = "", busy = false;
  function reschedule(force) {
    if (!LN || !PC || busy) return;
    var place = lsJSON("azkar-place");
    if (!place || typeof place.lat !== "number") return;
    var n = settings(), today = new Date();
    var sig = JSON.stringify([place.lat.toFixed(2), place.lon.toFixed(2), place.cc, n, method(place), hanafi(place), today.toDateString()]);
    if (!force && sig === lastSig) return;
    busy = true;
    LN.checkPermissions().then(function (p) {
      return p.display === "granted" ? p : LN.requestPermissions();
    }).then(function (p) {
      if (p.display !== "granted") throw new Error("notifications not allowed");
      var now = Date.now(), all = [];
      for (var d = 0; d < DAYS; d++) all = all.concat(eventsForDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + d), place, n));
      all = all.filter(function (e) { return e.at > now + 30000; }).sort(function (a, b) { return a.at - b.at; }).slice(0, 60);
      return LN.getPending().then(function (pend) {
        var old = (pend.notifications || []).map(function (x) { return { id: x.id }; });
        return old.length ? LN.cancel({ notifications: old }) : null;
      }).then(function () {
        if (!all.length) return null;
        return LN.schedule({ notifications: all.map(function (e) {
          var item = { id: idFor(e.key), title: e.title, body: e.body, schedule: { at: new Date(e.at), allowWhileIdle: true }, extra: { url: e.url }, threadIdentifier: "azkar" };
          // A full adhan clip can be added to the app as "adhan.caf" (30 seconds at most on iPhone).
          if (e.adhan && n.sound) item.sound = "adhan.caf";
          return item;
        }) });
      });
    }).then(function () { lastSig = sig; }).catch(function () {}).then(function () { busy = false; });
  }

  if (LN) {
    // Tapping a notification opens the matching section.
    LN.addListener("localNotificationActionPerformed", function (a) {
      var url = a && a.notification && a.notification.extra && a.notification.extra.url;
      if (url) location.hash = url.replace(/^#/, "");
    });
  }
  // Schedule on launch, whenever the app comes back, and when settings or location change.
  window.addEventListener("load", function () { setTimeout(function () { reschedule(true); }, 2500); });
  if (P.App) P.App.addListener("appStateChange", function (st) { if (st.isActive) reschedule(true); });
  setInterval(function () { reschedule(false); }, 60000);
  document.addEventListener("change", function () { setTimeout(function () { reschedule(false); }, 500); }, true);

  // Hide the splash screen once the page is drawn.
  window.addEventListener("load", function () { if (P.SplashScreen) P.SplashScreen.hide(); });
  window.HisnNative = { reschedule: reschedule };
})();
