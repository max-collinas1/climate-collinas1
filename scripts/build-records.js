const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const IN_DAILY = path.join(ROOT, "data", "daily.json");
const IN_MONTHLY_OVERRIDES = path.join(ROOT, "data", "monthly_overrides.json");
const IN_INTRADAY_DIR = path.join(ROOT, "public", "data", "intraday");
const OUT_RECORDS = path.join(ROOT, "data", "record.json");

const TOP_N = 20;

const EXPECTED_SAMPLES_PER_DAY = 96;
const MIN_COVERAGE = 0.9;
const MIN_SAMPLES_PER_DAY = Math.ceil(EXPECTED_SAMPLES_PER_DAY * MIN_COVERAGE);

const MAX_GAP_MINUTES = 20;
const OUTAGE_SPIKE_MM_15M = 10;

const DRY_DAY_RAIN_LIMIT_MM = 0;
const WET_DAY_RAIN_LIMIT_MM = 1;

// -------------------- io --------------------
function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

// -------------------- utils --------------------
function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function toFiniteNumber(x) {
  if (typeof x === "number" && Number.isFinite(x)) return x;

  if (typeof x === "string") {
    const v = Number(x.trim().replace(",", "."));
    return Number.isFinite(v) ? v : null;
  }

  return null;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

function yOf(dateStr) {
  return String(dateStr).slice(0, 4);
}

function mOf(dateStr) {
  return String(dateStr).slice(5, 7);
}

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function daysInYear(year) {
  const y = Number(year);
  return new Date(y, 1, 29).getMonth() === 1 ? 366 : 365;
}

function addDaysISO(dateStr, days) {
  const s = String(dateStr || "");
  if (s.length < 10) return "";

  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));

  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";

  const dt = new Date(Date.UTC(y, m - 1, d + Number(days || 0)));
  const yy = dt.getUTCFullYear();
  const mm = pad2(dt.getUTCMonth() + 1);
  const dd = pad2(dt.getUTCDate());

  return `${yy}-${mm}-${dd}`;
}

function areConsecutiveDates(startDate, currentDate, offsetDays) {
  return addDaysISO(startDate, offsetDays) === currentDate;
}

function sortByValue(arr, dir) {
  const mul = dir === "asc" ? 1 : -1;

  return [...arr].sort((a, b) => {
    const av = a.value;
    const bv = b.value;

    if (av === bv) {
      const ad = a.date || `${a.year || ""}-${pad2(a.month || 0)}`;
      const bd = b.date || `${b.year || ""}-${pad2(b.month || 0)}`;
      return String(ad).localeCompare(String(bd));
    }

    return (av - bv) * mul;
  });
}

function topN(arr, dir) {
  return sortByValue(arr, dir).slice(0, TOP_N);
}

function groupByYM(rows) {
  const map = new Map();

  for (const r of rows) {
    const ym = ymOf(r.date);
    if (!map.has(ym)) map.set(ym, []);
    map.get(ym).push(r);
  }

  return map;
}

function groupByYear(rows) {
  const map = new Map();

  for (const r of rows) {
    const y = yOf(r.date);
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(r);
  }

  return map;
}

function groupByMonthOfYear(rows) {
  const out = {};
  for (let mm = 1; mm <= 12; mm++) out[pad2(mm)] = [];

  for (const r of rows) {
    const mm = mOf(r.date);
    if (!out[mm]) out[mm] = [];
    out[mm].push(r);
  }

  return out;
}

function groupByYearMonth(rows) {
  const out = {};

  for (const r of rows) {
    const yy = yOf(r.date);
    const mm = mOf(r.date);

    if (!out[yy]) out[yy] = {};
    if (!out[yy][mm]) out[yy][mm] = [];

    out[yy][mm].push(r);
  }

  return out;
}

function mean(nums) {
  let s = 0;
  let n = 0;

  for (const x of nums) {
    if (!isNum(x)) continue;
    s += x;
    n += 1;
  }

  return n > 0 ? s / n : null;
}

function sum(nums) {
  let s = 0;
  let n = 0;

  for (const x of nums) {
    if (!isNum(x)) continue;
    s += x;
    n += 1;
  }

  return n > 0 ? s : null;
}

function max(nums) {
  let m = -Infinity;
  let ok = false;

  for (const x of nums) {
    if (!isNum(x)) continue;
    ok = true;
    if (x > m) m = x;
  }

  return ok ? m : null;
}

function min(nums) {
  let m = Infinity;
  let ok = false;

  for (const x of nums) {
    if (!isNum(x)) continue;
    ok = true;
    if (x < m) m = x;
  }

  return ok ? m : null;
}

function meanFromArray(arr) {
  let s = 0;
  let n = 0;

  for (const v of arr) {
    if (!isNum(v)) continue;
    s += v;
    n += 1;
  }

  return n > 0 ? s / n : null;
}

function countWhere(arr, pred) {
  let n = 0;

  for (const x of arr) {
    if (pred(x)) n += 1;
  }

  return n;
}

function firstNum(...vals) {
  for (const v of vals) {
    if (isNum(v)) return v;
  }

  return null;
}

// -------------------- overrides --------------------
function readMonthlyOverrides() {
  if (!fs.existsSync(IN_MONTHLY_OVERRIDES)) return [];

  try {
    const raw = readJSON(IN_MONTHLY_OVERRIDES);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function findMonthlyOverride(overrides, ym, field) {
  return (
    (overrides || []).find(
      (o) =>
        String(o?.scope ?? "") === "month" &&
        String(o?.ym ?? "") === String(ym) &&
        String(o?.field ?? "") === String(field)
    ) || null
  );
}

function applyRainMonthOverride(rawValue, override) {
  const ov = Number(override?.value);

  if (Number.isFinite(ov)) {
    return {
      value: ov,
      is_override: true,
      source: String(override?.source ?? ""),
      label: String(override?.label ?? "Dato ARPAS"),
      note: String(override?.note ?? ""),
    };
  }

  return {
    value: rawValue,
    is_override: false,
    source: "",
    label: "",
    note: "",
  };
}

// -------------------- derived getters --------------------
function getPressAvgDaily(r) {
  return firstNum(
    r.press_avg,
    r.press_mean,
    isNum(r.press_min) && isNum(r.press_max) ? (r.press_min + r.press_max) / 2 : null
  );
}

function getRhMeanDaily(r) {
  return firstNum(
    r.rh_mean,
    r.humidity_mean,
    isNum(r.rh_min) && isNum(r.rh_max) ? (r.rh_min + r.rh_max) / 2 : null
  );
}

function getTempRangeDaily(r) {
  return firstNum(
    r.trange,
    isNum(r.tmax) && isNum(r.tmin) ? r.tmax - r.tmin : null
  );
}

function getUvMeanDaily(r) {
  return firstNum(r.uv_mean, r.uv_avg, r.uv_average, r.uv_max);
}

function getSolarMeanDaily(r) {
  return firstNum(r.solar_mean, r.solar_avg, r.solar_average, r.radiation_mean, r.solar_max);
}

function getWindAvgDaily(r) {
  return firstNum(
    r.wind_avg,
    r.wind_mean,
    r.avg_wind,
    r.wind_speed_avg,
    r.wind_speed_mean
  );
}

function getGustMeanDaily(r) {
  return firstNum(
    r.gust_mean,
    r.gust_avg,
    r.avg_gust,
    r.gust_speed_avg,
    r.gust_speed_mean
  );
}

function getWindMaxDaily(r) {
  return firstNum(
    r.wind_max,
    r.wind_peak,
    r.wind_speed_max
  );
}

function getGustMaxDaily(r) {
  return firstNum(
    r.gust_max,
    r.gust_peak,
    r.max_gust
  );
}

function getWeatherLinkOvrRainDaily(r) {
  if (!r || typeof r !== "object") return null;

  const directKeys = [
    "rain_total_ovr",
    "rain_ovr",
    "rain_ovr_mm",
    "ovr_rain_total",
    "ovr_rain",
    "ovr_precip_total",
    "ovr_precip",
    "weatherlink_rain_total",
    "weatherlink_rain",
    "weatherlink_precip_total",
    "weatherlink_precip",
    "weatherLink_rain_total",
    "weatherLink_rain",
    "weatherLink_precip_total",
    "weatherLink_precip",
    "wl_rain_total",
    "wl_rain",
    "wl_precip_total",
    "wl_precip",
    "rain_total_wl",
    "rain_wl",
    "precip_total_wl",
    "precip_wl",
    "rain_total_weatherlink",
    "rain_weatherlink",
    "precip_total_weatherlink",
    "precip_weatherlink",
    "rain_total_override",
    "rain_override",
    "precip_total_override",
    "precip_override",
  ];

  for (const key of directKeys) {
    const v = toFiniteNumber(r[key]);
    if (v !== null) return v;
  }

  const nestedObjects = [
    r.ovr,
    r.OVR,
    r.override,
    r.overrides,
    r.weatherlink,
    r.weatherLink,
    r.WeatherLink,
    r.wl,
    r.WL,
  ];

  const nestedKeys = [
    "rain_total",
    "rain",
    "precip_total",
    "precip",
    "rain_mm",
    "precip_mm",
    "value",
  ];

  for (const obj of nestedObjects) {
    if (!obj || typeof obj !== "object") continue;

    for (const key of nestedKeys) {
      const v = toFiniteNumber(obj[key]);
      if (v !== null) return v;
    }
  }

  const source = String(
    r.rain_total_source ??
    r.rain_source ??
    r.precip_source ??
    r.source_rain ??
    r.source_precip ??
    ""
  ).toLowerCase();

  const isWeatherLink =
    source.includes("weatherlink") ||
    source.includes("weather link") ||
    source === "wl" ||
    source.includes(" wl ") ||
    source.includes("ovr") ||
    source.includes("override");

  const isWunderground =
    source.includes("wunderground") ||
    source.includes("weather underground") ||
    source === "wu" ||
    source.includes(" wu ");

  if (isWeatherLink && !isWunderground) {
    const v = toFiniteNumber(r.rain_total);
    if (v !== null) return v;
  }

  /*
    Nel tuo daily.json non c'è un campo OVR esplicito.
    La distinzione pratica è:
    - has_obs === true  -> giorno presente nei dati osservati WeatherLink
    - has_obs === false -> giorno non affidabile per accumuli pluriggiornalieri WeatherLink/OVR
  */
  if (r.has_obs === true) {
    const v = toFiniteNumber(r.rain_total);
    if (v !== null) return v;
  }

  return null;
}

// -------------------- coverage helpers --------------------
function coverageRatio(rows, expectedDays, getter) {
  let valid = 0;

  for (const r of rows) {
    const v = getter(r);
    if (isNum(v)) valid += 1;
  }

  return expectedDays > 0 ? valid / expectedDays : 0;
}

function buildCoverageByParam(rows, expectedDays) {
  return {
    temperature: coverageRatio(rows, expectedDays, (r) => firstNum(r.tmean, r.tmax, r.tmin)),
    rain: coverageRatio(rows, expectedDays, (r) => r.rain_total),
    wind: coverageRatio(rows, expectedDays, (r) => getWindAvgDaily(r)),
    pressure: coverageRatio(rows, expectedDays, (r) => getPressAvgDaily(r)),
    humidity: coverageRatio(rows, expectedDays, (r) => getRhMeanDaily(r)),
    radiation: coverageRatio(rows, expectedDays, (r) => getSolarMeanDaily(r)),
  };
}

// -------------------- daily rank helpers --------------------
function dailyRank(rows, field, dir) {
  const out = [];

  for (const r of rows) {
    const v = r[field];
    if (!isNum(v)) continue;
    out.push({ value: v, date: r.date });
  }

  return topN(out, dir);
}

function dailyRankGetter(rows, getter, dir) {
  const out = [];

  for (const r of rows) {
    const v = getter(r);
    if (!isNum(v)) continue;
    out.push({ value: v, date: r.date });
  }

  return topN(out, dir);
}

function dailyRankTempRange(rows, dir) {
  return dailyRankGetter(rows, getTempRangeDaily, dir);
}

function dailyRankPressDropNext(rowsSortedByDate) {
  const out = [];

  for (let i = 0; i < rowsSortedByDate.length - 1; i++) {
    const p0 = getPressAvgDaily(rowsSortedByDate[i]);
    const p1 = getPressAvgDaily(rowsSortedByDate[i + 1]);

    if (!isNum(p0) || !isNum(p1)) continue;

    out.push({ value: p0 - p1, date: rowsSortedByDate[i].date });
  }

  return topN(out, "desc");
}

function dailyRankPressRisePrev(rowsSortedByDate) {
  const out = [];

  for (let i = 1; i < rowsSortedByDate.length; i++) {
    const p0 = getPressAvgDaily(rowsSortedByDate[i - 1]);
    const p1 = getPressAvgDaily(rowsSortedByDate[i]);

    if (!isNum(p0) || !isNum(p1)) continue;

    out.push({ value: p1 - p0, date: rowsSortedByDate[i].date });
  }

  return topN(out, "desc");
}

// -------------------- intraday reading --------------------
function safeReadIntraday(dateStr) {
  const p = path.join(IN_INTRADAY_DIR, `${dateStr}.json`);
  if (!fs.existsSync(p)) return null;

  try {
    const arr = readJSON(p);
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

function listKeys(intr) {
  const keys = new Set();

  for (const row of intr) {
    if (!row || typeof row !== "object") continue;
    for (const k of Object.keys(row)) keys.add(k);
  }

  return Array.from(keys);
}

function collectSeries(intr, key) {
  const out = [];

  for (const row of intr) {
    const v = row?.[key];
    out.push(isNum(v) ? v : null);
  }

  return out;
}

function countValid(series) {
  let n = 0;

  for (const v of series) {
    if (isNum(v)) n++;
  }

  return n;
}

function extractTimestamps(intr) {
  const keys = listKeys(intr);
  const cand = keys.filter((k) => /^(t|ts|time|datetime|timestamp)$/i.test(k) || /(time|date)/i.test(k));

  if (!cand.length) return null;

  let best = null;
  let bestValid = 0;

  for (const k of cand) {
    const ts = intr.map((row) => {
      const v = row?.[k];

      if (isNum(v)) return v > 1e12 ? v : v > 1e9 ? v * 1000 : v;

      if (typeof v === "string") {
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : null;
      }

      return null;
    });

    const valid = ts.filter((x) => isNum(x)).length;

    if (valid > bestValid) {
      bestValid = valid;
      best = ts;
    }
  }

  if (bestValid < 10) return null;
  return best;
}

function hasBigGaps(ts) {
  if (!Array.isArray(ts)) return false;

  let prev = null;

  for (const t of ts) {
    if (!isNum(t)) continue;

    if (isNum(prev)) {
      const dtMin = (t - prev) / 60000;
      if (dtMin > MAX_GAP_MINUTES) return true;
    }

    prev = t;
  }

  return false;
}

function dayCoverageOK(intr) {
  if (!Array.isArray(intr) || intr.length < MIN_SAMPLES_PER_DAY) return false;

  const ts = extractTimestamps(intr);
  if (ts && hasBigGaps(ts)) return false;

  return true;
}

function keyCandidatesFor(intr, kind) {
  const keys = listKeys(intr);

  if (kind === "rain") {
    return keys.filter((k) => /rain|piogg|precip|pluv/i.test(k));
  }

  if (kind === "wind") {
    return keys.filter(
      (k) =>
        (
          /wind|vento/i.test(k) ||
          /windspeed|wind_speed|avgwindspeed|averagewind/i.test(k)
        ) &&
        !/gust|raff/i.test(k)
    );
  }

  if (kind === "gust") {
    return keys.filter(
      (k) =>
        /gust|raff/i.test(k) ||
        /windgust|gustspeed|gust_speed/i.test(k)
    );
  }

  return keys;
}

// -------------------- rain inference --------------------
function scoreCumulative(series) {
  let valid = 0;
  let nonneg = 0;
  let nondec = 0;
  let bad = 0;
  let prev = null;

  for (const v of series) {
    if (!isNum(v)) continue;

    valid++;

    if (v >= 0) nonneg++;

    if (isNum(prev)) {
      if (v >= prev) nondec++;

      const d = v - prev;
      if (d < -0.01) bad++;
      if (d > 200) bad++;
    }

    prev = v;
  }

  if (valid < MIN_SAMPLES_PER_DAY) return -Infinity;

  const rNonneg = nonneg / valid;
  const rNondec = valid > 1 ? nondec / (valid - 1) : 0;

  return rNonneg * 0.8 + rNondec * 1.2 - bad * 0.15;
}

function scoreIncrement(series) {
  let valid = 0;
  let nonneg = 0;
  let huge = 0;

  for (const v of series) {
    if (!isNum(v)) continue;

    valid++;

    if (v >= 0) nonneg++;
    if (v > 200) huge++;
  }

  if (valid < MIN_SAMPLES_PER_DAY) return -Infinity;

  const rNonneg = nonneg / valid;

  return rNonneg * 1.2 - huge * 0.2;
}

function pickBestRainKey(intr) {
  const cand = keyCandidatesFor(intr, "rain");
  const keys = cand.length ? cand : listKeys(intr);

  let bestCum = { key: null, score: -Infinity, series: null };
  let bestInc = { key: null, score: -Infinity, series: null };

  for (const k of keys) {
    const s = collectSeries(intr, k);

    if (!s.some((v) => isNum(v))) continue;

    const scCum = scoreCumulative(s);
    if (scCum > bestCum.score) bestCum = { key: k, score: scCum, series: s };

    const scInc = scoreIncrement(s);
    if (scInc > bestInc.score) bestInc = { key: k, score: scInc, series: s };
  }

  return { bestCum, bestInc };
}

function incrementsFromCumulative(cumSeries) {
  const out = [];
  let prev = null;

  for (const v of cumSeries) {
    if (!isNum(v)) {
      out.push(null);
      continue;
    }

    if (!isNum(prev)) {
      out.push(null);
      prev = v;
      continue;
    }

    let d = v - prev;
    if (!isNum(d) || d < 0) d = 0;

    out.push(d);
    prev = v;
  }

  return out;
}

function inferRainIncrements(intr) {
  if (!dayCoverageOK(intr)) return null;

  const { bestCum, bestInc } = pickBestRainKey(intr);

  const useCum = bestCum.key && bestCum.score >= bestInc.score + 0.15;
  let inc = null;

  if (useCum && bestCum.series) {
    inc = incrementsFromCumulative(bestCum.series);
  } else if (bestInc.key && bestInc.series) {
    inc = bestInc.series.map((v) => (isNum(v) ? (v < 0 ? 0 : v) : null));
  } else {
    return null;
  }

  const valid = countValid(inc);
  if (valid < MIN_SAMPLES_PER_DAY) return null;

  for (const v of inc) {
    if (isNum(v) && v > OUTAGE_SPIKE_MM_15M) return null;
  }

  return inc;
}

function maxRollingSum(values, win) {
  if (!Array.isArray(values) || values.length < win || win <= 0) return null;

  let best = null;

  for (let i = 0; i <= values.length - win; i++) {
    let s = 0;
    let ok = true;

    for (let j = 0; j < win; j++) {
      const v = values[i + j];

      if (!isNum(v)) {
        ok = false;
        break;
      }

      s += v;
    }

    if (!ok) continue;
    if (best === null || s > best) best = s;
  }

  return best;
}

// -------------------- wind/gust helpers --------------------
function pickBestKeyByKind(intr, kind) {
  if (!dayCoverageOK(intr)) return null;

  const cand = keyCandidatesFor(intr, kind);
  const keys = cand.length ? cand : listKeys(intr);

  let bestKey = null;
  let bestScore = -Infinity;

  for (const k of keys) {
    const s = collectSeries(intr, k);
    const valid = countValid(s);

    if (valid < MIN_SAMPLES_PER_DAY) continue;

    let nonneg = 0;
    let huge = 0;

    for (const v of s) {
      if (!isNum(v)) continue;
      if (v >= 0) nonneg++;
      if (v > 250) huge++;
    }

    const sc = nonneg / valid - huge * 0.2;

    if (sc > bestScore) {
      bestScore = sc;
      bestKey = k;
    }
  }

  return bestKey;
}

// -------------------- annual spell helpers --------------------
function longestConsecutiveSpell(rs, predicate) {
  const sorted = [...rs].sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let bestValue = 0;
  let bestStart = "";
  let bestEnd = "";

  let curValue = 0;
  let curStart = "";
  let curEnd = "";

  function closeCurrent() {
    if (curValue > bestValue) {
      bestValue = curValue;
      bestStart = curStart;
      bestEnd = curEnd;
    }

    curValue = 0;
    curStart = "";
    curEnd = "";
  }

  for (const r of sorted) {
    if (!r || typeof r.date !== "string") {
      closeCurrent();
      continue;
    }

    const ok = predicate(r);

    if (ok) {
      if (curValue === 0) curStart = r.date;
      curValue += 1;
      curEnd = r.date;
    } else {
      closeCurrent();
    }
  }

  closeCurrent();

  return {
    value: bestValue,
    start: bestStart || null,
    end: bestEnd || null,
  };
}

function longestDrySpell(rs) {
  return longestConsecutiveSpell(
    rs,
    (r) => isNum(r.rain_total) && r.rain_total <= DRY_DAY_RAIN_LIMIT_MM
  );
}

function longestWetSpellGt1mm(rs) {
  return longestConsecutiveSpell(
    rs,
    (r) => isNum(r.rain_total) && r.rain_total > WET_DAY_RAIN_LIMIT_MM
  );
}

function maxRainAccumulationNDays(rs, nDays) {
  const sorted = [...rs]
    .filter((r) => r && typeof r.date === "string" && r.date.length >= 10)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  let bestValue = null;
  let bestStart = null;
  let bestEnd = null;

  for (let i = 0; i <= sorted.length - nDays; i++) {
    const startDate = sorted[i].date;
    let total = 0;
    let ok = true;

    for (let j = 0; j < nDays; j++) {
      const r = sorted[i + j];

      if (!r || !areConsecutiveDates(startDate, r.date, j)) {
        ok = false;
        break;
      }

      const rainOvr = getWeatherLinkOvrRainDaily(r);

      if (rainOvr === null) {
        ok = false;
        break;
      }

      total += rainOvr;
    }

    if (!ok) continue;

    const endDate = sorted[i + nDays - 1].date;

    if (bestValue === null || total > bestValue) {
      bestValue = total;
      bestStart = startDate;
      bestEnd = endDate;
    }
  }

  return {
    value: bestValue,
    start: bestStart,
    end: bestEnd,
    source: "WeatherLink OVR",
  };
}

// -------------------- precompute derived per-day fields --------------------
function attachDerivedDailyFields(rows) {
  for (const r of rows) {
    r.rain_15m = null;
    r.rain_30m = null;
    r.rain_1h = null;
    r.rain_6h = null;
    r.rain_12h = null;

    if (!isNum(r.gust_mean)) {
      r.gust_mean = firstNum(r.gust_avg, r.avg_gust, r.gust_speed_avg, r.gust_speed_mean);
    }

    if (!isNum(r.wind_avg)) {
      r.wind_avg = firstNum(r.wind_mean, r.avg_wind, r.wind_speed_avg, r.wind_speed_mean);
    }

    if (!isNum(r.wind_max)) {
      r.wind_max = firstNum(r.wind_peak, r.wind_speed_max);
    }

    const intr = safeReadIntraday(r.date);
    if (!intr) continue;
    if (!dayCoverageOK(intr)) continue;

    const inc = inferRainIncrements(intr);

    if (inc) {
      const m15 = max(inc);
      const m30 = maxRollingSum(inc, 2);
      const m1h = maxRollingSum(inc, 4);
      const m6h = maxRollingSum(inc, 24);
      const m12h = maxRollingSum(inc, 48);

      if (isNum(m15)) r.rain_15m = m15;
      if (isNum(m30)) r.rain_30m = m30;
      if (isNum(m1h)) r.rain_1h = m1h;
      if (isNum(m6h)) r.rain_6h = m6h;
      if (isNum(m12h)) r.rain_12h = m12h;
    }

    {
      const k = pickBestKeyByKind(intr, "gust");

      if (k) {
        const s = collectSeries(intr, k);

        if (countValid(s) >= MIN_SAMPLES_PER_DAY) {
          const gmean = meanFromArray(s);
          if (isNum(gmean)) r.gust_mean = gmean;
        }
      }
    }

    {
      const k = pickBestKeyByKind(intr, "wind");

      if (k) {
        const s = collectSeries(intr, k);

        if (countValid(s) >= MIN_SAMPLES_PER_DAY) {
          const wmean = meanFromArray(s);
          const wmax = max(s);

          const gustMaxDaily = getGustMaxDaily(r);

          if (isNum(wmean)) {
            if (!isNum(gustMaxDaily) || wmean <= gustMaxDaily) r.wind_avg = wmean;
          }

          if (isNum(wmax)) {
            if (!isNum(gustMaxDaily) || wmax <= gustMaxDaily + 0.05) r.wind_max = wmax;
          }
        }
      }
    }
  }
}

// -------------------- daily ranks builder --------------------
function buildDailyRanks(rowsSortedByDate) {
  return {
    tmax_abs_high: dailyRank(rowsSortedByDate, "tmax", "desc"),
    tmax_abs_low: dailyRank(rowsSortedByDate, "tmax", "asc"),
    tmin_abs_low: dailyRank(rowsSortedByDate, "tmin", "asc"),
    tmin_abs_high: dailyRank(rowsSortedByDate, "tmin", "desc"),
    tmean_high: dailyRank(rowsSortedByDate, "tmean", "desc"),
    tmean_low: dailyRank(rowsSortedByDate, "tmean", "asc"),
    trange_high: dailyRankTempRange(rowsSortedByDate, "desc"),
    trange_low: dailyRankTempRange(rowsSortedByDate, "asc"),

    rain_total_high: dailyRank(rowsSortedByDate, "rain_total", "desc"),
    rainrate_max_high: dailyRank(rowsSortedByDate, "rainrate_max", "desc"),

    rain_15m_high: dailyRank(rowsSortedByDate, "rain_15m", "desc"),
    rain_30m_high: dailyRank(rowsSortedByDate, "rain_30m", "desc"),
    rain_1h_high: dailyRank(rowsSortedByDate, "rain_1h", "desc"),
    rain_6h_high: dailyRank(rowsSortedByDate, "rain_6h", "desc"),
    rain_12h_high: dailyRank(rowsSortedByDate, "rain_12h", "desc"),

    gust_max_high: dailyRankGetter(rowsSortedByDate, getGustMaxDaily, "desc"),
    gust_mean_high: dailyRankGetter(rowsSortedByDate, getGustMeanDaily, "desc"),

    wind_avg_high: dailyRankGetter(rowsSortedByDate, getWindAvgDaily, "desc"),
    wind_max_high: dailyRankGetter(rowsSortedByDate, getWindMaxDaily, "desc"),

    press_min_low: dailyRank(rowsSortedByDate, "press_min", "asc"),
    press_max_high: dailyRank(rowsSortedByDate, "press_max", "desc"),
    press_drop_nextday_high: dailyRankPressDropNext(rowsSortedByDate),
    press_rise_prevday_high: dailyRankPressRisePrev(rowsSortedByDate),

    rh_min_low: dailyRank(rowsSortedByDate, "rh_min", "asc"),
    rh_max_high: dailyRank(rowsSortedByDate, "rh_max", "desc"),
    rh_mean_high: dailyRankGetter(rowsSortedByDate, getRhMeanDaily, "desc"),

    uv_max_high: dailyRank(rowsSortedByDate, "uv_max", "desc"),
    solar_max_high: dailyRank(rowsSortedByDate, "solar_max", "desc"),
  };
}

// -------------------- monthly / yearly aggregations --------------------
function monthlyAggFromRows(year, month, rs, overrides) {
  const expectedDays = daysInMonth(year, month);
  const coverage_by_param = buildCoverageByParam(rs, expectedDays);
  const ym = `${year}-${pad2(month)}`;

  const rain_total_raw = sum(rs.map((r) => r.rain_total));
  const rainOverride = findMonthlyOverride(overrides, ym, "rainSum");
  const rainResolved = applyRainMonthOverride(rain_total_raw, rainOverride);

  return {
    ym,

    tmax_mean: mean(rs.map((r) => r.tmax)),
    tmin_mean: mean(rs.map((r) => r.tmin)),
    tmean_mean: mean(rs.map((r) => r.tmean)),
    trange_mean: mean(rs.map((r) => getTempRangeDaily(r))),

    rain_total_raw,
    rain_total: rainResolved.value,
    rain_is_override: rainResolved.is_override,
    rain_override_source: rainResolved.source,
    rain_override_label: rainResolved.label,
    rain_override_note: rainResolved.note,

    rainrate_max: max(rs.map((r) => r.rainrate_max)),
    rain_15m_high: max(rs.map((r) => r.rain_15m)),
    rain_30m_high: max(rs.map((r) => r.rain_30m)),
    rain_1h_high: max(rs.map((r) => r.rain_1h)),
    rain_6h_high: max(rs.map((r) => r.rain_6h)),
    rain_12h_high: max(rs.map((r) => r.rain_12h)),

    gust_max: max(rs.map((r) => getGustMaxDaily(r))),
    gust_mean: mean(rs.map((r) => getGustMeanDaily(r))),
    wind_avg: mean(rs.map((r) => getWindAvgDaily(r))),
    wind_max: max(rs.map((r) => getWindMaxDaily(r))),

    press_min: min(rs.map((r) => r.press_min)),
    press_max: max(rs.map((r) => r.press_max)),
    press_mean: mean(rs.map((r) => getPressAvgDaily(r))),

    rh_min: min(rs.map((r) => r.rh_min)),
    rh_max: max(rs.map((r) => r.rh_max)),
    rh_mean: mean(rs.map((r) => getRhMeanDaily(r))),

    uv_max: max(rs.map((r) => r.uv_max)),
    uv_mean: mean(rs.map((r) => getUvMeanDaily(r))),
    solar_max: max(rs.map((r) => r.solar_max)),
    solar_mean: mean(rs.map((r) => getSolarMeanDaily(r))),

    coverage_by_param,
  };
}

function yearlyAggFromRows(year, rs, monthlyListForYear) {
  const expectedDays = daysInYear(year);
  const coverage_by_param = buildCoverageByParam(rs, expectedDays);

  const monthlyRainFinals = (monthlyListForYear || [])
    .map((m) => m.rain_total)
    .filter((v) => isNum(v));

  const hasRainOverride = (monthlyListForYear || []).some((m) => m.rain_is_override);

  const rainOverrideMonths = (monthlyListForYear || [])
    .filter((m) => m.rain_is_override)
    .map((m) => m.month);

  const drySpell = longestDrySpell(rs);
  const wetSpellGt1mm = longestWetSpellGt1mm(rs);

  const rainMax2d = maxRainAccumulationNDays(rs, 2);
  const rainMax3d = maxRainAccumulationNDays(rs, 3);
  const rainMax5d = maxRainAccumulationNDays(rs, 5);

  return {
    tmax_mean: mean(rs.map((r) => r.tmax)),
    tmean_mean: mean(rs.map((r) => r.tmean)),
    tmin_mean: mean(rs.map((r) => r.tmin)),
    trange_mean: mean(rs.map((r) => getTempRangeDaily(r))),

    tmax_days_gt_35: countWhere(rs, (r) => isNum(r.tmax) && r.tmax > 35),
    tmax_days_gt_30: countWhere(rs, (r) => isNum(r.tmax) && r.tmax > 30),
    tmax_days_lt_5: countWhere(rs, (r) => isNum(r.tmax) && r.tmax < 5),
    tmin_days_gt_20: countWhere(rs, (r) => isNum(r.tmin) && r.tmin > 20),
    tmin_days_lt_0: countWhere(rs, (r) => isNum(r.tmin) && r.tmin < 0),

    rain_total: monthlyRainFinals.length ? monthlyRainFinals.reduce((a, b) => a + b, 0) : null,
    rain_total_raw: sum(rs.map((r) => r.rain_total)),
    rain_has_override: hasRainOverride,
    rain_override_months: rainOverrideMonths,

    rain_days_gt_1mm: countWhere(rs, (r) => isNum(r.rain_total) && r.rain_total > 1),
    rain_days_gt_10mm: countWhere(rs, (r) => isNum(r.rain_total) && r.rain_total > 10),
    rain_days_gt_20mm: countWhere(rs, (r) => isNum(r.rain_total) && r.rain_total > 20),
    rain_days_gt_50mm: countWhere(rs, (r) => isNum(r.rain_total) && r.rain_total > 50),

    rain_max_2d: rainMax2d.value,
    rain_max_2d_start: rainMax2d.start,
    rain_max_2d_end: rainMax2d.end,
    rain_max_2d_source: rainMax2d.source,

    rain_max_3d: rainMax3d.value,
    rain_max_3d_start: rainMax3d.start,
    rain_max_3d_end: rainMax3d.end,
    rain_max_3d_source: rainMax3d.source,

    rain_max_5d: rainMax5d.value,
    rain_max_5d_start: rainMax5d.start,
    rain_max_5d_end: rainMax5d.end,
    rain_max_5d_source: rainMax5d.source,

    longest_dry_spell: drySpell.value,
    longest_dry_spell_start: drySpell.start,
    longest_dry_spell_end: drySpell.end,

    longest_wet_spell_gt_1mm: wetSpellGt1mm.value,
    longest_wet_spell_gt_1mm_start: wetSpellGt1mm.start,
    longest_wet_spell_gt_1mm_end: wetSpellGt1mm.end,

    rainrate_max: max(rs.map((r) => r.rainrate_max)),

    wind_avg_mean: mean(rs.map((r) => getWindAvgDaily(r))),
    gust_mean: mean(rs.map((r) => getGustMeanDaily(r))),

    press_mean: mean(rs.map((r) => getPressAvgDaily(r))),
    rh_mean: mean(rs.map((r) => getRhMeanDaily(r))),
    uv_mean: mean(rs.map((r) => getUvMeanDaily(r))),
    solar_mean: mean(rs.map((r) => getSolarMeanDaily(r))),

    coverage_by_param,
  };
}

// -------------------- rank builders --------------------
function rankMonthly(list, field, dir) {
  return topN(
    list
      .filter((x) => isNum(x[field]))
      .map((x) => ({
        value: x[field],
        year: x.year,
        month: x.month,
        coverage_by_param: x.coverage_by_param,
        rain_is_override: !!x.rain_is_override,
        rain_override_source: x.rain_override_source || "",
        rain_override_label: x.rain_override_label || "",
        rain_override_note: x.rain_override_note || "",
      })),
    dir
  );
}

function rankYearly(list, field, dir, opts = {}) {
  const includePeriod = !!opts.includePeriod;
  const startField = opts.startField || `${field}_start`;
  const endField = opts.endField || `${field}_end`;

  return topN(
    list
      .filter((x) => isNum(x[field]))
      .map((x) => {
        const row = {
          value: x[field],
          year: x.year,
          coverage_by_param: x.coverage_by_param,
          rain_has_override: !!x.rain_has_override,
          rain_override_months: Array.isArray(x.rain_override_months) ? x.rain_override_months : [],
        };

        if (includePeriod) {
          row.start = x[startField] || null;
          row.end = x[endField] || null;
          row.period_start = x[startField] || null;
          row.period_end = x[endField] || null;
        }

        return row;
      }),
    dir
  );
}

// ====== ranking per mese dell'anno ======
function buildMonthlyByMonthOfYear(rows, overrides) {
  const byYM = groupByYM(rows);

  const monthlyList = [];

  for (const [ym, rs] of byYM.entries()) {
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(5, 7));
    const agg = monthlyAggFromRows(year, month, rs, overrides);

    monthlyList.push({ year, month, ym, ...agg });
  }

  const byMonth = {};
  for (let m = 1; m <= 12; m++) byMonth[pad2(m)] = [];

  for (const it of monthlyList) byMonth[pad2(it.month)].push(it);

  const out = {};

  for (const mm of Object.keys(byMonth)) {
    const list = byMonth[mm];

    out[mm] = {
      tmax_mean_high: rankMonthly(list, "tmax_mean", "desc"),
      tmax_mean_low: rankMonthly(list, "tmax_mean", "asc"),
      tmin_mean_low: rankMonthly(list, "tmin_mean", "asc"),
      tmin_mean_high: rankMonthly(list, "tmin_mean", "desc"),
      tmean_high: rankMonthly(list, "tmean_mean", "desc"),
      tmean_low: rankMonthly(list, "tmean_mean", "asc"),
      trange_high: rankMonthly(list, "trange_mean", "desc"),
      trange_low: rankMonthly(list, "trange_mean", "asc"),

      rain_total_high: rankMonthly(list, "rain_total", "desc"),
      rain_total_low: rankMonthly(list, "rain_total", "asc"),
      rainrate_max_high: rankMonthly(list, "rainrate_max", "desc"),
      rain_15m_high: rankMonthly(list, "rain_15m_high", "desc"),
      rain_30m_high: rankMonthly(list, "rain_30m_high", "desc"),
      rain_1h_high: rankMonthly(list, "rain_1h_high", "desc"),
      rain_6h_high: rankMonthly(list, "rain_6h_high", "desc"),
      rain_12h_high: rankMonthly(list, "rain_12h_high", "desc"),

      gust_max_high: rankMonthly(list, "gust_max", "desc"),
      gust_mean_high: rankMonthly(list, "gust_mean", "desc"),
      wind_avg_high: rankMonthly(list, "wind_avg", "desc"),
      wind_max_high: rankMonthly(list, "wind_max", "desc"),

      press_min_low: rankMonthly(list, "press_min", "asc"),
      press_max_high: rankMonthly(list, "press_max", "desc"),

      rh_min_low: rankMonthly(list, "rh_min", "asc"),
      rh_max_high: rankMonthly(list, "rh_max", "desc"),
      rh_mean_high: rankMonthly(list, "rh_mean", "desc"),

      uv_max_high: rankMonthly(list, "uv_max", "desc"),
      solar_max_high: rankMonthly(list, "solar_max", "desc"),

      coverage_summary: list.map((x) => ({
        year: x.year,
        month: x.month,
        coverage_by_param: x.coverage_by_param,
        rain_total: x.rain_total,
        rain_total_raw: x.rain_total_raw,
        rain_is_override: x.rain_is_override,
        rain_override_source: x.rain_override_source,
        rain_override_label: x.rain_override_label,
        rain_override_note: x.rain_override_note,
      })),
    };
  }

  return out;
}

// ====== ranking mensile dentro un anno ======
function buildMonthlyByYear(rows, overrides) {
  const byYM = groupByYM(rows);

  const monthlyList = [];

  for (const [ym, rs] of byYM.entries()) {
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(5, 7));
    const agg = monthlyAggFromRows(year, month, rs, overrides);

    monthlyList.push({ year, month, ym, ...agg });
  }

  const mapY = new Map();

  for (const it of monthlyList) {
    const yy = String(it.year);
    if (!mapY.has(yy)) mapY.set(yy, []);
    mapY.get(yy).push(it);
  }

  const out = {};

  for (const [yy, list] of mapY.entries()) {
    out[yy] = {
      tmax_mean_high: rankMonthly(list, "tmax_mean", "desc"),
      tmax_mean_low: rankMonthly(list, "tmax_mean", "asc"),
      tmin_mean_low: rankMonthly(list, "tmin_mean", "asc"),
      tmin_mean_high: rankMonthly(list, "tmin_mean", "desc"),
      tmean_high: rankMonthly(list, "tmean_mean", "desc"),
      tmean_low: rankMonthly(list, "tmean_mean", "asc"),
      trange_high: rankMonthly(list, "trange_mean", "desc"),
      trange_low: rankMonthly(list, "trange_mean", "asc"),

      rain_total_high: rankMonthly(list, "rain_total", "desc"),
      rain_total_low: rankMonthly(list, "rain_total", "asc"),
      rainrate_max_high: rankMonthly(list, "rainrate_max", "desc"),
      rain_15m_high: rankMonthly(list, "rain_15m_high", "desc"),
      rain_30m_high: rankMonthly(list, "rain_30m_high", "desc"),
      rain_1h_high: rankMonthly(list, "rain_1h_high", "desc"),
      rain_6h_high: rankMonthly(list, "rain_6h_high", "desc"),
      rain_12h_high: rankMonthly(list, "rain_12h_high", "desc"),

      gust_max_high: rankMonthly(list, "gust_max", "desc"),
      gust_mean_high: rankMonthly(list, "gust_mean", "desc"),
      wind_avg_high: rankMonthly(list, "wind_avg", "desc"),
      wind_max_high: rankMonthly(list, "wind_max", "desc"),

      press_min_low: rankMonthly(list, "press_min", "asc"),
      press_max_high: rankMonthly(list, "press_max", "desc"),

      rh_min_low: rankMonthly(list, "rh_min", "asc"),
      rh_max_high: rankMonthly(list, "rh_max", "desc"),
      rh_mean_high: rankMonthly(list, "rh_mean", "desc"),

      uv_max_high: rankMonthly(list, "uv_max", "desc"),
      solar_max_high: rankMonthly(list, "solar_max", "desc"),

      coverage_summary: list.map((x) => ({
        year: x.year,
        month: x.month,
        coverage_by_param: x.coverage_by_param,
        rain_total: x.rain_total,
        rain_total_raw: x.rain_total_raw,
        rain_is_override: x.rain_is_override,
        rain_override_source: x.rain_override_source,
        rain_override_label: x.rain_override_label,
        rain_override_note: x.rain_override_note,
      })),
    };
  }

  return out;
}

function buildYearly(rows, overrides) {
  const byY = groupByYear(rows);
  const byYM = groupByYM(rows);

  const monthlyList = [];

  for (const [ym, rs] of byYM.entries()) {
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(5, 7));
    const agg = monthlyAggFromRows(year, month, rs, overrides);

    monthlyList.push({ year, month, ym, ...agg });
  }

  const yearlyList = [];

  for (const [yy, rs] of byY.entries()) {
    const year = Number(yy);

    const monthlyListForYear = monthlyList
      .filter((m) => Number(m.year) === year)
      .sort((a, b) => a.month - b.month);

    const agg = yearlyAggFromRows(year, rs, monthlyListForYear);

    yearlyList.push({ year, ...agg });
  }

  return {
    tmax_mean_high: rankYearly(yearlyList, "tmax_mean", "desc"),
    tmax_mean_low: rankYearly(yearlyList, "tmax_mean", "asc"),
    tmean_high: rankYearly(yearlyList, "tmean_mean", "desc"),
    tmean_low: rankYearly(yearlyList, "tmean_mean", "asc"),
    tmin_mean_high: rankYearly(yearlyList, "tmin_mean", "desc"),
    tmin_mean_low: rankYearly(yearlyList, "tmin_mean", "asc"),
    trange_mean_high: rankYearly(yearlyList, "trange_mean", "desc"),
    trange_mean_low: rankYearly(yearlyList, "trange_mean", "asc"),

    tmax_days_gt_35_high: rankYearly(yearlyList, "tmax_days_gt_35", "desc"),
    tmax_days_gt_30_high: rankYearly(yearlyList, "tmax_days_gt_30", "desc"),
    tmax_days_lt_5_high: rankYearly(yearlyList, "tmax_days_lt_5", "desc"),
    tmin_days_gt_20_high: rankYearly(yearlyList, "tmin_days_gt_20", "desc"),
    tmin_days_lt_0_high: rankYearly(yearlyList, "tmin_days_lt_0", "desc"),

    rain_total_high: rankYearly(yearlyList, "rain_total", "desc"),
    rain_total_low: rankYearly(yearlyList, "rain_total", "asc"),
    rain_days_over_1mm_high: rankYearly(yearlyList, "rain_days_gt_1mm", "desc"),
    rain_days_over_1mm_low: rankYearly(yearlyList, "rain_days_gt_1mm", "asc"),

    rain_days_gt_10mm_high: rankYearly(yearlyList, "rain_days_gt_10mm", "desc"),
    rain_days_gt_20mm_high: rankYearly(yearlyList, "rain_days_gt_20mm", "desc"),
    rain_days_gt_50mm_high: rankYearly(yearlyList, "rain_days_gt_50mm", "desc"),

    rain_max_2d_high: rankYearly(yearlyList, "rain_max_2d", "desc", {
      includePeriod: true,
      startField: "rain_max_2d_start",
      endField: "rain_max_2d_end",
    }),
    rain_max_3d_high: rankYearly(yearlyList, "rain_max_3d", "desc", {
      includePeriod: true,
      startField: "rain_max_3d_start",
      endField: "rain_max_3d_end",
    }),
    rain_max_5d_high: rankYearly(yearlyList, "rain_max_5d", "desc", {
      includePeriod: true,
      startField: "rain_max_5d_start",
      endField: "rain_max_5d_end",
    }),

    longest_dry_spell_high: rankYearly(yearlyList, "longest_dry_spell", "desc", {
      includePeriod: true,
      startField: "longest_dry_spell_start",
      endField: "longest_dry_spell_end",
    }),
    longest_dry_spell_low: rankYearly(yearlyList, "longest_dry_spell", "asc", {
      includePeriod: true,
      startField: "longest_dry_spell_start",
      endField: "longest_dry_spell_end",
    }),
    longest_wet_spell_gt_1mm_high: rankYearly(yearlyList, "longest_wet_spell_gt_1mm", "desc", {
      includePeriod: true,
      startField: "longest_wet_spell_gt_1mm_start",
      endField: "longest_wet_spell_gt_1mm_end",
    }),

    rainrate_max_high: rankYearly(yearlyList, "rainrate_max", "desc"),

    wind_avg_high: rankYearly(yearlyList, "wind_avg_mean", "desc"),
    wind_avg_low: rankYearly(yearlyList, "wind_avg_mean", "asc"),
    gust_mean_high: rankYearly(yearlyList, "gust_mean", "desc"),
    gust_mean_low: rankYearly(yearlyList, "gust_mean", "asc"),

    press_mean_high: rankYearly(yearlyList, "press_mean", "desc"),
    press_mean_low: rankYearly(yearlyList, "press_mean", "asc"),

    rh_mean_high: rankYearly(yearlyList, "rh_mean", "desc"),
    rh_mean_low: rankYearly(yearlyList, "rh_mean", "asc"),

    uv_mean_high: rankYearly(yearlyList, "uv_mean", "desc"),
    uv_mean_low: rankYearly(yearlyList, "uv_mean", "asc"),
    solar_mean_high: rankYearly(yearlyList, "solar_mean", "desc"),
    solar_mean_low: rankYearly(yearlyList, "solar_mean", "asc"),

    summary: yearlyList.map((x) => ({
      year: x.year,
      coverage_by_param: x.coverage_by_param,

      tmax_mean: x.tmax_mean,
      tmean_mean: x.tmean_mean,
      tmin_mean: x.tmin_mean,
      trange_mean: x.trange_mean,

      tmax_days_gt_35: x.tmax_days_gt_35,
      tmax_days_gt_30: x.tmax_days_gt_30,
      tmax_days_lt_5: x.tmax_days_lt_5,
      tmin_days_gt_20: x.tmin_days_gt_20,
      tmin_days_lt_0: x.tmin_days_lt_0,

      rain_total: x.rain_total,
      rain_total_raw: x.rain_total_raw,
      rain_has_override: x.rain_has_override,
      rain_override_months: x.rain_override_months,

      rain_days_gt_1mm: x.rain_days_gt_1mm,
      rain_days_gt_10mm: x.rain_days_gt_10mm,
      rain_days_gt_20mm: x.rain_days_gt_20mm,
      rain_days_gt_50mm: x.rain_days_gt_50mm,

      rain_max_2d: x.rain_max_2d,
      rain_max_2d_start: x.rain_max_2d_start,
      rain_max_2d_end: x.rain_max_2d_end,
      rain_max_2d_source: x.rain_max_2d_source,

      rain_max_3d: x.rain_max_3d,
      rain_max_3d_start: x.rain_max_3d_start,
      rain_max_3d_end: x.rain_max_3d_end,
      rain_max_3d_source: x.rain_max_3d_source,

      rain_max_5d: x.rain_max_5d,
      rain_max_5d_start: x.rain_max_5d_start,
      rain_max_5d_end: x.rain_max_5d_end,
      rain_max_5d_source: x.rain_max_5d_source,

      longest_dry_spell: x.longest_dry_spell,
      longest_dry_spell_start: x.longest_dry_spell_start,
      longest_dry_spell_end: x.longest_dry_spell_end,

      longest_wet_spell_gt_1mm: x.longest_wet_spell_gt_1mm,
      longest_wet_spell_gt_1mm_start: x.longest_wet_spell_gt_1mm_start,
      longest_wet_spell_gt_1mm_end: x.longest_wet_spell_gt_1mm_end,

      rainrate_max: x.rainrate_max,

      wind_avg_mean: x.wind_avg_mean,
      gust_mean: x.gust_mean,
      press_mean: x.press_mean,
      rh_mean: x.rh_mean,
      uv_mean: x.uv_mean,
      solar_mean: x.solar_mean,
    })),
  };
}

// -------------------- main --------------------
function main() {
  if (!fs.existsSync(IN_DAILY)) {
    console.error("daily.json non trovato:", IN_DAILY);
    process.exit(1);
  }

  const overrides = readMonthlyOverrides();

  const rows = readJSON(IN_DAILY)
    .filter((r) => r && typeof r.date === "string" && r.date.length >= 10)
    .sort((a, b) => a.date.localeCompare(b.date));

  attachDerivedDailyFields(rows);

  const daily = buildDailyRanks(rows);

  const dailyByMonth = {};
  const byMonth = groupByMonthOfYear(rows);

  for (const mm of Object.keys(byMonth)) {
    const sub = [...byMonth[mm]].sort((a, b) => a.date.localeCompare(b.date));
    dailyByMonth[mm] = buildDailyRanks(sub);
  }

  const dailyByYear = {};
  const byYear = groupByYear(rows);

  for (const [yy, list] of byYear.entries()) {
    const sub = [...list].sort((a, b) => a.date.localeCompare(b.date));
    dailyByYear[yy] = buildDailyRanks(sub);
  }

  const dailyByYearMonth = {};
  const byYM = groupByYearMonth(rows);

  for (const yy of Object.keys(byYM)) {
    dailyByYearMonth[yy] = {};

    for (const mm of Object.keys(byYM[yy])) {
      const sub = [...byYM[yy][mm]].sort((a, b) => a.date.localeCompare(b.date));
      dailyByYearMonth[yy][mm] = buildDailyRanks(sub);
    }
  }

  const monthly = {
    by_month: buildMonthlyByMonthOfYear(rows, overrides),
    by_year: buildMonthlyByYear(rows, overrides),
  };

  const yearly = buildYearly(rows, overrides);

  const out = {
    generated_at: new Date().toISOString(),
    top_n: TOP_N,
    daily: {
      ...daily,
      by_month: dailyByMonth,
      by_year: dailyByYear,
      by_year_month: dailyByYearMonth,
    },
    monthly,
    yearly,
  };

  writeJSON(OUT_RECORDS, out);
  console.log("OK -> scritto", OUT_RECORDS);
}

main();