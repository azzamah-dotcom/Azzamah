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
        // The server's list always wins, except for a few minutes right after this phone saved
        // its own edit (the site takes a minute or two to publish it).
        var justSaved = Date.now() - (parseInt(lsGet("azkar-saved-at") || "0", 10) || 0) < 10 * 60000;
        if (!saved || !justSaved || (d.version || 0) >= (saved.version || 0)) {
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
  function checkDay() { if (prog.date !== todayStr()) { prog = { date: todayStr(), left: {} }; saveProg(); render(); } checkSlot(); }
  // The prayer whose time we are in now (before Fajr it is still last night's Isha).
  function prayerSlot() {
    if (!ptTimes) return null;
    var now = Date.now(), cur = "isha";
    ["fajr", "dhuhr", "asr", "maghrib", "isha"].forEach(function (k) { if (ptTimes.today[k].getTime() <= now) cur = k; });
    return cur;
  }
  // How many times for this dhikr now (some are read more after certain prayers).
  function countOf(it) {
    var sl = it.nx ? prayerSlot() : null;
    return sl && it.nx[sl] ? it.nx[sl] : it.n;
  }
  function left(it) { var n = countOf(it), l = prog.left[it.id]; return l == null ? n : Math.min(l, n); }
  // "After prayer" counters start fresh each time a new prayer comes in.
  function checkSlot() {
    var sl = prayerSlot();
    if (!sl) return;
    var key = sl === "isha" && Date.now() < ptTimes.today.fajr.getTime() ? "prev-isha" : todayStr() + sl;
    if (prog.slot === key) return;
    var had = prog.slot != null;
    prog.slot = key;
    if (had && data) data.items.forEach(function (it) { if (it.c === "prayer") delete prog.left[it.id]; });
    saveProg();
    if (had && data && !editing && currentCat && location.hash === "#prayer") render();
  }

  // ---------- personal duas (kept on this phone only) ----------
  function myDuas() {
    try { var a = JSON.parse(lsGet("azkar-mine") || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function saveMyDuas(a) { lsSet("azkar-mine", JSON.stringify(a)); }

  function currentCat() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (h === "mine") return "mine";
    if (h === "friday" && new Date().getDay() !== 5) return data.cats[0].id;
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
  // A soft fade on the far edge tells there are more sections to swipe to.
  function updateChipFade() {
    var rest = chipsEl.scrollWidth - chipsEl.clientWidth - Math.abs(chipsEl.scrollLeft);
    chipsEl.classList.toggle("more", rest > 4);
  }
  chipsEl.addEventListener("scroll", updateChipFade, { passive: true });
  window.addEventListener("resize", updateChipFade);
  function renderChips(cat) {
    chipsEl.textContent = "";
    data.cats.forEach(function (c) {
      // The Friday section shows only on Friday, once opened from the Friday note or notification.
      if (c.id === "friday" && !(cat === "friday" && new Date().getDay() === 5)) return;
      var a = el("a", "chip", chipLabel(c));
      a.title = c.name;
      a.href = "#" + c.id;
      a.setAttribute("aria-current", c.id === cat ? "true" : "false");
      chipsEl.appendChild(a);
    });
    var my = el("a", "chip", "أدعيتي");
    my.href = "#mine";
    my.title = "أدعيتي الخاصة";
    my.setAttribute("aria-current", cat === "mine" ? "true" : "false");
    chipsEl.appendChild(my);
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
    // Fill the first row, then the second, so the order reads across; extra columns are reached by swiping.
    var all = [].slice.call(chipsEl.children), half = Math.ceil(all.length / 2);
    all.forEach(function (c, i) { c.style.gridRow = i < half ? "1" : "2"; c.style.gridColumn = String((i < half ? i : i - half) + 1); });
    var on = chipsEl.querySelector('[aria-current="true"]');
    if (on) {
      var r = on.getBoundingClientRect(), box = chipsEl.getBoundingClientRect();
      if (r.left < box.left || r.right > box.right) chipsEl.scrollLeft += r.left < box.left ? r.left - box.left - 8 : r.right - box.right + 8;
    }
    updateChipFade();
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
    var n = countOf(it);
    card.querySelector(".ring").style.setProperty("--p", ((n - l) / n * 100).toFixed(1));
    card.querySelector(".ring span").textContent = l === 0 ? "✓" : (it.k === "task" ? "" : l);
    card.setAttribute("aria-label", "الباقي " + l + " من " + n);
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
    var cat = currentCat(), MINE = cat === "mine";
    var catObj = MINE ? { id: "mine", name: "أدعيتي" } : data.cats.filter(function (c) { return c.id === cat; })[0];
    renderChips(cat);
    var sl = cat === "prayer" ? prayerSlot() : null;
    $("catTitle").textContent = sl ? "أذكار بعد صلاة " + (sl === "dhuhr" && new Date().getDay() === 5 ? "الجمعة" : PNAMES[sl]) : catObj.name;
    // Some adhkar belong only to certain prayers (e.g. after Fajr and Maghrib); hide them after the others.
    var slotNow = cat === "prayer" ? prayerSlot() : null;
    var items = MINE ? myDuas() : data.items.filter(function (it) { return it.c === cat && (editing || !it.only || !slotNow || it.only.indexOf(slotNow) >= 0); });
    listEl.textContent = "";
    if (!items.length) {
      listEl.appendChild(el("div", "empty", MINE ? "هنا أدعيتك الخاصة، محفوظة على جوالك فقط. اضغط زر + بجانب العنوان لإضافة أول دعاء." :
        editing ? "لا يوجد شيء في هذا القسم بعد. أضف أول ذكر من النموذج أدناه." : "لا يوجد شيء في هذا القسم بعد."));
    }
    // Long sections are split into groups, with quick-jump buttons at the top.
    var groups = [];
    items.forEach(function (it) { if (it.grp && groups.indexOf(it.grp) < 0) groups.push(it.grp); });
    if (groups.length > 1) {
      var nav = el("nav", "grp-nav"); nav.setAttribute("aria-label", "مجموعات القسم");
      groups.forEach(function (g, gi) {
        var b = el("button", "grp-btn", g); b.type = "button";
        b.addEventListener("click", function () {
          var h = $("grp-" + gi), rail = document.querySelector("nav.rail");
          if (h) window.scrollTo(0, Math.max(0, h.getBoundingClientRect().top + window.pageYOffset - (rail ? rail.getBoundingClientRect().height : 0) - 10));
        });
        nav.appendChild(b);
      });
      listEl.appendChild(nav);
    }
    var lastGrp = null;
    items.forEach(function (it) {
      if (it.grp && it.grp !== lastGrp) {
        lastGrp = it.grp;
        var gh = el("h3", "grp-head", it.grp); gh.id = "grp-" + groups.indexOf(it.grp);
        listEl.appendChild(gh);
      }
      var card = el("article", "card");
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      if (it.w) card.appendChild(el("span", "when", it.w));
      card.appendChild(el("p", "txt", it.t));
      if (it.f) card.appendChild(el("p", "note", it.f));
      var foot = el("footer");
      var src = el("div", "src");
      src.appendChild(el("b", null, it.g || ""));
      src.appendChild(document.createTextNode(it.s ? " · " + it.s : ""));
      var cnt = el("div", "count");
      cnt.appendChild(el("span", it.k === "task" ? "lbl task" : "lbl", it.k === "task" ? (left(it) === 0 ? "تمّت" : "سُنّة") : (countOf(it) > 1 ? "× " + countOf(it) : "مرة")));
      var ring = el("div", "ring"); ring.appendChild(el("span")); cnt.appendChild(ring);
      foot.appendChild(src); foot.appendChild(cnt);
      card.appendChild(foot);
      if (MINE) {
        var dm = el("button", "del", "حذف"); dm.type = "button";
        dm.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (!dm.dataset.sure) { dm.dataset.sure = "1"; dm.textContent = "تأكيد الحذف"; setTimeout(function () { delete dm.dataset.sure; dm.textContent = "حذف"; }, 3500); return; }
          saveMyDuas(myDuas().filter(function (x) { return x.id !== it.id; }));
          delete prog.left[it.id]; saveProg(); render(); toast("حُذف الدعاء");
        });
        card.appendChild(dm);
      } else if (editing) {
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
        if (editing && !MINE) return;
        checkDay();
        var l = left(it);
        if (l === 0) return;
        prog.left[it.id] = l - 1; saveProg();
        cardState(card, it); updateProgress(items);
        if (it.k === "task") { var lb = card.querySelector(".lbl"); if (lb) lb.textContent = "تمّت"; }
        var finished = l - 1 === 0;
        var allDone = finished && items.every(function (x) { return left(x) === 0; });
        // Light tap for each count, a double pulse when a dhikr is finished, a longer one when the section is done.
        if (allDone) haptic([120, 70, 120, 70, 260], 3);
        else if (finished) haptic([70, 50, 70], 2);
        else haptic(25, 1);
        if (allDone) setTimeout(function () { celebrate(catObj); }, 350);
        if (finished && !allDone) {
          var next = card.nextElementSibling;
          while (next && (!next.classList.contains("card") || next.classList.contains("done"))) next = next.nextElementSibling;
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
    $("addForm").hidden = !editing || MINE;
    $("myAdd").hidden = !MINE;
    if (!MINE) showMyForm(false);
    $("editBar").hidden = !editing;
    if (editing && !MINE && !$("fCat").value) $("fCat").value = catObj.name;
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
      lsSet("azkar-saved-at", String(Date.now()));
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
  // ---------- celebration when a whole section is finished ----------
  var CHEERS = ["تقبّل الله منك", "جعلها الله في ميزان حسناتك", "ذكرت الله فذكرك", "حصّنت يومك بذكر الله"];
  function celebrate(cat) {
    $("celebTitle").textContent = "ما شاء الله! أتممت " + cat.name;
    $("celebBody").textContent = CHEERS[Math.floor(Math.random() * CHEERS.length)] + " 🤍";
    $("celebrate").hidden = false;
    $("celebOk").focus();
    chime(2);
    var c = $("confetti");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !c.getContext) return;
    var ctx = c.getContext("2d"), W = c.width = innerWidth, H = c.height = innerHeight, parts = [];
    var cols = ["#d6b468", "#0f5c4a", "#5fc3a3", "#f4efe0", "#9a7a2c"];
    for (var i = 0; i < 150; i++) parts.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, r: 3 + Math.random() * 5, vy: 2 + Math.random() * 3.2, vx: -1.5 + Math.random() * 3, a: Math.random() * 6, star: i % 4 === 0, col: cols[i % cols.length] });
    c.hidden = false;
    var start = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.a += 0.08;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.col;
        if (p.star) { ctx.beginPath(); for (var k = 0; k < 8; k++) { var rr = k % 2 ? p.r * 0.45 : p.r * 1.3, an = k * Math.PI / 4; ctx.lineTo(Math.cos(an) * rr, Math.sin(an) * rr); } ctx.closePath(); ctx.fill(); }
        else ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
        ctx.restore();
      });
      if (t - start < 3800) requestAnimationFrame(frame); else { ctx.clearRect(0, 0, W, H); c.hidden = true; }
    })(start);
  }
  $("celebOk").addEventListener("click", function () { $("celebrate").hidden = true; });
  $("celebrate").addEventListener("click", function (e) { if (e.target === $("celebrate")) $("celebrate").hidden = true; });

  function buzz() { haptic([90, 60, 90], 2); }
  // iPhone (iOS 18+): Safari gives a haptic tap when a switch control is toggled by a tap.
  // A hidden switch is created and clicked during the user's own tap, then removed.
  function iosTap() {
    try {
      var label = document.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.display = "none";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      label.appendChild(input);
      document.head.appendChild(label);
      label.click();
      document.head.removeChild(label);
    } catch (e) {}
  }
  // pattern: Android vibration in ms; taps: how many haptic taps on iPhone.
  // The first iPhone tap happens immediately, inside the tap that triggered it.
  function haptic(pattern, taps) {
    try { if (typeof navigator.vibrate === "function" && navigator.vibrate(pattern)) return; } catch (e) {}
    iosTap();
    for (var i = 1; i < taps; i++) setTimeout(iosTap, i * 120);
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
  // Double-tap zoom is turned off by "touch-action: manipulation" in the page styles, so every tap
  // (including quick double taps on a dhikr) reaches the page as a normal tap.

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
    computeTimes(); renderPrayer(); syncPush();
    if (moved || !place.cc) {
      // City name and country (to pick the right calculation method); the times work without it.
      fetch("https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=" + lat + "&longitude=" + lon + "&localityLanguage=ar")
        .then(function (r) { return r.json(); })
        .then(function (g) {
          place.cc = (g.countryCode || "").toUpperCase();
          place.city = [g.city || g.locality, g.countryName].filter(Boolean).join("، ");
          lsSet("azkar-place", JSON.stringify(place));
          computeTimes(); renderPrayer(); syncPush();
        }).catch(function () {});
    }
  }
  // Settings: calculation method and Asr
  (function () {
    var sel = $("sMethod");
    Object.keys(PC.METHODS).forEach(function (k) { var o = el("option", null, PC.METHODS[k].name); o.value = k; sel.appendChild(o); });
    sel.value = lsGet("azkar-pt-method") || "auto";
    $("sAsr").value = lsGet("azkar-pt-asr") || "auto";
    sel.addEventListener("change", function () { lsSet("azkar-pt-method", sel.value); computeTimes(); renderPrayer(); syncPush(); toast("تم تحديث أوقات الصلاة"); });
    $("sAsr").addEventListener("change", function () { lsSet("azkar-pt-asr", $("sAsr").value); computeTimes(); renderPrayer(); syncPush(); toast("تم تحديث أوقات الصلاة"); });
  })();
  computeTimes();
  setInterval(tickPrayer, 1000);

  // ---------- Alerts: adhan, iqama, "did you pray?", and adhkar reminders ----------
  var NDEF = { adhan: true, iqama: true, after: true, adhkar: true, sound: true, iq: { fajr: 20, dhuhr: 15, asr: 15, maghrib: 10, isha: 15 } };
  var nset = clone(NDEF);
  try { var ns = JSON.parse(lsGet("azkar-notif") || "null"); if (ns) { for (var nk in ns) nset[nk] = ns[nk]; nset.iq = Object.assign({}, NDEF.iq, ns.iq || {}); } } catch (e) {}
  function saveN() { lsSet("azkar-notif", JSON.stringify(nset)); if (typeof syncPush === "function") syncPush(); }

  function buildEvents() {
    if (!ptTimes) return [];
    var ev = [], t = ptTimes.today, fri = new Date().getDay() === 5, day = todayStr();
    var where = place && place.city ? " حسب توقيت " + place.city.split("،")[0] : "";
    ["fajr", "dhuhr", "asr", "maghrib", "isha"].forEach(function (k) {
      var name = k === "dhuhr" && fri ? "الجمعة" : PNAMES[k], at = t[k].getTime();
      if (nset.adhan) ev.push({ id: day + k + "a", at: at, kind: "adhan", title: "أذان " + name, body: "حان الآن موعد صلاة " + name + where + ".", url: "#times" });
      if (nset.iqama && !(k === "dhuhr" && fri)) ev.push({ id: day + k + "i", at: at + (nset.iq[k] || 0) * 60000, kind: "chime", title: "إقامة صلاة " + name, body: "حان موعد الإقامة تقريبًا، أدرك صلاة الجماعة.", url: "#times" });
      if (nset.after) ev.push({ id: day + k + "h", at: at + 3600000, kind: "chime", title: "هل صليت " + name + "؟", body: "مضت ساعة على أذان " + name + ". سُئل النبي ﷺ: أي العمل أحب إلى الله؟ قال: «الصلاة على وقتها» (البخاري 527).", url: "#times" });
    });
    if (nset.adhkar) {
      ev.push({ id: day + "am", at: t.fajr.getTime() + 40 * 60000, kind: "chime", title: "أذكار الصباح", body: "حان وقت أذكار الصباح، اغتنمها قبل أن يشغلك يومك.", url: "#morning", go: "افتح أذكار الصباح" });
      ev.push({ id: day + "pm", at: t.asr.getTime() + 30 * 60000, kind: "chime", title: "أذكار المساء", body: "حان وقت أذكار المساء قبل غروب الشمس.", url: "#evening", go: "افتح أذكار المساء" });
      ev.push({ id: day + "sl", at: t.isha.getTime() + 150 * 60000, kind: "chime", title: "أذكار النوم", body: "لا تنسَ أذكار النوم قبل أن تنام.", url: "#sleep", go: "افتح أذكار النوم" });
      if (new Date().getDay() === 5) ev.push({ id: day + "fr", at: t.sunrise.getTime() + 90 * 60000, kind: "chime", title: "🕌 اليوم الجمعة", body: "سورة الكهف، والإكثار من الصلاة على النبي ﷺ، والتبكير إلى الصلاة، وساعة الإجابة آخر ساعة بعد العصر.", url: "#friday", go: "افتح سنن الجمعة" });
    }
    return ev;
  }

  var fired = { day: todayStr(), ids: [] };
  try { var fr = JSON.parse(lsGet("azkar-fired") || "null"); if (fr && fr.day === fired.day) fired = fr; } catch (e) {}
  function checkAlerts() {
    if (fired.day !== todayStr()) fired = { day: todayStr(), ids: [] };
    var now = Date.now();
    buildEvents().forEach(function (e) {
      // Only alerts that are due now (not older than 3 minutes, so reopening the app doesn't replay the day).
      if (e.at <= now && now - e.at < 180000 && fired.ids.indexOf(e.id) < 0) {
        fired.ids.push(e.id); lsSet("azkar-fired", JSON.stringify(fired));
        fireAlert(e);
      }
    });
  }

  // Sound: adhan.mp3 if it was uploaded to the app, otherwise a soft synthesized chime.
  var actx = null, adhanAudio = null, adhanFile = null;
  fetch("adhan.mp3", { method: "HEAD", cache: "no-store" }).then(function (r) { adhanFile = r.ok && /audio|mpeg|octet/.test(r.headers.get("content-type") || ""); }).catch(function () { adhanFile = false; });
  function unlockAudio() {
    try {
      if (!actx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
      if (actx && actx.state === "suspended") actx.resume();
      // iPhone allows sound only after a tap: prepare the adhan during the first tap so it can play later.
      if (adhanFile !== false && !adhanAudio) {
        adhanAudio = new Audio("adhan.mp3");
        adhanAudio.preload = "auto";
        adhanAudio.setAttribute("playsinline", "");
        adhanAudio.muted = true;
        var pr = adhanAudio.play();
        if (pr && pr.then) pr.then(function () { adhanAudio.pause(); adhanAudio.currentTime = 0; adhanAudio.muted = false; }).catch(function () { adhanAudio.muted = false; });
      }
    } catch (e) {}
  }
  document.addEventListener("pointerdown", unlockAudio, { passive: true });
  function chime(times) {
    if (!actx) return;
    try {
      if (actx.state === "suspended") actx.resume();
      var t0 = actx.currentTime + 0.05;
      for (var r = 0; r < times; r++) {
        [659.25, 783.99, 987.77].forEach(function (f, i) {
          var o = actx.createOscillator(), g = actx.createGain(), st = t0 + r * 1.9 + i * 0.42;
          o.type = "sine"; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, st); g.gain.exponentialRampToValueAtTime(0.35, st + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, st + 1.6);
          o.connect(g); g.connect(actx.destination); o.start(st); o.stop(st + 1.7);
        });
      }
    } catch (e) {}
  }
  function playSound(kind) {
    if (!nset.sound) return;
    if (kind === "adhan" && adhanFile !== false) {
      try {
        if (!adhanAudio) { adhanAudio = new Audio("adhan.mp3"); adhanAudio.setAttribute("playsinline", ""); }
        adhanAudio.muted = false;
        adhanAudio.currentTime = 0;
        var pr = adhanAudio.play();
        if (pr && pr.catch) pr.catch(function () { chime(3); });
        return;
      } catch (e) {}
    }
    chime(kind === "adhan" ? 3 : 1);
  }
  function stopSound() { try { if (adhanAudio) adhanAudio.pause(); } catch (e) {} }

  function systemNotify(e) {
    if (!("Notification" in window) || Notification.permission !== "granted" || !navigator.serviceWorker) return false;
    navigator.serviceWorker.ready.then(function (reg) {
      reg.showNotification(e.title, { body: e.body, icon: "icon-192.png", badge: "icon-192.png", tag: e.id, lang: "ar", dir: "rtl", data: { url: "./" + e.url } });
    }).catch(function () {});
    return true;
  }
  function fireAlert(e) {
    if (document.visibilityState !== "visible") { systemNotify(e); return; }
    $("alTitle").textContent = e.title;
    $("alBody").textContent = e.body;
    var go = $("alGo");
    if (e.go) { go.hidden = false; go.textContent = e.go; go.href = e.url; } else go.hidden = true;
    var card = $("alertCard");
    card.classList.toggle("ringing", e.kind === "adhan");
    card.hidden = false;
    playSound(e.kind);
    try { if (navigator.vibrate) navigator.vibrate(e.kind === "adhan" ? [300, 150, 300, 150, 300] : [120, 80, 120]); else buzz(); } catch (err) {}
  }
  function closeAlert() { $("alertCard").hidden = true; stopSound(); }
  $("alClose").addEventListener("click", closeAlert);
  $("alGo").addEventListener("click", function () { closeAlert(); });
  setInterval(checkAlerts, 10000);

  // Ask once for notification permission (a tap is required on iPhone).
  function syncNotifAsk() {
    var can = "Notification" in window;
    $("notifAsk").hidden = !(can && Notification.permission === "default" && !lsGet("azkar-notif-asked"));
    $("nPerm").hidden = !(can && Notification.permission !== "granted");
  }
  function askNotif() {
    unlockAudio();
    lsSet("azkar-notif-asked", "1");
    if (!("Notification" in window)) { syncNotifAsk(); return; }
    Notification.requestPermission().then(function (p) {
      syncNotifAsk();
      if (p === "granted") syncPush();
      toast(p === "granted" ? "تم تفعيل التنبيهات" : "لم يُسمح بالإشعارات؛ ستظهر التنبيهات داخل التطبيق فقط");
    }).catch(function () { syncNotifAsk(); });
  }
  $("notifYes").addEventListener("click", askNotif);
  $("nPerm").addEventListener("click", askNotif);
  $("vTest").addEventListener("click", function () {
    haptic([70, 50, 70], 2);
    toast(typeof navigator.vibrate === "function" ? "يجب أن يهتز الجوال الآن" : "يجب أن تشعر بنقرتين خفيفتين (iOS 18 أو أحدث)");
  });
  $("nTest").addEventListener("click", function () {
    unlockAudio();
    // Played right inside the tap, as iPhone requires for sound.
    fireAlert({ id: "test", kind: "adhan", title: "تجربة التنبيه", body: "هكذا سيظهر تنبيه الأذان عند دخول وقت الصلاة.", url: "#times" });
    // Also ask the server to send a real notification, to confirm alerts arrive while the app is closed.
    var ep = lsGet("azkar-push-ep");
    if (pushUrl() && ep) fetch(pushUrl() + "/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: ep }) }).catch(function () {});
  });
  // Settings controls
  ["adhan", "iqama", "after", "adhkar", "sound"].forEach(function (k) {
    var box = $("n" + k.charAt(0).toUpperCase() + k.slice(1));
    box.checked = !!nset[k];
    box.addEventListener("change", function () { nset[k] = box.checked; saveN(); });
  });
  ["fajr", "dhuhr", "asr", "maghrib", "isha"].forEach(function (k) {
    var inp = $("iq-" + k);
    inp.value = nset.iq[k];
    inp.addEventListener("change", function () { var v = parseInt(inp.value, 10); nset.iq[k] = v >= 0 && v <= 90 ? v : NDEF.iq[k]; inp.value = nset.iq[k]; saveN(); });
  });
  syncNotifAsk();

  // ---------- Background notifications (Web Push through the notification server) ----------
  // The server address lives in azkar.json ("push"), so it can be set without changing the app.
  var pushTimer = null, pushOk = false;
  function pushUrl() { return data && data.push ? String(data.push).replace(/\/+$/, "") : ""; }
  function u8(b64) {
    var s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function syncPush() { clearTimeout(pushTimer); pushTimer = setTimeout(doSyncPush, 1500); }
  function doSyncPush() {
    var base = pushUrl();
    if (!base || !place || !("PushManager" in window) || !("Notification" in window) || Notification.permission !== "granted" || !navigator.serviceWorker) return;
    var reg;
    navigator.serviceWorker.ready.then(function (r) {
      reg = r;
      return fetch(base + "/vapid").then(function (x) { return x.json(); });
    }).then(function (v) {
      var key = u8(v.key);
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub && lsGet("azkar-push-key") === v.key) return sub;
        var drop = sub ? sub.unsubscribe() : Promise.resolve();
        return drop.then(function () { return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }); })
          .then(function (ns) { lsSet("azkar-push-key", v.key); return ns; });
      });
    }).then(function (sub) {
      var tz = "UTC";
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch (e) {}
      return fetch(base + "/subscribe", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sub: sub.toJSON(), lat: place.lat, lon: place.lon, tz: tz, method: ptMethod(), hanafi: ptHanafi(), city: place.city || "",
          n: { adhan: nset.adhan, iqama: nset.iqama, after: nset.after, adhkar: nset.adhkar, iq: nset.iq } })
      }).then(function (r) { pushOk = r.ok; lsSet("azkar-push-ep", sub.endpoint); });
    }).catch(function () { pushOk = false; });
  }

  // ---------- font size (for easier reading) ----------
  var FS = [{ v: 0.9, n: "صغير" }, { v: 1, n: "عادي" }, { v: 1.15, n: "كبير" }, { v: 1.3, n: "كبير جدًا" }, { v: 1.5, n: "ضخم" }];
  function curFs() { var v = parseFloat(lsGet("azkar-fs")); return v > 0.8 && v < 1.8 ? v : 1; }
  function applyFs(v) {
    var root = document.documentElement;
    root.style.fontSize = (16 * v) + "px";
    root.classList.toggle("fs-l", v > 1.05 && v < 1.3);
    root.classList.toggle("fs-xl", v >= 1.3);
    var f = FS.filter(function (x) { return x.v === v; })[0];
    $("fsName").textContent = f ? f.n : "";
    [].forEach.call($("fsSteps").children, function (b) { b.setAttribute("aria-checked", parseFloat(b.dataset.v) === v ? "true" : "false"); });
  }
  FS.forEach(function (f) {
    var b = el("button", "fs-step", "أ");
    b.type = "button"; b.dataset.v = f.v; b.setAttribute("role", "radio"); b.setAttribute("aria-label", f.n);
    b.style.fontSize = (14 + (f.v - 0.9) * 30) + "px";
    b.addEventListener("click", function () { lsSet("azkar-fs", String(f.v)); applyFs(f.v); });
    $("fsSteps").appendChild(b);
  });
  applyFs(curFs());
  $("fsBtn").addEventListener("click", function () {
    var open = $("fsPanel").hidden;
    $("fsPanel").hidden = !open;
    $("fsBtn").setAttribute("aria-expanded", open ? "true" : "false");
    if (open) $("settings").hidden = true;
  });

  // Switching sections: land on the first dhikr not finished yet, or at the top of the section.
  var lastView = location.hash;
  function onHash() {
    render();
    if (location.hash === lastView) return;
    lastView = location.hash;
    var view = $("adhkarView").hidden ? ($("qiblaView").hidden ? $("prayerView") : $("qiblaView")) : $("adhkarView");
    var rail = document.querySelector("nav.rail"), railH = rail ? rail.getBoundingClientRect().height : 0;
    var target = view, cards = view === $("adhkarView") ? [].slice.call(listEl.querySelectorAll(".card")) : [];
    var firstOpen = cards.filter(function (c) { return !c.classList.contains("done"); })[0];
    if (firstOpen && cards.indexOf(firstOpen) > 0) target = firstOpen;
    if (target === view) { window.scrollTo(0, 0); return; }
    window.scrollTo(0, Math.max(0, target.getBoundingClientRect().top + window.pageYOffset - railH - 16));
  }
  // The add form opens only from the small + button next to the title.
  function showMyForm(open) {
    $("myForm").hidden = !open;
    $("myAdd").setAttribute("aria-expanded", open ? "true" : "false");
    $("myAdd").setAttribute("aria-label", open ? "إغلاق" : "إضافة دعاء");
    if (open) { $("myMsg").textContent = ""; $("myForm").scrollIntoView({ block: "center" }); setTimeout(function () { $("myText").focus(); }, 50); }
  }
  $("myAdd").addEventListener("click", function () { showMyForm($("myForm").hidden); });
  $("myCancel").addEventListener("click", function () { showMyForm(false); });
  $("myForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var t = $("myText").value.trim(), n = parseInt($("myCount").value, 10);
    if (!t) { $("myMsg").textContent = "اكتب الدعاء أولًا."; $("myText").focus(); return; }
    if (!(n >= 1 && n <= 1000)) { $("myMsg").textContent = "عدد المرات من 1 إلى 1000."; return; }
    var a = myDuas();
    a.push({ id: "my" + Date.now().toString(36), c: "mine", t: t.slice(0, 1500), n: n, s: "", g: "دعائي" });
    saveMyDuas(a);
    $("myText").value = ""; $("myCount").value = 1; $("myMsg").textContent = "";
    showMyForm(false);
    render(); toast("أُضيف دعاؤك");
  });
  window.addEventListener("hashchange", onHash);
  // Coming back after 10+ minutes away: reload so the latest version (and any list edits) show up.
  var hiddenAt = 0;
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 10 * 60000 && !editing && $("sheet").hidden && $("alertCard").hidden && navigator.onLine !== false) { location.reload(); return; }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { checkDay(); if (!editing) fetchShared(false); }
  });

  if (saved) { data = clone(saved); render(); }
  syncAdminUi();
  fetchShared(false);
  renderPrayer();
  locate();
  setTimeout(syncPush, 4000);

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
