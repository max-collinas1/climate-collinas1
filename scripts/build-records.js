/* scripts/build-records.js
 * Genera data/record.json a partire da data/daily.json
 * Output: ranking giornalieri, mensili (per mese dell'anno), annuali
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const IN_DAILY = path.join(ROOT, "data", "daily.json");
const OUT_RECORDS = path.join(ROOT, "data", "record.json");

const TOP_N = 10;

function readJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}

function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function ymOf(dateStr) {
  // YYYY-MM-DD -> YYYY-MM
  return dateStr.slice(0, 7);
}

function yOf(dateStr) {
  return dateStr.slice(0, 4);
}

function mOf(dateStr) {
  return dateStr.slice(5, 7);
}

function sortByValue(arr, dir /* "asc" | "desc" */) {
  const mul = dir === "asc" ? 1 : -1;
  return [...arr].sort((a, b) => {
    const av = a.value;
    const bv = b.value;
    if (av === bv) {
      // tie-break stabile: data/chiave
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

function dailyRank(rows, field, dir) {
  const out = [];
  for (const r of rows) {
    const v = r[field];
    if (!isNum(v)) continue;
    out.push({ value: v, date: r.date });
  }
  return topN(out, dir);
}

function dailyRankWithYearMonth(rows, field, dir) {
  // se serve in futuro: qui non usata
  const out = [];
  for (const r of rows) {
    const v = r[field];
    if (!isNum(v)) continue;
    out.push({ value: v, date: r.date, year: Number(yOf(r.date)), month: Number(mOf(r.date)) });
  }
  return topN(out, dir);
}

function groupByYM(rows) {
  const map = new Map(); // ym -> array rows
  for (const r of rows) {
    const ym = ymOf(r.date);
    if (!map.has(ym)) map.set(ym, []);
    map.get(ym).push(r);
  }
  return map;
}

function groupByYear(rows) {
  const map = new Map(); // yyyy -> array rows
  for (const r of rows) {
    const y = yOf(r.date);
    if (!map.has(y)) map.set(y, []);
    map.get(y).push(r);
  }
  return map;
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

function monthlyAggFromRows(rs) {
  // Aggregati mensili dal daily:
  // - medie: tmax/tmin/tmean/rh_mean/press_avg/wind_avg
  // - totali: rain_total
  // - estremi mensili: gust_max, rainrate_max, press_min, press_max, uv_max, solar_max, rh_min, rh_max
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
  // Aggregati annuali: simili ai mensili ma su anno intero
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

function buildMonthlyByMonthOfYear(rows) {
  // 1) aggrego per anno-mese (YYYY-MM)
  const byYM = groupByYM(rows);

  // 2) trasformo in lista di record mensili {year, month, ...aggregati}
  const monthlyList = [];
  for (const [ym, rs] of byYM.entries()) {
    const year = Number(ym.slice(0, 4));
    const month = Number(ym.slice(5, 7));
    const agg = monthlyAggFromRows(rs);
    monthlyList.push({ year, month, ym, ...agg });
  }

  // 3) raggruppo per mese dell'anno ("01"..."12")
  const byMonth = {};
  for (let m = 1; m <= 12; m++) byMonth[pad2(m)] = [];

  for (const it of monthlyList) {
    const mm = pad2(it.month);
    byMonth[mm].push(it);
  }

  // 4) per ogni mese creo i ranking stile immagine
  const out = {};
  for (const mm of Object.keys(byMonth)) {
    const list = byMonth[mm];

    const rank = (field, dir) =>
      topN(
        list
          .filter((x) => isNum(x[field]))
          .map((x) => ({ value: x[field], year: x.year, month: x.month })),
        dir
      );

    out[mm] = {
      // temperature "medie delle massime" (tmax_mean)
      tmax_mean_high: rank("tmax_mean", "desc"),
      tmax_mean_low: rank("tmax_mean", "asc"),

      // temperature "medie delle minime" (tmin_mean)
      tmin_mean_low: rank("tmin_mean", "asc"),
      tmin_mean_high: rank("tmin_mean", "desc"),

      // temperatura media del mese (tmean_mean)
      tmean_high: rank("tmean_mean", "desc"),
      tmean_low: rank("tmean_mean", "asc"),

      // precipitazione totale mensile
      rain_total_high: rank("rain_total", "desc"),

      // estremi mensili
      gust_max_high: rank("gust_max", "desc"),
      rainrate_max_high: rank("rainrate_max", "desc"),
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
      yearlyList
        .filter((x) => isNum(x[field]))
        .map((x) => ({ value: x[field], year: x.year })),
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

function main() {
  if (!fs.existsSync(IN_DAILY)) {
    console.error("daily.json non trovato:", IN_DAILY);
    process.exit(1);
  }

  const rows = readJSON(IN_DAILY)
    .filter((r) => r && typeof r.date === "string" && r.date.length >= 10)
    .sort((a, b) => a.date.localeCompare(b.date));

  // --- daily records (giornalieri)
  const daily = {
    // assoluti temperatura
    tmax_abs_high: dailyRank(rows, "tmax", "desc"),
    tmax_abs_low: dailyRank(rows, "tmax", "asc"),
    tmin_abs_low: dailyRank(rows, "tmin", "asc"),
    tmin_abs_high: dailyRank(rows, "tmin", "desc"),

    // media giornaliera
    tmean_high: dailyRank(rows, "tmean", "desc"),
    tmean_low: dailyRank(rows, "tmean", "asc"),

    // pioggia / vento
    rain_total_high: dailyRank(rows, "rain_total", "desc"),
    rainrate_max_high: dailyRank(rows, "rainrate_max", "desc"),
    gust_max_high: dailyRank(rows, "gust_max", "desc"),

    // pressione / umidità / radiazione
    press_min_low: dailyRank(rows, "press_min", "asc"),
    press_max_high: dailyRank(rows, "press_max", "desc"),
    rh_min_low: dailyRank(rows, "rh_min", "asc"),
    rh_max_high: dailyRank(rows, "rh_max", "desc"),
    uv_max_high: dailyRank(rows, "uv_max", "desc"),
    solar_max_high: dailyRank(rows, "solar_max", "desc"),
  };

  // --- monthly records (per mese dell'anno)
  const monthly = {
    by_month: buildMonthlyByMonthOfYear(rows),
  };

  // --- yearly records
  const yearly = buildYearly(rows);

  const out = {
    generated_at: new Date().toISOString(),
    top_n: TOP_N,
    daily,
    monthly,
    yearly,
  };

  writeJSON(OUT_RECORDS, out);
  console.log("OK -> scritto", OUT_RECORDS);
}

main();