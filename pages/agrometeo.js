import fs from "fs";
import path from "path";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import SiteLayout from "../components/SiteLayout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const TIMEZONE = "Europe/Rome";
const LATITUDE = 39.6413;
const LONGITUDE = 8.8399;
const ELEVATION_M = 249;
const GDD_BASE_C = 10;
const FETCH_CACHE = new Map();

const SOURCES = {
  eto: {
    shortLabel: "FAO-56",
    url: "https://www.fao.org/4/x0490e/x0490e00.htm",
  },
  gdd: {
    shortLabel: "USDA",
    url: "https://www.climatehubs.usda.gov/hubs/southeast/tools/agroclimate-growing-degree-days-calculator",
  },
  leafWetness: {
    shortLabel: "Studio LWD",
    url: "https://doi.org/10.1016/j.agrformet.2007.09.011",
  },
  vpd: {
    shortLabel: "USDA-ARS",
    url: "https://www.ars.usda.gov/research/publications/publication/?seqNo115=375359",
  },
};

function readIntradayDates() {
  const dirPath = path.join(process.cwd(), "public", "data", "intraday");
  if (!fs.existsSync(dirPath)) return [];

  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map((name) => name.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export async function getStaticProps() {
  const intradayDates = readIntradayDates();
  const dailyRows = readDaily()
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date || "")))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((row) => ({
      date: String(row.date),
      tmin: finiteOrNull(row.tmin),
      tmax: finiteOrNull(row.tmax),
      tmean: finiteOrNull(row.tmean),
      rain_total: finiteOrNull(row.rain_total),
      obs_count: finiteOrNull(row.obs_count),
      has_obs: Boolean(row.has_obs),
    }));

  return {
    props: {
      intradayDates,
      latestDate: intradayDates.length
        ? intradayDates[intradayDates.length - 1]
        : null,
      dailyRows,
    },
    revalidate: 300,
  };
}

function finiteOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function n(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fmt(value, decimals = 1, suffix = "") {
  const parsed = n(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(decimals)}${suffix}` : "—";
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function currentRomeISO() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseLocalTimestamp(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/,
  );
  if (!match) return null;

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  );
}

function dateFromISO(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function dateToISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDaysISO(iso, amount) {
  const date = dateFromISO(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + amount);
  return dateToISO(date);
}

function dateRangeISO(startISO, endISO) {
  const start = dateFromISO(startISO);
  const end = dateFromISO(endISO);
  if (!start || !end || start > end) return [];

  const out = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    out.push(dateToISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

function formatLongDate(iso) {
  const date = dateFromISO(iso);
  if (!date) return iso || "—";
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatObservationTime(value) {
  const date = parseLocalTimestamp(value);
  if (!date) return "—";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function periodStartISO(endISO, period) {
  if (period === "week") return addDaysISO(endISO, -6);
  if (period === "month") return addDaysISO(endISO, -29);
  return endISO;
}

function periodLabel(period) {
  if (period === "week") return "ultimi 7 giorni";
  if (period === "month") return "ultimi 30 giorni";
  return "oggi";
}

function averageFinite(values) {
  const valid = values.map(n).filter(Number.isFinite);
  return valid.length
    ? valid.reduce((sum, value) => sum + value, 0) / valid.length
    : null;
}

function maxFinite(values) {
  const valid = values.map(n).filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function minFinite(values) {
  const valid = values.map(n).filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : null;
}

function sumFinite(values) {
  const valid = values.map(n).filter(Number.isFinite);
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) : null;
}

function saturationVapourPressure(tempC) {
  const temp = n(tempC);
  if (!Number.isFinite(temp)) return null;
  return 0.6108 * Math.exp((17.27 * temp) / (temp + 237.3));
}

function calculateVpd(tempC, dewpointC, rhPct) {
  const temp = n(tempC);
  if (!Number.isFinite(temp)) return null;

  const es = saturationVapourPressure(temp);
  let ea = saturationVapourPressure(dewpointC);

  if (!Number.isFinite(ea)) {
    const rh = n(rhPct);
    if (Number.isFinite(rh)) ea = es * clamp(rh / 100, 0, 1);
  }

  if (!Number.isFinite(es) || !Number.isFinite(ea)) return null;
  return Math.max(0, es - ea);
}

function vpdMeta(value) {
  const vpd = n(value);
  if (!Number.isFinite(vpd)) {
    return { label: "Dato non disponibile", detail: "", tone: "neutral" };
  }

  if (vpd < 0.4) {
    return {
      label: "Domanda molto bassa",
      detail: "L’aria sottrae poca acqua alle piante.",
      tone: "green",
    };
  }
  if (vpd < 1.2) {
    return {
      label: "Domanda moderata",
      detail: "Condizioni generalmente poco impegnative per la traspirazione.",
      tone: "green",
    };
  }
  if (vpd < 2) {
    return {
      label: "Domanda elevata",
      detail: "Le piante possono perdere acqua più rapidamente.",
      tone: "yellow",
    };
  }
  if (vpd < 3) {
    return {
      label: "Domanda molto elevata",
      detail: "La perdita d’acqua può diventare intensa, soprattutto al sole.",
      tone: "orange",
    };
  }

  return {
    label: "Domanda estrema",
    detail: "Aria molto disseccante: possibile forte stress nelle colture non irrigate.",
    tone: "red",
  };
}

function isEstimatedLeafWet(row) {
  const rain15 = n(row?.rain_15m_mm);
  const rainRate = n(row?.rain_rate_mmph);
  const rh = n(row?.rh_pct);
  const temp = n(row?.temp_c);
  const dewpoint = n(row?.dewpoint_c);
  const wind = n(row?.wind_kmh);

  if ((Number.isFinite(rain15) && rain15 > 0) || (Number.isFinite(rainRate) && rainRate > 0)) {
    return true;
  }

  const dewpointDepression =
    Number.isFinite(temp) && Number.isFinite(dewpoint) ? temp - dewpoint : NaN;

  if (Number.isFinite(rh) && rh >= 95) return true;

  return (
    Number.isFinite(rh) &&
    rh >= 90 &&
    Number.isFinite(dewpointDepression) &&
    dewpointDepression <= 2 &&
    (!Number.isFinite(wind) || wind <= 12)
  );
}

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function atmosphericPressureFromElevation(elevationM = ELEVATION_M) {
  return 101.3 * Math.pow((293 - 0.0065 * elevationM) / 293, 5.26);
}

function extraterrestrialRadiationInterval(date, durationHours = 0.25) {
  const j = dayOfYear(date);
  const phi = (LATITUDE * Math.PI) / 180;
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * j) / 365);
  const delta = 0.409 * Math.sin((2 * Math.PI * j) / 365 - 1.39);
  const gsc = 0.082;

  const localHour = date.getHours() + date.getMinutes() / 60;
  const timezoneOffsetHours = -date.getTimezoneOffset() / 60;
  const b = (2 * Math.PI * (j - 81)) / 364;
  const equationOfTimeMinutes = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const standardMeridian = 15 * timezoneOffsetHours;
  const solarCorrectionMinutes = 4 * (LONGITUDE - standardMeridian) + equationOfTimeMinutes;
  const solarMidHour = localHour + solarCorrectionMinutes / 60;

  const half = durationHours / 2;
  const omega1 = (Math.PI / 12) * (solarMidHour - half - 12);
  const omega2 = (Math.PI / 12) * (solarMidHour + half - 12);
  const sunsetAngle = Math.acos(clamp(-Math.tan(phi) * Math.tan(delta), -1, 1));

  const w1 = clamp(omega1, -sunsetAngle, sunsetAngle);
  const w2 = clamp(omega2, -sunsetAngle, sunsetAngle);
  if (w2 <= w1) return 0;

  const ra =
    (12 * 60) /
    Math.PI /
    gsc *
    dr *
    ((w2 - w1) * Math.sin(phi) * Math.sin(delta) +
      Math.cos(phi) * Math.cos(delta) * (Math.sin(w2) - Math.sin(w1)));

  return Math.max(0, ra);
}

function estimateEtoInterval(row, previousCloudFactor = 0.65) {
  const date = parseLocalTimestamp(row?.t);
  const temp = n(row?.temp_c);
  const rh = n(row?.rh_pct);
  const dewpoint = n(row?.dewpoint_c);
  const windKmh = n(row?.wind_kmh);
  const solarWm2 = n(row?.solar_wm2);

  if (!date || !Number.isFinite(temp) || !Number.isFinite(windKmh)) {
    return { eto: 0, cloudFactor: previousCloudFactor };
  }

  const es = saturationVapourPressure(temp);
  let ea = saturationVapourPressure(dewpoint);
  if (!Number.isFinite(ea) && Number.isFinite(rh)) {
    ea = es * clamp(rh / 100, 0, 1);
  }
  if (!Number.isFinite(es) || !Number.isFinite(ea)) {
    return { eto: 0, cloudFactor: previousCloudFactor };
  }

  const delta =
    (4098 * 0.6108 * Math.exp((17.27 * temp) / (temp + 237.3))) /
    Math.pow(temp + 237.3, 2);
  const pressure = atmosphericPressureFromElevation();
  const gamma = 0.000665 * pressure;
  const u2 = Math.max(0, windKmh / 3.6);

  const rsInterval = Math.max(0, Number.isFinite(solarWm2) ? solarWm2 : 0) * 0.0009;
  const raInterval = extraterrestrialRadiationInterval(date, 0.25);
  const rsoInterval = (0.75 + 2e-5 * ELEVATION_M) * raInterval;

  let cloudFactor = previousCloudFactor;
  if (rsoInterval > 0.003) {
    cloudFactor = clamp(1.35 * clamp(rsInterval / rsoInterval, 0, 1.2) - 0.35, 0.05, 1);
  }

  const rnsInterval = 0.77 * rsInterval;
  const sigmaInterval = 4.903e-9 / 96;
  const tempK = temp + 273.16;
  const rnlInterval =
    sigmaInterval *
    Math.pow(tempK, 4) *
    Math.max(0.05, 0.34 - 0.14 * Math.sqrt(Math.max(0, ea))) *
    cloudFactor;

  const rnInterval = rnsInterval - rnlInterval;
  const rnHourly = rnInterval * 4;
  const gHourly = (Number.isFinite(solarWm2) && solarWm2 > 5 ? 0.1 : 0.5) * rnHourly;

  const numerator =
    0.408 * delta * (rnHourly - gHourly) +
    gamma * (37 / (temp + 273)) * u2 * Math.max(0, es - ea);
  const denominator = delta + gamma * (1 + 0.34 * u2);
  const etoHourly = denominator > 0 ? numerator / denominator : 0;

  return {
    eto: Math.max(0, etoHourly * 0.25),
    cloudFactor,
  };
}

function enrichRows(rows) {
  const sorted = (Array.isArray(rows) ? rows : [])
    .filter((row) => parseLocalTimestamp(row?.t))
    .sort((a, b) => String(a.t).localeCompare(String(b.t)));

  let cloudFactor = 0.65;
  const cumulativeByDate = new Map();
  const runningExtremes = new Map();

  return sorted.map((row) => {
    const date = parseLocalTimestamp(row.t);
    const iso = String(row.t).slice(0, 10);
    const etoResult = estimateEtoInterval(row, cloudFactor);
    cloudFactor = etoResult.cloudFactor;

    const previousEto = cumulativeByDate.get(iso) || 0;
    const etoCumulative = previousEto + etoResult.eto;
    cumulativeByDate.set(iso, etoCumulative);

    const temp = n(row.temp_c);
    const extremes = runningExtremes.get(iso) || { min: Infinity, max: -Infinity };
    if (Number.isFinite(temp)) {
      extremes.min = Math.min(extremes.min, temp);
      extremes.max = Math.max(extremes.max, temp);
    }
    runningExtremes.set(iso, extremes);

    const gddRunning =
      Number.isFinite(extremes.min) && Number.isFinite(extremes.max)
        ? Math.max(0, (extremes.min + extremes.max) / 2 - GDD_BASE_C)
        : null;

    const rainAcc = n(row.rain_acc_mm);
    const rain15 = n(row.rain_15m_mm);

    return {
      ...row,
      timestamp: date.getTime(),
      iso,
      vpd: calculateVpd(row.temp_c, row.dewpoint_c, row.rh_pct),
      leafWet: isEstimatedLeafWet(row),
      etoInterval: etoResult.eto,
      etoCumulative,
      gddRunning,
      rainCumulative: Number.isFinite(rainAcc) ? rainAcc : null,
      rain15: Number.isFinite(rain15) ? rain15 : 0,
      waterBalanceCumulative:
        (Number.isFinite(rainAcc) ? rainAcc : 0) - etoCumulative,
    };
  });
}

function groupRowsByDate(rows) {
  const map = new Map();
  for (const row of rows) {
    const iso = row?.iso || String(row?.t || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    if (!map.has(iso)) map.set(iso, []);
    map.get(iso).push(row);
  }
  return map;
}

function summarizeDay(rows, iso) {
  const dayRows = (Array.isArray(rows) ? rows : []).filter((row) => row.iso === iso);
  const temps = dayRows.map((row) => row.temp_c).map(n).filter(Number.isFinite);
  const vpdValues = dayRows.map((row) => row.vpd).map(n).filter(Number.isFinite);

  const eto = sumFinite(dayRows.map((row) => row.etoInterval)) || 0;
  const rainAccMax = maxFinite(dayRows.map((row) => row.rainCumulative));
  const rainFromSteps = sumFinite(dayRows.map((row) => row.rain15));
  const rain = Number.isFinite(rainAccMax) ? rainAccMax : rainFromSteps || 0;
  const tmin = temps.length ? Math.min(...temps) : null;
  const tmax = temps.length ? Math.max(...temps) : null;
  const gdd =
    Number.isFinite(tmin) && Number.isFinite(tmax)
      ? Math.max(0, (tmin + tmax) / 2 - GDD_BASE_C)
      : null;

  return {
    iso,
    timestamp: dateFromISO(iso)?.setHours(12, 0, 0, 0) ?? null,
    eto,
    rain,
    waterBalance: rain - eto,
    gdd,
    vpdMax: maxFinite(vpdValues),
    vpdMean: averageFinite(vpdValues),
    leafWetHours: dayRows.filter((row) => row.leafWet).length * 0.25,
    highVpdHours: dayRows.filter((row) => n(row.vpd) >= 1.5).length * 0.25,
    heatHours: dayRows.filter((row) => n(row.temp_c) >= 35).length * 0.25,
    count: dayRows.length,
  };
}

function gddFromDailyRow(row) {
  const tmin = n(row?.tmin);
  const tmax = n(row?.tmax);
  if (!Number.isFinite(tmin) || !Number.isFinite(tmax)) return null;
  return Math.max(0, (tmin + tmax) / 2 - GDD_BASE_C);
}

function seasonalGdd(dailyRows, currentSummary, loadedDate) {
  const year = String(loadedDate || "").slice(0, 4);
  if (!year) return null;

  let total = 0;
  let found = false;
  for (const row of dailyRows || []) {
    if (!String(row.date).startsWith(year)) continue;
    if (String(row.date) >= String(loadedDate)) continue;
    const value = gddFromDailyRow(row);
    if (Number.isFinite(value)) {
      total += value;
      found = true;
    }
  }

  if (Number.isFinite(currentSummary?.gdd)) {
    total += currentSummary.gdd;
    found = true;
  }
  return found ? total : null;
}

function consecutiveDryDays(dailyRows, currentSummary, loadedDate) {
  const map = new Map((dailyRows || []).map((row) => [String(row.date), row]));
  let count = 0;
  let cursor = loadedDate;
  let safety = 0;

  while (cursor && safety < 400) {
    let rain;
    if (cursor === loadedDate && currentSummary) rain = n(currentSummary.rain);
    else rain = n(map.get(cursor)?.rain_total);

    if (!Number.isFinite(rain) || rain >= 1) break;
    count += 1;
    cursor = addDaysISO(cursor, -1);
    safety += 1;
  }

  return count;
}

function msUntilNextRefresh(now = new Date()) {
  const next = new Date(now);
  next.setSeconds(0, 0);
  const minute = now.getMinutes();

  if (minute < 20) next.setMinutes(20);
  else if (minute < 50) next.setMinutes(50);
  else {
    next.setHours(next.getHours() + 1);
    next.setMinutes(20);
  }

  return Math.max(1000, next.getTime() - now.getTime());
}

async function fetchIntraday(iso, force = false) {
  if (!iso) return [];
  if (!force && FETCH_CACHE.has(iso)) return FETCH_CACHE.get(iso);

  const response = await fetch(
    `/data/intraday/${iso}.json?ts=${Date.now()}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Dati ${iso} non disponibili`);

  const json = await response.json();
  const rows = Array.isArray(json) ? json : [];
  FETCH_CACHE.set(iso, rows);
  return rows;
}

function SourceLink({ source }) {
  if (!source) return null;
  return (
    <a
      className="sourceLink"
      href={source.url}
      target="_blank"
      rel="noreferrer"
      title="Apri la fonte metodologica"
    >
      {source.shortLabel} ↗
    </a>
  );
}

function InfoCard({ title, text, source }) {
  return (
    <article className="infoCard">
      <div className="infoTitle">{title}</div>
      <p>{text}</p>
      <SourceLink source={source} />
    </article>
  );
}

function MetricCard({ title, value, unit, label, detail, tone = "neutral", source }) {
  return (
    <article className={`metricCard tone-${tone}`}>
      <div className="metricTitle">{title}</div>
      <div className="metricValueRow">
        <span className="metricValue">{value}</span>
        {unit ? <span className="metricUnit">{unit}</span> : null}
      </div>
      <div className="metricLabel">{label}</div>
      <div className="metricDetail">{detail}</div>
      <SourceLink source={source} />
    </article>
  );
}

function SummaryCell({ label, value, detail }) {
  return (
    <div className="summaryCell">
      <div className="summaryLabel">{label}</div>
      <div className="summaryValue">{value}</div>
      <div className="summaryDetail">{detail}</div>
    </div>
  );
}

const METRIC_OPTIONS = [
  { value: "vpd", label: "Deficit di pressione di vapore (VPD)" },
  { value: "temperature", label: "Temperatura" },
  { value: "humidity", label: "Umidità relativa" },
  { value: "leafWetness", label: "Bagnatura fogliare stimata" },
  { value: "rain", label: "Pioggia cumulata" },
  { value: "eto", label: "Evapotraspirazione di riferimento (ET0)" },
  { value: "balance", label: "Bilancio pioggia − ET0" },
  { value: "gdd", label: `Gradi giorno, base ${GDD_BASE_C} °C` },
];

function chartMetricConfig(metric, dataMax = null, dataMin = null) {
  if (metric === "vpd") {
    return {
      title: "Andamento della domanda evaporativa (VPD)",
      unit: "kPa",
      min: 0,
      max: Math.max(3.2, Number.isFinite(dataMax) ? Math.ceil(dataMax * 10) / 10 : 0),
      decimals: 2,
      areas: [
        [0, 0.4, "Domanda molto bassa", "rgba(220, 252, 231, 0.78)"],
        [0.4, 1.2, "Domanda moderata", "rgba(236, 253, 245, 0.72)"],
        [1.2, 2, "Domanda elevata", "rgba(254, 249, 195, 0.72)"],
        [2, 3, "Domanda molto elevata", "rgba(255, 237, 213, 0.72)"],
        [3, 8, "Domanda estrema", "rgba(254, 226, 226, 0.76)"],
      ],
    };
  }

  if (metric === "temperature") {
    return {
      title: "Andamento della temperatura",
      unit: "°C",
      min: Number.isFinite(dataMin) ? Math.floor(dataMin - 2) : 0,
      max: Number.isFinite(dataMax) ? Math.ceil(dataMax + 2) : 45,
      decimals: 1,
      areas: [
        [30, 35, "Caldo elevato", "rgba(254, 249, 195, 0.58)"],
        [35, 40, "Caldo forte", "rgba(255, 237, 213, 0.62)"],
        [40, 60, "Caldo estremo", "rgba(254, 226, 226, 0.68)"],
      ],
    };
  }

  if (metric === "humidity") {
    return {
      title: "Andamento dell’umidità relativa",
      unit: "%",
      min: 0,
      max: 100,
      decimals: 0,
      areas: [],
    };
  }

  if (metric === "leafWetness") {
    return {
      title: "Condizioni favorevoli alla bagnatura fogliare",
      unit: "",
      min: 0,
      max: 1,
      decimals: 0,
      areas: [[0.5, 1.1, "Bagnatura probabile", "rgba(219, 234, 254, 0.8)"]],
      categoryLabels: true,
    };
  }

  if (metric === "rain") {
    return {
      title: "Pioggia cumulata",
      unit: "mm",
      min: 0,
      max: Number.isFinite(dataMax) ? Math.max(1, Math.ceil(dataMax + 1)) : 10,
      decimals: 1,
      areas: [],
    };
  }

  if (metric === "eto") {
    return {
      title: "Evapotraspirazione di riferimento stimata",
      unit: "mm",
      min: 0,
      max: Number.isFinite(dataMax) ? Math.max(1, Math.ceil(dataMax + 1)) : 8,
      decimals: 2,
      areas: [],
    };
  }

  if (metric === "balance") {
    const span = Math.max(
      2,
      Math.ceil(
        Math.max(
          Math.abs(Number.isFinite(dataMin) ? dataMin : 0),
          Math.abs(Number.isFinite(dataMax) ? dataMax : 0),
        ) + 1,
      ),
    );
    return {
      title: "Bilancio climatico: pioggia meno ET0",
      unit: "mm",
      min: -span,
      max: span,
      decimals: 2,
      areas: [
        [-100, 0, "Deficit", "rgba(254, 226, 226, 0.58)"],
        [0, 100, "Surplus", "rgba(220, 252, 231, 0.58)"],
      ],
    };
  }

  return {
    title: `Gradi giorno, base ${GDD_BASE_C} °C`,
    unit: "°C·giorno",
    min: 0,
    max: Number.isFinite(dataMax) ? Math.max(1, Math.ceil(dataMax + 1)) : 20,
    decimals: 1,
    areas: [],
  };
}

function buildChartPoints(rows, metric, period, loadedDate) {
  if (!rows.length) return [];

  const startISO = periodStartISO(loadedDate, period);
  const scopedRows = rows.filter(
    (row) => row.iso >= startISO && row.iso <= loadedDate,
  );

  if (["vpd", "temperature", "humidity", "leafWetness"].includes(metric)) {
    return scopedRows.map((row) => {
      let value = null;
      if (metric === "vpd") value = row.vpd;
      if (metric === "temperature") value = n(row.temp_c);
      if (metric === "humidity") value = n(row.rh_pct);
      if (metric === "leafWetness") value = row.leafWet ? 1 : 0;
      return [row.timestamp, Number.isFinite(value) ? value : null];
    });
  }

  if (metric === "rain" && period !== "day") {
    const grouped = groupRowsByDate(scopedRows);
    return Array.from(grouped.keys())
      .sort()
      .map((iso) => {
        const summary = summarizeDay(scopedRows, iso);
        return [summary.timestamp, summary.rain];
      });
  }

  if (metric === "rain") {
    return scopedRows.map((row) => [
      row.timestamp,
      Number.isFinite(row.rainCumulative) ? row.rainCumulative : null,
    ]);
  }

  if (period === "day") {
    return scopedRows
      .filter((row) => row.iso === loadedDate)
      .map((row) => {
        let value = null;
        if (metric === "eto") value = row.etoCumulative;
        if (metric === "balance") value = row.waterBalanceCumulative;
        if (metric === "gdd") value = row.gddRunning;
        return [row.timestamp, Number.isFinite(value) ? value : null];
      });
  }

  const grouped = groupRowsByDate(scopedRows);
  return Array.from(grouped.keys())
    .sort()
    .map((iso) => {
      const summary = summarizeDay(scopedRows, iso);
      let value = null;
      if (metric === "eto") value = summary.eto;
      if (metric === "balance") value = summary.waterBalance;
      if (metric === "gdd") value = summary.gdd;
      return [summary.timestamp, Number.isFinite(value) ? value : null];
    });
}

function chartTimeBounds(endISO, period) {
  const start = dateFromISO(periodStartISO(endISO, period));
  const end = dateFromISO(addDaysISO(endISO, 1));
  if (!start || !end) return { min: null, max: null };
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return { min: start.getTime(), max: end.getTime() };
}

function formatAxisTime(value, period) {
  const date = new Date(value);
  if (period === "day") return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (period === "week") return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
}

function AgrometeoChart({ rows, metric, period, loadedDate }) {
  const points = useMemo(
    () => buildChartPoints(rows, metric, period, loadedDate),
    [rows, metric, period, loadedDate],
  );
  const values = points.map((point) => n(point[1])).filter(Number.isFinite);
  const dataMax = values.length ? Math.max(...values) : null;
  const dataMin = values.length ? Math.min(...values) : null;
  const config = chartMetricConfig(metric, dataMax, dataMin);
  const bounds = chartTimeBounds(loadedDate, period);
  const latestPoint = points.slice().reverse().find((point) => Number.isFinite(n(point[1])));

  const markAreaData = (config.areas || []).map(([from, to, label, color]) => [
    {
      name: label,
      yAxis: from,
      itemStyle: { color },
      label: {
        show: true,
        position: "insideTopRight",
        color: "rgba(15,23,42,.58)",
        fontSize: 10,
        fontWeight: 800,
      },
    },
    { yAxis: to },
  ]);

  const option = {
    animation: false,
    grid: { left: 70, right: 34, top: 46, bottom: 76 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(255,255,255,.98)",
      borderColor: "#dbe2ea",
      textStyle: { color: "#0f172a" },
      formatter(params) {
        const item = Array.isArray(params) ? params[0] : params;
        const timestamp = item?.value?.[0];
        const value = n(item?.value?.[1]);
        if (!Number.isFinite(timestamp) || !Number.isFinite(value)) return "";
        const date = new Date(timestamp);
        const dateLabel = new Intl.DateTimeFormat("it-IT", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        }).format(date);
        const shown = config.categoryLabels
          ? value >= 0.5
            ? "Bagnatura probabile"
            : "Bagnatura non rilevata"
          : `${value.toFixed(config.decimals)} ${config.unit}`.trim();
        return `<strong>${dateLabel}</strong><br/>${shown}`;
      },
    },
    xAxis: {
      type: "time",
      min: bounds.min,
      max: bounds.max,
      boundaryGap: false,
      axisLabel: {
        color: "rgba(15,23,42,.68)",
        formatter: (value) => formatAxisTime(value, period),
        hideOverlap: true,
      },
      axisLine: { lineStyle: { color: "#94a3b8" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      min: config.min,
      max: config.max,
      name: config.unit,
      nameLocation: "middle",
      nameGap: 48,
      nameTextStyle: { color: "rgba(15,23,42,.68)", fontWeight: 800 },
      axisLabel: {
        color: "rgba(15,23,42,.68)",
        formatter: config.categoryLabels
          ? (value) => (value >= 0.5 ? "Sì" : "No")
          : undefined,
      },
      splitLine: { lineStyle: { color: "rgba(148,163,184,.22)" } },
    },
    dataZoom: [
      { type: "inside", filterMode: "none" },
      {
        type: "slider",
        bottom: 18,
        height: 20,
        showDetail: false,
        borderColor: "#cbd5e1",
        backgroundColor: "#eef2ff",
        fillerColor: "rgba(148,163,184,.18)",
      },
    ],
    series: [
      {
        name: config.title,
        type: "line",
        data: points,
        showSymbol: false,
        connectNulls: false,
        smooth: metric === "leafWetness" ? false : 0.16,
        step: metric === "leafWetness" ? "end" : false,
        lineStyle: { width: 3, color: "#0f172a" },
        itemStyle: { color: "#0f172a" },
        areaStyle:
          metric === "rain"
            ? { color: "rgba(14,165,233,.13)" }
            : undefined,
        markArea: markAreaData.length
          ? { silent: true, data: markAreaData }
          : undefined,
        markLine:
          metric === "balance"
            ? {
                silent: true,
                symbol: "none",
                lineStyle: { color: "#64748b", type: "dashed" },
                data: [{ yAxis: 0 }],
              }
            : undefined,
      },
      latestPoint
        ? {
            name: "Ultimo dato",
            type: "effectScatter",
            data: [latestPoint],
            symbolSize: 9,
            rippleEffect: { scale: 4, period: 1.8, brushType: "stroke" },
            itemStyle: {
              color: "#ef4444",
              borderColor: "#fff",
              borderWidth: 2,
            },
            tooltip: { show: false },
            z: 10,
          }
        : null,
    ].filter(Boolean),
  };

  return (
    <section className="chartPanel">
      <h2>{config.title}</h2>
      <div className="chartSubtitle">
        Periodo: {periodLabel(period)}. Le fasce colorate sono indicative e non sostituiscono soglie specifiche per coltura.
      </div>
      <ReactECharts option={option} style={{ height: 430, width: "100%" }} notMerge lazyUpdate />
    </section>
  );
}

export default function Agrometeo({ intradayDates = [], latestDate = null, dailyRows = [] }) {
  const [loadedDate, setLoadedDate] = useState(latestDate || currentRomeISO());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedMetric, setSelectedMetric] = useState("vpd");
  const [selectedPeriod, setSelectedPeriod] = useState("day");

  const availableDates = useMemo(() => {
    return Array.from(new Set([...(intradayDates || []), currentRomeISO()].filter(Boolean))).sort();
  }, [intradayDates]);

  const loadData = useCallback(
    async (force = false) => {
      setLoading(true);
      setError("");

      const today = currentRomeISO();
      const candidates = Array.from(new Set([today, latestDate, loadedDate].filter(Boolean)));
      let resolvedDate = null;

      for (const iso of candidates) {
        try {
          const data = await fetchIntraday(iso, force);
          if (data.length) {
            resolvedDate = iso;
            break;
          }
        } catch {
          // prova la data successiva
        }
      }

      if (!resolvedDate) {
        setRows([]);
        setLoading(false);
        setError("Nessun dato intraday disponibile.");
        return;
      }

      const startISO = periodStartISO(resolvedDate, "month");
      const requestedDates = dateRangeISO(startISO, resolvedDate).filter(
        (iso) => availableDates.includes(iso) || iso === today,
      );

      const loaded = await Promise.all(
        requestedDates.map(async (iso) => {
          try {
            return await fetchIntraday(iso, force && iso === resolvedDate);
          } catch {
            return [];
          }
        }),
      );

      setLoadedDate(resolvedDate);
      setRows(enrichRows(loaded.flat()));
      setLoading(false);
    }, [availableDates, latestDate, loadedDate, selectedPeriod],
  );

  useEffect(() => {
    loadData(false);
  }, [selectedPeriod]);

  useEffect(() => {
    let timeoutId;
    let cancelled = false;

    const schedule = () => {
      timeoutId = window.setTimeout(async () => {
        if (!cancelled) await loadData(true);
        if (!cancelled) schedule();
      }, msUntilNextRefresh());
    };

    schedule();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [loadData]);

  useEffect(() => {
    const refreshOnReturn = () => {
      if (document.visibilityState === "visible") loadData(true);
    };
    document.addEventListener("visibilitychange", refreshOnReturn);
    window.addEventListener("focus", refreshOnReturn);
    return () => {
      document.removeEventListener("visibilitychange", refreshOnReturn);
      window.removeEventListener("focus", refreshOnReturn);
    };
  }, [loadData]);

  const currentRows = useMemo(
    () => rows.filter((row) => row.iso === loadedDate),
    [rows, loadedDate],
  );
  const latest = currentRows.length ? currentRows[currentRows.length - 1] : null;
  const currentSummary = useMemo(
    () => summarizeDay(rows, loadedDate),
    [rows, loadedDate],
  );
  const dailySummaries = useMemo(() => {
    const grouped = groupRowsByDate(rows);
    return Array.from(grouped.keys())
      .sort()
      .map((iso) => summarizeDay(rows, iso));
  }, [rows]);

  const currentVpdMeta = vpdMeta(latest?.vpd);
  const wetNow = Boolean(latest?.leafWet);
  const seasonGdd = seasonalGdd(dailyRows, currentSummary, loadedDate);
  const dryDays = consecutiveDryDays(dailyRows, currentSummary, loadedDate);
  const sevenDay = dailySummaries.slice(-7);
  const eto7 = sumFinite(sevenDay.map((day) => day.eto));
  const balance7 = sumFinite(sevenDay.map((day) => day.waterBalance));
  const rain7 = sumFinite(sevenDay.map((day) => day.rain));

  const balanceTone =
    currentSummary.waterBalance < -3
      ? "red"
      : currentSummary.waterBalance < 0
        ? "orange"
        : currentSummary.waterBalance > 3
          ? "green"
          : "yellow";

  return (
    <SiteLayout
      headerProps={{
        title: "Agrometeo Collinas",
        kicker: "AGROMETEOROLOGIA",
        subtitle:
          "Indicatori utili per leggere domanda d’acqua, sviluppo termico e condizioni favorevoli alla bagnatura delle colture.",
        showPeriod: false,
        currentPath: "/agrometeo",
      }}
    >
      <section className="introPanel">
        <div className="introHead">
          <div>
            <h2>Cosa indicano questi valori</h2>
            <p>
              Sono stime ricavate dai sensori della stazione. Descrivono le condizioni atmosferiche, ma non misurano direttamente l’acqua nel terreno o lo stato di una coltura specifica.
            </p>
          </div>
          <div className="lastData">
            <span>Ultimo dato</span>
            <strong>{formatObservationTime(latest?.t)}</strong>
            <small>{formatLongDate(loadedDate)}</small>
          </div>
        </div>

        <div className="infoGrid">
          <InfoCard
            title="VPD"
            text="Indica quanto l’aria tende a sottrarre acqua alle piante: più sale, più la traspirazione può diventare intensa."
            source={SOURCES.vpd}
          />
          <InfoCard
            title="ET0"
            text="Stima quanta acqua perderebbe una superficie erbosa ben irrigata. Non corrisponde direttamente all’acqua da dare a una coltura."
            source={SOURCES.eto}
          />
          <InfoCard
            title="Bilancio climatico"
            text="Confronta la pioggia con l’ET0. Un valore negativo indica che la richiesta atmosferica ha superato la pioggia."
            source={SOURCES.eto}
          />
          <InfoCard
            title={`Gradi giorno, base ${GDD_BASE_C} °C`}
            text="Misurano il calore accumulato utile allo sviluppo biologico. La temperatura di base cambia a seconda della coltura."
            source={SOURCES.gdd}
          />
          <InfoCard
            title="Bagnatura fogliare stimata"
            text="Segnala quando pioggia, umidità e temperatura rendono probabile la presenza di acqua sulle foglie. Non è una misura diretta."
            source={SOURCES.leafWetness}
          />
        </div>
      </section>

      <section className="currentPanel">
        <div className="panelHeading">
          <h2>Condizioni agrometeorologiche attuali</h2>
          <p>Dati aggiornati dopo i caricamenti programmati delle :17 e :47.</p>
        </div>

        {error ? <div className="errorBox">{error}</div> : null}

        <div className={`metricsGrid ${loading ? "isLoading" : ""}`}>
          <MetricCard
            title="Domanda evaporativa (VPD)"
            value={fmt(latest?.vpd, 2)}
            unit="kPa"
            label={currentVpdMeta.label}
            detail={currentVpdMeta.detail}
            tone={currentVpdMeta.tone}
            source={SOURCES.vpd}
          />
          <MetricCard
            title="Bagnatura fogliare"
            value={wetNow ? "Probabile" : "No"}
            label={wetNow ? "Condizioni favorevoli" : "Condizioni non favorevoli"}
            detail={
              wetNow
                ? "Umidità, rugiada o pioggia possono mantenere bagnate le superfici vegetali."
                : "Al momento non emergono condizioni favorevoli alla bagnatura."
            }
            tone={wetNow ? "blue" : "green"}
            source={SOURCES.leafWetness}
          />
          <MetricCard
            title="Gradi giorno di oggi"
            value={fmt(currentSummary.gdd, 1)}
            unit="°C·giorno"
            label={`Base ${GDD_BASE_C} °C`}
            detail={`Accumulo dall’inizio dell’anno: ${fmt(seasonGdd, 1)} °C·giorno.`}
            tone="yellow"
            source={SOURCES.gdd}
          />
          <MetricCard
            title="ET0 stimata oggi"
            value={fmt(currentSummary.eto, 2)}
            unit="mm"
            label="Accumulo provvisorio"
            detail="La stima cresce durante la giornata con sole, vento e aria più secca."
            tone="orange"
            source={SOURCES.eto}
          />
          <MetricCard
            title="Bilancio di oggi"
            value={fmt(currentSummary.waterBalance, 2)}
            unit="mm"
            label={currentSummary.waterBalance < 0 ? "Deficit climatico" : "Surplus climatico"}
            detail={`Pioggia ${fmt(currentSummary.rain, 1)} mm meno ET0 ${fmt(currentSummary.eto, 2)} mm.`}
            tone={balanceTone}
            source={SOURCES.eto}
          />
        </div>
      </section>

      <section className="summaryPanel">
        <div className="panelHeading">
          <h2>Riepilogo</h2>
          <p>Valori accumulati con i dati disponibili finora.</p>
        </div>
        <div className="summaryGrid">
          <SummaryCell label="VPD massimo oggi" value={fmt(currentSummary.vpdMax, 2, " kPa")} detail="massima domanda evaporativa" />
          <SummaryCell label="Ore con VPD ≥1,5" value={fmt(currentSummary.highVpdHours, 1, " h")} detail="intervalli di domanda elevata" />
          <SummaryCell label="Bagnatura stimata" value={fmt(currentSummary.leafWetHours, 1, " h")} detail="durata complessiva di oggi" />
          <SummaryCell label="Ore ≥35 °C" value={fmt(currentSummary.heatHours, 1, " h")} detail="caldo molto intenso" />
          <SummaryCell label="Pioggia ultimi 7 giorni" value={fmt(rain7, 1, " mm")} detail="somma dei giorni caricati" />
          <SummaryCell label="ET0 ultimi 7 giorni" value={fmt(eto7, 1, " mm")} detail="stima da dati intraday" />
          <SummaryCell label="Bilancio ultimi 7 giorni" value={fmt(balance7, 1, " mm")} detail="pioggia meno ET0" />
          <SummaryCell label="Periodo secco" value={`${dryDays} giorni`} detail="giorni consecutivi con meno di 1 mm" />
        </div>
      </section>

      <section className="controlsPanel">
        <div className="controlGroup">
          <label htmlFor="agroMetric">Valore mostrato</label>
          <select id="agroMetric" value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)}>
            {METRIC_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="controlGroup">
          <label htmlFor="agroPeriod">Periodo</label>
          <select id="agroPeriod" value={selectedPeriod} onChange={(event) => setSelectedPeriod(event.target.value)}>
            <option value="day">Oggi</option>
            <option value="week">Ultimi 7 giorni</option>
            <option value="month">Ultimi 30 giorni</option>
          </select>
        </div>
      </section>

      <AgrometeoChart rows={rows} metric={selectedMetric} period={selectedPeriod} loadedDate={loadedDate} />

      <section className="methodPanel">
        <h2>Come leggere le stime</h2>
        <p>
          L’ET0 è stimata con una versione a passo breve della procedura FAO Penman–Monteith usando temperatura, umidità, vento e radiazione solare. Il bilancio climatico non considera irrigazione, riserva del suolo, pendenza, tipo di coltura o profondità delle radici. La bagnatura fogliare è ricavata con criteri meteorologici e non sostituisce un sensore dedicato.
        </p>
      </section>

      <style jsx global>{`
        * { box-sizing: border-box; }
        .introPanel,
        .currentPanel,
        .summaryPanel,
        .controlsPanel,
        .chartPanel,
        .methodPanel {
          margin-top: 20px;
          border: 1px solid #e2e8f0;
          border-radius: 24px;
          background: rgba(255,255,255,.94);
          box-shadow: 0 10px 28px rgba(15,23,42,.05);
        }
        .introPanel, .currentPanel, .summaryPanel, .methodPanel { padding: 22px; }
        .introHead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 20px;
        }
        h2 { margin: 0; color: #0f172a; font-size: 24px; font-weight: 950; letter-spacing: -.02em; }
        .introHead p, .panelHeading p, .methodPanel p {
          margin: 7px 0 0;
          color: rgba(15,23,42,.67);
          line-height: 1.55;
          font-size: 14px;
        }
        .lastData {
          min-width: 190px;
          padding: 12px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #f8fafc;
          text-align: right;
        }
        .lastData span, .lastData small { display: block; color: #64748b; font-size: 11px; font-weight: 800; }
        .lastData strong { display: block; margin: 3px 0; font-size: 22px; color: #0f172a; }
        .infoGrid { margin-top: 18px; display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 12px; }
        .infoCard {
          min-height: 150px;
          padding: 16px;
          border: 1px solid #e2e8f0;
          border-radius: 18px;
          background: linear-gradient(180deg,#fff,#f8fafc);
        }
        .infoTitle, .metricTitle, .summaryLabel {
          font-size: 12px;
          color: #64748b;
          font-weight: 950;
          letter-spacing: .04em;
          text-transform: uppercase;
        }
        .infoCard p { margin: 9px 0 12px; font-size: 13px; line-height: 1.48; color: rgba(15,23,42,.72); }
        .sourceLink { display: inline-block; font-size: 10px; font-weight: 850; color: #64748b; text-decoration: none; }
        .sourceLink:hover { color: #0f172a; text-decoration: underline; }
        .panelHeading { text-align: center; }
        .metricsGrid { margin-top: 18px; display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: 14px; transition: opacity .2s ease; }
        .metricsGrid.isLoading { opacity: .65; }
        .metricCard {
          position: relative;
          min-height: 235px;
          overflow: hidden;
          padding: 18px 18px 16px 22px;
          border: 1px solid #e2e8f0;
          border-radius: 20px;
          background: #fff;
        }
        .metricCard::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: #94a3b8; }
        .tone-green::before { background: #22c55e; }
        .tone-yellow::before { background: #eab308; }
        .tone-orange::before { background: #f97316; }
        .tone-red::before { background: #ef4444; }
        .tone-blue::before { background: #3b82f6; }
        .metricValueRow { margin-top: 10px; display: flex; align-items: baseline; gap: 6px; }
        .metricValue { color: #0f172a; font-size: 38px; font-weight: 1000; letter-spacing: -.04em; }
        .metricUnit { color: #64748b; font-size: 17px; font-weight: 900; }
        .metricLabel { margin-top: 2px; color: #0f172a; font-size: 16px; font-weight: 950; }
        .metricDetail { min-height: 45px; margin: 8px 0 10px; color: rgba(15,23,42,.67); font-size: 13px; line-height: 1.45; }
        .summaryGrid { margin-top: 18px; display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; }
        .summaryCell { min-height: 105px; padding: 16px; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; background: #fff; }
        .summaryCell:nth-child(4n) { border-right: 0; }
        .summaryCell:nth-last-child(-n+4) { border-bottom: 0; }
        .summaryValue { margin-top: 8px; color: #0f172a; font-size: 22px; font-weight: 1000; }
        .summaryDetail { margin-top: 5px; color: #64748b; font-size: 11px; }
        .controlsPanel { padding: 16px 20px; display: flex; justify-content: center; align-items: end; gap: 16px; }
        .controlGroup { min-width: 260px; display: grid; gap: 7px; }
        .controlGroup label { color: #64748b; font-size: 11px; font-weight: 950; text-transform: uppercase; letter-spacing: .05em; }
        .controlGroup select { width: 100%; min-height: 44px; padding: 0 13px; border: 1px solid #cbd5e1; border-radius: 13px; background: #fff; color: #0f172a; font-size: 14px; font-weight: 850; outline: none; }
        .controlGroup select:focus { border-color: #64748b; box-shadow: 0 0 0 3px rgba(100,116,139,.12); }
        .chartPanel { padding: 20px 18px 10px; }
        .chartPanel h2 { text-align: center; }
        .chartSubtitle { margin: 6px 0 2px; text-align: center; color: #64748b; font-size: 12px; }
        .methodPanel { margin-bottom: 10px; }
        .errorBox { margin-top: 15px; padding: 12px 14px; border: 1px solid #fecaca; border-radius: 14px; background: #fef2f2; color: #991b1b; font-weight: 800; }
        @media (max-width: 1180px) {
          .infoGrid, .metricsGrid { grid-template-columns: repeat(3,minmax(0,1fr)); }
        }
        @media (max-width: 820px) {
          .introHead { display: grid; }
          .lastData { width: 100%; text-align: left; }
          .infoGrid, .metricsGrid { grid-template-columns: repeat(2,minmax(0,1fr)); }
          .summaryGrid { grid-template-columns: repeat(2,minmax(0,1fr)); }
          .summaryCell:nth-child(4n) { border-right: 1px solid #e2e8f0; }
          .summaryCell:nth-child(2n) { border-right: 0; }
          .summaryCell:nth-last-child(-n+4) { border-bottom: 1px solid #e2e8f0; }
          .summaryCell:nth-last-child(-n+2) { border-bottom: 0; }
          .controlsPanel { align-items: stretch; flex-direction: column; }
          .controlGroup { min-width: 0; width: 100%; }
        }
        @media (max-width: 560px) {
          .introPanel, .currentPanel, .summaryPanel, .methodPanel { padding: 17px; border-radius: 20px; }
          .infoGrid, .metricsGrid, .summaryGrid { grid-template-columns: 1fr; }
          .infoCard, .metricCard { min-height: auto; }
          .summaryCell { border-right: 0 !important; border-bottom: 1px solid #e2e8f0 !important; }
          .summaryCell:last-child { border-bottom: 0 !important; }
          .metricValue { font-size: 34px; }
          .chartPanel { padding-left: 5px; padding-right: 5px; }
        }
      `}</style>
    </SiteLayout>
  );
}