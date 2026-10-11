import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import SiteLayout from "../components/SiteLayout";
import { readDailyLive } from "../lib/liveData";
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
export async function getStaticProps() {
  const dailyRows = (await readDailyLive())
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
  const intradayDates = dailyRows.map((row) => row.date);
  return {
    props: {
      intradayDates,
      latestDate: intradayDates.length
        ? intradayDates[intradayDates.length - 1]
        : null,
      dailyRows,
    },
    revalidate: 60,
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
    `https://raw.githubusercontent.com/max-collinas1/climate-collinas1/main/public/data/intraday/${encodeURIComponent(iso)}.json?ts=${Date.now()}`,
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
function agroVisual(title = "") {
  const value = String(title).toLowerCase();
  if (value.includes("vpd") || value.includes("evaporativa")) return { code: "VPD", tone: "blue" };
  if (value.includes("et0")) return { code: "ET₀", tone: "cyan" };
  if (value.includes("bilancio")) return { code: "P−E", tone: "green" };
  if (value.includes("gradi") || value.includes("35")) return { code: "GDD", tone: "orange" };
  if (value.includes("bagnatura")) return { code: "LWD", tone: "violet" };
  if (value.includes("pioggia")) return { code: "P", tone: "cyan" };
  if (value.includes("secco")) return { code: "DRY", tone: "orange" };
  return { code: "AG", tone: "slate" };
}
function AgroBadge({ title, compact = false }) {
  const visual = agroVisual(title);
  return <span className={`agroBadge badge-${visual.tone} ${compact ? "compact" : ""}`}>{visual.code}</span>;
}
function InfoCard({ title, text, source }) {
  return (
    <article className="infoCard">
      <div className="infoCardHead">
        <AgroBadge title={title} />
        <div className="infoTitle">{title}</div>
      </div>
      <p>{text}</p>
      <SourceLink source={source} />
    </article>
  );
}
function MetricCard({ title, value, unit, label, detail, tone = "neutral", source }) {
  return (
    <article className={`metricCard tone-${tone}`}>
      <div className="metricCardHead">
        <AgroBadge title={title} />
        <div className="metricTitle">{title}</div>
      </div>
      <div className="metricValueRow">
        <span className="metricValue">{value}</span>
        {unit ? <span className="metricUnit">{unit}</span> : null}
      </div>
      <div className={`metricLabel label-${tone}`}>{label}</div>
      <div className="metricDetail">{detail}</div>
      <SourceLink source={source} />
    </article>
  );
}
function SummaryCell({ label, value, detail }) {
  return (
    <div className="summaryCell">
      <div className="summaryTop">
        <AgroBadge title={label} compact />
        <div className="summaryLabel">{label}</div>
      </div>
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
      title: "Indice VPD",
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
      title: "Temperatura",
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
      title: "Umidità relativa",
      unit: "%",
      min: 0,
      max: 100,
      decimals: 0,
      areas: [],
    };
  }
  if (metric === "leafWetness") {
    return {
      title: "Bagnatura fogliare stimata",
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
      title: "Indice ET0",
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
      title: "Bilancio climatico",
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
function makeAgrometeoToolbox({ filename, isMobile }) {
  return {
    feature: {
      restore: { title: "Ripristina" },
      saveAsImage: {
        type: "png",
        name: filename,
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        title: "Salva grafico",
      },
    },
    left: isMobile ? 4 : 8,
    top: isMobile ? 4 : 7,
    itemSize: isMobile ? 13 : 17,
    itemGap: isMobile ? 6 : 9,
    iconStyle: {
      borderColor: "#64748b",
      borderWidth: 1.2,
    },
    emphasis: {
      iconStyle: {
        borderColor: "#2563eb",
      },
    },
  };
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
  const isMobile = typeof window !== "undefined" ? window.innerWidth <= 680 : false;
  const markAreaData = (config.areas || []).map(([from, to, label, color]) => [
    {
      name: label,
      yAxis: from,
      itemStyle: { color },
      label: {
        show: true,
        position: "insideTopRight",
        color: isMobile ? "rgba(51,65,85,.52)" : "rgba(51,65,85,.68)",
        fontSize: isMobile ? 8 : 10,
        fontWeight: 800,
      },
    },
    { yAxis: to },
  ]);
  const option = {
    animation: false,
    toolbox: makeAgrometeoToolbox({
      filename: `meteo-collinas-agrometeo-${metric}-${period}`,
      isMobile,
    }),
    grid: isMobile
      ? { left: 42, right: 10, top: 34, bottom: 32 }
      : { left: 66, right: 28, top: 42, bottom: 46 },
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
        color: isMobile ? "rgba(71,85,105,.60)" : "rgba(51,65,85,.72)",
        fontSize: isMobile ? 9 : 11,
        formatter: (value) => formatAxisTime(value, period),
        hideOverlap: true,
      },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "rgba(148,163,184,.52)" } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      min: config.min,
      max: config.max,
      name: config.unit,
      nameLocation: "middle",
      nameGap: isMobile ? 28 : 43,
      nameTextStyle: {
        color: isMobile ? "rgba(71,85,105,.60)" : "rgba(51,65,85,.72)",
        fontWeight: 800,
        fontSize: isMobile ? 9 : 11,
      },
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        color: isMobile ? "rgba(71,85,105,.60)" : "rgba(51,65,85,.72)",
        fontSize: isMobile ? 9 : 11,
        formatter: config.categoryLabels
          ? (value) => (value >= 0.5 ? "Sì" : "No")
          : undefined,
      },
      splitLine: { lineStyle: { color: "rgba(148,163,184,.24)" } },
    },
    dataZoom: [{ type: "inside", filterMode: "none" }],
    series: [
      {
        name: config.title,
        type: "line",
        data: points,
        showSymbol: false,
        connectNulls: false,
        smooth: metric === "leafWetness" ? false : 0.16,
        step: metric === "leafWetness" ? "end" : false,
        lineStyle: { width: isMobile ? 2.1 : 2.8, color: "#163a63" },
        itemStyle: { color: "#163a63" },
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
            symbolSize: isMobile ? 6 : 8,
            rippleEffect: { scale: 3, period: 1.8, brushType: "stroke" },
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
      <div className="chartHead">
        <h2>{config.title}</h2>
        <div className="chartSubtitle">Periodo: {periodLabel(period)}. Le fasce colorate sono indicative e non sostituiscono soglie specifiche per coltura.</div>
      </div>
      <div className="chartCanvas">
        <ReactECharts option={option} style={{ height: "100%", width: "100%" }} notMerge lazyUpdate />
      </div>
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
      <main className="agroPage">
        <section className="introPanel">
          <div className="introHead">
            <div className="introCopy">
              <h2>Cosa indicano questi valori</h2>
              <p>Sono stime ricavate dai sensori della stazione di Collinas. Descrivono la domanda evaporativa, il bilancio climatico, lo sviluppo termico e le condizioni favorevoli alla bagnatura fogliare, ma non misurano direttamente l’acqua disponibile nel terreno o lo stato di una coltura specifica.</p>
            </div>
            <div className="lastData">
              <div className="lastDataLine">
                <span>Ultimo dato</span>
                <strong>{formatObservationTime(latest?.t)}</strong>
              </div>
              <small>{formatLongDate(loadedDate)}</small>
              <div className="lastDataLine bottom">
                <span className="livePill">Dati in tempo reale</span>
                <strong className="currentTemp">{fmt(latest?.temp_c, 1, " °C")}</strong>
              </div>
            </div>
          </div>
          <div className="infoGrid">
            <InfoCard title="VPD" text="Deficit di pressione di vapore: descrive la domanda evaporativa dell’atmosfera sulle piante." source={SOURCES.vpd} />
            <InfoCard title="ET0" text="Evapotraspirazione di riferimento: stima quanta acqua l’atmosfera richiede in condizioni standard." source={SOURCES.eto} />
            <InfoCard title="Bilancio climatico" text="Differenza tra precipitazione ed ET0: mostra se il periodo è in surplus oppure in deficit climatico." source={SOURCES.eto} />
            <InfoCard title={`Gradi giorno, base ${GDD_BASE_C} °C`} text="Somma termica utile per descrivere l’accumulo di calore legato allo sviluppo biologico delle colture." source={SOURCES.gdd} />
            <InfoCard title="Bagnatura fogliare stimata" text="Stima le condizioni favorevoli alla presenza di acqua sulle superfici vegetali." source={SOURCES.leafWetness} />
          </div>
        </section>
        <section className="currentPanel">
          <div className="panelHeading">
            <h2>Condizioni agrometeorologiche attuali</h2>
            <p>Indicatori principali calcolati con i dati disponibili della giornata.</p>
          </div>
          {error ? <div className="errorBox">{error}</div> : null}
          <div className={`metricsGrid ${loading ? "isLoading" : ""}`}>
            <MetricCard title="Domanda evaporativa (VPD)" value={fmt(latest?.vpd, 2)} unit="kPa" label={currentVpdMeta.label} detail={currentVpdMeta.detail} tone={currentVpdMeta.tone} source={SOURCES.vpd} />
            <MetricCard title="Bagnatura fogliare" value={wetNow ? "Probabile" : "No"} label={wetNow ? "Condizioni favorevoli" : "Condizioni non favorevoli"} detail={wetNow ? "Umidità, rugiada o pioggia possono mantenere bagnate le superfici vegetali." : "Al momento non emergono condizioni favorevoli alla bagnatura."} tone={wetNow ? "blue" : "green"} source={SOURCES.leafWetness} />
            <MetricCard title="Gradi giorno di oggi" value={fmt(currentSummary.gdd, 1)} unit="°C·giorno" label={`Base ${GDD_BASE_C} °C`} detail={`Accumulo dall’inizio dell’anno: ${fmt(seasonGdd, 1)} °C·giorno.`} tone="yellow" source={SOURCES.gdd} />
            <MetricCard title="ET0 stimata oggi" value={fmt(currentSummary.eto, 2)} unit="mm" label="Accumulo provvisorio" detail="La stima cresce durante la giornata con sole, vento e aria più secca." tone="orange" source={SOURCES.eto} />
            <MetricCard title="Bilancio di oggi" value={fmt(currentSummary.waterBalance, 2)} unit="mm" label={currentSummary.waterBalance < 0 ? "Deficit climatico" : "Surplus climatico"} detail={`Pioggia ${fmt(currentSummary.rain, 1)} mm meno ET0 ${fmt(currentSummary.eto, 2)} mm.`} tone={balanceTone} source={SOURCES.eto} />
          </div>
        </section>
        <section className="summaryPanel">
          <div className="panelHeading compactHeading"><h2>Riepilogo</h2></div>
          <div className="summaryGrid">
            <SummaryCell label="VPD massimo oggi" value={fmt(currentSummary.vpdMax, 2, " kPa")} detail="massima domanda evaporativa" />
            <SummaryCell label="Ore con VPD ≥1,5" value={fmt(currentSummary.highVpdHours, 1, " h")} detail="domanda elevata" />
            <SummaryCell label="Bagnatura stimata" value={fmt(currentSummary.leafWetHours, 1, " h")} detail="durata di oggi" />
            <SummaryCell label="Ore ≥35 °C" value={fmt(currentSummary.heatHours, 1, " h")} detail="caldo molto intenso" />
            <SummaryCell label="Pioggia ultimi 7 giorni" value={fmt(rain7, 1, " mm")} detail="accumulo recente" />
            <SummaryCell label="ET0 ultimi 7 giorni" value={fmt(eto7, 1, " mm")} detail="stima complessiva" />
            <SummaryCell label="Bilancio ultimi 7 giorni" value={fmt(balance7, 1, " mm")} detail="pioggia meno ET0" />
            <SummaryCell label="Periodo secco" value={`${dryDays} giorni`} detail="giorni con meno di 1 mm" />
          </div>
        </section>
        <section className="trendPanel">
          <div className="controlsPanel">
            <div className="controlGroup metricControl">
              <label htmlFor="agroMetric">Indice selezionato</label>
              <select id="agroMetric" value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)}>
                {METRIC_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
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
          </div>
          <AgrometeoChart rows={rows} metric={selectedMetric} period={selectedPeriod} loadedDate={loadedDate} />
        </section>
        <section className="methodPanel">
          <div className="methodIcon">i</div>
          <div>
            <h2>Come leggere le stime</h2>
            <p>L’ET0 è stimata con una versione a passo breve della procedura FAO Penman–Monteith usando temperatura, umidità, vento e radiazione solare. Il bilancio climatico non considera irrigazione, riserva del suolo, pendenza, tipo di coltura o profondità delle radici. La bagnatura fogliare è ricavata con criteri meteorologici e non sostituisce un sensore dedicato.</p>
          </div>
        </section>
      </main>
      <style jsx global>{`
        .agroPage{margin-top:18px;display:grid;gap:14px}.agroPage *,.agroPage *::before,.agroPage *::after{box-sizing:border-box}.agroPage .introPanel,.agroPage .currentPanel,.agroPage .summaryPanel,.agroPage .trendPanel,.agroPage .methodPanel{border:1px solid #e3eaf0;border-radius:24px;background:rgba(255,255,255,.97);box-shadow:0 10px 30px rgba(15,23,42,.05)}.agroPage .introPanel,.agroPage .currentPanel,.agroPage .summaryPanel,.agroPage .methodPanel{padding:18px}.agroPage .introHead{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:14px;align-items:stretch}.agroPage .introCopy{display:grid;align-content:center;padding:2px}.agroPage h2{margin:0;color:#0f172a;font-size:22px;line-height:1.1;font-weight:950;letter-spacing:-.025em}.agroPage .introCopy p,.agroPage .panelHeading p,.agroPage .methodPanel p{margin:6px 0 0;color:rgba(15,23,42,.66);font-size:13px;line-height:1.5;font-weight:650}.agroPage .lastData{padding:13px 15px;border:1px solid #dfe8ef;border-radius:17px;background:linear-gradient(135deg,#f8fbff 0%,#eef7ff 100%);display:grid;gap:7px}.agroPage .lastDataLine{display:flex;align-items:center;justify-content:space-between;gap:10px}.agroPage .lastDataLine.bottom{align-items:flex-end}.agroPage .lastData span,.agroPage .lastData small{color:#64748b;font-size:10px;font-weight:800}.agroPage .lastData strong{color:#0f172a;font-size:20px;font-weight:950}.agroPage .livePill{padding:4px 8px;border-radius:999px;background:#dcfce7;color:#15803d!important;font-size:9px!important}.agroPage .currentTemp{font-size:16px!important}.agroPage .infoGrid{margin-top:14px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.agroPage .infoCard{min-width:0;min-height:112px;padding:12px;border:1px solid #e4eaf0;border-radius:17px;background:linear-gradient(180deg,#fff,#fbfdff);display:grid;align-content:start;gap:7px}.agroPage .infoCardHead,.agroPage .metricCardHead,.agroPage .summaryTop{display:flex;align-items:center;gap:9px;min-width:0}.agroPage .agroBadge{min-width:42px;height:34px;padding:0 8px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border:1px solid transparent;font-size:10px;font-weight:950}.agroPage .agroBadge.compact{min-width:31px;height:27px;padding:0 6px;border-radius:9px;font-size:8px}.agroPage .badge-blue{color:#1d4ed8;background:#eff6ff;border-color:#bfdbfe}.agroPage .badge-cyan{color:#0369a1;background:#f0f9ff;border-color:#bae6fd}.agroPage .badge-green{color:#15803d;background:#f0fdf4;border-color:#bbf7d0}.agroPage .badge-orange{color:#c2410c;background:#fff7ed;border-color:#fed7aa}.agroPage .badge-violet{color:#7e22ce;background:#faf5ff;border-color:#e9d5ff}.agroPage .badge-slate{color:#475569;background:#f8fafc;border-color:#e2e8f0}.agroPage .infoTitle,.agroPage .metricTitle,.agroPage .summaryLabel{min-width:0;color:#334155;font-size:11px;line-height:1.25;font-weight:950}.agroPage .infoCard p{margin:0;color:rgba(15,23,42,.67);font-size:11px;line-height:1.35;font-weight:650}.agroPage .sourceLink{width:fit-content;font-size:9px;font-weight:900;color:#64748b;text-decoration:none}.agroPage .sourceLink:hover{color:#2563eb;text-decoration:underline}.agroPage .panelHeading{text-align:left}.agroPage .compactHeading{margin-bottom:10px}.agroPage .metricsGrid{margin-top:14px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;transition:opacity .2s ease}.agroPage .metricsGrid.isLoading{opacity:.62}.agroPage .metricCard{min-width:0;min-height:164px;padding:13px;border:1px solid #e3eaf0;border-radius:18px;background:linear-gradient(180deg,#fff 0%,#fbfdff 100%);display:grid;align-content:start;gap:7px}.agroPage .metricValueRow{display:flex;align-items:baseline;gap:5px}.agroPage .metricValue{color:#0f172a;font-size:28px;line-height:1;font-weight:1000;letter-spacing:-.04em}.agroPage .metricUnit{color:#64748b;font-size:13px;font-weight:900}.agroPage .metricLabel{width:fit-content;padding:4px 8px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:10px;font-weight:900}.agroPage .label-green{background:#dcfce7;color:#15803d}.agroPage .label-yellow{background:#fef3c7;color:#a16207}.agroPage .label-orange{background:#ffedd5;color:#c2410c}.agroPage .label-red{background:#fee2e2;color:#b91c1c}.agroPage .label-blue{background:#dbeafe;color:#1d4ed8}.agroPage .metricDetail{min-height:32px;color:rgba(15,23,42,.64);font-size:10.5px;line-height:1.35;font-weight:650}.agroPage .summaryGrid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px}.agroPage .summaryCell{min-width:0;min-height:86px;padding:10px;border:1px solid #e5ebf0;border-radius:14px;background:#fbfdff}.agroPage .summaryValue{margin-top:7px;color:#0f172a;font-size:17px;line-height:1;font-weight:1000}.agroPage .summaryDetail{margin-top:5px;color:#64748b;font-size:9px;line-height:1.25;font-weight:700}.agroPage .trendPanel{overflow:hidden}.agroPage .controlsPanel{padding:12px 16px;display:flex;justify-content:center;align-items:end;gap:14px;border-bottom:1px solid #e8edf2;background:linear-gradient(180deg,#fbfdff,#f8fbff)}.agroPage .controlGroup{min-width:230px;display:grid;gap:5px}.agroPage .metricControl{min-width:360px}.agroPage .controlGroup label{color:#64748b;font-size:9px;font-weight:950;text-transform:uppercase;letter-spacing:.06em;text-align:center}.agroPage .controlGroup select{width:100%;min-height:40px;padding:0 12px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#0f172a;font-size:12px;font-weight:850;outline:none}.agroPage .controlGroup select:focus{border-color:#93c5fd;box-shadow:0 0 0 3px rgba(59,130,246,.1)}.agroPage .chartPanel{padding:12px 13px 7px;background:#fff}.agroPage .chartHead{min-height:40px;padding:0 50px;text-align:center}.agroPage .chartPanel h2{font-size:18px}.agroPage .chartSubtitle{margin-top:3px;color:#64748b;font-size:10px;line-height:1.35;font-weight:650}.agroPage .chartCanvas{height:320px}.agroPage .methodPanel{margin-bottom:10px;display:flex;align-items:flex-start;gap:12px;background:linear-gradient(180deg,#fbfffd,#f5fbf7)}.agroPage .methodIcon{width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:#dcfce7;color:#15803d;font-size:16px;font-weight:950}.agroPage .methodPanel h2{font-size:18px}.agroPage .errorBox{margin-top:12px;padding:10px 12px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2;color:#991b1b;font-size:12px;font-weight:800}@media(max-width:1280px){.agroPage .infoGrid,.agroPage .metricsGrid{grid-template-columns:repeat(3,minmax(0,1fr))}.agroPage .summaryGrid{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:820px){.agroPage .introHead{grid-template-columns:1fr}.agroPage .lastData{width:100%}.agroPage .infoGrid,.agroPage .metricsGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.agroPage .summaryGrid{grid-template-columns:repeat(2,minmax(0,1fr))}.agroPage .controlsPanel{display:grid;grid-template-columns:1fr;align-items:stretch}.agroPage .controlGroup,.agroPage .metricControl{min-width:0;width:100%}}@media(max-width:560px){.agroPage{gap:10px}.agroPage .introPanel,.agroPage .currentPanel,.agroPage .summaryPanel,.agroPage .methodPanel{padding:11px;border-radius:18px}.agroPage .introCopy p,.agroPage .panelHeading p,.agroPage .methodPanel p{font-size:11px;line-height:1.4}.agroPage h2{font-size:18px}.agroPage .infoGrid{grid-template-columns:1fr;gap:7px}.agroPage .infoCard{min-height:0;padding:9px;gap:5px}.agroPage .metricsGrid{grid-template-columns:1fr;gap:7px}.agroPage .metricCard{min-height:0;padding:10px;gap:5px}.agroPage .metricValue{font-size:23px}.agroPage .metricUnit{font-size:11px}.agroPage .metricDetail{min-height:0;font-size:10px}.agroPage .summaryGrid{gap:6px}.agroPage .summaryCell{min-height:72px;padding:8px}.agroPage .summaryValue{font-size:15px}.agroPage .summaryLabel{font-size:9px}.agroPage .summaryDetail{font-size:8px}.agroPage .controlsPanel{padding:10px;gap:8px}.agroPage .controlGroup label{text-align:left;font-size:8px}.agroPage .controlGroup select{min-height:36px;font-size:11px}.agroPage .chartPanel{padding:8px 4px 3px}.agroPage .chartHead{min-height:34px;padding:0 42px}.agroPage .chartPanel h2{font-size:15px}.agroPage .chartSubtitle{font-size:8px}.agroPage .chartCanvas{height:230px}.agroPage .methodPanel{gap:9px}.agroPage .methodIcon{width:28px;height:28px;border-radius:9px;font-size:13px}.agroPage .methodPanel h2{font-size:16px}.agroPage .agroBadge{min-width:35px;height:29px;font-size:9px}}
      `}</style>
    </SiteLayout>
  );
}
