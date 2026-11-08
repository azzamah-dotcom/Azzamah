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

  // Short chip names so every section fits in two rows without scrolling.
  function chipLabel(c) {
    if (c.short) return c.short;
    if (c.id === "quran") return "أدعية قرآنية";
    return c.name.replace(/^أذكار\s+/, "").replace(/^يوم\s+/, "");
  }
  function renderChips(cat) {
    chipsEl.textContent = "";
    data.cats.forEach(function (c) {
      var a = el("a", "chip", chipLabel(c));
      a.title = c.name;
      a.href = "#" + c.id;
      a.setAttribute("aria-current", c.id === cat ? "true" : "false");
      chipsEl.appendChild(a);
    });
    var pr = el("a", "chip", "المواقيت");
    pr.title = "أوقات الصلاة";
    pr.href = "#times";
    pr.setAttribute("aria-current", cat === "times" ? "true" : "false");
    chipsEl.appendChild(pr);
    var q = el("a", "chip", "القبلة");
    q.href = "#qibla";
    q.setAttribute("aria-current", cat === "qibla" ? "true" : "false");
    chipsEl.appendChild(q);
    var cur = chipsEl.querySelector('[aria-current="true"]');
    chipsEl.style.setProperty("--cols", Math.min(6, Math.ceil(chipsEl.children.length / 2)));
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
    var view = location.hash === "#qibla" ? "qibla" : location.hash === "#times" ? "times" : "adhkar";
    $("adhkarView").hidden = view !== "adhkar";
    $("qiblaView").hidden = view !== "qibla";
    $("prayerView").hidden = view !== "times";
    $("nextPrayer").hidden = view === "times" || !ptTimes;
    if (view !== "adhkar") {
      renderChips(view);
      if (view === "qibla") openQibla(); else { locate(); renderPrayer(); }
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
  function toast(msg, actionLabel, action) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    if (actionLabel) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "toast-act"; b.textContent = actionLabel;
      b.addEventListener("click", function () { t.hidden = true; action(); });
      t.appendChild(b);
    }
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, actionLabel ? 5000 : 2600);
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
    var cat = currentCat(), before = {}, any = false;
    data.items.forEach(function (it) {
      if (it.c === cat && prog.left[it.id] != null) { before[it.id] = prog.left[it.id]; delete prog.left[it.id]; any = true; }
    });
    saveProg(); render();
    var btn = $("resetBtn"); btn.classList.remove("spin"); void btn.offsetWidth; btn.classList.add("spin");
    if (any) toast("أُعيد عداد هذا القسم", "تراجع", function () {
      if (prog.date !== todayStr()) return;
      Object.keys(before).forEach(function (id) { prog.left[id] = before[id]; });
      saveProg(); render();
    });
    else toast("العداد في بدايته");
  });
  // Counters start fresh at 12 midnight (phone's local time), even if the app stays open.
  setInterval(checkDay, 30000);

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
  var AYAH_MS = 5 * 60 * 1000, ayahIdx = -1, ayahStart = 0, ayahList = null, curAyah = null;
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
      curAyah = a;
      hero.classList.remove("fade");
    }
    if (animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) { hero.classList.add("fade"); setTimeout(show, 400); }
    else show();
  }
  $("ayahNext").addEventListener("click", function (ev) { ev.stopPropagation(); nextAyah(true); });

  // Ayah details sheet: tafsir, when it was revealed, and the occasion of revelation if any.
  var lastFocus = null;
  function openSheet() {
    var a = curAyah; if (!a) return;
    $("shRef").textContent = "سورة " + a.r + " · الآية " + a.a;
    $("shAyah").textContent = "﴿ " + a.t + " ﴾";
    $("shTf").textContent = a.tf || "لم يُضف تفسير لهذه الآية بعد.";
    $("shNz").textContent = a.nz || "—";
    $("shSb").textContent = a.sb || "لم يثبت لهذه الآية سبب نزول خاص بحسب ما وقفنا عليه.";
    $("shLink").href = "https://quran.com/" + a.s + "/" + a.a;
    lastFocus = document.activeElement;
    $("sheet").hidden = false; $("sheetBack").hidden = false;
    $("sheet").scrollTop = 0;
    document.body.style.overflow = "hidden";
    $("shClose").focus();
  }
  function closeSheet() {
    if ($("sheet").hidden) return;
    $("sheet").hidden = true; $("sheetBack").hidden = true;
    document.body.style.overflow = "";
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  $("hero").addEventListener("click", openSheet);
  $("hero").addEventListener("keydown", function (ev) { if (ev.target === $("hero") && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openSheet(); } });
  $("shClose").addEventListener("click", closeSheet);
  $("sheetBack").addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeSheet(); });
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
    $("kaabaIcon").style.transform = "rotate(" + (h - qibla.bearing - 180) + "deg)";
    var box = document.querySelector(".qibla");
    if (heading == null) {
      box.classList.remove("aligned");
      $("qStatus").textContent = needsCompassPermission && compassPerm !== "granted"
        ? "المس الشاشة مرة واحدة لتشغيل البوصلة"
        : "البوصلة غير متاحة: وجّه أعلى الجوال نحو الشمال، ثم استدر " + Math.round(qibla.bearing) + "° باتجاه عقارب الساعة.";
      return;
    }
    var diff = ((qibla.bearing - heading + 540) % 360) - 180;
    var aligned = Math.abs(diff) <= 5;
    box.classList.toggle("aligned", aligned);
    $("qStatus").textContent = aligned ? "أنت الآن باتجاه القبلة" : (diff > 0 ? "استدر يمينًا " : "استدر يسارًا ") + Math.round(Math.abs(diff)) + "°";
    if (aligned && !wasAligned) buzz();
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

  var DOE = window.DeviceOrientationEvent;
  var needsCompassPermission = !!(DOE && typeof DOE.requestPermission === "function");
  var compassPerm = needsCompassPermission ? null : "granted", locating = false;

  // Vibration when facing the Qibla. Android supports navigator.vibrate; iPhone (iOS 18+) gives a
  // haptic tap when a switch control is toggled, so a hidden switch is used there.
  var hapticLabel = null;
  function buzz() {
    try { if (navigator.vibrate && navigator.vibrate([90, 60, 90])) return; } catch (e) {}
    try {
      if (!hapticLabel) {
        hapticLabel = document.createElement("label");
        hapticLabel.setAttribute("aria-hidden", "true");
        hapticLabel.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
        var sw = document.createElement("input");
        sw.type = "checkbox"; sw.setAttribute("switch", ""); sw.tabIndex = -1;
        hapticLabel.appendChild(sw);
        document.body.appendChild(hapticLabel);
      }
      hapticLabel.click();
      setTimeout(function () { hapticLabel.click(); }, 150);
    } catch (e) {}
  }

  function locate() {
    if (locating || !navigator.geolocation) return;
    locating = true;
    if (!qibla) $("qStatus").textContent = "جارٍ تحديد موقعك…";
    navigator.geolocation.getCurrentPosition(function (pos) {
      locating = false;
      var c = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      lsSet("azkar-pos", JSON.stringify(c));
      setPosition(c.lat, c.lon);
      setPrayerPlace(c.lat, c.lon);
    }, function () {
      locating = false;
      if (!qibla) $("qStatus").textContent = "تعذّر تحديد موقعك. اسمح للتطبيق بالوصول إلى الموقع من إعدادات الجوال.";
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 });
  }
  // iPhone only allows the compass after a tap, so the tap that opens the Qibla screen asks for it.
  function askCompass() {
    if (!needsCompassPermission || compassPerm === "granted" || compassPerm === "pending") return;
    compassPerm = "pending";
    DOE.requestPermission().then(function (state) {
      compassPerm = state;
      if (state === "granted") startCompass();
      else $("qStatus").textContent = "لم يُسمح باستخدام البوصلة. أغلق التطبيق وافتحه من جديد واختر «سماح».";
    }).catch(function () { compassPerm = null; });
  }
  // Every time the Qibla screen opens: location and compass start by themselves.
  function openQibla() {
    locate();
    startCompass();
    drawQibla();
  }
  chipsEl.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("a");
    if (a && a.getAttribute("href") === "#qibla") askCompass();
  });
  $("qiblaView").addEventListener("click", askCompass);
  $("qiblaView").addEventListener("touchend", askCompass);

  // No zooming: double-tap and pinch are blocked so a quick double tap on a dhikr never zooms the page.
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.addEventListener("dblclick", function (e) { e.preventDefault(); }, { passive: false });
  var lastTouch = 0;
  document.addEventListener("touchend", function (e) {
    var now = Date.now();
    if (now - lastTouch < 350 && e.cancelable) {
      e.preventDefault();
      var t = e.target.closest && e.target.closest(".card");
      if (t) t.click();
    }
    lastTouch = now;
  }, { passive: false });

  // ---------- Prayer times ----------
  var PC = window.PrayerCalc;
  var PNAMES = { fajr: "الفجر", sunrise: "الشروق", dhuhr: "الظهر", asr: "العصر", maghrib: "المغرب", isha: "العشاء" };
  var place = null, ptTimes = null, ptDay = "", lastLocate = 0;
  try { place = JSON.parse(lsGet("azkar-place") || "null"); } catch (e) {}

  function ptMethod() {
    var m = lsGet("azkar-pt-method") || "auto";
    if (m !== "auto" && PC.METHODS[m]) return m;
    return (place && place.cc && PC.COUNTRY[place.cc]) || "mwl";
  }
  function ptHanafi() {
    var a = lsGet("azkar-pt-asr") || "auto";
    if (a === "auto") return !!(place && place.cc && PC.HANAFI[place.cc]);
    return a === "hanafi";
  }
  function fmtTime(d) {
    var h = d.getHours(), m = d.getMinutes();
    return (h % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + " " + (h < 12 ? "ص" : "م");
  }
  function fmtLeft(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); s = s % 60;
    return h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function computeTimes() {
    if (!place || !PC) { ptTimes = null; return; }
    var now = new Date();
    ptDay = todayStr();
    var today = PC.compute(now, place.lat, place.lon, ptMethod(), ptHanafi());
    var tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    ptTimes = { today: today, tomorrowFajr: PC.compute(tom, place.lat, place.lon, ptMethod(), ptHanafi()).fajr };
  }
  function nextPrayer() {
    var now = Date.now(), order = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
    for (var i = 0; i < order.length; i++) if (ptTimes.today[order[i]].getTime() > now) return { key: order[i], at: ptTimes.today[order[i]] };
    return { key: "fajr", at: ptTimes.tomorrowFajr, tomorrow: true };
  }
  function renderPrayer() {
    if (ptDay !== todayStr()) computeTimes();
    if (!ptTimes) {
      $("ptCity").textContent = "جارٍ تحديد موقعك…";
      $("ptList").textContent = "";
      $("ptMethod").textContent = "تُحسب الأوقات حسب موقعك. اسمح للتطبيق بالوصول إلى الموقع.";
      $("nextPrayer").hidden = true;
      return;
    }
    var nx = nextPrayer(), now = Date.now();
    $("ptCity").textContent = place.city || "موقعك الحالي";
    var dateTxt = "";
    try {
      dateTxt = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "long", year: "numeric" }).format(new Date()) +
        " · " + new Intl.DateTimeFormat("ar-u-nu-latn", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
    } catch (e) {}
    $("ptDate").textContent = dateTxt;
    var list = $("ptList"); list.textContent = "";
    ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].forEach(function (k) {
      var li = el("li"), at = ptTimes.today[k];
      if (k === "sunrise") li.classList.add("sun");
      if (!nx.tomorrow && k === nx.key) li.classList.add("next");
      else if (at.getTime() <= now) li.classList.add("past");
      if (nx.tomorrow && k === "fajr") li.classList.add("next");
      var name = k === "dhuhr" && new Date().getDay() === 5 ? "الجمعة" : PNAMES[k];
      li.appendChild(el("span", "n", name));
      li.appendChild(el("span", "t", fmtTime(k === "fajr" && nx.tomorrow ? ptTimes.tomorrowFajr : at)));
      list.appendChild(li);
    });
    var m = PC.METHODS[ptMethod()];
    $("ptMethod").textContent = "طريقة الحساب: " + m.name + " · العصر: " + (ptHanafi() ? "الحنفي" : "الجمهور") +
      ". قد تختلف الأوقات دقيقة أو دقيقتين عن تقويم مسجدك، ويمكن تغيير الطريقة من الإعدادات ⚙️.";
    tickPrayer();
  }
  function tickPrayer() {
    if (!ptTimes) return;
    if (ptDay !== todayStr()) { renderPrayer(); return; }
    var nx = nextPrayer(), left = nx.at.getTime() - Date.now();
    if (left <= 0) { renderPrayer(); return; }
    var name = nx.key === "dhuhr" && new Date().getDay() === 5 ? "الجمعة" : PNAMES[nx.key];
    $("npName").textContent = name;
    $("npTime").textContent = fmtTime(nx.at);
    $("npLeft").textContent = fmtLeft(left);
    $("ptNextName").textContent = name + " بعد";
    $("ptCountdown").textContent = fmtLeft(left);
    $("nextPrayer").hidden = location.hash === "#times";
  }
  function setPrayerPlace(lat, lon) {
    var moved = !place || Math.abs(place.lat - lat) > 0.05 || Math.abs(place.lon - lon) > 0.05;
    place = { lat: lat, lon: lon, cc: place && !moved ? place.cc : "", city: place && !moved ? place.city : "" };
    lsSet("azkar-place", JSON.stringify(place));
    computeTimes(); renderPrayer();
    if (moved || !place.cc) {
      // City name and country (to pick the right calculation method); the times work without it.
      fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + lat + "&longitude=" + lon + "&localityLanguage=ar")
        .then(function (r) { return r.json(); })
        .then(function (g) {
          place.cc = (g.countryCode || "").toUpperCase();
          place.city = [g.city || g.locality, g.countryName].filter(Boolean).join("، ");
          lsSet("azkar-place", JSON.stringify(place));
          computeTimes(); renderPrayer();
        }).catch(function () {});
    }
  }
  // Settings: calculation method and Asr
  (function () {
    var sel = $("sMethod");
    Object.keys(PC.METHODS).forEach(function (k) { var o = el("option", null, PC.METHODS[k].name); o.value = k; sel.appendChild(o); });
    sel.value = lsGet("azkar-pt-method") || "auto";
    $("sAsr").value = lsGet("azkar-pt-asr") || "auto";
    sel.addEventListener("change", function () { lsSet("azkar-pt-method", sel.value); computeTimes(); renderPrayer(); toast("تم تحديث أوقات الصلاة"); });
    $("sAsr").addEventListener("change", function () { lsSet("azkar-pt-asr", $("sAsr").value); computeTimes(); renderPrayer(); toast("تم تحديث أوقات الصلاة"); });
  })();
  computeTimes();
  setInterval(tickPrayer, 1000);

  window.addEventListener("hashchange", render);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { checkDay(); if (!editing) fetchShared(false); }
  });

  if (saved) { data = clone(saved); render(); }
  syncAdminUi();
  fetchShared(false);
  renderPrayer();
  locate();

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
