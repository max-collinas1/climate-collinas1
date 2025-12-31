const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const ROOT = process.cwd();

const IN_DIR = path.join(ROOT, "data_raw", "clean");
const OUT_DAILY = path.join(ROOT, "data", "daily.json");
const OUT_INTRADAY_DIR = path.join(ROOT, "public", "data", "intraday");

// ==================== config ====================
const CARDINAL_STEP_DEG = 22.5; // 16 venti
const RAIN_TICK_MM = 0.2;

// ==================== utils ====================
function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;

  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      if (!name || name.startsWith(".")) continue;
      const full = path.join(d, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const x = name.toLowerCase();
        if (x.endsWith(".csv") || x.endsWith(".txt")) out.push(full);
      }
    }
  }

  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function clearIntradayJson(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.toLowerCase().endsWith(".json")) {
      fs.unlinkSync(path.join(dir, f));
    }
  }
}

function normKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\u00b0/g, "")
    .replace(/[().]/g, "")
    .replace(/[%]/g, "pct")
    .replace(/w\/?m2/g, "wm2")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sniffDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/).find((l) => l.trim() !== "") || "";
  const count = (ch) => (firstLine.match(new RegExp(`\\${ch}`, "g")) || []).length;
  const commas = count(",");
  const semis = count(";");
  const tabs = count("\t");

  if (semis > commas && semis > tabs) return ";";
  if (tabs > commas && tabs > semis) return "\t";
  return ",";
}

function toNum(x) {
  if (x === "" || x === null || x === undefined) return NaN;
  const s = String(x).trim();
  if (!s) return NaN;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function numOrNull(x) {
  const n = toNum(x);
  return Number.isFinite(n) ? n : null;
}

function mean(vals) {
  const v = vals.filter(Number.isFinite);
  if (!v.length) return NaN;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function minv(vals) {
  const v = vals.filter(Number.isFinite);
  if (!v.length) return NaN;
  return Math.min(...v);
}

function maxv(vals) {
  const v = vals.filter(Number.isFinite);
  if (!v.length) return NaN;
  return Math.max(...v);
}

function normalizeDate(x) {
  if (x === null || x === undefined || x === "") return "";
  const s = String(x).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, "0");
    const mm = String(m[2]).padStart(2, "0");
    const yy = m[3];
    return `${yy}-${mm}-${dd}`;
  }

  return s;
}

function normalizeTime(x) {
  if (x === null || x === undefined || x === "") return "";
  const s = String(x).trim();
  if (s === "OVR") return "OVR";

  const ampm = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let hh = Number(ampm[1]);
    const mm = Number(ampm[2]);
    const ap = ampm[3].toUpperCase();
    if (ap === "PM" && hh !== 12) hh += 12;
    if (ap === "AM" && hh === 12) hh = 0;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  const hm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) {
    const hh = String(hm[1]).padStart(2, "0");
    const mm = String(hm[2]).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const n = Number(s);
  if (Number.isFinite(n) && n >= 0 && n < 1) {
    const totalMin = Math.round(n * 24 * 60);
    const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
    const mm = String(totalMin % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  return s;
}

function isValidTimeToken(t) {
  return t === "OVR" || /^\d{2}:\d{2}$/.test(String(t || ""));
}

function isObsRow(r) {
  return r.time && r.time !== "OVR" && isValidTimeToken(r.time);
}

function isOvrRow(r) {
  return r.time === "OVR" && r.key;
}

// ==================== header mapping ====================
const HEADER_MAP = new Map([
  ["date", "date"],
  ["time", "time"],

  ["temp_c", "temp_c"],
  ["dewpoint_c", "dewpoint_c"],
  ["rh_pct", "rh_pct"],

  ["wind_dir_txt", "wind_dir_txt"],
  ["wind_kmh", "wind_kmh"],
  ["gust_kmh", "gust_kmh"],
  ["wind_dir_deg", "wind_dir_deg"],

  ["press_hpa", "press_hpa"],
  ["rain_rate_mmph", "rain_rate_mmph"],
  ["rain_acc_mm", "rain_acc_mm"],

  ["uv", "uv"],
  ["solar_wm2", "solar_wm2"],

  ["key", "key"],
  ["value", "value"],
]);

function mapHeaders(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const nk = normKey(k);
    const mapped = HEADER_MAP.get(nk);
    if (mapped) out[mapped] = v;
    else out[nk] = v;
  }
  return out;
}

function readCsv(filePath) {
  const txt = fs.readFileSync(filePath, "utf8");
  const delimiter = sniffDelimiter(txt);

  const rows = parse(txt, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
  });

  return rows.map(mapHeaders);
}

// ==================== meteo helpers ====================
function cardinalToDeg(txt) {
  const raw = String(txt || "").trim().toUpperCase();
  if (!raw) return null;

  const alias = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };
  const s = alias[raw] || raw;

  const order = [
    "N",
    "NNW",
    "NW",
    "WNW",
    "W",
    "WSW",
    "SW",
    "SSW",
    "S",
    "SSE",
    "SE",
    "ESE",
    "E",
    "ENE",
    "NE",
    "NNE",
  ];

  const idx = order.indexOf(s);
  if (idx === -1) return null;

  return idx * CARDINAL_STEP_DEG;
}

function circularMeanDeg(degs) {
  const vals = degs.filter((d) => Number.isFinite(d));
  if (!vals.length) return null;

  let sx = 0;
  let sy = 0;
  for (const d of vals) {
    const rad = (d * Math.PI) / 180;
    sx += Math.cos(rad);
    sy += Math.sin(rad);
  }
  const meanRad = Math.atan2(sy / vals.length, sx / vals.length);
  let meanDeg = (meanRad * 180) / Math.PI;
  if (meanDeg < 0) meanDeg += 360;
  return meanDeg;
}

function rainDeltasFixed(obsRows, tickMm = RAIN_TICK_MM) {
  const deltas = [];
  let prev = NaN;

  for (const r of obsRows) {
    const acc = toNum(r.rain_acc_mm);
    let d = NaN;

    if (Number.isFinite(acc) && Number.isFinite(prev)) {
      d = acc - prev;
      if (d < 0) d = acc;
    } else if (Number.isFinite(acc) && !Number.isFinite(prev)) {
      d = acc;
    }

    if (!Number.isFinite(d) || d < 0) d = 0;
    d = Math.floor(d / tickMm + 1e-9) * tickMm;

    deltas.push(d);
    prev = acc;
  }
  return deltas;
}

function rollingMaxSum(arr, win) {
  if (arr.length < win) return 0;
  let s = 0;
  for (let i = 0; i < win; i++) s += arr[i];
  let max = s;
  for (let i = win; i < arr.length; i++) {
    s += arr[i] - arr[i - win];
    if (s > max) max = s;
  }
  return max;
}

// ==================== main ====================
function main() {
  ensureDir(path.join(ROOT, "data"));
  ensureDir(OUT_INTRADAY_DIR);

  clearIntradayJson(OUT_INTRADAY_DIR);

  const files = listFiles(IN_DIR);
  if (!files.length) {
    console.log("Nessun file CSV trovato in", IN_DIR);
    process.exit(1);
  }

  console.log("Input files:");
  for (const f of files) console.log(" -", path.relative(IN_DIR, f));

  let rowsAll = [];
  for (const f of files) {
    const rows = readCsv(f);
    rowsAll = rowsAll.concat(rows);
  }

  for (const r of rowsAll) {
    r.date = normalizeDate(r.date);
    r.time = normalizeTime(r.time);

    if (!Number.isFinite(toNum(r.wind_dir_deg))) {
      const fromCard = cardinalToDeg(r.wind_dir_txt);
      if (Number.isFinite(fromCard)) r.wind_dir_deg = fromCard;
    }
  }

  const byDate = new Map();
  for (const r of rowsAll) {
    const date = String(r.date || "").trim();
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(r);
  }

  const datesSorted = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b));
  console.log("Giorni trovati:", datesSorted.length, datesSorted[0], "->", datesSorted[datesSorted.length - 1]);

  const daily = [];

  for (const date of datesSorted) {
    const rows = byDate.get(date);

    const obs = rows.filter(isObsRow).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    const ovr = rows.filter(isOvrRow);

    const override = {};
    for (const r of ovr) {
      const k = String(r.key).trim();
      const v = toNum(r.value);
      if (k && Number.isFinite(v)) override[k] = v;
    }

    const tvals = obs.map((r) => toNum(r.temp_c));
    const dpvals = obs.map((r) => toNum(r.dewpoint_c));
    const rhvals = obs.map((r) => toNum(r.rh_pct));
    const wvals = obs.map((r) => toNum(r.wind_kmh));
    const gvals = obs.map((r) => toNum(r.gust_kmh));
    const pvals = obs.map((r) => toNum(r.press_hpa));
    const dvals = obs.map((r) => toNum(r.wind_dir_deg));
    const uvvals = obs.map((r) => toNum(r.uv));
    const solvals = obs.map((r) => toNum(r.solar_wm2));
    const rrvals = obs.map((r) => toNum(r.rain_rate_mmph));

    const tmin_calc = minv(tvals);
    const tmax_calc = maxv(tvals);
    const tmean = mean(tvals);

    const dewpoint_mean = mean(dpvals);
    const rh_mean = mean(rhvals);

    const wind_avg = mean(wvals);
    const wind_max = maxv(wvals);
    const gust_max_calc = maxv(gvals);

    const press_avg = mean(pvals);
    const press_min = minv(pvals);
    const press_max = maxv(pvals);

    const wind_dir_mean_deg = circularMeanDeg(dvals.filter(Number.isFinite));

    const deltas15 = rainDeltasFixed(obs, RAIN_TICK_MM);
    const rain_total = deltas15.reduce((s, x) => s + x, 0);

    const rain_15m_max = deltas15.length ? Math.max(...deltas15) : 0;
    const rain_30m_max = rollingMaxSum(deltas15, 2);
    const rain_1h_max = rollingMaxSum(deltas15, 4);
    const rain_3h_max = rollingMaxSum(deltas15, 12);
    const rain_6h_max = rollingMaxSum(deltas15, 24);
    const rain_12h_max = rollingMaxSum(deltas15, 48);
    const rain_24h_max = rollingMaxSum(deltas15, 96);

    const rainrate_max_calc = maxv(rrvals);
    const uv_max = maxv(uvvals);
    const solar_max = maxv(solvals);

    const tmin = Number.isFinite(override.tmin) ? override.tmin : tmin_calc;
    const tmax = Number.isFinite(override.tmax) ? override.tmax : tmax_calc;
    const gust_max = Number.isFinite(override.gustmax) ? override.gustmax : gust_max_calc;
    const rainrate_max = Number.isFinite(override.rainrate_max) ? override.rainrate_max : rainrate_max_calc;

    daily.push({
      date,

      // temperature
      tmin,
      tmax,
      tmean,

      // medie utili
      dewpoint_mean,
      rh_mean,

      // vento/pressione
      wind_avg,
      wind_max,
      wind_dir_mean_deg,
      gust_max,
      press_avg,
      press_min,
      press_max,

      // pioggia
      rain_total,
      rainrate_max,
      rain_15m_max,
      rain_30m_max,
      rain_1h_max,
      rain_3h_max,
      rain_6h_max,
      rain_12h_max,
      rain_24h_max,

      // radiazione
      uv_max,
      solar_max,
    });

    const intraday = obs.map((r, i) => ({
      t: `${date} ${String(r.time).slice(0, 5)}`,
      temp_c: numOrNull(r.temp_c),
      dewpoint_c: numOrNull(r.dewpoint_c),
      rh_pct: numOrNull(r.rh_pct),
      wind_dir_txt: r.wind_dir_txt === "" || r.wind_dir_txt == null ? null : String(r.wind_dir_txt),
      wind_dir_deg: numOrNull(r.wind_dir_deg),
      wind_kmh: numOrNull(r.wind_kmh),
      gust_kmh: numOrNull(r.gust_kmh),
      press_hpa: numOrNull(r.press_hpa),
      uv: numOrNull(r.uv),
      solar_wm2: numOrNull(r.solar_wm2),
      rain_15m_mm: Number.isFinite(deltas15[i]) ? deltas15[i] : 0,
      rain_acc_mm: numOrNull(r.rain_acc_mm),
      rain_rate_mmph: numOrNull(r.rain_rate_mmph),
    }));

    fs.writeFileSync(path.join(OUT_INTRADAY_DIR, `${date}.json`), JSON.stringify(intraday));
  }

  fs.writeFileSync(OUT_DAILY, JSON.stringify(daily, null, 2));
  console.log("OK:", daily.length, "giorni ->", OUT_DAILY);
}

main();