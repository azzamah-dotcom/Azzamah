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

  var key = lsGet("parent-key"), hasPin = true, preset = 0, kidsData = [], looseData = [], editing = null, showCode = {}, showShare = {};

  function api(path, body) {
    var opt = { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" } };
    if (key) opt.headers["X-Parent-Key"] = key;
    if (body) opt.body = JSON.stringify(body);
    return fetch(API + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    });
  }

  // ---------- parent account: log in or create one ----------
  var mode = "login";
  function setMode(m) {
    mode = m;
    $("tabLogin").setAttribute("aria-selected", m === "login" ? "true" : "false");
    $("tabSignup").setAttribute("aria-selected", m === "signup" ? "true" : "false");
    $("titleWrap").hidden = m !== "signup";
    $("pin2Wrap").hidden = m !== "signup";
    $("lockBtn").textContent = m === "login" ? "دخول" : "إنشاء الحساب";
    $("lockText").textContent = m === "login" ? "لكل ولي أمر حسابه الخاص، ويرى أولاده فقط." : "أنشئ حسابك لتضيف أولادك وتتابع صلواتهم. لن يرى أحد غيرك أولادك.";
    $("pin").setAttribute("autocomplete", m === "login" ? "current-password" : "new-password");
    $("lockMsg").textContent = "";
  }
  $("tabLogin").addEventListener("click", function () { setMode("login"); });
  $("tabSignup").addEventListener("click", function () { setMode("signup"); });
  function showLock() {
    $("dash").hidden = true; $("refresh").hidden = true; $("lock").hidden = false;
    $("hello").textContent = "صلوات الأولاد اليوم وتذكيرهم بالصلاة";
    setMode(mode);
    $("pName").value = lsGet("parent-name") || "";
    ($("pName").value ? $("pin") : $("pName")).focus();
  }
  function submitPin() {
    var name = $("pName").value.trim(), pin = $("pin").value.trim();
    if (!name) { $("lockMsg").textContent = "اكتب اسمك."; $("pName").focus(); return; }
    if (!/^\d{6,12}$/.test(pin)) { $("lockMsg").textContent = "الرمز يجب أن يكون من 6 إلى 12 رقمًا."; return; }
    if (mode === "signup" && pin !== $("pin2").value.trim()) { $("lockMsg").textContent = "الرمزان غير متطابقين."; return; }
    $("lockBtn").disabled = true;
    var body = mode === "signup" ? { name: name, pin: pin, title: $("pTitle").value } : { name: name, pin: pin };
    api(mode === "signup" ? "/parent/signup" : "/parent/login", body).then(function (j) {
      $("lockBtn").disabled = false;
      if (j.key) {
        key = j.key; lsSet("parent-key", key); lsSet("parent-name", j.name || name);
        $("pin").value = ""; $("pin2").value = "";
        showDash(); return;
      }
      $("lockMsg").textContent = j._status === 429 ? "محاولات كثيرة. حاول بعد " + (j.wait || 15) + " دقيقة." :
        j._status === 409 ? "هذا الاسم مستخدم. اختر اسمًا آخر، أو ادخل من «دخول» إن كان حسابك." :
        j._status === 403 ? "الاسم أو الرمز غير صحيح." :
        j._status === 401 ? "خادم الإشعارات يعمل بنسخة قديمة. حدّث كوده على Cloudflare ثم حاول مرة أخرى." : "تعذّر الدخول، حاول مرة أخرى.";
    }).catch(function () { $("lockBtn").disabled = false; $("lockMsg").textContent = "لا يوجد اتصال بالإنترنت."; });
  }
  $("lockBtn").addEventListener("click", submitPin);
  ["pName", "pin", "pin2"].forEach(function (id) { $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") submitPin(); }); });
  $("logout").addEventListener("click", function () { lsDel("parent-key"); key = null; mode = "login"; showLock(); });
  var myTitle = "بابا";
  $("titleBtn").addEventListener("click", function () {
    var opts = ["بابا", "ماما", "جدو", "تيتا", "عمو", "خالة"], next = opts[(opts.indexOf(myTitle) + 1) % opts.length];
    api("/parent/title", { title: next }).then(function (j) { if (j.title) { myTitle = j.title; showHello(); toast("تصل رسائلك الآن باسم «" + myTitle + "»"); } });
  });
  function showHello() {
    $("hello").textContent = "مرحبًا " + (lsGet("parent-name") || "") + " · رسائلك تصل باسم «" + myTitle + "»";
    $("sendAll").textContent = "📣 أرسل لكل أولادي";
  }

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
      if (k.devices && !k.notify) card.appendChild(el("div", "hint", "جهاز " + (k.name || "الولد") + " مربوط، لكن التذكير غير مفعّل عليه، فلن تصله التنبيهات ولا رسائلك. على جواله: افتح «صلاتي» واتبع الرسالة البرتقالية في الأعلى (إضافة التطبيق إلى الشاشة الرئيسية، أو السماح بالإشعارات أو الموقع)."));

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
      var sh = el("button", "btn", showShare[k.id] ? "إخفاء" : "📤 أرسل التطبيق"); sh.type = "button";
      sh.addEventListener("click", function () { showShare[k.id] = !showShare[k.id]; renderKids(); });
      acts.appendChild(nudge); acts.appendChild(sh); if (k.devices) acts.appendChild(sc); acts.appendChild(ren); acts.appendChild(rm);
      card.appendChild(acts);
      if (showShare[k.id]) card.appendChild(sharePanel(k));
      box.appendChild(card);
    });
  }

  // ---------- send the kids app (with this child's link code) to the child's phone ----------
  var KIDS_URL = "https://azzamah-dotcom.github.io/Azzamah/kids/";
  function shareText(k) {
    var nm = k.name || "يا بطل", link = KIDS_URL + "?code=" + k.code;
    return "السلام عليكم يا " + nm + " 🌟\n" +
      "هذا تطبيق «صلاتي» لتسجيل صلواتك وتذكيرك بها:\n" + link + "\n\n" +
      "رمز الربط: " + k.code + "\n\n" +
      "1) افتح الرابط (في Safari على الآيفون، أو Chrome على الأندرويد)\n" +
      "2) أضفه إلى الشاشة الرئيسية: زر المشاركة ثم «إضافة إلى الشاشة الرئيسية»\n" +
      "3) افتح «صلاتي» من الأيقونة، واكتب الرمز إن طُلب منك، واضغط «تفعيل» للتذكير";
  }
  function sharePanel(k) {
    var text = shareText(k), box = el("div", "share");
    box.appendChild(el("b", null, "أرسل تطبيق «صلاتي» إلى جوال " + (k.name || "الولد")));
    var pre = el("p", "share-text", text); box.appendChild(pre);
    var row = el("div", "share-btns");
    var wa = el("a", "btn wa", "واتساب"); wa.href = "https://wa.me/?text=" + encodeURIComponent(text); wa.target = "_blank"; wa.rel = "noopener";
    var sms = el("a", "btn", "رسالة SMS"); sms.href = "sms:?&body=" + encodeURIComponent(text);
    row.appendChild(wa); row.appendChild(sms);
    if (navigator.share) {
      var more = el("button", "btn", "مشاركة…"); more.type = "button";
      more.addEventListener("click", function () { navigator.share({ title: "تطبيق صلاتي", text: text }).catch(function () {}); });
      row.appendChild(more);
    }
    var cp = el("button", "btn", "نسخ"); cp.type = "button";
    cp.addEventListener("click", function () {
      var ok = function () { toast("نُسخت الرسالة، الصقها في أي محادثة"); };
      var fallback = function () { var r = document.createRange(); r.selectNodeContents(pre); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("حدّد النص وانسخه"); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(ok).catch(fallback); else fallback();
    });
    row.appendChild(cp);
    box.appendChild(row);
    return box;
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
    api("/parent/me").then(function (j) {
      if (j._status !== 200) return;
      myTitle = j.title || "بابا";
      if (j.name) { lsSet("parent-name", j.name); showHello(); }
      else $("hello").textContent = "حسابك بدون اسم بعد: اضغط «خروج من هذا الجهاز» في الأسفل، ثم ادخل باسمك ورمزك نفسه.";
    }).catch(function () {});
  }
  $("refresh").addEventListener("click", function () { load().then(function () { toast("تم التحديث"); }); });
  setInterval(function () { if (key && !$("dash").hidden && document.visibilityState === "visible" && editing === null) load(); }, 60000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && key && !$("dash").hidden) load(); });

  if (key) showDash(); else showLock();
})();
