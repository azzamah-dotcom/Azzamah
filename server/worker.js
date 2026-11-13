// حصن الأذكار — notification server (Cloudflare Worker).
// Sends the adhan, iqama, "did you pray?" and adhkar reminders to each subscribed phone at the
// right time for its location, using standard Web Push. No keys to configure: the server makes
// its own VAPID keys on first use and keeps them, with the subscriber list, in the SUBS KV store.
//
// Needs: a KV namespace bound as SUBS, and a Cron Trigger "* * * * *" (every minute).

// Prayer time calculation (astronomical formulas in the style of PrayTimes.org), fully offline.
(function (root) {
  "use strict";
  var DR = Math.PI / 180;
  function dsin(d) { return Math.sin(d * DR); }
  function dcos(d) { return Math.cos(d * DR); }
  function dtan(d) { return Math.tan(d * DR); }
  function darcsin(x) { return Math.asin(x) / DR; }
  function darccos(x) { return Math.acos(x) / DR; }
  function darctan2(y, x) { return Math.atan2(y, x) / DR; }
  function darccot(x) { return Math.atan(1 / x) / DR; }
  function fix(a, b) { a = a - b * Math.floor(a / b); return a < 0 ? a + b : a; }
  function fixHour(h) { return fix(h, 24); }
  function timeDiff(a, b) { return fixHour(b - a); }

  // fajr/isha: sun angle below the horizon; ishaMin: fixed minutes after Maghrib.
  var METHODS = {
    mwl:     { name: "رابطة العالم الإسلامي", fajr: 18, isha: 17 },
    makkah:  { name: "أم القرى (مكة المكرمة)", fajr: 18.5, ishaMin: 90 },
    jordan:  { name: "وزارة الأوقاف الأردنية", fajr: 18, isha: 18 },
    egypt:   { name: "الهيئة المصرية العامة للمساحة", fajr: 19.5, isha: 17.5 },
    gulf:    { name: "منطقة الخليج", fajr: 19.5, ishaMin: 90 },
    kuwait:  { name: "الكويت", fajr: 18, isha: 17.5 },
    qatar:   { name: "قطر", fajr: 18, ishaMin: 90 },
    dubai:   { name: "الإمارات", fajr: 18.2, isha: 18.2 },
    karachi: { name: "جامعة العلوم الإسلامية، كراتشي", fajr: 18, isha: 18 },
    isna:    { name: "الجمعية الإسلامية لأمريكا الشمالية", fajr: 15, isha: 15 },
    morocco: { name: "المغرب", fajr: 19, isha: 17 },
    algeria: { name: "الجزائر", fajr: 18, isha: 17 },
    tunisia: { name: "تونس", fajr: 18, isha: 18 },
    turkey:  { name: "رئاسة الشؤون الدينية التركية", fajr: 18, isha: 17 }
  };
  var COUNTRY = {
    SA: "makkah", YE: "makkah", JO: "jordan", EG: "egypt", SD: "egypt", LY: "egypt",
    AE: "dubai", KW: "kuwait", QA: "qatar", BH: "gulf", OM: "gulf",
    PK: "karachi", IN: "karachi", BD: "karachi", AF: "karachi",
    US: "isna", CA: "isna", MA: "morocco", DZ: "algeria", TN: "tunisia", TR: "turkey"
  };
  var HANAFI = { PK: 1, IN: 1, BD: 1, AF: 1 };

  function julian(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  }

  function isRamadan(date) {
    try { return new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { month: "numeric" }).format(date) === "9"; }
    catch (e) { return false; }
  }

  // Times (as UTC milliseconds) for the calendar day y-mo-d in a place whose UTC offset is tz hours.
  function computeFor(y, mo, d, tz, lat, lng, methodKey, hanafi) {
    var m = METHODS[methodKey] || METHODS.mwl;
    var date = new Date(Date.UTC(y, mo, d, 12));
    var jd = julian(y, mo + 1, d) - lng / (15 * 24);
    var asrF = hanafi ? 2 : 1;

    function sunPos(j) {
      var D = j - 2451545.0;
      var g = fix(357.529 + 0.98560028 * D, 360);
      var q = fix(280.459 + 0.98564736 * D, 360);
      var L = fix(q + 1.915 * dsin(g) + 0.020 * dsin(2 * g), 360);
      var e = 23.439 - 0.00000036 * D;
      var RA = darctan2(dcos(e) * dsin(L), dcos(L)) / 15;
      return { decl: darcsin(dsin(e) * dsin(L)), eqt: q / 15 - fixHour(RA) };
    }
    function midDay(t) { return fixHour(12 - sunPos(jd + t).eqt); }
    function angleTime(angle, t, before) {
      var decl = sunPos(jd + t).decl, noon = midDay(t);
      var v = 1 / 15 * darccos((-dsin(angle) - dsin(decl) * dsin(lat)) / (dcos(decl) * dcos(lat)));
      return noon + (before ? -v : v);
    }
    function asrTime(t) {
      var decl = sunPos(jd + t).decl;
      return angleTime(-darccot(asrF + dtan(Math.abs(lat - decl))), t);
    }

    var t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
    for (var i = 0; i < 2; i++) {
      t = {
        fajr: angleTime(m.fajr, t.fajr / 24, true),
        sunrise: angleTime(0.833, t.sunrise / 24, true),
        dhuhr: midDay(t.dhuhr / 24),
        asr: asrTime(t.asr / 24),
        sunset: angleTime(0.833, t.sunset / 24),
        isha: m.ishaMin ? 18 : angleTime(m.isha, t.isha / 24)
      };
    }
    var shift = tz - lng / 15;
    for (var k in t) t[k] += shift;
    t.maghrib = t.sunset;

    // High latitudes: when twilight never ends, use a share of the night based on the angle.
    var night = timeDiff(t.sunset, t.sunrise);
    var fp = m.fajr / 60 * night;
    if (isNaN(t.fajr) || timeDiff(t.fajr, t.sunrise) > fp) t.fajr = t.sunrise - fp;
    if (m.ishaMin) t.isha = t.maghrib + (m.ishaMin + (methodKey === "makkah" && isRamadan(date) ? 30 : 0)) / 60;
    else {
      var ip = m.isha / 60 * night;
      if (isNaN(t.isha) || timeDiff(t.sunset, t.isha) > ip) t.isha = t.sunset + ip;
    }

    var base = Date.UTC(y, mo, d) - tz * 3600000, out = {};
    ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"].forEach(function (k) {
      out[k] = base + Math.round(t[k] * 60) * 60000;
    });
    return out;
  }

  // Date objects for the given day in the phone's own timezone.
  function compute(date, lat, lng, methodKey, hanafi) {
    var y = date.getFullYear(), mo = date.getMonth(), d = date.getDate();
    var tz = -new Date(y, mo, d, 12).getTimezoneOffset() / 60;
    var ms = computeFor(y, mo, d, tz, lat, lng, methodKey, hanafi), out = {};
    for (var k in ms) out[k] = new Date(ms[k]);
    return out;
  }

  root.PrayerCalc = { compute: compute, computeFor: computeFor, METHODS: METHODS, COUNTRY: COUNTRY, HANAFI: HANAFI };
  if (typeof module !== "undefined") module.exports = root.PrayerCalc;
})(typeof window !== "undefined" ? window : globalThis);


const PC = globalThis.PrayerCalc;
const APP_URL = "https://azzamah-dotcom.github.io/Azzamah/";
const PNAMES = { fajr: "الفجر", dhuhr: "الظهر", asr: "العصر", maghrib: "المغرب", isha: "العشاء" };
const NDEF = { adhan: true, iqama: true, after: true, adhkar: true, iq: { fajr: 20, dhuhr: 15, asr: 15, maghrib: 10, isha: 15 } };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Parent-Key"
};
function json(data, status) {
  return new Response(JSON.stringify(data), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json" }, CORS) });
}

// ---------- base64url helpers ----------
function b64u(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64u(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
function concat() {
  let len = 0;
  for (const a of arguments) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arguments) { out.set(a, o); o += a.length; }
  return out;
}
const enc = new TextEncoder();

// ---------- VAPID keys (made once, stored in KV) ----------
async function getVapid(env) {
  const saved = await env.SUBS.get("vapid", "json");
  if (saved) return saved;
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const v = { jwk: jwk, pub: b64u(pub) };
  await env.SUBS.put("vapid", JSON.stringify(v));
  return v;
}
async function vapidHeader(vapid, endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: APP_URL })));
  const key = await crypto.subtle.importKey("jwk", vapid.jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(header + "." + claims)));
  return "vapid t=" + header + "." + claims + "." + b64u(sig) + ", k=" + vapid.pub;
}

// ---------- Web Push payload encryption (RFC 8291, aes128gcm) ----------
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt, info: info }, key, bytes * 8));
}
async function encryptPayload(sub, payload) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}
async function sendPush(vapid, sub, data) {
  const body = await encryptPayload(sub, JSON.stringify(data));
  return fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": "900",
      "Urgency": "high",
      "Authorization": await vapidHeader(vapid, sub.endpoint)
    },
    body: body
  });
}


// ---------- kids: history, names, and the parent dashboard ----------
function cleanDone(list) { return (list || []).filter(function (k) { return PNAMES[k]; }).filter(function (k, i, a) { return a.indexOf(k) === i; }); }
function cleanDevice(d) { d = String(d || ""); return /^[A-Za-z0-9_-]{16,64}$/.test(d) ? d : ""; }
function newCode(profiles) {
  let c;
  do { c = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0"); }
  while (profiles.some(function (p) { return p.code === c; }));
  return c;
}
function cleanName(n) { return String(n || "").replace(/[<>]/g, "").trim().slice(0, 24); }
function setHist(s, day, done) {
  s.hist = s.hist || {};
  s.hist[day] = done;
  const keys = Object.keys(s.hist).sort(function (a, b) { return Date.parse(b) - Date.parse(a); });
  keys.slice(14).forEach(function (k) { delete s.hist[k]; });
}
async function kidId(endpoint) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(endpoint)));
  return b64u(h).slice(0, 12);
}
async function pinHash(pin, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  return b64u(new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64u(salt), iterations: 5000 }, key, 256)));
}
function sameStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
// Parent accounts: each parent has a name, what their kids call them, a passcode, and their own kids.
function normName(n) { return String(n || "").replace(/\s+/g, " ").trim().toLowerCase(); }
async function loadParents(env) {
  let parents = await env.SUBS.get("parents", "json");
  if (parents) return parents;
  // First run after the update: the single passcode from before becomes the first account,
  // and every child added so far belongs to it.
  parents = [];
  const old = await env.SUBS.get("parent", "json");
  if (old && old.hash) {
    const id = b64u(crypto.getRandomValues(new Uint8Array(9)));
    parents.push({ id: id, name: "", title: "بابا", salt: old.salt, hash: old.hash, key: old.key, fails: 0, lockUntil: 0, legacy: true, created: Date.now() });
    const profiles = (await env.SUBS.get("kids", "json")) || [];
    profiles.forEach(function (p) { if (!p.parentId) p.parentId = id; });
    await env.SUBS.put("kids", JSON.stringify(profiles));
  }
  await env.SUBS.put("parents", JSON.stringify(parents));
  return parents;
}
async function getParent(request, env) {
  const key = request.headers.get("X-Parent-Key") || "";
  if (!key) return null;
  const parents = await loadParents(env);
  return parents.find(function (p) { return p.key && sameStr(key, p.key); }) || null;
}
function cleanTitle(t) { t = String(t || "").replace(/[<>]/g, "").trim().slice(0, 16); return t || "بابا"; }
// The prayer a child should be praying now (the latest one whose time has come today).
function currentPrayer(s, nowMs) {
  const day = localDay(s.tz || "UTC", nowMs);
  const tz = tzOffsetHours(s.tz, Date.UTC(day.y, day.m, day.d, 12));
  const t = PC.computeFor(day.y, day.m, day.d, tz, s.lat, s.lon, s.method || "mwl", !!s.hanafi);
  let cur = null;
  for (const k of ["fajr", "dhuhr", "asr", "maghrib", "isha"]) if (t[k] <= nowMs) cur = k;
  const id = day.y + "-" + (day.m + 1) + "-" + day.d;
  return { key: cur, day: id, fri: day.wd === 5, times: t };
}

// ---------- prayer reminders for one subscriber ----------
function tzOffsetHours(timeZone, utcMs) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" }).formatToParts(new Date(utcMs));
    const g = {};
    for (const p of parts) g[p.type] = +p.value;
    return (Date.UTC(g.year, g.month - 1, g.day, g.hour, g.minute) - Math.floor(utcMs / 60000) * 60000) / 3600000;
  } catch (e) { return 0; }
}
function localDay(timeZone, utcMs) {
  const off = tzOffsetHours(timeZone, utcMs);
  const d = new Date(utcMs + off * 3600000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), wd: d.getUTCDay() };
}
// Kids app: a reminder at the adhan and every 30 minutes after it, until the child marks the
// prayer as prayed or the next prayer comes in.
const KID_NUDGES = ["صلاتك نور ⭐ لا تؤخّرها", "الله يحب من يصلي على الوقت 💚", "قم الآن وتوضأ وصلِّ، ثم سجّل نجمتك ⭐", "أنت بطل، والبطل لا ينسى صلاته 🌟"];
function kidEventsFor(s, day, prof) {
  const tz = tzOffsetHours(s.tz, Date.UTC(day.y, day.m, day.d, 12));
  const t = PC.computeFor(day.y, day.m, day.d, tz, s.lat, s.lon, s.method || "mwl", !!s.hanafi);
  const id = day.y + "-" + (day.m + 1) + "-" + day.d;
  const done = prof ? ((prof.hist || {})[id] || []) : (s.marks && s.marks.day === id ? s.marks.done || [] : []);
  const fri = day.wd === 5;
  const ends = { fajr: t.sunrise, dhuhr: t.asr, asr: t.maghrib, maghrib: t.isha, isha: t.isha + 150 * 60000 };
  const ev = [];
  for (const k of ["fajr", "dhuhr", "asr", "maghrib", "isha"]) {
    if (done.indexOf(k) >= 0) continue;
    const name = k === "dhuhr" && fri ? "الجمعة" : PNAMES[k];
    for (let at = t[k], i = 0; at < ends[k] - 60000; at += 30 * 60000, i++) {
      ev.push(i === 0
        ? { tag: id + k + "k", at: at, title: "🕌 حان وقت صلاة " + name, body: "قم توضأ وصلِّ، ثم اضغط «صليت» واربح نجمة ⭐", url: "" }
        : { tag: id + k + "k", at: at, title: "هل صليت " + name + "؟ 🤔", body: KID_NUDGES[(i - 1) % KID_NUDGES.length], url: "" });
    }
  }
  return ev;
}

function eventsFor(s, day, prof) {
  if (s.mode === "kids") return kidEventsFor(s, day, prof);
  const n = Object.assign({}, NDEF, s.n || {});
  n.iq = Object.assign({}, NDEF.iq, (s.n && s.n.iq) || {});
  const tz = tzOffsetHours(s.tz, Date.UTC(day.y, day.m, day.d, 12));
  const t = PC.computeFor(day.y, day.m, day.d, tz, s.lat, s.lon, s.method || "mwl", !!s.hanafi);
  const id = day.y + "-" + (day.m + 1) + "-" + day.d;
  const fri = day.wd === 5;
  const where = s.city ? " حسب توقيت " + String(s.city).split("،")[0] : "";
  const ev = [];
  for (const k of ["fajr", "dhuhr", "asr", "maghrib", "isha"]) {
    const name = k === "dhuhr" && fri ? "الجمعة" : PNAMES[k];
    if (n.adhan) ev.push({ tag: id + k + "a", at: t[k], title: "🕌 أذان " + name, body: "حان الآن موعد صلاة " + name + where + ".", url: "#times" });
    if (n.iqama && !(k === "dhuhr" && fri)) ev.push({ tag: id + k + "i", at: t[k] + (n.iq[k] || 0) * 60000, title: "إقامة صلاة " + name, body: "حان موعد الإقامة تقريبًا، أدرك صلاة الجماعة.", url: "#times" });
    if (n.after) ev.push({ tag: id + k + "h", at: t[k] + 3600000, title: "هل صليت " + name + "؟", body: "مضت ساعة على أذان " + name + ". «أحب الأعمال إلى الله: الصلاة على وقتها».", url: "#times" });
  }
  if (n.adhkar) {
    ev.push({ tag: id + "am", at: t.fajr + 40 * 60000, title: "☀️ أذكار الصباح", body: "حان وقت أذكار الصباح، اغتنمها قبل أن يشغلك يومك.", url: "#morning" });
    ev.push({ tag: id + "pm", at: t.asr + 30 * 60000, title: "🌙 أذكار المساء", body: "حان وقت أذكار المساء قبل غروب الشمس.", url: "#evening" });
    ev.push({ tag: id + "sl", at: t.isha + 150 * 60000, title: "أذكار النوم", body: "لا تنسَ أذكار النوم قبل أن تنام.", url: "#sleep" });
    if (fri) ev.push({ tag: id + "fr", at: t.sunrise + 90 * 60000, title: "🕌 اليوم الجمعة", body: "سورة الكهف، والإكثار من الصلاة على النبي ﷺ، والتبكير إلى الصلاة، وساعة الإجابة آخر ساعة بعد العصر.", url: "#friday" });
  }
  return ev;
}

async function runMinute(env, nowMs) {
  const minute = Math.floor(nowMs / 60000);
  const subs = (await env.SUBS.get("subs", "json")) || [];
  if (!subs.length) return { sent: 0 };
  const vapid = await getVapid(env);
  const profiles = (await env.SUBS.get("kids", "json")) || [];
  const dead = [];
  let sent = 0;
  for (const s of subs) {
    if (typeof s.lat !== "number" || typeof s.lon !== "number") continue;
    const prof = s.kidId ? profiles.find(function (p) { return p.id === s.kidId; }) : null;
    // Today and yesterday (a reminder after Isha can fall after midnight).
    const due = [];
    for (const back of [0, 1]) {
      const day = localDay(s.tz || "UTC", nowMs - back * 86400000);
      for (const e of eventsFor(s, day, prof)) if (Math.floor(e.at / 60000) === minute) due.push(e);
    }
    for (const e of due) {
      try {
        const r = await sendPush(vapid, s.sub, { title: e.title, body: e.body, tag: e.tag, url: (s.mode === "kids" ? APP_URL + "kids/" : APP_URL) + e.url });
        if (r.status === 404 || r.status === 410) { dead.push(s.sub.endpoint); break; }
        if (r.ok) sent++;
      } catch (err) { /* try again next time */ }
    }
  }
  if (dead.length) {
    const keep = subs.filter(function (s) { return dead.indexOf(s.sub.endpoint) < 0; });
    await env.SUBS.put("subs", JSON.stringify(keep));
  }
  return { sent: sent, removed: dead.length };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!env.SUBS) return json({ error: "KV namespace SUBS is not bound to this Worker" }, 500);

    if (url.pathname === "/vapid") {
      const v = await getVapid(env);
      return json({ key: v.pub });
    }
    if (url.pathname === "/status") {
      const subs = (await env.SUBS.get("subs", "json")) || [];
      return json({ ok: true, subscribers: subs.length });
    }
    if (url.pathname === "/subscribe" && request.method === "POST") {
      let b;
      try { b = await request.json(); } catch (e) { return json({ error: "bad json" }, 400); }
      if (!b || !b.sub || !b.sub.endpoint || !b.sub.keys || !b.sub.keys.p256dh || !b.sub.keys.auth) return json({ error: "missing subscription" }, 400);
      if (!/^https:\/\//.test(b.sub.endpoint)) return json({ error: "bad endpoint" }, 400);
      const rec = {
        sub: { endpoint: b.sub.endpoint, keys: { p256dh: b.sub.keys.p256dh, auth: b.sub.keys.auth } },
        lat: Number(b.lat), lon: Number(b.lon), tz: String(b.tz || "UTC").slice(0, 64),
        method: PC.METHODS[b.method] ? b.method : "mwl", hanafi: !!b.hanafi,
        city: String(b.city || "").slice(0, 80), n: b.n || {}, updated: Date.now(),
        mode: b.mode === "kids" ? "kids" : "full"
      };
      if (rec.mode === "kids") {
        rec.name = cleanName(b.name); rec.seen = Date.now(); rec.device = cleanDevice(b.device);
        const profiles = (await env.SUBS.get("kids", "json")) || [];
        const prof = rec.device ? profiles.find(function (p) { return (p.devices || []).indexOf(rec.device) >= 0; }) : null;
        rec.kidId = prof ? prof.id : null;
      }
      if (!isFinite(rec.lat) || !isFinite(rec.lon)) return json({ error: "missing location" }, 400);
      const all = (await env.SUBS.get("subs", "json")) || [];
      const prev = all.find(function (s) { return s.sub.endpoint === rec.sub.endpoint; });
      if (b.marks && typeof b.marks.day === "string") rec.marks = { day: b.marks.day.slice(0, 12), done: cleanDone(b.marks.done) };
      else if (prev && prev.marks) rec.marks = prev.marks;
      if (prev && prev.hist) rec.hist = prev.hist;
      if (rec.mode === "kids" && rec.marks) setHist(rec, rec.marks.day, rec.marks.done);
      const subs = all.filter(function (s) { return s.sub.endpoint !== rec.sub.endpoint; });
      subs.push(rec);
      await env.SUBS.put("subs", JSON.stringify(subs.slice(-500)));
      return json({ ok: true });
    }
    // ---------- kids app ----------
    // Which prayers were prayed today (stops that prayer's reminders and shows in the dashboard).
    if (url.pathname === "/mark" && request.method === "POST") {
      let b = {};
      try { b = await request.json(); } catch (e) { return json({ error: "bad json" }, 400); }
      const day = String(b.day || "").slice(0, 12), done = cleanDone(b.done), device = cleanDevice(b.device);
      const profiles = (await env.SUBS.get("kids", "json")) || [];
      const prof = device ? profiles.find(function (p) { return (p.devices || []).indexOf(device) >= 0; }) : null;
      if (prof) {
        setHist(prof, day, done);
        prof.seen = Date.now();
        if (isFinite(Number(b.lat)) && isFinite(Number(b.lon)) && b.lat != null) {
          prof.loc = { lat: Number(b.lat), lon: Number(b.lon), tz: String(b.tz || "UTC").slice(0, 64), method: PC.METHODS[b.method] ? b.method : "mwl", hanafi: !!b.hanafi };
        }
        await env.SUBS.put("kids", JSON.stringify(profiles));
        return json({ ok: true, linked: true });
      }
      // Not linked yet: keep today's marks on the device's subscription so its reminders still stop.
      const subs = (await env.SUBS.get("subs", "json")) || [];
      const s = subs.find(function (x) { return x.sub.endpoint === b.endpoint || (device && x.device === device); });
      if (!s) return json({ ok: true, linked: false });
      s.marks = { day: day, done: done };
      s.seen = Date.now();
      await env.SUBS.put("subs", JSON.stringify(subs));
      return json({ ok: true, linked: false });
    }
    // Which child this device belongs to, with their name and recent history.
    if (url.pathname === "/kid/info" && request.method === "POST") {
      let b = {};
      try { b = await request.json(); } catch (e) {}
      const device = cleanDevice(b.device);
      const prof = device ? ((await env.SUBS.get("kids", "json")) || []).find(function (p) { return (p.devices || []).indexOf(device) >= 0; }) : null;
      return json(prof ? { linked: true, name: prof.name, hist: prof.hist || {} } : { linked: false });
    }
    // Link this device to a child using the 6-digit code from the parent dashboard.
    if (url.pathname === "/kid/link" && request.method === "POST") {
      let b = {};
      try { b = await request.json(); } catch (e) {}
      const device = cleanDevice(b.device), code = String(b.code || "").replace(/\D/g, "");
      if (!device) return json({ error: "missing device" }, 400);
      const lock = (await env.SUBS.get("linklock", "json")) || { fails: 0, lockUntil: 0 };
      if (lock.lockUntil && Date.now() < lock.lockUntil) return json({ error: "locked", wait: Math.ceil((lock.lockUntil - Date.now()) / 60000) }, 429);
      const profiles = (await env.SUBS.get("kids", "json")) || [];
      const prof = code.length === 6 ? profiles.find(function (p) { return p.code === code; }) : null;
      if (!prof) {
        lock.fails = (lock.fails || 0) + 1;
        if (lock.fails >= 10) { lock.lockUntil = Date.now() + 15 * 60000; lock.fails = 0; }
        await env.SUBS.put("linklock", JSON.stringify(lock));
        return json({ error: "wrong code" }, 404);
      }
      if (lock.fails) await env.SUBS.put("linklock", JSON.stringify({ fails: 0, lockUntil: 0 }));
      profiles.forEach(function (p) { p.devices = (p.devices || []).filter(function (d) { return d !== device; }); });
      prof.devices.push(device);
      prof.seen = Date.now();
      // Bring over anything this device recorded before it was linked.
      if (b.marks && typeof b.marks.day === "string") {
        const merged = cleanDone(((prof.hist || {})[b.marks.day] || []).concat(b.marks.done || []));
        setHist(prof, b.marks.day.slice(0, 12), merged);
      }
      await env.SUBS.put("kids", JSON.stringify(profiles));
      const subs = (await env.SUBS.get("subs", "json")) || [];
      let touched = false;
      subs.forEach(function (x) { if (x.device === device) { x.kidId = prof.id; touched = true; } });
      if (touched) await env.SUBS.put("subs", JSON.stringify(subs));
      return json({ ok: true, name: prof.name, hist: prof.hist || {} });
    }
    // "This isn't me": unlink this device.
    if (url.pathname === "/kid/unlink" && request.method === "POST") {
      let b = {};
      try { b = await request.json(); } catch (e) {}
      const device = cleanDevice(b.device);
      const profiles = (await env.SUBS.get("kids", "json")) || [];
      profiles.forEach(function (p) { p.devices = (p.devices || []).filter(function (d) { return d !== device; }); });
      await env.SUBS.put("kids", JSON.stringify(profiles));
      const subs = (await env.SUBS.get("subs", "json")) || [];
      subs.forEach(function (x) { if (device && x.device === device) x.kidId = null; });
      await env.SUBS.put("subs", JSON.stringify(subs));
      return json({ ok: true });
    }

    // ---------- parent dashboard (protected by the parent passcode) ----------
    if (url.pathname === "/parent/signup" && request.method === "POST") {
      let b = {};
      try { b = await request.json(); } catch (e) {}
      const name = cleanName(b.name), pin = String(b.pin || "");
      if (!name) return json({ error: "missing name" }, 400);
      if (!/^\d{6,12}$/.test(pin)) return json({ error: "pin must be 6-12 digits" }, 400);
      const parents = await loadParents(env);
      if (parents.some(function (p) { return normName(p.name) === normName(name); })) return json({ error: "name taken" }, 409);
      if (parents.length >= 50) return json({ error: "too many" }, 400);
      const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
      const acc = { id: b64u(crypto.getRandomValues(new Uint8Array(9))), name: name, title: cleanTitle(b.title), salt: salt, hash: await pinHash(pin, salt),
        key: b64u(crypto.getRandomValues(new Uint8Array(24))), fails: 0, lockUntil: 0, created: Date.now() };
      parents.push(acc);
      await env.SUBS.put("parents", JSON.stringify(parents));
      return json({ key: acc.key, name: acc.name, title: acc.title });
    }
    if (url.pathname === "/parent/login" && request.method === "POST") {
      let b = {};
      try { b = await request.json(); } catch (e) {}
      const parents = await loadParents(env);
      const nm = normName(b.name);
      let acc = nm ? parents.find(function (p) { return normName(p.name) === nm; }) : null;
      // The account from before the update has no name yet: its passcode works with any new name.
      const claim = !acc ? parents.find(function (p) { return p.legacy && !p.name; }) : null;
      acc = acc || claim;
      if (!acc) return json({ error: "wrong" }, 403);
      if (acc.lockUntil && Date.now() < acc.lockUntil) return json({ error: "locked", wait: Math.ceil((acc.lockUntil - Date.now()) / 60000) }, 429);
      if (sameStr(await pinHash(String(b.pin || ""), acc.salt), acc.hash)) {
        acc.fails = 0; acc.lockUntil = 0;
        if (claim) acc.name = cleanName(b.name) || "بابا";
        await env.SUBS.put("parents", JSON.stringify(parents));
        return json({ key: acc.key, name: acc.name, title: acc.title });
      }
      acc.fails = (acc.fails || 0) + 1;
      if (acc.fails >= 5) { acc.lockUntil = Date.now() + 15 * 60000; acc.fails = 0; }
      await env.SUBS.put("parents", JSON.stringify(parents));
      return json({ error: "wrong" }, 403);
    }
    if (url.pathname.indexOf("/parent/") === 0) {
      const me = await getParent(request, env);
      if (!me) return json({ error: "not allowed" }, 401);
      let b = {};
      if (request.method === "POST") { try { b = await request.json(); } catch (e) {} }
      const subs = (await env.SUBS.get("subs", "json")) || [];
      const profiles = (await env.SUBS.get("kids", "json")) || [];
      const mine = profiles.filter(function (p) { return p.parentId === me.id; });
      const myIds = mine.map(function (p) { return p.id; });
      function myKid(id) { return mine.find(function (p) { return p.id === id; }); }
      const now = Date.now();

      if (url.pathname === "/parent/me") return json({ name: me.name, title: me.title });
      if (url.pathname === "/parent/title" && request.method === "POST") {
        const parents = await loadParents(env);
        const acc = parents.find(function (p) { return p.id === me.id; });
        acc.title = cleanTitle(b.title);
        await env.SUBS.put("parents", JSON.stringify(parents));
        return json({ ok: true, title: acc.title });
      }
      // Where a child is (for prayer times): their latest report, or one of their devices.
      function locOf(p) {
        if (p.loc) return p.loc;
        const d = subs.filter(function (x) { return x.kidId === p.id; }).sort(function (a, c) { return (c.updated || 0) - (a.updated || 0); })[0];
        return d ? { lat: d.lat, lon: d.lon, tz: d.tz, method: d.method, hanafi: d.hanafi } : null;
      }

      if (url.pathname === "/parent/kids") {
        const kids = mine.map(function (p) {
          const loc = locOf(p), cur = loc ? currentPrayer(loc, now) : null;
          const day = cur ? cur.day : (function () { const d = new Date(now); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); })();
          const t = {};
          if (cur) for (const k of ["fajr", "dhuhr", "asr", "maghrib", "isha"]) t[k] = cur.times[k];
          const devs = subs.filter(function (x) { return x.kidId === p.id; });
          return { id: p.id, name: p.name, code: p.code, devices: (p.devices || []).length, notify: devs.length, today: day, done: (p.hist || {})[day] || [],
            hist: p.hist || {}, times: cur ? t : null, current: cur ? cur.key : null, tz: loc ? loc.tz : null, seen: p.seen || 0 };
        });
        const loose = [];
        // Devices from before kids had accounts: only the first (original) parent sees them.
        if (me.legacy) for (const x of subs) if (x.mode === "kids" && !x.kidId) loose.push({ id: await kidId(x.sub.endpoint), name: x.name || "", seen: x.seen || x.updated || 0, canLink: !!x.device });
        return json({ kids: kids, devices: loose, now: now });
      }
      if (url.pathname === "/parent/addkid" && request.method === "POST") {
        const name = cleanName(b.name);
        if (!name) return json({ error: "missing name" }, 400);
        if (mine.length >= 20) return json({ error: "too many" }, 400);
        const p = { id: b64u(crypto.getRandomValues(new Uint8Array(9))), parentId: me.id, name: name, code: newCode(profiles), devices: [], hist: {}, created: now, seen: 0 };
        profiles.push(p);
        await env.SUBS.put("kids", JSON.stringify(profiles));
        return json({ ok: true, id: p.id, code: p.code });
      }
      if (url.pathname === "/parent/removekid" && request.method === "POST") {
        if (!myKid(b.id)) return json({ error: "not found" }, 404);
        const keep = profiles.filter(function (p) { return p.id !== b.id; });
        await env.SUBS.put("kids", JSON.stringify(keep));
        // Stop this child's reminders on all their devices.
        await env.SUBS.put("subs", JSON.stringify(subs.filter(function (x) { return x.kidId !== b.id; })));
        return json({ ok: true });
      }
      if (url.pathname === "/parent/rename" && request.method === "POST") {
        const p = myKid(b.id);
        if (!p) return json({ error: "not found" }, 404);
        const name = cleanName(b.name);
        if (!name) return json({ error: "missing name" }, 400);
        p.name = name;
        await env.SUBS.put("kids", JSON.stringify(profiles));
        return json({ ok: true });
      }
      if (url.pathname === "/parent/newcode" && request.method === "POST") {
        const p = myKid(b.id);
        if (!p) return json({ error: "not found" }, 404);
        p.code = newCode(profiles);
        await env.SUBS.put("kids", JSON.stringify(profiles));
        return json({ ok: true, code: p.code });
      }
      // Link a device that registered before it was linked (shown under "devices not linked").
      if (url.pathname === "/parent/link" && request.method === "POST") {
        const p = myKid(b.kidId);
        if (!p || !me.legacy) return json({ error: "not found" }, 404);
        let rec = null;
        for (const x of subs) if (x.mode === "kids" && (await kidId(x.sub.endpoint)) === b.device) rec = x;
        if (!rec || !rec.device) return json({ error: "device cannot be linked" }, 400);
        profiles.forEach(function (q) { q.devices = (q.devices || []).filter(function (d) { return d !== rec.device; }); });
        p.devices.push(rec.device);
        if (rec.marks) setHist(p, rec.marks.day, cleanDone(((p.hist || {})[rec.marks.day] || []).concat(rec.marks.done)));
        subs.forEach(function (x) { if (x.device === rec.device) x.kidId = p.id; });
        await env.SUBS.put("kids", JSON.stringify(profiles));
        await env.SUBS.put("subs", JSON.stringify(subs));
        return json({ ok: true });
      }
      // Remove a device that isn't linked to any child.
      if (url.pathname === "/parent/remove" && request.method === "POST") {
        if (!me.legacy) return json({ error: "not found" }, 404);
        const keep = [];
        for (const x of subs) if (x.mode !== "kids" || x.kidId || (await kidId(x.sub.endpoint)) !== b.id) keep.push(x);
        await env.SUBS.put("subs", JSON.stringify(keep));
        return json({ ok: true });
      }
      if (url.pathname === "/parent/nudge" && request.method === "POST") {
        const vapid = await getVapid(env);
        const text = String(b.text || "").replace(/[<>]/g, "").trim().slice(0, 140);
        let sent = 0;
        for (const x of subs) {
          if (x.mode !== "kids") continue;
          if (myIds.indexOf(x.kidId) < 0) continue;
          if (b.ids !== "all" && (!Array.isArray(b.ids) || b.ids.indexOf(x.kidId) < 0)) continue;
          const p = x.kidId ? profiles.find(function (q) { return q.id === x.kidId; }) : null;
          const cur = currentPrayer(p && p.loc ? p.loc : x, now);
          const done = p ? ((p.hist || {})[cur.day] || []) : (x.marks && x.marks.day === cur.day ? x.marks.done : []);
          const nm = cur.key ? (cur.key === "dhuhr" && cur.fri ? "الجمعة" : PNAMES[cur.key]) : "";
          const name = p ? p.name : x.name;
          const who = name ? "يا " + name + " " : "";
          const body = text || (cur.key && done.indexOf(cur.key) < 0 ? who + "قم صلِّ " + nm + " الآن 🕌" : who + "حافظ على صلاتك، بارك الله فيك 💚");
          try {
            const r = await sendPush(vapid, x.sub, { title: "📣 رسالة من " + (me.title || "بابا"), body: body, tag: "parent-" + now, url: APP_URL + "kids/" });
            if (r.ok) sent++;
          } catch (e) {}
        }
        return json({ ok: true, sent: sent });
      }
      return json({ error: "unknown" }, 404);
    }
    if (url.pathname === "/unsubscribe" && request.method === "POST") {
      let b = {};
      try { b = await request.json(); } catch (e) {}
      const subs = ((await env.SUBS.get("subs", "json")) || []).filter(function (s) { return s.sub.endpoint !== b.endpoint; });
      await env.SUBS.put("subs", JSON.stringify(subs));
      return json({ ok: true });
    }
    if (url.pathname === "/test" && request.method === "POST") {
      let b = {};
      try { b = await request.json(); } catch (e) {}
      const subs = (await env.SUBS.get("subs", "json")) || [];
      const s = subs.find(function (x) { return x.sub.endpoint === b.endpoint; });
      if (!s) return json({ error: "not subscribed" }, 404);
      const kid = s.mode === "kids";
      const r = await sendPush(await getVapid(env), s.sub, kid
        ? { title: "مرحبًا يا بطل 🌟", body: "التذكير يعمل! سنذكّرك بكل صلاة حتى تصليها.", tag: "test", url: APP_URL + "kids/" }
        : { title: "تجربة الإشعارات", body: "الإشعارات تعمل، وسيصلك الأذان والتذكيرات والتطبيق مغلق.", tag: "test", url: APP_URL });
      return json({ ok: r.ok, status: r.status });
    }
    return json({ ok: true, name: "حصن الأذكار — خادم الإشعارات" });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMinute(env, event.scheduledTime || Date.now()));
  }
};
