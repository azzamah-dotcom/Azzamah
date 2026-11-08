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
