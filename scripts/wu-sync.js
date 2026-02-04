// scripts/wu-sync.js
// WU PWS -> aggiorna JSON:
// - public/data/intraday/YYYY-MM-DD.json (15-min) nel TUO formato
// - data/daily.json (merge: riempie SOLO campi mancanti)
//
// Env richieste:
//   WU_API_KEY      (GitHub Secret)
//   WU_STATION_ID   (es. ICOLLI48)
// Opzionali:
//   WU_TZ (default Europe/Rome)

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const OUT_DAILY = path.join(ROOT, "data", "daily.json");
const OUT_INTRADAY_DIR = path.join(ROOT, "public", "data", "intraday");

const TZ = process.env.WU_TZ || "Europe/Rome";
const STATION_ID = process.env.WU_STATION_ID || "";
const API_KEY = process.env.WU_API_KEY || "";

// ---------------- utils ----------------
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
function readJSON(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJSON(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), "utf8");
}
function isNum(x) {
  return typeof x === "number" && Number.isFinite(x);
}
function round1(x) {
  return isNum(x) ? Math.round(x * 10) / 10 : null;
}
function round2(x) {
  return isNum(x) ? Math.round(x * 100) / 100 : null;
}
function sum(arr) {
  const v = arr.filter(isNum);
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0);
}
function mean(arr) {
  const v = arr.filter(isNum);
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}
function min(arr) {
  const v = arr.filter(isNum);
  if (!v.length) return null;
  return Math.min(...v);
}
function max(arr) {
  const v = arr.filter(isNum);
  if (!v.length) return null;
  return Math.max(...v);
}

function partsInTZ(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  return parts; // {year,month,day,hour,minute,second}
}
function ymdInTZ(date, timeZone) {
  const p = partsInTZ(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}
function ymdCompact(ymd) {
  return ymd.replaceAll("-", "");
}
function addDaysYMD(ymd, deltaDays) {
  const [Y, M, D] = ymd.split("-").map((x) => parseInt(x, 10));
  const base = new Date(Date.UTC(Y, M - 1, D, 12, 0, 0));
  const shifted = new Date(base.getTime() + deltaDays * 86400 * 1000);
  return ymdInTZ(shifted, TZ);
}

// ritorna "YYYY-MM-DD HH:mm" in timezone TZ, floored a 15 min
function floorTo15MinLocalString(dateObj) {
  const p = partsInTZ(dateObj, TZ);
  const mm = Math.floor(parseInt(p.minute, 10) / 15) * 15;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${String(mm).padStart(2, "0")}`;
}

// 16 cardinali come i tuoi (22.5°)
const CARDINAL = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];
function degToCardinal16(deg) {
  if (!isNum(deg)) return null;
  const norm = ((deg % 360) + 360) % 360;
  const idx = Math.round(norm / 22.5) % 16;
  return CARDINAL[idx] || null;
}

// prevalente: mode sui 16 settori
function prevailingDirDeg(degs) {
  const vals = degs.filter(isNum);
  if (!vals.length) return null;
  const step = 22.5;
  const bins = new Map();
  for (const d of vals) {
    const norm = ((d % 360) + 360) % 360;
    const idx = Math.round(norm / step) % 16;
    bins.set(idx, (bins.get(idx) || 0) + 1);
  }
  let bestIdx = null;
  let bestCnt = -1;
  for (const [k, v] of bins.entries()) {
    if (v > bestCnt) {
      bestCnt = v;
      bestIdx = k;
    }
  }
  return bestIdx === null ? null : bestIdx * step;
}

// ---------------- WU fetch + mapping ----------------
function parseObsTime(obs) {
  const t =
    obs.obsTimeLocal ||
    obs.obsTimeLocalString ||
    obs.obsTimeUtc ||
    obs.obsTimeUtcString ||
    obs.validTimeLocal ||
    obs.validTimeUtc;

  if (!t) return null;
  if (typeof t === "number") {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function mapObsWU(obs) {
  const metric = obs.metric || obs;

  const gNum = (...keys) => {
    for (const k of keys) {
      const v1 = obs?.[k];
      if (isNum(v1)) return v1;
      const v2 = metric?.[k];
      if (isNum(v2)) return v2;
    }
    return null;
  };

  const t = parseObsTime(obs);
  const windDirDeg = isNum(obs.winddir) ? obs.winddir : isNum(obs.windDir) ? obs.windDir : null;

  // WU metric tipico:
  // temp, dewpt, rh, pressure, windSpeed, windGust, precipRate, precipTotal, solarRadiation, uv
  return {
    t,
    temp_c: gNum("temp", "temperature"),
    dewpoint_c: gNum("dewpt", "dewpoint"),
    rh_pct: gNum("rh", "humidity"),
    press_hpa: gNum("pressure", "pressureMSL", "pressureMeanSeaLevel"),
    wind_kmh: gNum("windSpeed", "windspeed"),
    gust_kmh: gNum("windGust", "windgust"),
    wind_dir_deg: windDirDeg,
    uv: gNum("uv", "uvIndex"),
    solar_wm2: gNum("solarRadiation", "solar"),
    // pioggia: preferisco ricostruire rain_15m_mm da differenze di precipTotal (se c'è)
    precip_total_mm: gNum("precipTotal", "precip_total"),
    rain_rate_mmph: gNum("precipRate", "precip_rate"),
  };
}

async function fetchWUHistoryByDate(ymd) {
  const date = ymdCompact(ymd);
  const url = new URL("https://api.weather.com/v2/pws/history/all");
  url.searchParams.set("stationId", STATION_ID);
  url.searchParams.set("format", "json");
  url.searchParams.set("units", "m");
  url.searchParams.set("numericPrecision", "decimal");
  url.searchParams.set("date", date);
  url.searchParams.set("apiKey", API_KEY);

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "meteo-collinas-wu-sync/1.0",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`WU HTTP ${res.status} ${res.statusText} for ${ymd}: ${txt.slice(0, 300)}`);
  }

  const json = await res.json();
  const observations = json.observations || json.observation || [];
  if (!Array.isArray(observations)) return [];
  return observations
    .map(mapObsWU)
    .filter((o) => o.t instanceof Date && !Number.isNaN(o.t.getTime()));
}

// ---------------- build intraday (15 min) in tuo formato ----------------
function build15MinIntraday(mapped) {
  const rows = [...mapped].sort((a, b) => a.t - b.t);

  // rain increment from precipTotal diffs
  let lastTotal = null;
  for (const r of rows) {
    if (isNum(r.precip_total_mm)) {
      if (lastTotal === null) {
        r.rain_inc_mm = 0;
      } else {
        const d = r.precip_total_mm - lastTotal;
        // tollero micro negativi (reset/rumore)
        r.rain_inc_mm = d >= -0.05 ? Math.max(0, d) : 0;
      }
      lastTotal = r.precip_total_mm;
    } else {
      r.rain_inc_mm = null;
    }
  }

  // bucket 15-min (local TZ)
  const buckets = new Map();
  for (const r of rows) {
    const key = floorTo15MinLocalString(r.t); // "YYYY-MM-DD HH:mm"
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }

  const keys = Array.from(buckets.keys()).sort();
  const out = [];

  let rainAcc = 0;

  for (const k of keys) {
    const b = buckets.get(k);

    const windDirDegMean = mean(b.map((x) => x.wind_dir_deg));
    const windDirTxt = degToCardinal16(windDirDegMean);

    const rain15 = sum(b.map((x) => x.rain_inc_mm));
    // se rain15 è null (manca precipTotal), metto 0 per non rompere il grafico
    const rain15Safe = isNum(rain15) ? rain15 : 0;
    rainAcc += rain15Safe;

    const obj = {
      t: k,
      temp_c: round1(mean(b.map((x) => x.temp_c))),
      dewpoint_c: round1(mean(b.map((x) => x.dewpoint_c))),
      rh_pct: round1(mean(b.map((x) => x.rh_pct))),
      wind_dir_txt: windDirTxt,
      wind_dir_deg: isNum(windDirDegMean) ? round1(windDirDegMean) : null,
      wind_kmh: round1(mean(b.map((x) => x.wind_kmh))),
      gust_kmh: round1(max(b.map((x) => x.gust_kmh))),
      press_hpa: round2(mean(b.map((x) => x.press_hpa))),
      uv: round1(mean(b.map((x) => x.uv))) ?? 0,
      solar_wm2: round1(mean(b.map((x) => x.solar_wm2))) ?? 0,
      rain_15m_mm: round2(rain15Safe),
      rain_acc_mm: round2(rainAcc),
      rain_rate_mmph: round1(max(b.map((x) => x.rain_rate_mmph))) ?? 0,
    };

    out.push(obj);
  }

  return out;
}

// ---------------- daily merge (solo se mancano) ----------------
function dailyFromIntraday(ymd, intraday15) {
  const temps = intraday15.map((r) => r.temp_c);
  const dews = intraday15.map((r) => r.dewpoint_c);
  const rhs = intraday15.map((r) => r.rh_pct);
  const winds = intraday15.map((r) => r.wind_kmh);
  const gusts = intraday15.map((r) => r.gust_kmh);
  const presses = intraday15.map((r) => r.press_hpa);
  const uvs = intraday15.map((r) => r.uv);
  const solars = intraday15.map((r) => r.solar_wm2);
  const rains15 = intraday15.map((r) => r.rain_15m_mm);
  const rainRates = intraday15.map((r) => r.rain_rate_mmph);
  const dirDegs = intraday15.map((r) => r.wind_dir_deg);

  // stats "base" dal tuo daily.json di esempio
  const tmin = min(temps);
  const tmax = max(temps);
  const tmean = mean(temps);

  const dewMean = mean(dews);

  const rhMean = mean(rhs);
  const rhMin = min(rhs);
  const rhMax = max(rhs);

  const windAvg = mean(winds);
  const windMax = max(winds);

  const gustMax = max(gusts);

  const pressAvg = mean(presses);
  const pressMin = min(presses);
  const pressMax = max(presses);

  const uvMax = max(uvs);
  const solarMax = max(solars);

  const rainTotal = sum(rains15);

  const rain15Max = max(rains15);

  // finestre mobili su serie 15-min
  const rollMax = (arr, win) => {
    const v = arr.map((x) => (isNum(x) ? x : 0));
    if (!v.length) return null;
    let best = 0;
    let s = 0;
    for (let i = 0; i < v.length; i++) {
      s += v[i];
      if (i >= win) s -= v[i - win];
      if (i >= win - 1) best = Math.max(best, s);
    }
    return best;
  };

  const rain30Max = rollMax(rains15, 2);
  const rain1hMax = rollMax(rains15, 4);
  const rain3hMax = rollMax(rains15, 12);
  const rain6hMax = rollMax(rains15, 24);
  const rain12hMax = rollMax(rains15, 48);
  const rain24hMax = rollMax(rains15, 96);

  const windDirMeanDeg = prevailingDirDeg(dirDegs);

  // pos means (come nel tuo daily: uv_mean_pos/solar_mean_pos)
  const uvPos = uvs.filter((x) => isNum(x) && x > 0);
  const solarPos = solars.filter((x) => isNum(x) && x > 0);

  return {
    date: ymd,
    tmin: isNum(tmin) ? round1(tmin) : null,
    tmax: isNum(tmax) ? round1(tmax) : null,
    tmean: isNum(tmean) ? tmean : null, // tu lo tieni anche non arrotondato
    dewpoint_mean: isNum(dewMean) ? dewMean : null,
    rh_mean: isNum(rhMean) ? rhMean : null,
    rh_min: isNum(rhMin) ? round1(rhMin) : null,
    rh_max: isNum(rhMax) ? round1(rhMax) : null,
    wind_avg: isNum(windAvg) ? round1(windAvg) : null,
    wind_max: isNum(windMax) ? round1(windMax) : null,
    gust_max: isNum(gustMax) ? round1(gustMax) : null,
    press_avg: isNum(pressAvg) ? pressAvg : null,
    press_min: isNum(pressMin) ? round2(pressMin) : null,
    press_max: isNum(pressMax) ? round2(pressMax) : null,
    uv_max: isNum(uvMax) ? round1(uvMax) : null,
    solar_max: isNum(solarMax) ? round1(solarMax) : null,
    uv_mean_pos: uvPos.length ? mean(uvPos) : null,
    solar_mean_pos: solarPos.length ? mean(solarPos) : null,
    rain_total: isNum(rainTotal) ? round2(rainTotal) : null,
    rain_15m_max: isNum(rain15Max) ? round2(rain15Max) : null,
    rain_30m_max: isNum(rain30Max) ? round2(rain30Max) : null,
    rain_1h_max: isNum(rain1hMax) ? round2(rain1hMax) : null,
    rain_3h_max: isNum(rain3hMax) ? round2(rain3hMax) : null,
    rain_6h_max: isNum(rain6hMax) ? round2(rain6hMax) : null,
    rain_12h_max: isNum(rain12hMax) ? round2(rain12hMax) : null,
    rain_24h_max: isNum(rain24hMax) ? round2(rain24hMax) : null,
    rainrate_max: isNum(max(rainRates)) ? round1(max(rainRates)) : null,
    wind_dir_mean_deg: isNum(windDirMeanDeg) ? round1(windDirMeanDeg) : null,

    has_obs: true,
    obs_count: intraday15.length,
    _source_wu: true,
    _updated_at_utc: new Date().toISOString(),
  };
}

function mergeDaily(existingRow, computedRow) {
  const out = { ...(existingRow || {}) };

  // riempi solo se mancano (null/undefined/"")
  const fill = (k) => {
    const cur = out[k];
    const miss =
      cur === undefined ||
      cur === null ||
      cur === "" ||
      (typeof cur === "number" && !Number.isFinite(cur));
    if (miss) out[k] = computedRow[k];
  };

  for (const k of Object.keys(computedRow)) {
    // MAI sovrascrivere i tuoi campi già calcolati da WeatherLink
    fill(k);
  }

  // metadati
  out._source_wu = out._source_wu || computedRow._source_wu;
  out._updated_at_utc = computedRow._updated_at_utc;

  return out;
}

// ---------------- main ----------------
async function main() {
  if (!STATION_ID) throw new Error("WU_STATION_ID mancante");
  if (!API_KEY) throw new Error("WU_API_KEY mancante");

  ensureDir(OUT_INTRADAY_DIR);

  const today = ymdInTZ(new Date(), TZ);
  const yesterday = addDaysYMD(today, -1);
  const targets = [yesterday, today];

  let daily = readJSON(OUT_DAILY, []);
  if (!Array.isArray(daily)) daily = [];

  const idx = new Map();
  daily.forEach((r, i) => {
    if (r && r.date) idx.set(String(r.date).slice(0, 10), i);
  });

  for (const ymd of targets) {
    console.log(`=== WU sync ${ymd} ===`);

    const obs = await fetchWUHistoryByDate(ymd);
    console.log(`Observations raw: ${obs.length}`);
    if (!obs.length) continue;

    const intraday15 = build15MinIntraday(obs);

    const outIntradayPath = path.join(OUT_INTRADAY_DIR, `${ymd}.json`);
    writeJSON(outIntradayPath, intraday15);
    console.log(`Wrote ${path.relative(ROOT, outIntradayPath)} (${intraday15.length} bins)`);

    const computedDaily = dailyFromIntraday(ymd, intraday15);

    if (idx.has(ymd)) {
      const i = idx.get(ymd);
      daily[i] = mergeDaily(daily[i], computedDaily);
    } else {
      daily.push(computedDaily);
      idx.set(ymd, daily.length - 1);
    }
  }

  daily.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  writeJSON(OUT_DAILY, daily);
  console.log(`Wrote ${path.relative(ROOT, OUT_DAILY)} (${daily.length} days)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});