// scripts/build-records.js
const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const IN_DAILY = path.join(ROOT, "data", "daily.json");
const IN_INTRADAY_DIR = path.join(ROOT, "public", "data", "intraday");
const OUT_RECORDS = path.join(ROOT, "data", "record.json");

const TOP_N = 20;

const EXPECTED_SAMPLES_PER_DAY = 96;
const MIN_COVERAGE = 0.9;
const MIN_SAMPLES_PER_DAY = Math.ceil(EXPECTED_SAMPLES_PER_DAY * MIN_COVERAGE);

const MAX_GAP_MINUTES = 20;
const OUTAGE_SPIKE_MM_15M = 10;

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
function dailyRankTempRange(rows, dir) {
  const out = [];
  for (const r of rows) {
    const tmax = r.tmax;
    const tmin = r.tmin;
    if (!isNum(tmax) || !isNum(tmin)) continue;
    out.push({ value: tmax - tmin, date: r.date });
  }
  return topN(out, dir);
}

function getPressAvgDaily(r) {
  const v = r.press_avg;
  if (isNum(v)) return v;
  const pmin = r.press_min;
  const pmax = r.press_max;
  if (isNum(pmin) && isNum(pmax)) return (pmin + pmax) / 2;
  return null;
}
function getRhMeanDaily(r) {
  const v = r.rh_mean;
  if (isNum(v)) return v;
  const rmin = r.rh_min;
  const rmax = r.rh_max;
  if (isNum(rmin) && isNum(rmax)) return (rmin + rmax) / 2;
  return null;
}
function dailyRankDerived(rows, getter, dir) {
  const out = [];
  for (const r of rows) {
    const v = getter(r);
    if (!isNum(v)) continue;
    out.push({ value: v, date: r.date });
  }
  return topN(out, dir);
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
  for (const v of series) if (isNum(v)) n++;
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
  if (kind === "rain") return keys.filter((k) => /rain|piogg|precip|pluv/i.test(k));
  if (kind === "wind") return keys.filter((k) => /wind|vento/i.test(k) && !/gust|raff/i.test(k));
  if (kind === "gust") return keys.filter((k) => /gust|raff/i.test(k));
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

  if (useCum && bestCum.series) inc = incrementsFromCumulative(bestCum.series);
  else if (bestInc.key && bestInc.series) inc = bestInc.series.map((v) => (isNum(v) ? (v < 0 ? 0 : v) : null));
  else return null;

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

// -------------------- precompute derived per-day fields --------------------
function attachDerivedDailyFields(rows) {
  for (const r of rows) {
    // init derived fields as null
    r.rain_15m = null;
    r.rain_30m = null;
    r.rain_1h = null;
    r.rain_6h = null;
    r.rain_12h = null;

    r.gust_mean = null;
    r.wind_avg = null;
    r.wind_max = null;

    const intr = safeReadIntraday(r.date);
    if (!intr) continue;
    if (!dayCoverageOK(intr)) continue;

    // ---- rain windows (from increments) ----
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

    // ---- gust mean ----
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

    // ---- wind avg / wind max ----
    {
      const k = pickBestKeyByKind(intr, "wind");
      if (k) {
        const s = collectSeries(intr, k);
        if (countValid(s) >= MIN_SAMPLES_PER_DAY) {
          const wmean = meanFromArray(s);
          const wmax = max(s);

          // controlli di coerenza con gust giornaliero da daily.json, se presente
          const gustMaxDaily = r.gust_max;
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

// -------------------- daily ranks builder (global / subset) --------------------
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

    // intraday-derived windows (precomputed)
    rain_15m_high: dailyRank(rowsSortedByDate, "rain_15m", "desc"),
    rain_30m_high: dailyRank(rowsSortedByDate, "rain_30m", "desc"),
    rain_1h_high: dailyRank(rowsSortedByDate, "rain_1h", "desc"),
    rain_6h_high: dailyRank(rowsSortedByDate, "rain_6h", "desc"),
    rain_12h_high: dailyRank(rowsSortedByDate, "rain_12h", "desc"),

    gust_max_high: dailyRank(rowsSortedByDate, "gust_max", "desc"),
    gust_mean_high: dailyRank(rowsSortedByDate, "gust_mean", "desc"),

    wind_avg_high: dailyRank(rowsSortedByDate, "wind_avg", "desc"),
    wind_max_high: dailyRank(rowsSortedByDate, "wind_max", "desc"),

    press_min_low: dailyRank(rowsSortedByDate, "press_min", "asc"),
    press_max_high: dailyRank(rowsSortedByDate, "press_max", "desc"),
    press_drop_nextday_high: dailyRankPressDropNext(rowsSortedByDate),
    press_rise_prevday_high: dailyRankPressRisePrev(rowsSortedByDate),

    rh_min_low: dailyRank(rowsSortedByDate, "rh_min", "asc"),
    rh_max_high: dailyRank(rowsSortedByDate, "rh_max", "desc"),
    rh_mean_high: dailyRankDerived(rowsSortedByDate, getRhMeanDaily, "desc"),

    uv_max_high: dailyRank(rowsSortedByDate, "uv_max", "desc"),
    solar_max_high: dailyRank(rowsSortedByDate, "solar_max", "desc"),
  };
}

// -------------------- monthly / yearly aggregations --------------------
function monthlyAggFromRows(rs) {
  const tmax_mean = mean(rs.map((r) => r.tmax));
  const tmin_mean = mean(rs.map((r) => r.tmin));
  const tmean_mean = mean(rs.map((r) => r.tmean));

  const rain_total = sum(rs.map((r) => r.rain_total));
  const gust_max = max(rs.map((r) => r.gust_max));
  const rainrate_max = max(rs.map((r) => r.rainrate_max));

  const press_min = min(rs.map((r) => r.press_min));
  const press_max = max(rs.map((r) => r.press_max));

  const rh_min = min(rs.map((r) => r.rh_min));
  const rh_max = max(rs.map((r) => r.rh_max));

  const uv_max = max(rs.map((r) => r.uv_max));
  const solar_max = max(rs.map((r) => r.solar_max));

  return {
    tmax_mean,
    tmin_mean,
    tmean_mean,
    rain_total,
    gust_max,
    rainrate_max,
    press_min,
    press_max,
    rh_min,
    rh_max,
    uv_max,
    solar_max,
  };
}

function yearlyAggFromRows(rs) {
  const tmax_abs = max(rs.map((r) => r.tmax));
  const tmin_abs = min(rs.map((r) => r.tmin));
  const tmean = mean(rs.map((r) => r.tmean));

  const rain_total = sum(rs.map((r) => r.rain_total));
  const gust_max = max(rs.map((r) => r.gust_max));
  const rainrate_max = max(rs.map((r) => r.rainrate_max));

  const press_min = min(rs.map((r) => r.press_min));
  const press_max = max(rs.map((r) => r.press_max));

  const rh_min = min(rs.map((r) => r.rh_min));
  const rh_max = max(rs.map((r) => r.rh_max));

  const uv_max = max(rs.map((r) => r.uv_max));
  const solar_max = max(rs.map((r) => r.solar_max));

  return {
    tmax_abs,
    tmin_abs,
    tmean,
    rain_total,
    gust_max,
    rainrate_max,
    press_min,
    press_max,
    rh_min,
    rh_max,
    uv_max,
    solar_max,
  };
}

// ====== ranking per "mese dell'anno" (tutti i Gennaio, tutti i Febbraio, ecc.) ======
function buildMonthlyByMonthOfYear(rows) {
  const byYM = groupByYM(rows);

  const monthlyList = [];
  for (const [ym, rs] of byYM.entries()) {
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(5, 7));
    const agg = monthlyAggFromRows(rs);
    monthlyList.push({ year, month, ym, ...agg });
  }

  const byMonth = {};
  for (let m = 1; m <= 12; m++) byMonth[pad2(m)] = [];
  for (const it of monthlyList) byMonth[pad2(it.month)].push(it);

  const out = {};
  for (const mm of Object.keys(byMonth)) {
    const list = byMonth[mm];
    const rank = (field, dir) =>
      topN(
        list.filter((x) => isNum(x[field])).map((x) => ({ value: x[field], year: x.year, month: x.month })),
        dir
      );

    out[mm] = {
      tmax_mean_high: rank("tmax_mean", "desc"),
      tmax_mean_low: rank("tmax_mean", "asc"),
      tmin_mean_low: rank("tmin_mean", "asc"),
      tmin_mean_high: rank("tmin_mean", "desc"),
      tmean_high: rank("tmean_mean", "desc"),
      tmean_low: rank("tmean_mean", "asc"),
      rain_total_high: rank("rain_total", "desc"),
      gust_max_high: rank("gust_max", "desc"),
      rainrate_max_high: rank("rainrate_max", "desc"),
    };
  }

  return out;
}

// ====== ranking mensile "dentro un anno" (tra i 12 mesi del 2021, 2022, ...) ======
function buildMonthlyByYear(rows) {
  const byYM = groupByYM(rows);

  const monthlyList = [];
  for (const [ym, rs] of byYM.entries()) {
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(5, 7));
    const agg = monthlyAggFromRows(rs);
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
    const rank = (field, dir) =>
      topN(
        list.filter((x) => isNum(x[field])).map((x) => ({ value: x[field], year: x.year, month: x.month })),
        dir
      );

    out[yy] = {
      tmax_mean_high: rank("tmax_mean", "desc"),
      tmax_mean_low: rank("tmax_mean", "asc"),
      tmin_mean_low: rank("tmin_mean", "asc"),
      tmin_mean_high: rank("tmin_mean", "desc"),
      tmean_high: rank("tmean_mean", "desc"),
      tmean_low: rank("tmean_mean", "asc"),
      rain_total_high: rank("rain_total", "desc"),
      gust_max_high: rank("gust_max", "desc"),
      rainrate_max_high: rank("rainrate_max", "desc"),
      press_min_low: rank("press_min", "asc"),
      press_max_high: rank("press_max", "desc"),
      rh_min_low: rank("rh_min", "asc"),
      rh_max_high: rank("rh_max", "desc"),
      uv_max_high: rank("uv_max", "desc"),
      solar_max_high: rank("solar_max", "desc"),
    };
  }

  return out;
}

function buildYearly(rows) {
  const byY = groupByYear(rows);

  const yearlyList = [];
  for (const [yy, rs] of byY.entries()) {
    const year = Number(yy);
    const agg = yearlyAggFromRows(rs);
    yearlyList.push({ year, ...agg });
  }

  const rank = (field, dir) =>
    topN(
      yearlyList.filter((x) => isNum(x[field])).map((x) => ({ value: x[field], year: x.year })),
      dir
    );

  return {
    tmax_abs_high: rank("tmax_abs", "desc"),
    tmin_abs_low: rank("tmin_abs", "asc"),
    tmean_high: rank("tmean", "desc"),
    tmean_low: rank("tmean", "asc"),
    rain_total_high: rank("rain_total", "desc"),
    gust_max_high: rank("gust_max", "desc"),
    rainrate_max_high: rank("rainrate_max", "desc"),
    press_min_low: rank("press_min", "asc"),
    press_max_high: rank("press_max", "desc"),
  };
}

// -------------------- main --------------------
function main() {
  if (!fs.existsSync(IN_DAILY)) {
    console.error("daily.json non trovato:", IN_DAILY);
    process.exit(1);
  }

  const rows = readJSON(IN_DAILY)
    .filter((r) => r && typeof r.date === "string" && r.date.length >= 10)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 1) calcola UNA volta sola i derivati da intraday e li attacca alle righe
  attachDerivedDailyFields(rows);

  // 2) daily global (compatibilità: stessi campi di prima)
  const daily = buildDailyRanks(rows);

  // 3) daily per mese dell'anno / per anno / per anno+mese
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

  // 4) monthly / yearly (come prima + by_year)
  const monthly = {
    by_month: buildMonthlyByMonthOfYear(rows), // tutti i Gennaio / Febbraio / ...
    by_year: buildMonthlyByYear(rows),         // dentro un anno: Gen..Dic del 2021, ecc.
  };

  const yearly = buildYearly(rows);

  const out = {
    generated_at: new Date().toISOString(),
    top_n: TOP_N,

    // compatibilità (pagina attuale): records.daily.tmax_abs_high ecc.
    daily: {
      ...daily,

      // nuove viste per filtri veri (no "filtro dentro top globale")
      by_month: dailyByMonth,           // "01".."12"
      by_year: dailyByYear,             // "2021"...
      by_year_month: dailyByYearMonth,  // "2021" -> "01" -> ...
    },

    monthly,
    yearly,
  };

  writeJSON(OUT_RECORDS, out);
  console.log("OK -> scritto", OUT_RECORDS);
}

main();