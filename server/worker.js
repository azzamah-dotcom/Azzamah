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
  "Access-Control-Allow-Headers": "Content-Type"
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
function eventsFor(s, day) {
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
  }
  return ev;
}

async function runMinute(env, nowMs) {
  const minute = Math.floor(nowMs / 60000);
  const subs = (await env.SUBS.get("subs", "json")) || [];
  if (!subs.length) return { sent: 0 };
  const vapid = await getVapid(env);
  const dead = [];
  let sent = 0;
  for (const s of subs) {
    if (typeof s.lat !== "number" || typeof s.lon !== "number") continue;
    // Today and yesterday (a reminder after Isha can fall after midnight).
    const due = [];
    for (const back of [0, 1]) {
      const day = localDay(s.tz || "UTC", nowMs - back * 86400000);
      for (const e of eventsFor(s, day)) if (Math.floor(e.at / 60000) === minute) due.push(e);
    }
    for (const e of due) {
      try {
        const r = await sendPush(vapid, s.sub, { title: e.title, body: e.body, tag: e.tag, url: APP_URL + e.url });
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
        city: String(b.city || "").slice(0, 80), n: b.n || {}, updated: Date.now()
      };
      if (!isFinite(rec.lat) || !isFinite(rec.lon)) return json({ error: "missing location" }, 400);
      const subs = ((await env.SUBS.get("subs", "json")) || []).filter(function (s) { return s.sub.endpoint !== rec.sub.endpoint; });
      subs.push(rec);
      await env.SUBS.put("subs", JSON.stringify(subs.slice(-500)));
      return json({ ok: true });
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
      const r = await sendPush(await getVapid(env), s.sub, { title: "تجربة الإشعارات", body: "الإشعارات تعمل، وسيصلك الأذان والتذكيرات والتطبيق مغلق.", tag: "test", url: APP_URL });
      return json({ ok: r.ok, status: r.status });
    }
    return json({ ok: true, name: "حصن الأذكار — خادم الإشعارات" });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMinute(env, event.scheduledTime || Date.now()));
  }
};
