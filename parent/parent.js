(function () {
  "use strict";
  var API = "https://azkar-push.azzamah.workers.dev";
  var ORDER = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
  var NAMES = { fajr: "الفجر", dhuhr: "الظهر", asr: "العصر", maghrib: "المغرب", isha: "العشاء" };
  var PRESETS = [
    { label: "تلقائي حسب الصلاة", text: "" },
    { label: "تعال نصلي جماعة", text: "تعال نصلي جماعة الآن 🕌" },
    { label: "توضأ واستعد", text: "توضأ واستعد للصلاة 💧" },
    { label: "أحسنت، استمر", text: "ما شاء الله عليك، استمر على صلاتك ⭐" }
  ];
  var $ = function (id) { return document.getElementById(id); };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var toastT;
  function toast(m) { var t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 2600); }

  var key = lsGet("parent-key"), hasPin = true, preset = 0, kidsData = [], looseData = [], editing = null, showCode = {};

  function api(path, body) {
    var opt = { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" } };
    if (key) opt.headers["X-Parent-Key"] = key;
    if (body) opt.body = JSON.stringify(body);
    return fetch(API + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    });
  }

  // ---------- passcode ----------
  function showLock() {
    $("dash").hidden = true; $("refresh").hidden = true; $("lock").hidden = false;
    $("lockMsg").textContent = "";
    api("/parent/status").then(function (j) {
      hasPin = !!j.hasPin;
      $("lockTitle").textContent = hasPin ? "أدخل رمز ولي الأمر" : "أنشئ رمز ولي الأمر";
      $("lockText").textContent = hasPin ? "هذه الصفحة لولي الأمر فقط." : "اختر رمزًا من 6 أرقام أو أكثر. لن يستطيع أحد غيرك رؤية صلوات الأولاد أو إرسال التذكير بدونه.";
      $("pin2").hidden = hasPin;
      $("lockBtn").textContent = hasPin ? "دخول" : "حفظ الرمز";
      $("pin").focus();
    }).catch(function () { $("lockMsg").textContent = "لا يوجد اتصال بالإنترنت."; });
  }
  function submitPin() {
    var pin = $("pin").value.trim();
    if (!/^\d{6,12}$/.test(pin)) { $("lockMsg").textContent = "الرمز يجب أن يكون من 6 إلى 12 رقمًا."; return; }
    if (!hasPin && pin !== $("pin2").value.trim()) { $("lockMsg").textContent = "الرمزان غير متطابقين."; return; }
    $("lockBtn").disabled = true;
    api(hasPin ? "/parent/login" : "/parent/setup", { pin: pin }).then(function (j) {
      $("lockBtn").disabled = false;
      if (j.key) { key = j.key; lsSet("parent-key", key); $("pin").value = ""; $("pin2").value = ""; showDash(); return; }
      $("lockMsg").textContent = j._status === 429 ? "محاولات كثيرة. حاول بعد " + (j.wait || 15) + " دقيقة." :
        j._status === 403 ? "الرمز غير صحيح." : j._status === 409 ? "الرمز موجود مسبقًا، أدخله للدخول." : "تعذّر الدخول، حاول مرة أخرى.";
      if (j._status === 409) showLock();
    }).catch(function () { $("lockBtn").disabled = false; $("lockMsg").textContent = "لا يوجد اتصال بالإنترنت."; });
  }
  $("lockBtn").addEventListener("click", submitPin);
  $("pin").addEventListener("keydown", function (e) { if (e.key === "Enter") { if (hasPin) submitPin(); else $("pin2").focus(); } });
  $("pin2").addEventListener("keydown", function (e) { if (e.key === "Enter") submitPin(); });
  $("logout").addEventListener("click", function () { lsDel("parent-key"); key = null; showLock(); });

  // ---------- dashboard ----------
  function renderPresets() {
    var box = $("presets"); box.textContent = "";
    PRESETS.forEach(function (p, i) {
      var b = el("button", "preset", p.label); b.type = "button"; b.setAttribute("aria-pressed", i === preset ? "true" : "false");
      b.addEventListener("click", function () { preset = i; $("custom").value = ""; renderPresets(); });
      box.appendChild(b);
    });
  }
  function messageText() { return $("custom").value.trim() || PRESETS[preset].text; }
  $("custom").addEventListener("input", function () { if ($("custom").value) { preset = -1; renderPresets(); } else { preset = 0; renderPresets(); } });

  function dayKeys(today, n) {
    var p = today.split("-").map(Number), out = [];
    for (var i = n - 1; i >= 0; i--) { var d = new Date(p[0], p[1] - 1, p[2] - i); out.push({ key: d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(), date: d }); }
    return out;
  }
  function seenText(ms) {
    if (!ms) return "";
    var m = Math.round((Date.now() - ms) / 60000);
    if (m < 2) return "فتح التطبيق الآن";
    if (m < 60) return "آخر نشاط قبل " + m + " دقيقة";
    var h = Math.round(m / 60);
    if (h < 24) return "آخر نشاط قبل " + h + " ساعة";
    return "آخر نشاط قبل " + Math.round(h / 24) + " يوم";
  }
  function fmtTime(ms, tz) {
    try { return new Intl.DateTimeFormat("ar-u-nu-latn", { hour: "numeric", minute: "2-digit", timeZone: tz || undefined }).format(new Date(ms)); }
    catch (e) { var d = new Date(ms); return d.getHours() + ":" + ("0" + d.getMinutes()).slice(-2); }
  }

  function renderKids() {
    var box = $("kids"); box.textContent = "";
    if (!kidsData.length) {
      box.appendChild(el("div", "empty", "أضف أولادك بالاسم من الخانة في الأعلى. سيظهر لكل ولد رمز ربط من 6 أرقام يكتبه في تطبيق «صلاتي» على جواله."));
      $("sendAll").disabled = true;
      return;
    }
    $("sendAll").disabled = false;
    var now = Date.now();
    kidsData.forEach(function (k) {
      var card = el("article", "kid");
      // name, last seen, today's score
      var top = el("div", "kid-top"), who = el("div");
      if (editing === k.id) {
        var ed = el("form", "edit"), inp = el("input"); inp.value = k.name; inp.maxLength = 24; inp.setAttribute("aria-label", "اسم الولد");
        var sv = el("button", "btn primary", "حفظ"); sv.type = "submit";
        ed.appendChild(inp); ed.appendChild(sv);
        ed.addEventListener("submit", function (e) {
          e.preventDefault();
          api("/parent/rename", { id: k.id, name: inp.value }).then(function () { editing = null; load(); toast("تم تغيير الاسم"); });
        });
        who.appendChild(ed);
        setTimeout(function () { inp.focus(); }, 30);
      } else {
        who.appendChild(el("h2", "kid-name", k.name || "بدون اسم"));
        who.appendChild(el("div", "kid-sub", !k.devices ? "لم يُربط أي جهاز بعد" :
          (k.devices === 1 ? "جهاز واحد" : k.devices === 2 ? "جهازان" : k.devices + " أجهزة") + (k.seen ? " · " + seenText(k.seen) : "") + (k.notify ? "" : " · التذكير غير مفعّل")));
      }
      var score = el("div", "score", (k.devices ? k.done.length : "–") + " ");
      score.appendChild(el("small", null, "من 5 اليوم"));
      top.appendChild(who); top.appendChild(score);
      card.appendChild(top);

      // link code: shown until a device is linked, then on demand
      if (!k.devices || showCode[k.id]) {
        var cd = el("div", "code"), cdText = el("div");
        cdText.appendChild(el("span", null, "رمز الربط لـ " + (k.name || "الولد")));
        cdText.appendChild(document.createElement("br"));
        cdText.appendChild(el("b", null, k.code.slice(0, 3) + " " + k.code.slice(3)));
        var tools = el("div", "tools");
        var cp = el("button", "btn", "نسخ"); cp.type = "button";
        cp.addEventListener("click", function () {
          var done = function () { toast("نُسخ الرمز"); };
          if (navigator.clipboard) navigator.clipboard.writeText(k.code).then(done).catch(function () { toast(k.code); }); else toast(k.code);
        });
        var nc = el("button", "btn", "رمز جديد"); nc.type = "button";
        nc.addEventListener("click", function () { api("/parent/newcode", { id: k.id }).then(function () { load(); toast("أُنشئ رمز جديد، والرمز القديم لم يعد يعمل"); }); });
        tools.appendChild(cp); tools.appendChild(nc);
        cd.appendChild(cdText); cd.appendChild(tools);
        card.appendChild(cd);
        if (!k.devices) card.appendChild(el("div", "hint", "على جوال " + (k.name || "الولد") + ": افتح تطبيق «صلاتي»، واكتب هذا الرمز. يمكن ربط أكثر من جهاز بنفس الرمز (جوال وآيباد)."));
      }

      // today's five prayers
      var grid = el("div", "prayers");
      ORDER.forEach(function (p, i) {
        if (!k.times) { var c0 = el("div", "p" + (k.done.indexOf(p) >= 0 ? " done" : "")); c0.appendChild(el("b", null, NAMES[p])); c0.appendChild(el("span", null, k.done.indexOf(p) >= 0 ? "صلّاها ✓" : "—")); grid.appendChild(c0); return; }
        var t = k.times[p], next = i < 4 ? k.times[ORDER[i + 1]] : t + 150 * 60000;
        var st = k.done.indexOf(p) >= 0 ? "done" : now < t ? "wait" : now < next ? "now" : "miss";
        var label = { done: "صلّاها ✓", wait: fmtTime(t, k.tz), now: "الآن", miss: "فاتته" }[st];
        var c = el("div", "p " + st); c.appendChild(el("b", null, NAMES[p])); c.appendChild(el("span", null, label));
        grid.appendChild(c);
      });
      card.appendChild(grid);

      // last 7 days
      var week = el("div", "week");
      dayKeys(k.today, 7).forEach(function (d, i, arr) {
        var n = (k.hist[d.key] || []).length, bar = el("div", "bar" + (i === arr.length - 1 ? " today" : ""));
        var col = el("i", n === 5 ? "full" : null); col.style.height = Math.max(3, n / 5 * 40) + "px";
        bar.title = n + " من 5";
        bar.appendChild(el("span", null, String(n)));
        bar.appendChild(col);
        var lbl = ""; try { lbl = new Intl.DateTimeFormat("ar", { weekday: "short" }).format(d.date); } catch (e) {}
        bar.appendChild(el("span", null, i === arr.length - 1 ? "اليوم" : lbl));
        week.appendChild(bar);
      });
      card.appendChild(week);

      // actions
      var acts = el("div", "kid-actions");
      var nudge = el("button", "btn primary", "📣 ذكّره بالصلاة"); nudge.type = "button";
      nudge.addEventListener("click", function () { send([k.id], nudge); });
      if (!k.notify) nudge.disabled = true;
      var ren = el("button", "btn", "تغيير الاسم"); ren.type = "button";
      ren.addEventListener("click", function () { editing = editing === k.id ? null : k.id; renderKids(); });
      var sc = el("button", "btn", showCode[k.id] ? "إخفاء الرمز" : "رمز الربط"); sc.type = "button";
      sc.addEventListener("click", function () { showCode[k.id] = !showCode[k.id]; renderKids(); });
      var rm = el("button", "link", "حذف " + (k.name || "الولد")); rm.type = "button";
      rm.addEventListener("click", function () {
        if (rm.dataset.sure) { api("/parent/removekid", { id: k.id }).then(function () { load(); toast("حُذف " + (k.name || "الولد") + " وتوقفت تذكيراته"); }); }
        else { rm.dataset.sure = "1"; rm.textContent = "اضغط مرة أخرى لحذف " + (k.name || "الولد"); setTimeout(function () { delete rm.dataset.sure; rm.textContent = "حذف " + (k.name || "الولد"); }, 4000); }
      });
      acts.appendChild(nudge); if (k.devices) acts.appendChild(sc); acts.appendChild(ren); acts.appendChild(rm);
      card.appendChild(acts);
      box.appendChild(card);
    });
  }

  function renderLoose() {
    var box = $("looseList"); box.textContent = "";
    $("loose").hidden = !looseData.length;
    looseData.forEach(function (d) {
      var row = el("div", "dev");
      row.appendChild(el("b", null, (d.name ? "جهاز باسم «" + d.name + "»" : "جهاز بدون اسم") + (d.seen ? " · " + seenText(d.seen) : "")));
      if (d.canLink && kidsData.length) {
        var sel = el("select"); sel.setAttribute("aria-label", "اربطه بـ");
        kidsData.forEach(function (k) { var o = el("option", null, k.name); o.value = k.id; sel.appendChild(o); });
        var lk = el("button", "btn primary", "ربط"); lk.type = "button";
        lk.addEventListener("click", function () { api("/parent/link", { device: d.id, kidId: sel.value }).then(function (j) { load(); toast(j.ok ? "تم الربط" : "تعذّر الربط"); }); });
        row.appendChild(sel); row.appendChild(lk);
      } else if (!d.canLink) {
        row.appendChild(el("span", "kid-sub", "يحتاج فتح التطبيق مرة ليتحدّث"));
      }
      var del = el("button", "link", "حذف"); del.type = "button";
      del.addEventListener("click", function () { api("/parent/remove", { id: d.id }).then(function () { load(); toast("حُذف الجهاز"); }); });
      row.appendChild(del);
      box.appendChild(row);
    });
  }
  $("addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("addName").value.trim();
    if (!name) { $("addName").focus(); return; }
    api("/parent/addkid", { name: name }).then(function (j) {
      if (j.code) { $("addName").value = ""; showCode[j.id] = true; load(); toast("أُضيف " + name + ". رمزه: " + j.code); }
      else toast("تعذّرت الإضافة");
    });
  });

  function send(ids, btn) {
    btn.disabled = true;
    api("/parent/nudge", { ids: ids, text: messageText() }).then(function (j) {
      btn.disabled = false;
      if (j._status === 401) { lsDel("parent-key"); key = null; showLock(); return; }
      toast(j.sent ? (j.sent === 1 ? "أُرسل التذكير" : "أُرسل إلى " + j.sent + " أجهزة") : "لم يصل التذكير؛ تأكد أن التذكير مفعّل في تطبيق الولد");
    }).catch(function () { btn.disabled = false; toast("لا يوجد اتصال بالإنترنت"); });
  }
  $("sendAll").addEventListener("click", function () { send("all", $("sendAll")); });

  function load() {
    return api("/parent/kids").then(function (j) {
      if (j._status === 401) { lsDel("parent-key"); key = null; showLock(); return; }
      kidsData = (j.kids || []).sort(function (a, b) { return (a.name || "").localeCompare(b.name || "", "ar"); });
      looseData = j.devices || [];
      if (editing === null) { renderKids(); renderLoose(); }
    }).catch(function () { toast("لا يوجد اتصال بالإنترنت"); });
  }
  function showDash() {
    $("lock").hidden = true; $("dash").hidden = false; $("refresh").hidden = false;
    renderPresets(); load();
  }
  $("refresh").addEventListener("click", function () { load().then(function () { toast("تم التحديث"); }); });
  setInterval(function () { if (key && !$("dash").hidden && document.visibilityState === "visible" && editing === null) load(); }, 60000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && key && !$("dash").hidden) load(); });

  if (key) showDash(); else showLock();
})();
