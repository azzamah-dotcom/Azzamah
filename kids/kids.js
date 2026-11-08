(function () {
  "use strict";
  var PUSH = "https://azkar-push.azzamah.workers.dev";
  var PC = window.PrayerCalc;
  var ORDER = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
  var NAMES = { fajr: "الفجر", dhuhr: "الظهر", asr: "العصر", maghrib: "المغرب", isha: "العشاء" };
  var COLORS = { fajr: "var(--fajr)", dhuhr: "var(--dhuhr)", asr: "var(--asr)", maghrib: "var(--maghrib)", isha: "var(--isha)" };
  var $ = function (id) { return document.getElementById(id); };

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fmtTime(d) { var h = d.getHours(), m = d.getMinutes(); return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + " " + (h < 12 ? "ص" : "م"); }
  function fmtLeft(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); s %= 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  // ---------- prayed log: { "2026-11-8": ["fajr","dhuhr"] } ----------
  var log = {};
  try { log = JSON.parse(lsGet("kids-log") || "{}") || {}; } catch (e) {}
  function doneToday() { return log[dayKey()] || []; }
  function saveLog() {
    var keys = Object.keys(log).sort(function (a, b) { return new Date(b) - new Date(a); });
    keys.slice(60).forEach(function (k) { delete log[k]; });
    lsSet("kids-log", JSON.stringify(log));
  }

  // ---------- location and prayer times ----------
  var place = null, times = null, timesDay = "";
  try { place = JSON.parse(lsGet("kids-place") || "null"); } catch (e) {}
  function method() { return (place && place.cc && PC.COUNTRY[place.cc]) || "mwl"; }
  function hanafi() { return !!(place && place.cc && PC.HANAFI[place.cc]); }
  function computeTimes() {
    if (!place) { times = null; return; }
    var now = new Date();
    timesDay = dayKey(now);
    times = PC.compute(now, place.lat, place.lon, method(), hanafi());
    var tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    times.tomorrowFajr = PC.compute(tom, place.lat, place.lon, method(), hanafi()).fajr;
  }
  function ends(k) {
    return { fajr: times.sunrise, dhuhr: times.asr, asr: times.maghrib, maghrib: times.isha, isha: new Date(times.isha.getTime() + 150 * 60000) }[k];
  }
  function stateOf(k) {
    if (doneToday().indexOf(k) >= 0) return "done";
    var now = Date.now();
    if (now < times[k].getTime()) return "soon";
    if (now < ends(k).getTime()) return "now";
    return "late";
  }
  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude;
      var moved = !place || Math.abs(place.lat - lat) > 0.05 || Math.abs(place.lon - lon) > 0.05;
      place = { lat: lat, lon: lon, cc: place && !moved ? place.cc : "" };
      lsSet("kids-place", JSON.stringify(place));
      computeTimes(); render(); syncPush();
      if (moved || !place.cc) {
        fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + lat + "&longitude=" + lon + "&localityLanguage=ar")
          .then(function (r) { return r.json(); })
          .then(function (g) { place.cc = (g.countryCode || "").toUpperCase(); lsSet("kids-place", JSON.stringify(place)); computeTimes(); render(); syncPush(); })
          .catch(function () {});
      }
    }, function () {
      if (!times) $("nextTxt").textContent = "اطلب من بابا أو ماما السماح للتطبيق بمعرفة الموقع لنعرف أوقات الصلاة.";
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  }

  // ---------- drawing ----------
  var STAR = '<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z"/></svg>';
  var ICONS = {
    fajr: '<svg viewBox="0 0 40 40"><path d="M8 26a12 12 0 0 1 24 0z" fill="#ff8fa3"/><path d="M4 28h32" stroke="#ff6f8a" stroke-width="3" stroke-linecap="round"/><path d="M20 6v4M9 11l2.5 2.5M31 11l-2.5 2.5" stroke="#ff8fa3" stroke-width="3" stroke-linecap="round"/></svg>',
    dhuhr: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="8" fill="#ffc94d"/><g stroke="#f5b324" stroke-width="3" stroke-linecap="round"><path d="M20 4v4M20 32v4M4 20h4M32 20h4M8.7 8.7l2.8 2.8M28.5 28.5l2.8 2.8M8.7 31.3l2.8-2.8M28.5 11.5l2.8-2.8"/></g></svg>',
    asr: '<svg viewBox="0 0 40 40"><circle cx="24" cy="17" r="8" fill="#ff9f43"/><path d="M6 31h28" stroke="#e8862b" stroke-width="3" stroke-linecap="round"/><path d="M10 25h12" stroke="#e8862b" stroke-width="3" stroke-linecap="round" opacity=".55"/></svg>',
    maghrib: '<svg viewBox="0 0 40 40"><path d="M10 28a10 10 0 0 1 20 0z" fill="#f0645a"/><path d="M4 28h32M10 33h20" stroke="#d94c43" stroke-width="3" stroke-linecap="round"/></svg>',
    isha: '<svg viewBox="0 0 40 40"><path d="M26 30a12 12 0 1 1-6-22 9.5 9.5 0 0 0 6 22z" fill="#6c63ff"/><path d="M30 8l1.2 2.4 2.6.4-1.9 1.8.5 2.6L30 14l-2.4 1.2.5-2.6-1.9-1.8 2.6-.4z" fill="#ffc94d"/></svg>'
  };

  function renderHeader() {
    var n = doneToday().length;
    var st = $("stars"); st.innerHTML = "";
    for (var i = 0; i < 5; i++) { var w = el("span", i < n ? "on" : "off"); w.innerHTML = STAR; st.appendChild(w.firstChild); st.lastChild.setAttribute("class", i < n ? "on" : "off"); }
    $("countTxt").textContent = n === 5 ? "ما شاء الله! صليت كل صلواتك اليوم" : n === 0 ? "هل صليت اليوم؟" : "صليت " + n + " من 5 اليوم";
    var h = new Date().getHours();
    $("greet").textContent = h < 12 ? "صباح الخير يا بطل" : "مساء الخير يا بطل";
    try {
      $("dateTxt").textContent = new Intl.DateTimeFormat("ar-u-nu-latn", { weekday: "long" }).format(new Date()) + " · " +
        new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long" }).format(new Date());
    } catch (e) {}
  }

  function renderList() {
    var list = $("list"); list.textContent = "";
    if (!times) return;
    var fri = new Date().getDay() === 5;
    ORDER.forEach(function (k) {
      var s = stateOf(k), card = el("article", "pr " + s);
      card.style.setProperty("--c", COLORS[k]);
      var ic = el("div", "ic"); ic.innerHTML = ICONS[k];
      var info = el("div");
      var nm = el("div", "nm", k === "dhuhr" && fri ? "الجمعة" : NAMES[k]);
      if (s === "now") nm.appendChild(el("span", "tag", "حان وقتها"));
      if (s === "late") nm.appendChild(el("span", "tag", "تأخّرت"));
      info.appendChild(nm);
      info.appendChild(el("div", "tm", fmtTime(times[k])));
      var act = el("div", "act");
      if (s === "done") {
        var got = el("div", "got"); got.innerHTML = STAR; got.appendChild(el("span", null, "أحسنت!"));
        var undo = el("button", "undo", "تراجع"); undo.type = "button";
        undo.addEventListener("click", function () { unmark(k); });
        act.appendChild(got); act.appendChild(undo);
      } else if (s === "soon") {
        var w = el("div", "wait", "بعد"); w.appendChild(el("b", null, fmtLeft(times[k] - Date.now()))); w.dataset.k = k;
        act.appendChild(w);
      } else {
        var go = el("button", "go", s === "late" ? "صليتها ✓" : "صليت ✓"); go.type = "button";
        go.addEventListener("click", function () { mark(k); });
        act.appendChild(go);
      }
      card.appendChild(ic); card.appendChild(info); card.appendChild(act);
      list.appendChild(card);
    });
  }

  function renderWeek() {
    var days = $("days"); days.textContent = "";
    var today = new Date();
    for (var i = 6; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      var n = (log[dayKey(d)] || []).length;
      var cell = el("div", "day" + (i === 0 ? " is-today" : "") + (n === 5 ? " full" : ""));
      var c = el("div", "c"); c.style.setProperty("--p", n / 5 * 100);
      c.appendChild(el("i", null, n === 5 ? "★" : String(n)));
      cell.appendChild(c);
      var lbl = "";
      try { lbl = new Intl.DateTimeFormat("ar", { weekday: "short" }).format(d); } catch (e) {}
      cell.appendChild(el("span", null, i === 0 ? "اليوم" : lbl));
      days.appendChild(cell);
    }
  }

  function nextLine() {
    if (!times) return;
    var now = Date.now(), fri = new Date().getDay() === 5;
    for (var i = 0; i < ORDER.length; i++) {
      var k = ORDER[i];
      if (times[k].getTime() > now) {
        var nm = k === "dhuhr" && fri ? "الجمعة" : NAMES[k];
        $("nextTxt").innerHTML = "";
        $("nextTxt").append("الصلاة القادمة: ", el("b", null, nm), " بعد ", el("b", null, fmtLeft(times[k] - now)));
        return;
      }
    }
    $("nextTxt").innerHTML = "";
    $("nextTxt").append("الصلاة القادمة: ", el("b", null, "الفجر"), " غدًا الساعة ", el("b", null, fmtTime(times.tomorrowFajr)));
  }

  var lastStates = "";
  function render() {
    if (timesDay !== dayKey()) computeTimes();
    renderHeader(); renderWeek();
    if (times) { renderList(); lastStates = times ? ORDER.map(stateOf).join() : ""; nextLine(); }
  }
  function tick() {
    if (!times) return;
    if (timesDay !== dayKey()) { render(); return; }
    var st = ORDER.map(stateOf).join();
    if (st !== lastStates) { render(); return; }
    document.querySelectorAll(".wait[data-k]").forEach(function (w) { w.querySelector("b").textContent = fmtLeft(times[w.dataset.k] - Date.now()); });
    nextLine();
    checkReminders();
  }

  // ---------- marking prayers ----------
  var PRAISE = ["أحسنت! ربحت نجمة ⭐", "ما شاء الله عليك! 🌟", "بارك الله فيك يا بطل 💚", "رائع! الله يحب المصلين ⭐"];
  function mark(k) {
    var d = dayKey(), arr = log[d] || [];
    if (arr.indexOf(k) < 0) arr.push(k);
    log[d] = arr; saveLog();
    render(); sendMarks();
    if (arr.length === 5) { popup("🏆", "ما شاء الله!", "صليت الصلوات الخمس اليوم. أنت بطل حقيقي!"); confetti(); }
    else popup("⭐", PRAISE[Math.floor(Math.random() * PRAISE.length)], "سجّلنا صلاة " + NAMES[k] + ". بقي لك " + (5 - arr.length) + " اليوم.");
    chime(2);
  }
  function unmark(k) {
    var d = dayKey();
    log[d] = (log[d] || []).filter(function (x) { return x !== k; });
    saveLog(); render(); sendMarks();
  }

  // ---------- popups, sound, confetti ----------
  function popup(big, title, body) {
    $("popBig").textContent = big; $("popTitle").textContent = title; $("popBody").textContent = body;
    $("pop").hidden = false; $("popBtn").focus();
  }
  $("popBtn").addEventListener("click", function () { $("pop").hidden = true; });
  $("pop").addEventListener("click", function (e) { if (e.target === $("pop")) $("pop").hidden = true; });

  var actx = null;
  function unlock() { try { if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); } if (actx && actx.state === "suspended") actx.resume(); } catch (e) {} }
  document.addEventListener("pointerdown", unlock, { passive: true });
  function chime(n) {
    if (!actx) return;
    try {
      var t0 = actx.currentTime + 0.03;
      [523.25, 659.25, 783.99, 1046.5].slice(0, n + 2).forEach(function (f, i) {
        var o = actx.createOscillator(), g = actx.createGain(), st = t0 + i * 0.13;
        o.type = "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.25, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, st + 0.6);
        o.connect(g); g.connect(actx.destination); o.start(st); o.stop(st + 0.65);
      });
    } catch (e) {}
  }
  function confetti() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var c = $("confetti"), ctx = c.getContext("2d"), W = c.width = innerWidth, H = c.height = innerHeight, parts = [];
    var cols = ["#ffc94d", "#ff8fa3", "#6c63ff", "#1f9d6b", "#ff9f43"];
    for (var i = 0; i < 140; i++) parts.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.5, r: 4 + Math.random() * 5, vy: 2 + Math.random() * 3, vx: -1.5 + Math.random() * 3, a: Math.random() * 6, c: cols[i % cols.length] });
    c.hidden = false;
    var start = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      parts.forEach(function (p) { p.x += p.vx; p.y += p.vy; p.a += 0.1; ctx.fillStyle = p.c; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); });
      if (t - start < 3500) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, W, H); c.hidden = true; }
    })(start);
  }
  (function skyStars() {
    var c = $("skyStars"), r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = r.width * dpr; c.height = r.height * dpr;
    var ctx = c.getContext("2d");
    for (var i = 0; i < 60; i++) {
      ctx.fillStyle = "rgba(255,255,255," + (0.25 + Math.random() * 0.6) + ")";
      ctx.beginPath(); ctx.arc(Math.random() * c.width, Math.random() * c.height, (0.6 + Math.random() * 1.4) * dpr, 0, 7); ctx.fill();
    }
  })();

  // ---------- reminders while the app is open (same timing as the server) ----------
  var fired = {};
  try { fired = JSON.parse(lsGet("kids-fired") || "{}"); if (fired.day !== dayKey()) fired = { day: dayKey(), ids: [] }; } catch (e) { fired = { day: dayKey(), ids: [] }; }
  function checkReminders() {
    if (!times || document.visibilityState !== "visible") return;
    if (fired.day !== dayKey()) fired = { day: dayKey(), ids: [] };
    var now = Date.now();
    ORDER.forEach(function (k) {
      if (stateOf(k) !== "now") return;
      var t = times[k].getTime(), i = Math.floor((now - t) / 1800000), at = t + i * 1800000, id = k + i;
      if (now - at < 120000 && fired.ids.indexOf(id) < 0) {
        fired.ids.push(id); lsSet("kids-fired", JSON.stringify(fired));
        var nm = k === "dhuhr" && new Date().getDay() === 5 ? "الجمعة" : NAMES[k];
        popup("🕌", i === 0 ? "حان وقت صلاة " + nm : "هل صليت " + nm + "؟", i === 0 ? "قم توضأ وصلِّ، ثم اضغط «صليت» واربح نجمة ⭐" : "صلاتك نور ⭐ لا تؤخّرها");
        chime(3);
        try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
      }
    });
  }

  // ---------- notifications through the family server ----------
  function u8(b) { var s = atob(b.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b.length + 3) % 4)), o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
  var syncT = null;
  function syncPush() { clearTimeout(syncT); syncT = setTimeout(doSync, 1200); }
  function doSync() {
    if (!place || !("PushManager" in window) || !("Notification" in window) || Notification.permission !== "granted" || !navigator.serviceWorker) return;
    var reg;
    navigator.serviceWorker.ready.then(function (r) { reg = r; return fetch(PUSH + "/vapid").then(function (x) { return x.json(); }); })
      .then(function (v) {
        return reg.pushManager.getSubscription().then(function (sub) {
          if (sub && lsGet("kids-push-key") === v.key) return sub;
          return (sub ? sub.unsubscribe() : Promise.resolve()).then(function () {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(v.key) });
          }).then(function (ns) { lsSet("kids-push-key", v.key); return ns; });
        });
      })
      .then(function (sub) {
        var tz = "UTC"; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) {}
        lsSet("kids-push-ep", sub.endpoint);
        return fetch(PUSH + "/subscribe", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "kids", sub: sub.toJSON(), lat: place.lat, lon: place.lon, tz: tz, method: method(), hanafi: hanafi(), marks: { day: dayKey(), done: doneToday() } }) });
      }).catch(function () {});
  }
  function sendMarks() {
    var ep = lsGet("kids-push-ep");
    if (!ep) return;
    fetch(PUSH + "/mark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: ep, day: dayKey(), done: doneToday() }) })
      .catch(function () { syncPush(); });
  }
  function syncAsk() { $("ask").hidden = !("Notification" in window && Notification.permission === "default"); }
  $("askBtn").addEventListener("click", function () {
    unlock();
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(function (p) {
      syncAsk();
      if (p === "granted") { syncPush(); popup("🔔", "تم تفعيل التذكير", "سنذكّرك بكل صلاة حتى تصليها."); }
    });
  });
  $("testBtn").addEventListener("click", function () {
    unlock(); chime(3);
    var ep = lsGet("kids-push-ep");
    if (ep) {
      fetch(PUSH + "/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: ep }) }).catch(function () {});
      popup("🔔", "أُرسل تذكير تجريبي", "أغلق التطبيق الآن، وسيصلك إشعار خلال ثوانٍ.");
    } else popup("🔔", "التذكير غير مفعّل بعد", "اضغط «تفعيل» في الأعلى واسمح بالإشعارات.");
  });

  // ---------- start ----------
  // Coming back after 10+ minutes: reload so the latest version shows.
  var hiddenAt = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 600000 && $("pop").hidden && navigator.onLine !== false) { location.reload(); return; }
    render(); locate();
  });
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  computeTimes(); render(); syncAsk(); locate();
  setInterval(tick, 1000);
  setTimeout(syncPush, 3000);
  if ("serviceWorker" in navigator) {
    var had = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (had && !reloaded) { reloaded = true; location.reload(); } });
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js", { scope: "./" }).then(function (r) { r.update(); }).catch(function () {}); });
  }
})();
