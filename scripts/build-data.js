// ==================== build-data.js (FULL) ====================
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

// watch debounce (ms)
const WATCH_DEBOUNCE_MS = 600;

// qualità medie giornaliere (15-min)
const QH_PER_DAY = 96; // 24h * 4
const MIN_COVERAGE = 0.9; // 90%
const MIN_SAMPLES_FOR_MEAN = Math.ceil(QH_PER_DAY * MIN_COVERAGE); // 87

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
    if (f.toLowerCase().endsWith(".json")) fs.unlinkSync(path.join(dir, f));
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

// parse robusto anche con unità tipo "76%" "1013.2 hPa" "12.3 °C"
function toNum(x) {
  if (x === "" || x === null || x === undefined) return NaN;
  let s = String(x).trim();
  if (!s) return NaN;

  if (s === "-" || s === "—") return NaN;

  s = s
    .replaceAll("%", "")
    .replaceAll("°C", "")
    .replaceAll("°", "")
    .replaceAll("km/h", "")
    .replaceAll("mm/h", "")
    .replaceAll("mm", "")
    .replaceAll("hPa", "")
    .replaceAll("W/m²", "")
    .replaceAll("W/m2", "")
    .trim();

  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function numOrNull(x) {
  const n = toNum(x);
  return Number.isFinite(n) ? n : null;
}

function meanMin(vals, minCount = MIN_SAMPLES_FOR_MEAN) {
  const v = (vals || []).filter(Number.isFinite);
  if (v.length < minCount) return null;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

// media solo dei valori > 0 (se nessun valore > 0 => null)
function meanPositive(vals) {
  const v = (vals || []).filter((x) => Number.isFinite(x) && x > 0);
  if (!v.length) return null;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function minv(vals) {
  const v = (vals || []).filter(Number.isFinite);
  if (!v.length) return null;
  return Math.min(...v);
}
function maxv(vals) {
  const v = (vals || []).filter(Number.isFinite);
  if (!v.length) return null;
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

// ==================== CSV read (robusto) ====================
const DEFAULT_COLUMNS_NO_HEADER = [
  "date",
  "time",
  "temp_c",
  "dewpoint_c",
  "rh_pct",
  "wind_dir_txt",
  "wind_kmh",
  "gust_kmh",
  "press_hpa",
  "rain_rate_mmph",
  "rain_acc_mm",
  "uv",
  "solar_wm2",
  "key",
  "value",
];

function isNoHeaderParsedWrong(rowsParsed) {
  if (!rowsParsed || !rowsParsed.length) return false;
  const first = rowsParsed[0];
  const keys = Object.keys(first || {});
  if (!keys.length) return false;

  const k0 = String(keys[0] || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(k0)) return true;

  const normKeys = keys.map(normKey);
  const hasDate = normKeys.includes("date");
  const hasTime = normKeys.includes("time");
  if (!hasDate || !hasTime) {
    if (keys.some((k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k).trim()))) return true;
  }
  return false;
}

function readCsv(filePath) {
  const txt = fs.readFileSync(filePath, "utf8");
  const delimiter = sniffDelimiter(txt);

  let rows = parse(txt, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
  });

  if (isNoHeaderParsedWrong(rows)) {
    rows = parse(txt, {
      columns: DEFAULT_COLUMNS_NO_HEADER,
      skip_empty_lines: true,
      trim: true,
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
    });
  }

  return rows.map(mapHeaders);
}

// ==================== meteo helpers ====================
// ✅ FIX: ordine corretto (senso orario meteorologico)
function cardinalToDeg(txt) {
  const raw = String(txt || "").trim().toUpperCase();
  if (!raw) return null;

  const alias = { NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };
  const s = alias[raw] || raw;

  // N=0, E=90, S=180, W=270
  const order = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const idx = order.indexOf(s);
  if (idx === -1) return null;

  return idx * CARDINAL_STEP_DEG;
}

function circularMeanDegMin(degs, minCount = MIN_SAMPLES_FOR_MEAN) {
  const vals = (degs || []).filter((d) => Number.isFinite(d));
  if (vals.length < minCount) return null;

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

/**
 * FIX PRECIPITAZIONI:
 * - non fidarsi del "rain_rate_mmph" del CSV: può essere >0 anche con rain_acc_mm fermo (come nel tuo Maggio.csv).
 * - quindi:
 *   1) calcolo i delta da rain_acc_mm (mm/15min)
 *   2) ricavo il rate "fisico" come delta*4 (mm/h)
 *   3) rainrate_max e intraday rain_rate_mmph derivano SOLO da delta (zero delta => zero intensità)
 */
function rainDeltasFromAcc(obsRows, tickMm = RAIN_TICK_MM) {
  const deltas = [];
  let prev = NaN;

  for (let i = 0; i < obsRows.length; i++) {
    const acc = toNum(obsRows[i].rain_acc_mm);
    let d = 0;

    if (!Number.isFinite(acc)) {
      d = 0;
    } else if (!Number.isFinite(prev)) {
      // primo valore valido del giorno: baseline, non pioggia
      d = 0;
      prev = acc;
    } else {
      const diff = acc - prev;
      if (diff >= 0) d = diff;
      else d = acc; // reset contatore
      prev = acc;
    }

    if (!Number.isFinite(d) || d < 0) d = 0;
    d = Math.floor(d / tickMm + 1e-9) * tickMm;

    deltas.push(d);
  }

  return deltas;
}

function rollingMaxSum(arr, win) {
  const n = (arr || []).length;
  if (!n) return null;

  const w = Math.min(win, n);
  let s = 0;
  for (let i = 0; i < w; i++) s += arr[i];
  let max = s;

  for (let i = w; i < n; i++) {
    s += arr[i] - arr[i - w];
    if (s > max) max = s;
  }
  return max;
}

function pickOverrideNumber(overrideNum, ...keys) {
  for (const k of keys) {
    if (Number.isFinite(overrideNum[k])) return overrideNum[k];
  }
  return null;
}

function pickOverrideDirDeg(overrideNum, overrideStr, ...keys) {
  for (const k of keys) {
    if (Number.isFinite(overrideNum[k])) return overrideNum[k];
  }
  for (const k of keys) {
    const s = overrideStr[k];
    if (typeof s === "string" && s.trim()) {
      const d = cardinalToDeg(s);
      if (Number.isFinite(d)) return d;
      const n = toNum(s);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

// ==================== build ====================
let isBuilding = false;

function buildOnce() {
  if (isBuilding) return;
  isBuilding = true;

  const started = Date.now();
  try {
    ensureDir(path.join(ROOT, "data"));
    ensureDir(OUT_INTRADAY_DIR);

    clearIntradayJson(OUT_INTRADAY_DIR);

    const files = listFiles(IN_DIR);
    if (!files.length) {
      console.log("Nessun file CSV trovato in", IN_DIR);
      isBuilding = false;
      return;
    }

    console.log("\n[build-data] Input files:");
    for (const f of files) console.log(" -", path.relative(IN_DIR, f));

    let rowsAll = [];
    for (const f of files) rowsAll = rowsAll.concat(readCsv(f));

    for (const r of rowsAll) {
      r.date = normalizeDate(r.date);
      r.time = normalizeTime(r.time);

      // se manca il numerico, lo calcolo dal testuale (NW/WEST/...)
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
    console.log(
      "[build-data] Giorni trovati:",
      datesSorted.length,
      datesSorted[0],
      "->",
      datesSorted[datesSorted.length - 1]
    );

    const daily = [];

    for (const date of datesSorted) {
      const rows = byDate.get(date);

      const obs = rows.filter(isObsRow).sort((a, b) => String(a.time).localeCompare(String(b.time)));
      const ovr = rows.filter(isOvrRow);

      const overrideNum = {};
      const overrideStr = {};
      for (const r of ovr) {
        const k = normKey(r.key);
        const raw = r.value === null || r.value === undefined ? "" : String(r.value).trim();
        if (!k) continue;
        overrideStr[k] = raw;

        const v = toNum(raw);
        if (Number.isFinite(v)) overrideNum[k] = v;
      }

      const hasObs = obs.length > 0;

      const tvals = hasObs ? obs.map((r) => toNum(r.temp_c)) : [];
      const dpvals = hasObs ? obs.map((r) => toNum(r.dewpoint_c)) : [];
      const rhvals = hasObs ? obs.map((r) => toNum(r.rh_pct)) : [];
      const wvals = hasObs ? obs.map((r) => toNum(r.wind_kmh)) : [];
      const gvals = hasObs ? obs.map((r) => toNum(r.gust_kmh)) : [];
      const pvals = hasObs ? obs.map((r) => toNum(r.press_hpa)) : [];
      const dvals = hasObs ? obs.map((r) => toNum(r.wind_dir_deg)) : [];
      const uvvals = hasObs ? obs.map((r) => toNum(r.uv)) : [];
      const solvals = hasObs ? obs.map((r) => toNum(r.solar_wm2)) : [];

      const tmin_calc = minv(tvals);
      const tmax_calc = maxv(tvals);

      const tmean = meanMin(tvals);
      const dewpoint_mean = meanMin(dpvals);
      const rh_mean = meanMin(rhvals);
      const wind_avg = meanMin(wvals);
      const press_avg = meanMin(pvals);

      const rh_min = minv(rhvals);
      const rh_max = maxv(rhvals);

      const wind_max = maxv(wvals);
      const gust_max_calc = maxv(gvals);
      const press_min = minv(pvals);
      const press_max = maxv(pvals);

      const wind_dir_mean_calc = circularMeanDegMin(dvals);

      // ===== precip: tutto derivato da rain_acc_mm =====
      let deltas15 = [];
      let rates15 = [];
      let rain_total_calc = null;
      let rainrate_max_calc = null;

      if (hasObs) {
        deltas15 = rainDeltasFromAcc(obs, RAIN_TICK_MM); // mm per 15min
        rain_total_calc = deltas15.reduce((s, x) => s + x, 0);

        rates15 = deltas15.map((d) => d * 4); // mm/h
        rainrate_max_calc = maxv(rates15);
      }

      const rain_total_ovr = pickOverrideNumber(overrideNum, "rain_total", "rain_total_mm");
      const rain_total = rain_total_ovr !== null ? rain_total_ovr : rain_total_calc;

      // massimi su finestre (da deltas)
      const rain_15m_max = hasObs ? maxv(deltas15) : null;
      const rain_30m_max = hasObs ? rollingMaxSum(deltas15, 2) : null;
      const rain_1h_max = hasObs ? rollingMaxSum(deltas15, 4) : null;
      const rain_3h_max = hasObs ? rollingMaxSum(deltas15, 12) : null;
      const rain_6h_max = hasObs ? rollingMaxSum(deltas15, 24) : null;
      const rain_12h_max = hasObs ? rollingMaxSum(deltas15, 48) : null;
      const rain_24h_max = hasObs ? rollingMaxSum(deltas15, 96) : null;

      const uv_max = maxv(uvvals);
      const solar_max = maxv(solvals);

      const uv_mean_pos = meanPositive(uvvals);
      const solar_mean_pos = meanPositive(solvals);

      const tmin = Number.isFinite(overrideNum.tmin) ? overrideNum.tmin : tmin_calc;
      const tmax = Number.isFinite(overrideNum.tmax) ? overrideNum.tmax : tmax_calc;

      const gust_max = Number.isFinite(overrideNum.gustmax) ? overrideNum.gustmax : gust_max_calc;

      // rainrate_max: prendo OVR se presente, altrimenti il calcolo fisico da delta*4
      const rainrate_max_ovr = pickOverrideNumber(
        overrideNum,
        "rainrate_max",
        "rain_rate_max",
        "rain_r_max",
        "rain_rate_mmph_max"
      );
      let rainrate_max = rainrate_max_ovr !== null ? rainrate_max_ovr : rainrate_max_calc;

      const wind_dir_mean_deg_ovr = pickOverrideDirDeg(
        overrideNum,
        overrideStr,
        "wind_dir_mean_deg",
        "wind_dir_mean",
        "wind_dir_mean_direction",
        "direction",
        "dir_mean"
      );
      const wind_dir_mean_deg = wind_dir_mean_deg_ovr !== null ? wind_dir_mean_deg_ovr : wind_dir_mean_calc;

      // ===== CONSISTENZA: se accumulo nullo, intensità nullo =====
      // (serve proprio per casi tipo Maggio: rain_rate_mmph nel CSV >0 ma rain_acc_mm fermo)
      if (!(Number.isFinite(rain_total) && rain_total > 0)) {
        rainrate_max = 0;
      }

      daily.push({
        date,

        tmin,
        tmax,
        gust_max,

        rainrate_max,
        wind_dir_mean_deg,

        tmean,
        dewpoint_mean,
        rh_mean,
        rh_min,
        rh_max,

        wind_avg,
        wind_max,

        press_avg,
        press_min,
        press_max,

        uv_max,
        solar_max,

        uv_mean_pos,
        solar_mean_pos,

        rain_total,
        rain_15m_max,
        rain_30m_max,
        rain_1h_max,
        rain_3h_max,
        rain_6h_max,
        rain_12h_max,
        rain_24h_max,

        has_obs: hasObs,
        obs_count: obs.length,
        mean_min_samples: MIN_SAMPLES_FOR_MEAN,
      });

      // intraday: rain_rate_mmph DERIVATO dai delta (così nei grafici non appaiono spike “fantasma”)
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

        rain_15m_mm: Number.isFinite(deltas15[i]) ? deltas15[i] : null,
        rain_acc_mm: numOrNull(r.rain_acc_mm),

        // qui non uso il campo del CSV: uso rate fisico dal delta
        rain_rate_mmph: Number.isFinite(rates15[i]) ? rates15[i] : null,
      }));

      fs.writeFileSync(path.join(OUT_INTRADAY_DIR, `${date}.json`), JSON.stringify(intraday));
    }

    fs.writeFileSync(OUT_DAILY, JSON.stringify(daily, null, 2));

    const ms = Date.now() - started;
    console.log(`[build-data] OK: ${daily.length} giorni -> ${OUT_DAILY} (${ms} ms)`);
  } catch (e) {
    console.error("[build-data] ERRORE:", e);
  } finally {
    isBuilding = false;
  }
}

// ==================== watch ====================
function watchAndRebuild() {
  if (!fs.existsSync(IN_DIR)) {
    console.log("[watch] Cartella non trovata:", IN_DIR);
    process.exit(1);
  }

  console.log("[watch] Attivo su:", IN_DIR);
  console.log("[watch] Ogni modifica CSV/TXT rigenera daily.json e intraday/*.json");

  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => buildOnce(), WATCH_DEBOUNCE_MS);
  };

  const watchers = new Map();

  function watchDir(dir) {
    if (watchers.has(dir)) return;

    const w = fs.watch(dir, { persistent: true }, () => {
      schedule();
    });

    watchers.set(dir, w);

    for (const name of fs.readdirSync(dir)) {
      if (!name || name.startsWith(".")) continue;
      const full = path.join(dir, name);
      try {
        if (fs.statSync(full).isDirectory()) watchDir(full);
      } catch (_) {}
    }
  }

  watchDir(IN_DIR);

  setInterval(() => {
    try {
      const stack = [IN_DIR];
      while (stack.length) {
        const d = stack.pop();
        if (!watchers.has(d)) watchDir(d);
        for (const name of fs.readdirSync(d)) {
          if (!name || name.startsWith(".")) continue;
          const full = path.join(d, name);
          try {
            if (fs.statSync(full).isDirectory()) stack.push(full);
          } catch (_) {}
        }
      }
    } catch (_) {}
  }, 2000);

  buildOnce();
}

// ==================== entry ====================
const args = process.argv.slice(2);
if (args.includes("--watch") || args.includes("-w")) {
  watchAndRebuild();
} else {
  buildOnce();
}