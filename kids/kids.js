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
      if (linkedName() && (moved || lsGet("kids-loc-sent") !== dayKey())) { lsSet("kids-loc-sent", dayKey()); sendMarks(); }
      if (moved || !place.cc) {
        fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + lat + "&longitude=" + lon + "&localityLanguage=ar")
          .then(function (r) { return r.json(); })
          .then(function (g) { place.cc = (g.countryCode || "").toUpperCase(); lsSet("kids-place", JSON.stringify(place)); computeTimes(); render(); syncPush(); })
          .catch(function () {});
      }
    }, function () {
      if (!times) $("nextTxt").textContent = "اطلب من بابا أو ماما السماح للتطبيق بمعرفة الموقع لنعرف أوقات الصلاة.";
      showPushState();
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
    var h = new Date().getHours(), nm = linkedName() || "بطل";
    $("greet").textContent = (h < 12 ? "صباح الخير يا " : "مساء الخير يا ") + nm;
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

  // ---------- which child is this? (linked with a 6-digit code from the parent dashboard) ----------
  var device = lsGet("kids-device");
  if (!device) {
    var rb = crypto.getRandomValues(new Uint8Array(16)), bs = "";
    for (var ri = 0; ri < rb.length; ri++) bs += String.fromCharCode(rb[ri]);
    device = btoa(bs).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    lsSet("kids-device", device);
  }
  function linkedName() { return lsGet("kids-linked") || ""; }
  function post(path, body) {
    return fetch(PUSH + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; }); });
  }
  // The family server's record wins for past days; today's marks from both sides are combined.
  function mergeHist(hist) {
    var today = dayKey(), changed = false;
    Object.keys(hist || {}).forEach(function (d) {
      var server = hist[d] || [], local = log[d] || [];
      var merged = d === today ? local.concat(server.filter(function (k) { return local.indexOf(k) < 0; })) : server.slice();
      if (merged.join() !== local.join()) { log[d] = merged; changed = true; }
    });
    if (changed) { saveLog(); render(); }
    var srv = (hist || {})[today] || [];
    if (doneToday().some(function (k) { return srv.indexOf(k) < 0; })) sendMarks();
  }
  function openLink() {
    var nm = linkedName();
    $("linkMsg").textContent = "";
    $("codeInput").value = "";
    if (nm) {
      $("linkBig").textContent = "👋";
      $("linkTitle").textContent = "أنت " + nm;
      $("linkText").textContent = "صلواتك تظهر عند بابا باسم «" + nm + "». إن لم يكن هذا اسمك، اكتب رمزك الصحيح.";
      $("linkBtn").textContent = "تغيير";
      $("linkLater").textContent = "حسنًا";
    } else {
      $("linkBig").textContent = "🔗";
      $("linkTitle").textContent = "اطلب من بابا رمز الربط";
      $("linkText").textContent = "اكتب الرمز المكوّن من 6 أرقام لنعرف من أنت، وتظهر صلواتك عند بابا.";
      $("linkBtn").textContent = "ربط";
      $("linkLater").textContent = "ليس الآن";
    }
    $("linkPop").hidden = false;
    setTimeout(function () { $("codeInput").focus(); }, 50);
  }
  $("greet").addEventListener("click", openLink);
  $("linkLater").addEventListener("click", function () { $("linkPop").hidden = true; lsSet("kids-link-later", dayKey()); });
  $("codeInput").addEventListener("input", function () { $("codeInput").value = $("codeInput").value.replace(/\D/g, "").slice(0, 6); });
  $("linkForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("codeInput").value;
    if (code.length !== 6) { $("linkMsg").textContent = "الرمز 6 أرقام"; return; }
    $("linkBtn").disabled = true;
    post("/kid/link", { device: device, code: code, marks: { day: dayKey(), done: doneToday() } }).then(function (j) {
      $("linkBtn").disabled = false;
      if (j.name) {
        lsSet("kids-linked", j.name);
        $("linkPop").hidden = true;
        mergeHist(j.hist);
        renderHeader();
        sendMarks();
        syncPush();
        popup("🎉", "أهلًا يا " + j.name, "تم الربط! صلواتك ستظهر عند بابا من الآن.");
        chime(2);
        return;
      }
      $("linkMsg").textContent = j._status === 429 ? "محاولات كثيرة، جرّب بعد " + (j.wait || 15) + " دقيقة" : "الرمز غير صحيح، تأكد منه مع بابا";
    }).catch(function () { $("linkBtn").disabled = false; $("linkMsg").textContent = "لا يوجد إنترنت، حاول لاحقًا"; });
  });
  // On every open: get this child's name and history (or learn that the link was removed).
  // Opened from the link a parent sent (…/kids/?code=123456): fill in the code and link right away.
  var urlCode = (function () { var m = /[?&]code=(\d{6})/.exec(location.search); return m ? m[1] : ""; })();
  if (urlCode) { lsSet("kids-pending-code", urlCode); try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {} }
  function autoLink() {
    var code = lsGet("kids-pending-code");
    if (!code) return false;
    lsSet("kids-pending-code", "");
    openLink();
    $("codeInput").value = code;
    $("linkForm").requestSubmit ? $("linkForm").requestSubmit() : $("linkBtn").click();
    return true;
  }
  function pullInfo() {
    post("/kid/info", { device: device }).then(function (j) {
      if (j._status !== 200) return;
      if (lsGet("kids-pending-code") && !(j.linked && j.name)) { if (autoLink()) return; }
      if (j.linked) lsSet("kids-pending-code", "");
      if (j.linked) {
        if (j.name !== linkedName()) { lsSet("kids-linked", j.name); renderHeader(); }
        mergeHist(j.hist);
      } else if (linkedName()) {
        lsSet("kids-linked", ""); renderHeader(); openLink();
      } else if (lsGet("kids-link-later") !== dayKey()) {
        openLink();
      }
    }).catch(function () {});
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
  // What stops reminders from reaching this phone, if anything, shown to the child with the fix.
  var pushResult = "";
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  function pushState() {
    if (isIOS && !standalone) return { cls: "warn", text: "لتصلك التذكيرات: افتح هذه الصفحة في Safari، ثم زر المشاركة ⬆️، ثم «إضافة إلى الشاشة الرئيسية»، وافتح «صلاتي» من الأيقونة." };
    if (!("Notification" in window) || !("PushManager" in window) || !navigator.serviceWorker) return { cls: "warn", text: "هذا المتصفح لا يدعم التذكيرات. افتح التطبيق في Safari على الآيفون أو Chrome على الأندرويد." };
    if (Notification.permission === "default") return null; // the "تفعيل" card handles this
    if (Notification.permission === "denied") return { cls: "warn", text: "التذكيرات مرفوضة. افتح إعدادات الجوال ← الإشعارات ← «صلاتي» ← السماح بالإشعارات، ثم افتح التطبيق من جديد." };
    if (!place) return { cls: "warn", text: "اسمح لـ«صلاتي» بمعرفة الموقع لنعرف أوقات الصلاة ونرسل التذكير في وقته (الإعدادات ← الخصوصية ← خدمات الموقع)." };
    if (pushResult === "fail") return { cls: "warn", text: "تعذّر تفعيل التذكير. تأكد من الإنترنت ثم أغلق التطبيق وافتحه." };
    if (pushResult === "ok") return { cls: "ok", text: "✓ التذكير مفعّل على هذا الجوال" };
    return { cls: "", text: "جارٍ تفعيل التذكير…" };
  }
  function showPushState() {
    var st = pushState(), box = $("pushState");
    if (!st) { box.hidden = true; return; }
    box.hidden = false; box.className = "push-state " + st.cls; box.textContent = st.text;
  }
  function doSync() {
    showPushState();
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
          body: JSON.stringify({ mode: "kids", device: device, name: linkedName(), sub: sub.toJSON(), lat: place.lat, lon: place.lon, tz: tz, method: method(), hanafi: hanafi(), marks: { day: dayKey(), done: doneToday() } }) });
      }).then(function (r) { pushResult = r && r.ok ? "ok" : "fail"; showPushState(); })
      .catch(function () { pushResult = "fail"; showPushState(); });
  }
  function sendMarks() {
    var tz = "UTC"; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) {}
    var body = { device: device, endpoint: lsGet("kids-push-ep") || "", day: dayKey(), done: doneToday() };
    if (place) { body.lat = place.lat; body.lon = place.lon; body.tz = tz; body.method = method(); body.hanafi = hanafi(); }
    fetch(PUSH + "/mark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(function () {});
  }
  function syncAsk() {
    $("ask").hidden = !("Notification" in window && Notification.permission === "default" && !(isIOS && !standalone));
    showPushState();
  }
  $("askBtn").addEventListener("click", function () {
    unlock();
    if (!("Notification" in window)) return;
    Notification.requestPermission().then(function (p) {
      syncAsk();
      if (p === "granted") { syncPush(); popup("🔔", "تم تفعيل التذكير", "سنذكّرك بكل صلاة حتى تصليها، وتصلك رسائل بابا هنا."); }
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

  // ---------- أذكاري: short adhkar for kids, all from the Quran and sahih hadith ----------
  var KAZ = [
    { id: "k1", when: "كل يوم", t: "سبحان الله وبحمده، سبحان الله العظيم", n: 10, s: "صحيح البخاري 6406", f: "كلمتان خفيفتان على اللسان، ثقيلتان في الميزان، حبيبتان إلى الرحمن" },
    { id: "k2", when: "كل يوم", t: "لا حول ولا قوة إلا بالله", n: 10, s: "صحيح البخاري 4205، مسلم 2704", f: "كنز من كنوز الجنة" },
    { id: "k3", when: "كل يوم", t: "أستغفر الله", n: 10, s: "صحيح البخاري 6307", f: "كان النبي ﷺ يستغفر الله في اليوم أكثر من سبعين مرة" },
    { id: "k4", when: "كل يوم", t: "اللهم صلِّ على محمد", n: 10, s: "صحيح مسلم 408", f: "من صلّى على النبي ﷺ مرة صلّى الله عليه بها عشرًا" },
    { id: "k5", when: "الصباح والمساء", t: "قل هو الله أحد ۝ الله الصمد ۝ لم يلد ولم يولد ۝ ولم يكن له كفوًا أحد", n: 3, s: "سورة الإخلاص — صحيح البخاري 5013", f: "تعدل ثلث القرآن" },
    { id: "k6", when: "قبل الأكل", t: "بسم الله", n: 1, s: "صحيح البخاري 5376", f: "قال النبي ﷺ: «يا غلام، سمِّ الله، وكُل بيمينك، وكُل مما يليك»" },
    { id: "k7", when: "بعد الأكل", t: "الحمد لله الذي أطعمني هذا ورزقنيه من غير حول مني ولا قوة", n: 1, s: "أبو داود 4023، الترمذي 3458 — حسن", f: "غُفر له ما تقدّم من ذنبه" },
    { id: "k8", when: "عند الخروج من البيت", t: "بسم الله، توكلت على الله، ولا حول ولا قوة إلا بالله", n: 1, s: "أبو داود 5095، الترمذي 3426 — صحيح", f: "يُقال له: هُديت وكُفيت ووُقيت" },
    { id: "k9", when: "قبل دخول الحمّام", t: "اللهم إني أعوذ بك من الخبث والخبائث", n: 1, s: "صحيح البخاري 142، مسلم 375" },
    { id: "k10", when: "بعد الخروج من الحمّام", t: "غفرانك", n: 1, s: "أبو داود 30، الترمذي 7 — صحيح" },
    { id: "k11", when: "بعد الوضوء", t: "أشهد أن لا إله إلا الله وحده لا شريك له، وأشهد أن محمدًا عبده ورسوله", n: 1, s: "صحيح مسلم 234", f: "فُتحت له أبواب الجنة الثمانية يدخل من أيها شاء" },
    { id: "k12", when: "عند العطاس", t: "الحمد لله", n: 1, s: "صحيح البخاري 6224", f: "ويقول له أخوه: يرحمك الله، فيرد: يهديكم الله ويصلح بالكم" },
    { id: "k13", when: "قبل المذاكرة", t: "ربِّ زدني علمًا", n: 1, s: "سورة طه 114" },
    { id: "k14", when: "عند ركوب السيارة", t: "سبحان الذي سخّر لنا هذا وما كنا له مقرنين، وإنا إلى ربنا لمنقلبون", n: 1, s: "سورة الزخرف 13–14 — صحيح مسلم 1342" },
    { id: "k15", when: "قبل النوم", t: "باسمك اللهم أموت وأحيا", n: 1, s: "صحيح البخاري 6324" },
    { id: "k16", when: "عند الاستيقاظ", t: "الحمد لله الذي أحيانا بعد ما أماتنا وإليه النشور", n: 1, s: "صحيح البخاري 6312" }
  ];
  var az = { day: dayKey(), left: {} };
  try { var azs = JSON.parse(lsGet("kids-az") || "null"); if (azs && azs.day === az.day) az = azs; } catch (e) {}
  function azLeft(it) { if (az.day !== dayKey()) az = { day: dayKey(), left: {} }; return az.left[it.id] == null ? it.n : az.left[it.id]; }
  function azSave() { lsSet("kids-az", JSON.stringify(az)); }
  function azState(card, it) {
    var l = azLeft(it);
    card.classList.toggle("done", l === 0);
    card.querySelector(".c").style.setProperty("--p", ((it.n - l) / it.n * 100).toFixed(1));
    card.querySelector(".c i").textContent = l === 0 ? "★" : (it.n === 1 ? "✓" : l);
    card.setAttribute("aria-label", it.t + (l === 0 ? "، قلته" : "، الباقي " + l));
  }
  function azHeader() {
    var done = KAZ.filter(function (it) { return azLeft(it) === 0; }).length;
    $("azCount").textContent = done === KAZ.length ? "ما شاء الله! قلت كل الأذكار اليوم" : "قلت " + done + " من " + KAZ.length + " اليوم";
  }
  function renderAz() {
    var box = $("azList"); box.textContent = "";
    KAZ.forEach(function (it) {
      var card = el("article", "az"); card.tabIndex = 0; card.setAttribute("role", "button");
      card.appendChild(el("span", "when", it.when));
      card.appendChild(el("div", "t", it.t));
      var c = el("div", "c"); c.appendChild(el("i")); card.appendChild(c);
      var meta = el("div", "meta");
      if (it.f) { meta.appendChild(el("b", null, it.f)); meta.appendChild(document.createElement("br")); }
      meta.appendChild(document.createTextNode(it.s));
      card.appendChild(meta);
      azState(card, it);
      function tap() {
        unlock();
        var l = azLeft(it);
        if (l === 0) return;
        az.left[it.id] = l - 1; azSave(); azState(card, it); azHeader();
        if (l - 1 === 0) {
          chime(1);
          if (KAZ.every(function (x) { return azLeft(x) === 0; })) { popup("🏆", "ما شاء الله!", "قلت كل أذكارك اليوم. ذكرت الله فذكرك."); confetti(); }
        } else { try { if (navigator.vibrate) navigator.vibrate(20); } catch (e) {} }
      }
      card.addEventListener("click", tap);
      card.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tap(); } });
      box.appendChild(card);
    });
    azHeader();
  }
  $("azReset").addEventListener("click", function () { az = { day: dayKey(), left: {} }; azSave(); renderAz(); });

  // ---------- tabs ----------
  function showTab(name) {
    var isAz = name === "adhkar";
    $("prayView").hidden = isAz; $("azView").hidden = !isAz;
    $("tabPray").setAttribute("aria-selected", isAz ? "false" : "true");
    $("tabAz").setAttribute("aria-selected", isAz ? "true" : "false");
    if (isAz) renderAz();
  }
  $("tabPray").addEventListener("click", function () { if (location.hash) history.replaceState(null, "", location.pathname); showTab("pray"); });
  $("tabAz").addEventListener("click", function () { location.hash = "adhkar"; });
  window.addEventListener("hashchange", function () { showTab(location.hash === "#adhkar" ? "adhkar" : "pray"); });

  // ---------- settings: font size and theme ----------
  var SIZES = [{ v: 0.9, n: "صغير" }, { v: 1, n: "عادي" }, { v: 1.15, n: "كبير" }, { v: 1.3, n: "كبير جدًا" }, { v: 1.5, n: "ضخم" }];
  var THEMES = [
    { id: "space", n: "فضاء", icon: "🚀", a: "#2b3478", b: "#5a4caa" },
    { id: "ocean", n: "بحر", icon: "🐬", a: "#0b4f7c", b: "#1aa3b8" },
    { id: "garden", n: "حديقة", icon: "🌳", a: "#1f6b45", b: "#4caf50" },
    { id: "rose", n: "وردي", icon: "🌸", a: "#b0306b", b: "#f06292" },
    { id: "butterfly", n: "فراشة", icon: "🦋", a: "#6a2c91", b: "#c06ad8" },
    { id: "sunset", n: "غروب", icon: "🌅", a: "#c2410c", b: "#f59e0b" }
  ];
  function curSize() { var v = parseFloat(lsGet("kids-fs")); return v > 0.8 && v < 1.8 ? v : 1; }
  function curTheme() { return lsGet("kids-theme") || "space"; }
  function applySettings() {
    var root = document.documentElement, t = curTheme();
    root.style.fontSize = (16 * curSize()) + "px";
    if (t === "space") root.removeAttribute("data-kt"); else root.setAttribute("data-kt", t);
    var th = THEMES.filter(function (x) { return x.id === t; })[0];
    var meta = document.querySelector('meta[name="theme-color"]'); if (meta && th) meta.setAttribute("content", th.a);
    [].forEach.call($("sizes").children, function (b) { b.setAttribute("aria-checked", parseFloat(b.dataset.v) === curSize() ? "true" : "false"); });
    [].forEach.call($("themes").children, function (b) { b.setAttribute("aria-checked", b.dataset.t === t ? "true" : "false"); });
  }
  SIZES.forEach(function (z) {
    var b = el("button", "size", "أ"); b.type = "button"; b.dataset.v = z.v; b.setAttribute("role", "radio"); b.setAttribute("aria-label", z.n);
    b.style.fontSize = (15 + (z.v - 0.9) * 32) + "px";
    b.addEventListener("click", function () { lsSet("kids-fs", String(z.v)); applySettings(); });
    $("sizes").appendChild(b);
  });
  THEMES.forEach(function (th) {
    var b = el("button", "theme"); b.type = "button"; b.dataset.t = th.id; b.setAttribute("role", "radio");
    var sw = el("div", "sw", th.icon); sw.style.background = "linear-gradient(135deg," + th.a + "," + th.b + ")";
    b.appendChild(sw); b.appendChild(el("span", null, th.n));
    b.addEventListener("click", function () { lsSet("kids-theme", th.id); applySettings(); chime(1); });
    $("themes").appendChild(b);
  });
  // The account part (link code, change account) is for parents: it shows after 7 taps on the title.
  var acctTaps = 0, acctTimer = null;
  $("setTitle").addEventListener("click", function () {
    acctTaps++;
    clearTimeout(acctTimer); acctTimer = setTimeout(function () { if (acctTaps < 7) acctTaps = 0; }, 3000);
    if (acctTaps === 7) $("acctBox").hidden = false;
  });
  function openSettings() {
    acctTaps = 0; $("acctBox").hidden = true;
    var nm = linkedName();
    $("setLinked").textContent = nm ? "هذا الجوال مربوط باسم «" + nm + "»، وصلواتك تظهر لأهلك." : "هذا الجوال غير مربوط بعد. اطلب رمز الربط من بابا أو ماما.";
    $("setLink").textContent = nm ? "تغيير الحساب" : "إدخال رمز الربط";
    $("setSheet").hidden = false; $("setBack").hidden = false;
    $("setClose").focus();
  }
  function closeSettings() { $("setSheet").hidden = true; $("setBack").hidden = true; }
  $("setBtn").addEventListener("click", openSettings);
  $("setClose").addEventListener("click", closeSettings);
  $("setBack").addEventListener("click", closeSettings);
  $("setLink").addEventListener("click", function () { closeSettings(); openLink(); });
  applySettings();
  showTab(location.hash === "#adhkar" ? "adhkar" : "pray");

  // ---------- start ----------
  // Coming back after 10+ minutes: reload so the latest version shows.

  // ---------- updates: apply a new version as soon as the app is opened or brought back ----------
  // Compares the published files' fingerprints (ETag) with the ones this copy started with.
  var buildSig = null, updating = false;
  function fileSig(files) {
    return Promise.all(files.map(function (f) {
      return fetch(f + "?t=" + Date.now(), { method: "HEAD", cache: "no-store" })
        .then(function (r) { return r.ok ? (r.headers.get("etag") || r.headers.get("last-modified") || "") : ""; });
    })).then(function (a) { return a.join("|"); });
  }
  function checkForUpdate(files, canReload) {
    if (updating || navigator.onLine === false) return;
    fileSig(files).then(function (sig) {
      if (!sig.replace(/\|/g, "")) return;
      if (buildSig === null) { buildSig = sig; return; }
      if (sig !== buildSig && canReload()) { updating = true; location.reload(); }
    }).catch(function () {});
  }
  var KIDS_FILES = ["index.html", "kids.js", "../prayer.js"];
  function canReloadKids() { return $("pop").hidden && $("linkPop").hidden && $("setSheet").hidden; }
  setTimeout(function () { checkForUpdate(KIDS_FILES, canReloadKids); }, 1500);
  setInterval(function () { if (document.visibilityState === "visible") checkForUpdate(KIDS_FILES, canReloadKids); }, 5 * 60000);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    checkForUpdate(KIDS_FILES, canReloadKids);
    render(); locate(); pullInfo();
  });
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  computeTimes(); render(); syncAsk(); locate();
  setTimeout(pullInfo, 500);
  setInterval(tick, 1000);
  setTimeout(syncPush, 3000);
  if ("serviceWorker" in navigator) {
    var had = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () { if (had && !reloaded) { reloaded = true; location.reload(); } });
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js", { scope: "./" }).then(function (r) { r.update(); }).catch(function () {}); });
  }
})();
