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
function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}
function daysInYear(year) {
  const y = Number(year);
  return new Date(y, 1, 29).getMonth() === 1 ? 366 : 365;
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
    isNum(r.tmax) && isNum(r.tmin) ? (r.tmax - r.tmin) : null
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
    temperature: coverageRatio(rows, expectedDays, (r) => r.tmean),
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
function monthlyAggFromRows(year, month, rs) {
  const expectedDays = daysInMonth(year, month);
  const coverage_by_param = buildCoverageByParam(rs, expectedDays);

  return {
    tmax_mean: mean(rs.map((r) => r.tmax)),
    tmin_mean: mean(rs.map((r) => r.tmin)),
    tmean_mean: mean(rs.map((r) => r.tmean)),
    trange_mean: mean(rs.map((r) => getTempRangeDaily(r))),

    rain_total: sum(rs.map((r) => r.rain_total)),
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

function longestDrySpellDays(rs) {
  const sorted = [...rs].sort((a, b) => a.date.localeCompare(b.date));
  let best = 0;
  let cur = 0;

  for (const r of sorted) {
    const rain = r.rain_total;
    if (isNum(rain) && rain > 1) {
      if (cur > best) best = cur;
      cur = 0;
    } else {
      cur += 1;
    }
  }
  if (cur > best) best = cur;
  return best;
}

function yearlyAggFromRows(year, rs) {
  const expectedDays = daysInYear(year);
  const coverage_by_param = buildCoverageByParam(rs, expectedDays);

  return {
    tmax_mean: mean(rs.map((r) => r.tmax)),
    tmean_mean: mean(rs.map((r) => r.tmean)),
    tmin_mean: mean(rs.map((r) => r.tmin)),
    trange_mean: mean(rs.map((r) => getTempRangeDaily(r))),

    rain_total: sum(rs.map((r) => r.rain_total)),
    rain_days_gt_1mm: countWhere(rs, (r) => isNum(r.rain_total) && r.rain_total > 1),
    longest_dry_spell: longestDrySpellDays(rs),
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
      })),
    dir
  );
}

function rankYearly(list, field, dir) {
  return topN(
    list
      .filter((x) => isNum(x[field]))
      .map((x) => ({
        value: x[field],
        year: x.year,
        coverage_by_param: x.coverage_by_param,
      })),
    dir
  );
}

// ====== ranking per "mese dell'anno" ======
function buildMonthlyByMonthOfYear(rows) {
  const byYM = groupByYM(rows);

  const monthlyList = [];
  for (const [ym, rs] of byYM.entries()) {
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(5, 7));
    const agg = monthlyAggFromRows(year, month, rs);
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
      })),
    };
  }

  return out;
}

// ====== ranking mensile dentro un anno ======
function buildMonthlyByYear(rows) {
  const byYM = groupByYM(rows);

  const monthlyList = [];
  for (const [ym, rs] of byYM.entries()) {
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(5, 7));
    const agg = monthlyAggFromRows(year, month, rs);
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
      })),
    };
  }

  return out;
}

function buildYearly(rows) {
  const byY = groupByYear(rows);

  const yearlyList = [];
  for (const [yy, rs] of byY.entries()) {
    const year = Number(yy);
    const agg = yearlyAggFromRows(year, rs);
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

    rain_total_high: rankYearly(yearlyList, "rain_total", "desc"),
    rain_total_low: rankYearly(yearlyList, "rain_total", "asc"),
    rain_days_over_1mm_high: rankYearly(yearlyList, "rain_days_gt_1mm", "desc"),
    rain_days_over_1mm_low: rankYearly(yearlyList, "rain_days_gt_1mm", "asc"),
    longest_dry_spell_high: rankYearly(yearlyList, "longest_dry_spell", "desc"),
    longest_dry_spell_low: rankYearly(yearlyList, "longest_dry_spell", "asc"),
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
      rain_total: x.rain_total,
      rain_days_gt_1mm: x.rain_days_gt_1mm,
      longest_dry_spell: x.longest_dry_spell,
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
    by_month: buildMonthlyByMonthOfYear(rows),
    by_year: buildMonthlyByYear(rows),
  };

  const yearly = buildYearly(rows);

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