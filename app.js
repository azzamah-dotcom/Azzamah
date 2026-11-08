(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var chipsEl = $("chips"), listEl = $("list");

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  // ---------- data: cached copy first, then the shared list from the server ----------
  var saved = null;         // last known shared list
  var data = null;          // working copy (differs from saved only while editing)
  var editing = false, removed = {};
  try { saved = JSON.parse(lsGet("azkar-data") || "null"); } catch (e) {}

  function setSaved(d) {
    saved = d;
    lsSet("azkar-data", JSON.stringify(d));
    if (!editing) data = clone(d);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function fetchShared(manual) {
    return fetch("azkar.json?t=" + Date.now(), { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) {
        if (!saved || (d.version || 0) >= (saved.version || 0)) {
          var changed = !saved || JSON.stringify(d) !== JSON.stringify(saved);
          setSaved(d);
          if (changed && !editing) render();
          if (manual) toast(changed ? "تم تحديث القائمة" : "القائمة محدّثة");
        } else if (manual) toast("القائمة محدّثة");
      })
      .catch(function () {
        if (!saved) $("catTitle").textContent = "تعذّر تحميل الأذكار. تأكد من الاتصال بالإنترنت ثم أعد فتح التطبيق.";
        else if (manual) toast("لا يوجد اتصال، تُعرض آخر نسخة محفوظة");
      });
  }

  // ---------- per-viewer counters, reset daily ----------
  function todayStr() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  var prog = { date: todayStr(), left: {} };
  try {
    var p = JSON.parse(lsGet("azkar-progress") || "null");
    if (p && p.date === prog.date) prog = p;
  } catch (e) {}
  function saveProg() { lsSet("azkar-progress", JSON.stringify(prog)); }
  function checkDay() { if (prog.date !== todayStr()) { prog = { date: todayStr(), left: {} }; saveProg(); render(); } }
  function left(it) { return prog.left[it.id] == null ? it.n : prog.left[it.id]; }

  function currentCat() {
    var h = decodeURIComponent(location.hash.slice(1));
    return data.cats.some(function (c) { return c.id === h; }) ? h : data.cats[0].id;
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderChips(cat) {
    chipsEl.textContent = "";
    data.cats.forEach(function (c) {
      var a = el("a", "chip", c.name);
      a.href = "#" + c.id;
      a.setAttribute("aria-current", c.id === cat ? "true" : "false");
      chipsEl.appendChild(a);
    });
    var q = el("a", "chip", "القبلة");
    q.href = "#qibla";
    q.setAttribute("aria-current", cat === "qibla" ? "true" : "false");
    chipsEl.appendChild(q);
    var cur = chipsEl.querySelector('[aria-current="true"]');
    if (cur) cur.scrollIntoView({ block: "nearest", inline: "center" });
    var dl = $("catList"); dl.textContent = "";
    data.cats.forEach(function (c) { var o = el("option"); o.value = c.name; dl.appendChild(o); });
  }

  function updateProgress(items) {
    var total = 0, doneN = 0;
    items.forEach(function (it) { if (removed[it.id]) return; total++; if (left(it) === 0) doneN++; });
    $("barFill").style.width = total ? (doneN / total * 100) + "%" : "0";
    $("progTxt").textContent = doneN + " / " + total;
  }

  function cardState(card, it) {
    var l = left(it);
    card.classList.toggle("done", l === 0);
    card.querySelector(".ring").style.setProperty("--p", ((it.n - l) / it.n * 100).toFixed(1));
    card.querySelector(".ring span").textContent = l === 0 ? "✓" : (it.k === "task" ? "" : l);
    card.setAttribute("aria-label", "الباقي " + l + " من " + it.n);
  }

  function render() {
    if (!data) return;
    renderBannerData();
    $("fridayNote").hidden = !(new Date().getDay() === 5 && data.cats.some(function (c) { return c.id === "friday"; }) && location.hash !== "#friday");
    var isQ = location.hash === "#qibla";
    $("adhkarView").hidden = isQ; $("qiblaView").hidden = !isQ;
    if (isQ) {
      renderChips("qibla");
      $("addForm").hidden = true; $("editBar").hidden = !editing;
      return;
    }
    var cat = currentCat();
    var catObj = data.cats.filter(function (c) { return c.id === cat; })[0];
    renderChips(cat);
    $("catTitle").textContent = catObj.name;
    var items = data.items.filter(function (it) { return it.c === cat; });
    listEl.textContent = "";
    if (!items.length) {
      listEl.appendChild(el("div", "empty", editing ? "لا يوجد شيء في هذا القسم بعد. أضف أول ذكر من النموذج أدناه." : "لا يوجد شيء في هذا القسم بعد."));
    }
    items.forEach(function (it) {
      var card = el("article", "card");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.appendChild(el("p", "txt", it.t));
      if (it.f) card.appendChild(el("p", "note", it.f));
      var foot = el("footer");
      var src = el("div", "src");
      src.appendChild(el("b", null, it.g || ""));
      src.appendChild(document.createTextNode(it.s ? " · " + it.s : ""));
      var cnt = el("div", "count");
      cnt.appendChild(el("span", it.k === "task" ? "lbl task" : "lbl", it.k === "task" ? (left(it) === 0 ? "تمّت" : "سُنّة") : (it.n > 1 ? "× " + it.n : "مرة")));
      var ring = el("div", "ring"); ring.appendChild(el("span")); cnt.appendChild(ring);
      foot.appendChild(src); foot.appendChild(cnt);
      card.appendChild(foot);
      if (editing) {
        var del = el("button", "del", removed[it.id] ? "تراجع" : "حذف");
        del.type = "button";
        del.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (removed[it.id]) delete removed[it.id]; else removed[it.id] = true;
          render();
        });
        card.appendChild(del);
        card.classList.toggle("removed", !!removed[it.id]);
      }
      cardState(card, it);
      function tap() {
        if (editing) return;
        checkDay();
        var l = left(it);
        if (l === 0) return;
        prog.left[it.id] = l - 1; saveProg();
        cardState(card, it); updateProgress(items);
        if (it.k === "task") { var lb = card.querySelector(".lbl"); if (lb) lb.textContent = "تمّت"; }
        try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
        if (l - 1 === 0) {
          var next = card.nextElementSibling;
          while (next && next.classList.contains("done")) next = next.nextElementSibling;
          if (next && next.classList.contains("card")) {
            var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            setTimeout(function () { next.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" }); }, 250);
          }
        }
      }
      card.addEventListener("click", tap);
      card.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); tap(); } });
      listEl.appendChild(card);
    });
    updateProgress(items);
    $("addForm").hidden = !editing;
    $("editBar").hidden = !editing;
    if (editing && !$("fCat").value) $("fCat").value = catObj.name;
    updatePending();
  }

  function pendingCount() {
    var savedIds = {};
    saved.items.forEach(function (it) { savedIds[it.id] = 1; });
    var added = data.items.filter(function (it) { return !savedIds[it.id] && !removed[it.id]; }).length;
    var del = Object.keys(removed).filter(function (id) { return savedIds[id]; }).length;
    return added + del;
  }
  function updatePending() {
    if (!editing) return;
    var n = pendingCount();
    $("pendTxt").textContent = n ? ("تغييرات غير محفوظة: " + n) : "اضغط «حذف» على أي ذكر أو أضف ذكرًا جديدًا";
    $("saveBtn").disabled = !n;
  }

  var toastTimer;
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------- admin: GitHub-backed editing ----------
  function defaultRepo() {
    var m = location.hostname.match(/^([^.]+)\.github\.io$/);
    var seg = location.pathname.split("/").filter(Boolean)[0];
    return m ? m[1] + "/" + (seg && !/\.html?$/.test(seg) ? seg : m[1] + ".github.io") : "";
  }
  function admin() {
    var token = lsGet("azkar-gh-token"), repo = lsGet("azkar-gh-repo") || defaultRepo();
    return token && repo ? { token: token, repo: repo } : null;
  }
  function syncAdminUi() { $("editBtn").hidden = !admin(); }

  function gh(path, opts) {
    var a = admin();
    opts = opts || {};
    opts.headers = { "Authorization": "Bearer " + a.token, "Accept": "application/vnd.github+json" };
    return fetch("https://api.github.com/repos/" + a.repo + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.message || r.status); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function b64(str) {
    var bytes = new TextEncoder().encode(str), bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function ghError(e) {
    if (e.status === 401) return "المفتاح غير صالح أو منتهي.";
    if (e.status === 403) return "المفتاح لا يملك صلاحية الكتابة على هذا المستودع.";
    if (e.status === 404) return "لم يُعثر على المستودع أو الملف. تأكد من اسم المستودع.";
    if (e.status === 409) return "تغيّرت القائمة من مكان آخر. اضغط «تحديث القائمة الآن» ثم أعد التعديل.";
    return "تعذّر الاتصال بـ GitHub. تأكد من الإنترنت وحاول مرة أخرى.";
  }

  $("settingsBtn").addEventListener("click", function () {
    var s = $("settings"); s.hidden = !s.hidden;
    if (!s.hidden) {
      $("sRepo").value = lsGet("azkar-gh-repo") || defaultRepo();
      $("sToken").value = lsGet("azkar-gh-token") ? "••••••••" : "";
      $("sMsg").textContent = ""; $("sMsg").className = "msg";
    }
  });
  $("sSave").addEventListener("click", function () {
    var repo = $("sRepo").value.trim(), token = $("sToken").value.trim();
    var msg = $("sMsg");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { msg.className = "msg err"; msg.textContent = "اكتب اسم المستودع بالشكل owner/repo."; return; }
    lsSet("azkar-gh-repo", repo);
    if (token && token !== "••••••••") lsSet("azkar-gh-token", token);
    if (!lsGet("azkar-gh-token")) { msg.className = "msg err"; msg.textContent = "أدخل المفتاح."; return; }
    msg.className = "msg"; msg.textContent = "جارٍ التحقق…";
    gh("").then(function (j) {
      if (j.permissions && !j.permissions.push) throw Object.assign(new Error("no push"), { status: 403 });
      msg.textContent = "تم. يظهر الآن زر «تعديل» في الأعلى."; syncAdminUi();
    }).catch(function (e) { msg.className = "msg err"; msg.textContent = ghError(e); syncAdminUi(); });
  });
  $("sClear").addEventListener("click", function () {
    lsDel("azkar-gh-token"); $("sToken").value = ""; editing = false; syncAdminUi(); render();
    $("sMsg").className = "msg"; $("sMsg").textContent = "أُزيل المفتاح من هذا الجهاز.";
  });
  $("sRefresh").addEventListener("click", function () { fetchShared(true); });

  $("resetBtn").addEventListener("click", function () {
    var cat = currentCat();
    data.items.forEach(function (it) { if (it.c === cat) delete prog.left[it.id]; });
    saveProg(); render();
  });

  $("addForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var t = $("fText").value.trim(), n = parseInt($("fCount").value, 10), cname = $("fCat").value.trim();
    if (!t) { $("addMsg").textContent = "اكتب نص الذكر أولًا."; return; }
    if (!(n >= 1)) { $("addMsg").textContent = "عدد المرات يجب أن يكون 1 أو أكثر."; return; }
    if (!cname) { $("addMsg").textContent = "اختر قسمًا أو اكتب اسم قسم جديد."; return; }
    var cat = data.cats.filter(function (c) { return c.name === cname; })[0];
    if (!cat) { cat = { id: "c" + Date.now().toString(36), name: cname }; data.cats.push(cat); }
    var item = { id: "u" + Date.now().toString(36), c: cat.id, t: t, n: n, s: $("fSrc").value.trim(), g: $("fGrade").value };
    var f = $("fNote").value.trim(); if (f) item.f = f;
    data.items.push(item);
    $("fText").value = ""; $("fSrc").value = ""; $("fNote").value = ""; $("fCount").value = 1; $("addMsg").textContent = "";
    if (currentCat() !== cat.id) location.hash = cat.id; else render();
    toast("أُضيف. اضغط «حفظ للجميع» لنشره");
  });

  $("editBtn").addEventListener("click", function () {
    editing = !editing;
    if (editing) { data = clone(saved); removed = {}; }
    $("editBtn").textContent = editing ? "إنهاء التعديل" : "تعديل";
    if (!editing) { data = clone(saved); removed = {}; }
    render();
  });
  $("cancelBtn").addEventListener("click", function () {
    data = clone(saved); removed = {}; editing = false;
    $("editBtn").textContent = "تعديل"; render();
  });

  $("saveBtn").addEventListener("click", function () {
    var next = { version: (saved.version || 0) + 1, cats: [], items: data.items.filter(function (it) { return !removed[it.id]; }) };
    data.cats.forEach(function (c) {
      if (saved.cats.some(function (s) { return s.id === c.id; }) || next.items.some(function (it) { return it.c === c.id; })) next.cats.push(c);
    });
    var body = JSON.stringify(next, null, 1) + "\n";
    $("saveBtn").disabled = true; $("pendTxt").textContent = "جارٍ الحفظ…";
    gh("/contents/azkar.json").then(function (file) {
      return gh("/contents/azkar.json", {
        method: "PUT",
        body: JSON.stringify({ message: "تحديث الأذكار (نسخة " + next.version + ")", content: b64(body), sha: file.sha })
      });
    }).then(function () {
      editing = false; removed = {};
      setSaved(next);
      $("editBtn").textContent = "تعديل";
      render();
      toast("تم الحفظ. يصل التحديث للعائلة خلال دقيقة أو دقيقتين");
    }).catch(function (e) {
      $("pendTxt").textContent = ghError(e);
      $("saveBtn").disabled = false;
    });
  });

  // ---------- Quran banner: a new ayah on every open and every 5 minutes ----------
  var AYAH_MS = 5 * 60 * 1000, ayahIdx = -1, ayahStart = 0, ayahList = null;
  function renderBannerData() {
    var list = data && data.ayat;
    if (!list || !list.length) { $("hero").hidden = true; return; }
    if (ayahList === list.length) return;
    ayahList = list.length;
    $("hero").hidden = false;
    nextAyah(false);
  }
  function nextAyah(animate) {
    var list = data.ayat, last = parseInt(lsGet("azkar-last-ayah") || "-1", 10), i;
    do { i = Math.floor(Math.random() * list.length); } while (list.length > 1 && (i === ayahIdx || i === last));
    ayahIdx = i; lsSet("azkar-last-ayah", String(i)); ayahStart = Date.now();
    var a = list[i], hero = $("hero");
    function show() {
      $("ayahText").textContent = a.t;
      $("ayahRef").textContent = "سورة " + a.r + " · الآية " + a.a;
      $("ayahLink").href = "https://quran.com/" + a.s + "/" + a.a;
      hero.classList.remove("fade");
    }
    if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) { hero.classList.add("fade"); setTimeout(show, 400); }
    else show();
  }
  $("ayahNext").addEventListener("click", function () { nextAyah(true); });
  setInterval(function () {
    if ($("hero").hidden || ayahIdx < 0) return;
    var t = Date.now() - ayahStart;
    if (t >= AYAH_MS) { nextAyah(true); t = 0; }
    $("ayahTimer").style.width = (t / AYAH_MS * 100).toFixed(2) + "%";
  }, 1000);

  // ---------- Qibla ----------
  var KAABA = { lat: 21.422487, lon: 39.826206 };
  var qibla = null, heading = null, wasAligned = false, compassOn = false;
  function rad(d) { return d * Math.PI / 180; }
  function deg(r) { return r * 180 / Math.PI; }
  function computeQibla(lat, lon) {
    var p1 = rad(lat), p2 = rad(KAABA.lat), dl = rad(KAABA.lon - lon);
    var b = deg(Math.atan2(Math.sin(dl), Math.cos(p1) * Math.tan(p2) - Math.sin(p1) * Math.cos(dl)));
    var a = Math.sin((p2 - p1) / 2) * Math.sin((p2 - p1) / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return { bearing: (b + 360) % 360, km: 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) };
  }
  function drawQibla() {
    if (!qibla) return;
    var h = heading == null ? 0 : heading;
    $("dial").style.transform = "rotate(" + (-h) + "deg)";
    $("kaabaArm").style.transform = "rotate(" + (qibla.bearing + 180) + "deg)";
    var box = document.querySelector(".qibla");
    if (heading == null) {
      box.classList.remove("aligned");
      $("qStatus").textContent = "البوصلة غير متاحة: وجّه أعلى الجوال نحو الشمال، ثم استدر " + Math.round(qibla.bearing) + "° باتجاه عقارب الساعة.";
      return;
    }
    var diff = ((qibla.bearing - heading + 540) % 360) - 180;
    var aligned = Math.abs(diff) <= 5;
    box.classList.toggle("aligned", aligned);
    $("qStatus").textContent = aligned ? "أنت الآن باتجاه القبلة" : (diff > 0 ? "استدر يمينًا " : "استدر يسارًا ") + Math.round(Math.abs(diff)) + "°";
    if (aligned && !wasAligned) { try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {} }
    wasAligned = aligned;
  }
  function setPosition(lat, lon) {
    qibla = computeQibla(lat, lon);
    $("qBearing").textContent = Math.round(qibla.bearing) + "°";
    $("qDist").textContent = Math.round(qibla.km).toLocaleString("ar") + " كم";
    drawQibla();
  }
  function onOrient(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === "number") h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === "number") h = 360 - e.alpha;
    if (h == null) return;
    var so = (screen.orientation && screen.orientation.angle) || 0;
    heading = (h + so + 360) % 360;
    drawQibla();
  }
  function startCompass() {
    if (compassOn) return;
    compassOn = true;
    if ("ondeviceorientationabsolute" in window) window.addEventListener("deviceorientationabsolute", onOrient);
    else window.addEventListener("deviceorientation", onOrient);
    setTimeout(function () { if (heading == null) drawQibla(); }, 2500);
  }
  try { var lastPos = JSON.parse(lsGet("azkar-pos") || "null"); if (lastPos) setPosition(lastPos.lat, lastPos.lon); } catch (e) {}
  $("qStart").addEventListener("click", function () {
    var DOE = window.DeviceOrientationEvent;
    var perm = DOE && typeof DOE.requestPermission === "function" ? DOE.requestPermission().catch(function () { return "denied"; }) : Promise.resolve("granted");
    startCompass();
    perm.then(function (state) {
      if (state !== "granted" && heading == null) $("qStatus").textContent = "لم يُسمح باستخدام البوصلة. أغلق التطبيق وافتحه ثم اضغط «ابدأ» واختر «سماح».";
    });
    if (!navigator.geolocation) { $("qStatus").textContent = "تحديد الموقع غير مدعوم على هذا الجهاز."; return; }
    $("qStatus").textContent = "جارٍ تحديد موقعك…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      var c = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      lsSet("azkar-pos", JSON.stringify(c));
      setPosition(c.lat, c.lon);
      $("qStart").textContent = "تحديث الموقع";
    }, function () {
      $("qStatus").textContent = qibla ? "تعذّر تحديث الموقع، يُستخدم آخر موقع محفوظ." : "تعذّر تحديد موقعك. اسمح للتطبيق بالوصول إلى الموقع ثم اضغط «ابدأ».";
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  });

  window.addEventListener("hashchange", render);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { checkDay(); if (!editing) fetchShared(false); }
  });

  if (saved) { data = clone(saved); render(); }
  syncAdminUi();
  fetchShared(false);

  if ("serviceWorker" in navigator) {
    var hadController = !!navigator.serviceWorker.controller, reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (hadController && !reloaded && !editing) { reloaded = true; location.reload(); }
    });
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").then(function (reg) { reg.update(); }).catch(function () {});
    });
  }
})();
