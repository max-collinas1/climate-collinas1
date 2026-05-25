import fs from "fs";
import path from "path";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import SiteLayout from "../components/SiteLayout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// -----------------------------------------------------
// DATA LOAD
// -----------------------------------------------------
function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(raw) ? raw : [];
}

export async function getStaticProps() {
  const rows = readDaily()
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date ?? "").trim()))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return {
    props: {
      dailyRows: rows,
    },
  };
}

// -----------------------------------------------------
// HELPERS
// -----------------------------------------------------
function n(x) {
  if (x === null || x === undefined || x === "") return NaN;
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

function avgFinite(arr) {
  let s = 0;
  let c = 0;
  for (const x of arr) {
    const v = n(x);
    if (Number.isFinite(v)) {
      s += v;
      c += 1;
    }
  }
  return c ? s / c : NaN;
}

function getAny(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function safeVal(v, d = 2) {
  const x = n(v);
  return Number.isFinite(x) ? Number(x.toFixed(d)) : null;
}

function cumulative(arr) {
  let s = 0;
  let seen = false;
  return arr.map((v) => {
    const x = n(v);
    if (Number.isFinite(x)) {
      s += x;
      seen = true;
      return Number(s.toFixed(2));
    }
    return seen ? Number(s.toFixed(2)) : null;
  });
}

function axisTooltipFormatter(params, specs) {
  if (!Array.isArray(params) || !params.length) return "";
  const title = params[0]?.axisValueLabel ?? params[0]?.name ?? "—";
  const lines = [`<b>${title}</b>`];

  for (const spec of specs) {
    const p = params.find((x) => x.seriesName === spec.name);
    if (!p) continue;
    const value = Array.isArray(p.value) ? p.value[1] : p.value;
    const text = spec.formatter ? spec.formatter(value) : value;
    lines.push(`${p.marker}${spec.name}: <b>${text}</b>`);
  }

  return lines.join("<br/>");
}

function pad2(x) {
  return String(x).padStart(2, "0");
}

const MONTHS_IT_FULL = [
  "Gennaio",
  "Febbraio",
  "Marzo",
  "Aprile",
  "Maggio",
  "Giugno",
  "Luglio",
  "Agosto",
  "Settembre",
  "Ottobre",
  "Novembre",
  "Dicembre",
];

const MONTHS_IT_SHORT = [
  "gen",
  "feb",
  "mar",
  "apr",
  "mag",
  "giu",
  "lug",
  "ago",
  "set",
  "ott",
  "nov",
  "dic",
];

function pickFromEndByIndex(list, index) {
  if (!Array.isArray(list) || !list.length) return "";
  const safeIndex = Math.min(Math.max(Number(index) || 0, 0), list.length - 1);
  return list[list.length - 1 - safeIndex] || "";
}

function isLeapYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return false;
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function buildYearAxisItems(years = []) {
  const includeLeapDay = years.some((y) => isLeapYear(y));
  const baseYear = includeLeapDay ? 2020 : 2021;
  const totalDays = includeLeapDay ? 366 : 365;

  return Array.from({ length: totalDays }, (_, i) => {
    const d = new Date(baseYear, 0, i + 1);
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());

    return {
      key: `${mm}-${dd}`,
      day: d.getDate(),
      label: `${d.getDate()} ${MONTHS_IT_SHORT[d.getMonth()]}`,
    };
  });
}

function getYearAxisLabelInterval(zoomSpan = 100) {
  return (_index, value) => {
    const day = Number(String(value).split(" ")[0]);
    if (!Number.isFinite(day)) return false;

    if (zoomSpan > 60) return day === 1;
    if (zoomSpan > 35) return day === 1 || day === 15;
    if (zoomSpan > 18) return day === 1 || day === 8 || day === 15 || day === 22;
    if (zoomSpan > 9) return day === 1 || day === 5 || day === 10 || day === 15 || day === 20 || day === 25;
    if (zoomSpan > 4) return day === 1 || day % 2 === 1;

    return true;
  };
}

function monthFull(ym) {
  const mm = Number(String(ym).slice(5, 7));
  return MONTHS_IT_FULL[mm - 1] || String(ym).slice(5, 7);
}

function formatMonthYear(ym) {
  const [y] = String(ym).split("-");
  return `${monthFull(ym)} ${y}`;
}

function formatDateIt(dateStr) {
  const s = String(dateStr ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
  const [y, m, d] = s.split("-");
  const mName = MONTHS_IT_FULL[Number(m) - 1] || m;
  return `${Number(d)} ${mName} ${y}`;
}

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function getIntradayCandidatePaths(iso) {
  const [y, m, d] = String(iso).split("-");
  return [
    `/data/intraday/${y}/${m}/${d}.json`,
    `/data/intraday/${y}/${m}/${y}-${m}-${d}.json`,
    `/data/intraday/${y}-${m}-${d}.json`,
    `/data/${y}/${m}/${d}.json`,
  ];
}

function makeUniqueLabels(labels) {
  const counts = new Map();
  return labels.map((label) => {
    const base = String(label || "—");
    const seen = counts.get(base) || 0;
    counts.set(base, seen + 1);
    return seen === 0 ? base : `${base} (${seen + 1})`;
  });
}

function pickColor(i) {
  const colors = [
    "#ff2d20",
    "#2563eb",
    "#2f9e44",
    "#f28c28",
    "#7c3aed",
    "#0891b2",
    "#dc2626",
    "#65a30d",
    "#ea580c",
    "#0f766e",
    "#4f46e5",
    "#be185d",
  ];
  return colors[i % colors.length];
}

function gaussianKernel(radius = 2, sigma = 1.2) {
  const kernel = [];
  let sum = 0;

  for (let i = -radius; i <= radius; i += 1) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }

  return kernel.map((v) => v / sum);
}

function gaussianSmooth(values, radius = 2, sigma = 1.2) {
  const arr = (values || []).map((v) => n(v)).map((v) => (Number.isFinite(v) ? v : 0));
  if (!arr.length) return [];

  const kernel = gaussianKernel(radius, sigma);
  const out = [];

  for (let i = 0; i < arr.length; i += 1) {
    let s = 0;
    let wsum = 0;

    for (let k = -radius; k <= radius; k += 1) {
      const ix = i + k;
      if (ix >= 0 && ix < arr.length) {
        const w = kernel[k + radius];
        s += arr[ix] * w;
        wsum += w;
      }
    }

    out.push(Number((wsum ? s / wsum : 0).toFixed(3)));
  }

  return out;
}

function computeFrequencyDistribution(
  values,
  { binCount = 24, filterFn = null, minValue = null, maxValue = null } = {}
) {
  let vals = (values || []).map(n).filter(Number.isFinite);
  if (filterFn) vals = vals.filter(filterFn);

  if (vals.length < 2) return null;

  let min = minValue !== null ? minValue : Math.min(...vals);
  let max = maxValue !== null ? maxValue : Math.max(...vals);

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  if (min === max) {
    min -= 0.5;
    max += 0.5;
  }

  const width = (max - min) / binCount;
  const counts = Array.from({ length: binCount }, () => 0);
  const xValues = [];

  for (let i = 0; i < binCount; i += 1) {
    const start = min + i * width;
    const end = i === binCount - 1 ? max : min + (i + 1) * width;
    const center = start + (end - start) / 2;
    xValues.push(Number(center.toFixed(2)));
  }

  for (const v of vals) {
    let idx = Math.floor((v - min) / width);
    if (idx < 0) idx = 0;
    if (idx >= binCount) idx = binCount - 1;
    counts[idx] += 1;
  }

  const smoothCounts = gaussianSmooth(counts, 2, 1.15);

  return {
    xValues,
    counts,
    smoothCounts,
    sampleSize: vals.length,
    min,
    max,
    width,
  };
}

function buildEmptyChart(baseChart, text = "Seleziona almeno un elemento per visualizzare il grafico") {
  return {
    animation: false,
    grid: { left: 72, right: 56, top: 58, bottom: 90 },
    title: { left: "center", top: 10, text: "" },
    legend: { show: false },
    toolbox: { feature: { restore: { title: "Ripristina grafico" } }, right: 10, top: 10 },
    tooltip: { show: false },
    xAxis: {
      type: "category",
      data: [],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    dataZoom: [],
    graphic: [
      {
        type: "text",
        left: "center",
        top: "middle",
        style: {
          text,
          fill: "#64748b",
          fontSize: 18,
          fontWeight: 700,
        },
      },
    ],
    series: [],
  };
}

// -----------------------------------------------------
// COMPAT FIELDS
// -----------------------------------------------------
function getRhMin(d) {
  const a = n(getAny(d, ["rh_min", "rh_pct_min", "hum_min", "humidity_min"]));
  return Number.isFinite(a) ? a : NaN;
}

function getRhMax(d) {
  const a = n(getAny(d, ["rh_max", "rh_pct_max", "hum_max", "humidity_max"]));
  return Number.isFinite(a) ? a : NaN;
}

function getRhMean(d) {
  const a = n(getAny(d, ["rh_mean", "rh_pct_mean", "hum_avg", "humidity_avg"]));
  return Number.isFinite(a) ? a : NaN;
}

// -----------------------------------------------------
// NORMALIZE DAILY
// -----------------------------------------------------
function normalizeDailyRow(row) {
  return {
    date: String(row?.date ?? "").slice(0, 10),

    tmin: n(getAny(row, ["tmin", "temp_min", "tempMin", "temperatureMin", "min_temp"])),
    tmean: n(getAny(row, ["tmean", "tavg", "temp_avg", "tempAvg", "temperatureAvg", "avg_temp", "temp_mean"])),
    tmax: n(getAny(row, ["tmax", "temp_max", "tempMax", "temperatureMax", "max_temp"])),

    rain_total: n(getAny(row, ["rain_total", "rain", "rainSum", "rain_sum", "precipitation", "precip_total"])),
    rainrate_max: n(getAny(row, ["rainrate_max", "rain_rate_max", "rainRateMax", "precip_rate_max"])),

    rh_min: n(getAny(row, ["rh_min", "rh_pct_min", "hum_min", "humidity_min"])),
    rh_mean: n(getAny(row, ["rh_mean", "rh_pct_mean", "hum_avg", "humidity_avg"])),
    rh_max: n(getAny(row, ["rh_max", "rh_pct_max", "hum_max", "humidity_max"])),

    wind_avg: n(getAny(row, ["wind_avg", "wind_mean", "windAvg", "avg_wind", "wind_speed_avg"])),
    gust_max: n(getAny(row, ["gust_max", "gust", "wind_gust", "windGust", "max_gust"])),
    wind_dir_mean_deg: n(getAny(row, ["wind_dir_mean_deg", "wind_dir_deg", "windDirectionAvg", "wind_dir_avg_deg"])),

    press_min: n(getAny(row, ["press_min", "pressure_min", "pressMin"])),
    press_avg: n(getAny(row, ["press_avg", "pressure_avg", "pressureAvg", "avg_pressure", "pressure_mean"])),
    press_max: n(getAny(row, ["press_max", "pressure_max", "pressMax"])),

    uv_mean_pos: n(getAny(row, ["uv_mean_pos", "uv_avg", "uvAvg", "avg_uv", "uv_mean"])),
    uv_max: n(getAny(row, ["uv_max", "uvMax"])),

    solar_mean_pos: n(getAny(row, ["solar_mean_pos", "solar_avg", "solarAvg", "rad_avg", "radiation_avg", "avg_solar", "solar_mean"])),
    solar_max: n(getAny(row, ["solar_max", "solarMax", "radiation_max"])),
  };
}

// -----------------------------------------------------
// NORMALIZE INTRADAY
// -----------------------------------------------------
function extractTimeLabel(rawTs) {
  if (rawTs === null || rawTs === undefined) return "";

  if (typeof rawTs === "number" && Number.isFinite(rawTs)) {
    const ms = rawTs > 1e12 ? rawTs : rawTs * 1000;
    const d = new Date(ms);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const s = String(rawTs).trim();
  if (!s) return "";

  const m1 = s.match(/(\d{1,2}):(\d{2})/);
  if (m1) return `${String(m1[1]).padStart(2, "0")}:${m1[2]}`;

  const m2 = s.match(/T(\d{2}:\d{2})/);
  if (m2) return m2[1];

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) return s.slice(11, 16);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(11, 16);

  return "";
}

function normalizeIntradayRow(row) {
  const rawTs =
    getAny(row, [
      "t",
      "timestamp",
      "datetime",
      "dateTime",
      "date",
      "time",
      "ts",
      "local_time",
      "obsTimeLocal",
      "obsTimeUtc",
    ]) || "";

  return {
    time: extractTimeLabel(rawTs),
    temp: n(getAny(row, ["temp_c", "temp", "temperature", "outTemp", "temp_out"])),
    rh: n(getAny(row, ["rh_pct", "humidity", "hum", "outHumidity", "rh"])),
    rain: n(getAny(row, ["rain_15m_mm", "rain", "rain_step", "rainDelta", "rain_delta", "precip"])),
    wind: n(getAny(row, ["wind_kmh", "wind", "wind_avg", "windSpeed", "wind_speed", "avg_wind"])),
    gust: n(getAny(row, ["gust_kmh", "gust", "wind_gust", "windGust"])),
    press: n(getAny(row, ["press_hpa", "pressure", "barometer", "press", "relativePressure", "stationPressure"])),
    uv: n(getAny(row, ["uv", "uv_index", "UV"])),
    solar: n(getAny(row, ["solar_wm2", "solar", "solarRadiation", "radiation", "rad"])),
  };
}

function parseIntradayPayload(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.rows)) return json.rows;
  if (Array.isArray(json?.data)) return json.data;
  if (Array.isArray(json?.observations)) return json.observations;
  if (Array.isArray(json?.samples)) return json.samples;
  if (Array.isArray(json?.archive)) return json.archive;
  return [];
}

// -----------------------------------------------------
// AGGREGATIONS
// -----------------------------------------------------
function aggregateMonthRows(rows, year, month) {
  const prefix = `${year}-${pad2(month)}-`;
  return rows
    .filter((r) => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function aggregateYearRows(rows, year) {
  return rows
    .filter((r) => r.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// -----------------------------------------------------
// DESCRIZIONI GRAFICI
// -----------------------------------------------------
function getChartDescription(mode, param) {
  if (param === "temp_mean_dist") {
    return "Il grafico mostra la distribuzione di frequenza delle temperature medie giornaliere. Le barre indicano quanti giorni ricadono in ciascun intervallo di temperatura, mentre la linea smussata serve a leggere meglio la forma generale della distribuzione. Il picco indica i valori più frequenti nell’anno selezionato.";
  }

  if (param === "rain_dist") {
    return "Il grafico mostra la distribuzione di frequenza delle precipitazioni giornaliere nei soli giorni piovosi, cioè con accumulo superiore a 0 mm. Le barre indicano quanti giorni ricadono in ciascun intervallo di pioggia, mentre la linea smussata evidenzia gli accumuli più tipici.";
  }

  if (mode === "giorni") {
    return "Il grafico mostra l’andamento intragiornaliero del parametro scelto. L’asse orizzontale rappresenta le ore del giorno, mentre ogni linea corrisponde a uno dei giorni selezionati.";
  }

  if (mode === "mesi") {
    return "Il grafico confronta l’andamento giornaliero del parametro scelto nei mesi selezionati. L’asse orizzontale rappresenta i giorni del mese, mentre ogni linea o barra corrisponde a un mese diverso.";
  }

  return "Il grafico confronta l’andamento annuale del parametro scelto. L’asse orizzontale segue il calendario da gennaio a dicembre e le serie sono allineate sulle date reali, quindi eventuali anni incompleti iniziano solo dal primo dato disponibile.";
}

// -----------------------------------------------------
// SELECT OPTIONS
// -----------------------------------------------------
const MODE_OPTIONS = [
  { key: "giorni", label: "Giorni" },
  { key: "mesi", label: "Mesi" },
  { key: "anni", label: "Anni" },
];

const DAILY_PARAMS = [
  { key: "temp", label: "Temperatura" },
  { key: "rh", label: "Umidità relativa" },
  { key: "rain", label: "Precipitazioni cumulate" },
  { key: "wind", label: "Vento medio" },
  { key: "gust", label: "Raffiche" },
  { key: "press", label: "Pressione relativa" },
  { key: "uv", label: "Indice UV" },
  { key: "solar", label: "Radiazione solare" },
];

const MONTH_PARAMS = [
  { key: "temp_max", label: "Temperatura massima" },
  { key: "temp_mean", label: "Temperatura media" },
  { key: "temp_min", label: "Temperatura minima" },
  { key: "rain", label: "Precipitazione giornaliera" },
  { key: "rain_cum", label: "Precipitazione cumulata" },
  { key: "humidity_max", label: "Umidità massima" },
  { key: "humidity_mean", label: "Umidità media" },
  { key: "humidity_min", label: "Umidità minima" },
  { key: "wind", label: "Vento medio" },
  { key: "gust", label: "Raffiche" },
  { key: "pressure", label: "Pressione media" },
  { key: "uv", label: "UV medio" },
  { key: "solar", label: "Radiazione media" },
];

const YEAR_PARAMS = [
  { key: "temp_max", label: "Temperatura massima" },
  { key: "temp_mean", label: "Temperatura media" },
  { key: "temp_min", label: "Temperatura minima" },
  { key: "rain", label: "Precipitazione giornaliera" },
  { key: "rain_cum", label: "Precipitazione cumulata" },
  { key: "humidity_max", label: "Umidità massima" },
  { key: "humidity_mean", label: "Umidità media" },
  { key: "humidity_min", label: "Umidità minima" },
  { key: "wind", label: "Vento medio" },
  { key: "gust", label: "Raffiche" },
  { key: "pressure", label: "Pressione media" },
  { key: "uv", label: "UV medio" },
  { key: "solar", label: "Radiazione media" },
  { key: "temp_mean_dist", label: "Distribuzione temperature medie giornaliere" },
  { key: "rain_dist", label: "Distribuzione precipitazioni giornaliere" },
];

// -----------------------------------------------------
// PAGE
// -----------------------------------------------------
export default function ConfrontoPage({ dailyRows }) {
  const [mounted, setMounted] = useState(false);
  const [zoomRange, setZoomRange] = useState({ start: 0, end: 100 });

  useEffect(() => setMounted(true), []);

  const daily = useMemo(() => dailyRows.map(normalizeDailyRow), [dailyRows]);

  const availableDates = useMemo(() => daily.map((r) => r.date).sort(), [daily]);

  const availableMonths = useMemo(() => {
    return Array.from(new Set(daily.map((r) => r.date.slice(0, 7)))).sort();
  }, [daily]);

  const availableYears = useMemo(() => {
    return Array.from(new Set(daily.map((r) => r.date.slice(0, 4)))).sort();
  }, [daily]);

  const monthsByYear = useMemo(() => {
    const map = {};
    for (const y of availableYears) {
      map[y] = Array.from(
        new Set(
          daily
            .filter((r) => r.date.startsWith(`${y}-`))
            .map((r) => r.date.slice(5, 7))
        )
      ).sort();
    }
    return map;
  }, [daily, availableYears]);

  const daysByYearMonth = useMemo(() => {
    const map = {};
    for (const d of availableDates) {
      const y = d.slice(0, 4);
      const m = d.slice(5, 7);
      const key = `${y}-${m}`;
      if (!map[key]) map[key] = [];
      map[key].push(d.slice(8, 10));
    }
    return map;
  }, [availableDates]);

  const [mode, setMode] = useState("giorni");
  const [param, setParam] = useState("temp");

  const [daySelections, setDaySelections] = useState([]);
  const [monthSelections, setMonthSelections] = useState([]);
  const [yearSelections, setYearSelections] = useState([]);
  const [intradayData, setIntradayData] = useState({});

  const currentParams = useMemo(() => {
    if (mode === "giorni") return DAILY_PARAMS;
    if (mode === "mesi") return MONTH_PARAMS;
    return YEAR_PARAMS;
  }, [mode]);

  const activeSelectionCount =
    mode === "giorni"
      ? daySelections.length
      : mode === "mesi"
      ? monthSelections.length
      : yearSelections.length;

  const legendRows = Math.max(1, Math.ceil(activeSelectionCount / 4));
  const chartHeight = activeSelectionCount <= 4 ? 560 : Math.min(860, 560 + legendRows * 42);
  const gridBottom = activeSelectionCount <= 4 ? 108 : Math.min(250, 92 + legendRows * 28);
  const zoomSpan = Math.max(0, zoomRange.end - zoomRange.start);

  const chartDescription = useMemo(() => getChartDescription(mode, param), [mode, param]);

  const chartEvents = useMemo(
    () => ({
      datazoom: (params) => {
        const payload = Array.isArray(params?.batch) ? params.batch[0] : params;
        const start = Number(payload?.start);
        const end = Number(payload?.end);

        if (Number.isFinite(start) && Number.isFinite(end)) {
          setZoomRange((prev) => {
            if (Math.abs(prev.start - start) < 0.1 && Math.abs(prev.end - end) < 0.1) {
              return prev;
            }

            return { start, end };
          });
        }
      },
      restore: () => {
        setZoomRange({ start: 0, end: 100 });
      },
    }),
    []
  );

  useEffect(() => {
    const valid = currentParams.some((p) => p.key === param);
    if (!valid) setParam(currentParams[0]?.key || "");
  }, [mode, currentParams, param]);

  useEffect(() => {
    setZoomRange({ start: 0, end: 100 });
  }, [mode, param, daySelections.length, monthSelections.length, yearSelections.length]);

  useEffect(() => {
    if (mode !== "giorni") {
      setIntradayData({});
      return;
    }

    const ids = daySelections
      .map((s) => (s.year && s.month && s.day ? `${s.year}-${s.month}-${s.day}` : ""))
      .filter(Boolean);

    if (!ids.length) {
      setIntradayData({});
      return;
    }

    let alive = true;

    async function fetchIntradayByCandidates(iso) {
      const paths = getIntradayCandidatePaths(iso);
      for (const p of paths) {
        try {
          const res = await fetch(p, { cache: "no-store" });
          if (!res.ok) continue;
          const json = await res.json();
          const rows = parseIntradayPayload(json);
          if (rows.length) return rows;
        } catch {}
      }
      return [];
    }

    async function loadAll() {
      const next = {};

      await Promise.all(
        ids.map(async (iso) => {
          const rows = await fetchIntradayByCandidates(iso);
          next[iso] = rows
            .map(normalizeIntradayRow)
            .filter((r) => r.time)
            .sort((a, b) => String(a.time).localeCompare(String(b.time)));
        })
      );

      if (alive) setIntradayData(next);
    }

    loadAll();

    return () => {
      alive = false;
    };
  }, [mode, daySelections]);

  function addDaySelection() {
    setDaySelections((prev) => {
      const picked = pickFromEndByIndex(availableDates, prev.length);
      const [year = "", month = "", day = ""] = picked ? picked.split("-") : [];
      return [...prev, { year, month, day }];
    });
  }

  function addMonthSelection() {
    setMonthSelections((prev) => {
      const picked = pickFromEndByIndex(availableMonths, prev.length);
      const [year = "", month = ""] = picked ? picked.split("-") : [];
      return [...prev, { year, month }];
    });
  }

  function addYearSelection() {
    setYearSelections((prev) => {
      const year = pickFromEndByIndex(availableYears, prev.length);
      return [...prev, { year }];
    });
  }

  function clearCurrentSelections() {
    if (mode === "giorni") {
      setDaySelections([]);
      setIntradayData({});
      return;
    }

    if (mode === "mesi") {
      setMonthSelections([]);
      return;
    }

    setYearSelections([]);
  }

  function removeDaySelection(index) {
    setDaySelections((prev) => prev.filter((_, i) => i !== index));
  }

  function removeMonthSelection(index) {
    setMonthSelections((prev) => prev.filter((_, i) => i !== index));
  }

  function removeYearSelection(index) {
    setYearSelections((prev) => prev.filter((_, i) => i !== index));
  }

  function updateDaySelection(index, patch) {
    setDaySelections((prev) => {
      const next = [...prev];
      const current = { ...next[index], ...patch };

      if (patch.year !== undefined) {
        const months = monthsByYear[current.year] || [];
        if (!months.includes(current.month)) current.month = months[0] || "";
        const dayKey = `${current.year}-${current.month}`;
        const days = daysByYearMonth[dayKey] || [];
        if (!days.includes(current.day)) current.day = days[0] || "";
      }

      if (patch.month !== undefined) {
        const dayKey = `${current.year}-${current.month}`;
        const days = daysByYearMonth[dayKey] || [];
        if (!days.includes(current.day)) current.day = days[0] || "";
      }

      next[index] = current;
      return next;
    });
  }

  function updateMonthSelection(index, patch) {
    setMonthSelections((prev) => {
      const next = [...prev];
      const current = { ...next[index], ...patch };

      if (patch.year !== undefined) {
        const months = monthsByYear[current.year] || [];
        if (!months.includes(current.month)) current.month = months[0] || "";
      }

      next[index] = current;
      return next;
    });
  }

  function updateYearSelection(index, patch) {
    setYearSelections((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  const seriesLabels = useMemo(() => {
    if (mode === "giorni") {
      return makeUniqueLabels(
        daySelections.map((s) => {
          if (!s.year || !s.month || !s.day) return "—";
          return formatDateIt(`${s.year}-${s.month}-${s.day}`);
        })
      );
    }

    if (mode === "mesi") {
      return makeUniqueLabels(
        monthSelections.map((s) => {
          if (!s.year || !s.month) return "—";
          return formatMonthYear(`${s.year}-${s.month}`);
        })
      );
    }

    return makeUniqueLabels(yearSelections.map((s) => s.year || "—"));
  }, [mode, daySelections, monthSelections, yearSelections]);

  const baseChart = useMemo(() => {
    return {
      animation: false,
      grid: { left: 72, right: 56, top: 58, bottom: gridBottom },
      title: { left: "center", top: 10 },
      legend: {
        show: true,
        bottom: 38,
        left: "center",
        itemGap: 18,
        itemWidth: 22,
        itemHeight: 12,
        padding: [8, 10, 2, 10],
        textStyle: {
          fontSize: 13,
          fontWeight: 600,
        },
      },
      toolbox: {
        show: true,
        right: 10,
        top: 10,
        itemSize: 20,
        feature: {
          restore: {
            show: true,
            title: "Ripristina grafico",
          },
        },
      },
      tooltip: { trigger: "axis", order: "seriesAsc" },
      xAxis: {
        type: "category",
        axisLabel: { rotate: 0, margin: 14 },
      },
      yAxis: {
        type: "value",
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          filterMode: "none",
          start: zoomRange.start,
          end: zoomRange.end,
        },
        {
          type: "slider",
          xAxisIndex: 0,
          height: 22,
          bottom: 8,
          filterMode: "none",
          start: zoomRange.start,
          end: zoomRange.end,
          borderColor: "#d9e2f2",
          fillerColor: "rgba(79,111,213,0.14)",
          backgroundColor: "#eef3fb",
          handleStyle: {
            color: "#ffffff",
            borderColor: "#97acd8",
          },
          moveHandleStyle: {
            color: "#97acd8",
          },
        },
      ],
      graphic: [],
      series: [],
    };
  }, [zoomRange, gridBottom]);

  const chartOption = useMemo(() => {
    if (mode === "giorni") {
      const selected = daySelections
        .map((s, i) => ({
          iso: s.year && s.month && s.day ? `${s.year}-${s.month}-${s.day}` : "",
          label: seriesLabels[i],
          color: pickColor(i),
        }))
        .filter((x) => x.iso);

      if (!selected.length) return buildEmptyChart(baseChart);

      const xAxis = Array.from(
        new Set(selected.flatMap((item) => (intradayData[item.iso] || []).map((r) => r.time)))
      ).sort();

      if (!xAxis.length) return buildEmptyChart(baseChart, "Nessun dato intraday disponibile per la selezione");

      if (param === "temp") {
        return buildDayLineChart(baseChart, "Temperatura", xAxis, "°C", selected, intradayData, (row) => safeVal(row?.temp), (v) => `${Number(v).toFixed(1)} °C`);
      }

      if (param === "rh") {
        return buildDayLineChart(baseChart, "Umidità relativa", xAxis, "%", selected, intradayData, (row) => safeVal(row?.rh), (v) => `${Math.round(Number(v))} %`, {
          min: 0,
          max: 100,
          axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
        });
      }

      if (param === "rain") {
        return {
          ...baseChart,
          title: { ...baseChart.title, text: "Precipitazioni cumulate" },
          xAxis: { ...baseChart.xAxis, data: xAxis },
          yAxis: {
            type: "value",
            name: "mm",
            nameLocation: "middle",
            nameRotate: 90,
            nameGap: 52,
            scale: true,
            axisLabel: { formatter: (v) => Number(v).toFixed(1) },
          },
          tooltip: {
            trigger: "axis",
            order: "seriesAsc",
            formatter: (params) =>
              axisTooltipFormatter(
                params,
                selected.map((s) => ({
                  name: s.label,
                  formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} mm`),
                }))
              ),
          },
          series: selected.map((s) => {
            const map = new Map((intradayData[s.iso] || []).map((r) => [r.time, r]));
            return {
              name: s.label,
              type: "line",
              data: cumulative(xAxis.map((t) => n(map.get(t)?.rain))),
              showSymbol: false,
              connectNulls: false,
              lineStyle: { width: 3, color: s.color },
              itemStyle: { color: s.color },
              smooth: false,
            };
          }),
        };
      }

      if (param === "wind") {
        return buildDayLineChart(baseChart, "Vento medio", xAxis, "km/h", selected, intradayData, (row) => safeVal(row?.wind), (v) => `${Number(v).toFixed(1)} km/h`, {
          axisLabelFormatter: (v) => Number(v).toFixed(0),
        });
      }

      if (param === "gust") {
        return buildDayLineChart(baseChart, "Raffiche", xAxis, "km/h", selected, intradayData, (row) => safeVal(row?.gust), (v) => `${Number(v).toFixed(1)} km/h`, {
          axisLabelFormatter: (v) => Number(v).toFixed(0),
        });
      }

      if (param === "press") {
        return buildDayLineChart(baseChart, "Pressione relativa", xAxis, "hPa", selected, intradayData, (row) => safeVal(row?.press), (v) => `${Number(v).toFixed(1)} hPa`, {
          axisLabelFormatter: (v) => Number(v).toFixed(0),
        });
      }

      if (param === "uv") {
        return buildDayLineChart(baseChart, "Indice UV", xAxis, "UV", selected, intradayData, (row) => safeVal(row?.uv), (v) => `${Number(v).toFixed(1)}`, {
          axisLabelFormatter: (v) => Number(v).toFixed(1),
        });
      }

      return buildDayLineChart(baseChart, "Radiazione solare", xAxis, "W/m²", selected, intradayData, (row) => safeVal(row?.solar), (v) => `${Math.round(Number(v))} W/m²`, {
        axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
        nameGap: 56,
      });
    }

    if (mode === "mesi") {
      const selected = monthSelections
        .map((s, i) => ({
          ym: s.year && s.month ? `${s.year}-${s.month}` : "",
          label: seriesLabels[i],
          color: pickColor(i),
        }))
        .filter((x) => x.ym);

      if (!selected.length) return buildEmptyChart(baseChart);

      const maxDays = Math.max(...selected.map((s) => daysInMonth(s.ym.slice(0, 4), s.ym.slice(5, 7))), 31);
      const xAxis = Array.from({ length: maxDays }, (_, i) => String(i + 1));

      const seriesData = selected.map((s) => {
        const [y, m] = s.ym.split("-");
        const rows = aggregateMonthRows(daily, y, m);
        const map = new Map(rows.map((r) => [Number(r.date.slice(8, 10)), r]));
        return { ...s, map, rows };
      });

      if (param === "temp_max") {
        return buildSimpleLineChart({ baseChart, title: "Temperatura massima", xAxis, yName: "°C", formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`), seriesData, getValue: (map, d) => safeVal(map.get(Number(d))?.tmax) });
      }

      if (param === "temp_mean") {
        return buildSimpleLineChart({ baseChart, title: "Temperatura media", xAxis, yName: "°C", formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`), seriesData, getValue: (map, d) => safeVal(map.get(Number(d))?.tmean) });
      }

      if (param === "temp_min") {
        return buildSimpleLineChart({ baseChart, title: "Temperatura minima", xAxis, yName: "°C", formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`), seriesData, getValue: (map, d) => safeVal(map.get(Number(d))?.tmin) });
      }

      if (param === "rain") {
        return {
          ...baseChart,
          title: { ...baseChart.title, text: "Precipitazione giornaliera" },
          xAxis: { ...baseChart.xAxis, data: xAxis },
          yAxis: {
            type: "value",
            name: "mm",
            nameLocation: "middle",
            nameRotate: 90,
            nameGap: 52,
            scale: true,
            axisLabel: { formatter: (v) => Number(v).toFixed(1) },
          },
          tooltip: {
            trigger: "axis",
            order: "seriesAsc",
            formatter: (params) =>
              axisTooltipFormatter(
                params,
                seriesData.map((s) => ({
                  name: s.label,
                  formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} mm`),
                }))
              ),
          },
          series: seriesData.map((s) => ({
            name: s.label,
            type: "bar",
            barMaxWidth: 18,
            data: xAxis.map((d) => safeVal(s.map.get(Number(d))?.rain_total)),
            itemStyle: { color: s.color },
          })),
        };
      }

      if (param === "rain_cum") {
        return buildSimpleLineChart({
          baseChart,
          title: "Precipitazione cumulata",
          xAxis,
          yName: "mm",
          formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} mm`),
          seriesData,
          getValue: (map, d) => {
            const vals = xAxis.slice(0, Number(d)).map((dd) => n(map.get(Number(dd))?.rain_total));
            const cum = cumulative(vals);
            return cum[cum.length - 1] ?? null;
          },
        });
      }

      if (param === "humidity_max") {
        return buildSimpleLineChart({ baseChart, title: "Umidità massima", xAxis, yName: "%", formatValue: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`), seriesData, yMin: 0, yMax: 100, getValue: (map, d) => safeVal(getRhMax(map.get(Number(d)))), axisLabelFormatter: (v) => `${Math.round(Number(v))}` });
      }

      if (param === "humidity_mean") {
        return buildSimpleLineChart({ baseChart, title: "Umidità media", xAxis, yName: "%", formatValue: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`), seriesData, yMin: 0, yMax: 100, getValue: (map, d) => safeVal(getRhMean(map.get(Number(d)))), axisLabelFormatter: (v) => `${Math.round(Number(v))}` });
      }

      if (param === "humidity_min") {
        return buildSimpleLineChart({ baseChart, title: "Umidità minima", xAxis, yName: "%", formatValue: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`), seriesData, yMin: 0, yMax: 100, getValue: (map, d) => safeVal(getRhMin(map.get(Number(d)))), axisLabelFormatter: (v) => `${Math.round(Number(v))}` });
      }

      if (param === "wind") {
        return buildSimpleLineChart({ baseChart, title: "Vento medio", xAxis, yName: "km/h", formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} km/h`), seriesData, getValue: (map, d) => safeVal(map.get(Number(d))?.wind_avg), axisLabelFormatter: (v) => Number(v).toFixed(0) });
      }

      if (param === "gust") {
        return buildSimpleLineChart({ baseChart, title: "Raffiche", xAxis, yName: "km/h", formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} km/h`), seriesData, getValue: (map, d) => safeVal(map.get(Number(d))?.gust_max), axisLabelFormatter: (v) => Number(v).toFixed(0) });
      }

      if (param === "pressure") {
        return buildSimpleLineChart({ baseChart, title: "Pressione media", xAxis, yName: "hPa", formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`), seriesData, getValue: (map, d) => safeVal(map.get(Number(d))?.press_avg), axisLabelFormatter: (v) => Number(v).toFixed(0) });
      }

      if (param === "uv") {
        return buildSimpleLineChart({ baseChart, title: "UV medio", xAxis, yName: "UV", formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)}`), seriesData, getValue: (map, d) => safeVal(map.get(Number(d))?.uv_mean_pos), axisLabelFormatter: (v) => Number(v).toFixed(1) });
      }

      return buildSimpleLineChart({ baseChart, title: "Radiazione media", xAxis, yName: "W/m²", formatValue: (v) => (v == null ? "—" : `${Math.round(Number(v))} W/m²`), seriesData, getValue: (map, d) => safeVal(map.get(Number(d))?.solar_mean_pos), axisLabelFormatter: (v) => `${Math.round(Number(v))}`, nameGap: 56 });
    }

    const selected = yearSelections
      .map((s, i) => ({
        year: s.year || "",
        label: seriesLabels[i],
        color: pickColor(i),
      }))
      .filter((x) => x.year);

    if (!selected.length) return buildEmptyChart(baseChart);

    const yearRows = selected.map((s) => {
      const rows = aggregateYearRows(daily, s.year);
      const rowByMonthDay = new Map(rows.map((r) => [r.date.slice(5, 10), r]));

      return {
        ...s,
        rows,
        rowByMonthDay,
      };
    });

    if (param === "temp_mean_dist") {
      const allValues = yearRows
        .flatMap((s) => s.rows.map((r) => r.tmean))
        .map(n)
        .filter(Number.isFinite);

      if (allValues.length < 2) {
        return buildEmptyChart(baseChart, "Nessun dato disponibile per la distribuzione");
      }

      const globalMin = Math.min(...allValues);
      const globalMax = Math.max(...allValues);

      const dists = yearRows.map((s) => {
        const values = s.rows.map((r) => r.tmean);
        const dist = computeFrequencyDistribution(values, {
          binCount: 26,
          minValue: globalMin,
          maxValue: globalMax,
        });
        return { ...s, dist };
      });

      const validDists = dists.filter((s) => s.dist);
      if (!validDists.length) {
        return buildEmptyChart(baseChart, "Nessun dato disponibile per la distribuzione");
      }

      return {
        ...baseChart,
        legend: {
          ...baseChart.legend,
          data: validDists.map((s) => s.label),
        },
        title: {
          ...baseChart.title,
          text: "Distribuzione temperature medie giornaliere",
        },
        xAxis: {
          type: "value",
          min: Number(globalMin.toFixed(1)),
          max: Number(globalMax.toFixed(1)),
          axisLabel: {
            formatter: (v) => `${Number(v).toFixed(1)}`,
            hideOverlap: true,
          },
          name: "Temperatura media giornaliera (°C)",
          nameLocation: "middle",
          nameGap: 34,
        },
        yAxis: {
          type: "value",
          name: "Frequenza (giorni)",
          nameLocation: "middle",
          nameRotate: 90,
          nameGap: 58,
          min: 0,
          axisLabel: {
            formatter: (v) => `${Number(v).toFixed(0)}`,
          },
        },
        tooltip: {
          trigger: "axis",
          order: "seriesAsc",
          formatter: (params) =>
            axisTooltipFormatter(
              params,
              validDists.map((s) => ({
                name: s.label,
                formatter: (v) => `${Number(v).toFixed(1)} giorni`,
              }))
            ),
        },
        series: validDists.flatMap((s) => [
          {
            name: `${s.label} barre`,
            type: "bar",
            data: s.dist.xValues.map((x, idx) => [x, s.dist.counts[idx]]),
            barWidth: 12,
            silent: true,
            tooltip: { show: false },
            itemStyle: {
              color: s.color,
              opacity: 0.18,
            },
            emphasis: {
              disabled: true,
            },
          },
          {
            name: s.label,
            type: "line",
            data: s.dist.xValues.map((x, idx) => [x, s.dist.smoothCounts[idx]]),
            showSymbol: false,
            smooth: true,
            connectNulls: false,
            lineStyle: {
              width: 3,
              color: s.color,
            },
            itemStyle: {
              color: s.color,
            },
            emphasis: {
              focus: "series",
            },
          },
        ]),
      };
    }

    if (param === "rain_dist") {
      const allValues = yearRows
        .flatMap((s) => s.rows.map((r) => r.rain_total))
        .map(n)
        .filter((v) => Number.isFinite(v) && v > 0);

      if (allValues.length < 2) {
        return buildEmptyChart(baseChart, "Nessun dato disponibile per la distribuzione");
      }

      const globalMin = 0;
      const globalMax = Math.max(...allValues);

      const dists = yearRows.map((s) => {
        const values = s.rows.map((r) => r.rain_total);
        const dist = computeFrequencyDistribution(values, {
          binCount: 24,
          filterFn: (v) => v > 0,
          minValue: globalMin,
          maxValue: globalMax,
        });
        return { ...s, dist };
      });

      const validDists = dists.filter((s) => s.dist);
      if (!validDists.length) {
        return buildEmptyChart(baseChart, "Nessun dato disponibile per la distribuzione");
      }

      return {
        ...baseChart,
        legend: {
          ...baseChart.legend,
          data: validDists.map((s) => s.label),
        },
        title: {
          ...baseChart.title,
          text: "Distribuzione precipitazioni giornaliere",
        },
        xAxis: {
          type: "value",
          min: 0,
          max: Number(globalMax.toFixed(1)),
          axisLabel: {
            formatter: (v) => `${Number(v).toFixed(1)}`,
            hideOverlap: true,
          },
          name: "Precipitazione nei giorni piovosi (mm)",
          nameLocation: "middle",
          nameGap: 34,
        },
        yAxis: {
          type: "value",
          name: "Frequenza (giorni)",
          nameLocation: "middle",
          nameRotate: 90,
          nameGap: 58,
          min: 0,
          axisLabel: {
            formatter: (v) => `${Number(v).toFixed(0)}`,
          },
        },
        tooltip: {
          trigger: "axis",
          order: "seriesAsc",
          formatter: (params) =>
            axisTooltipFormatter(
              params,
              validDists.map((s) => ({
                name: s.label,
                formatter: (v) => `${Number(v).toFixed(1)} giorni`,
              }))
            ),
        },
        series: validDists.flatMap((s) => [
          {
            name: `${s.label} barre`,
            type: "bar",
            data: s.dist.xValues.map((x, idx) => [x, s.dist.counts[idx]]),
            barWidth: 12,
            silent: true,
            tooltip: { show: false },
            itemStyle: {
              color: s.color,
              opacity: 0.18,
            },
            emphasis: {
              disabled: true,
            },
          },
          {
            name: s.label,
            type: "line",
            data: s.dist.xValues.map((x, idx) => [x, s.dist.smoothCounts[idx]]),
            showSymbol: false,
            smooth: true,
            connectNulls: false,
            lineStyle: {
              width: 3,
              color: s.color,
            },
            itemStyle: {
              color: s.color,
            },
            emphasis: {
              focus: "series",
            },
          },
        ]),
      };
    }

    const yearAxisItems = buildYearAxisItems(yearRows.map((s) => s.year));
    const xAxis = yearAxisItems.map((item) => item.label);

    function buildYearSeries(getValue) {
      return yearRows.map((s) => ({
        name: s.label,
        type: "line",
        data: yearAxisItems.map((item) => getValue(s.rowByMonthDay.get(item.key))),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: s.color },
        itemStyle: { color: s.color },
      }));
    }

    function buildYearBarSeries(getValue) {
      return yearRows.map((s) => ({
        name: s.label,
        type: "bar",
        barMaxWidth: 12,
        data: yearAxisItems.map((item) => getValue(s.rowByMonthDay.get(item.key))),
        itemStyle: { color: s.color },
      }));
    }

    function buildYearCumLineSeries(getValue) {
      return yearRows.map((s) => ({
        name: s.label,
        type: "line",
        data: cumulative(yearAxisItems.map((item) => n(getValue(s.rowByMonthDay.get(item.key))))),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: s.color },
        itemStyle: { color: s.color },
      }));
    }

    const yearChartExtra = { zoomSpan };

    if (param === "temp_max") {
      return buildYearChart(baseChart, "Temperatura massima", xAxis, "°C", yearRows, (v) => `${Number(v).toFixed(1)} °C`, buildYearSeries((r) => safeVal(r?.tmax)), yearChartExtra);
    }

    if (param === "temp_mean") {
      return buildYearChart(baseChart, "Temperatura media", xAxis, "°C", yearRows, (v) => `${Number(v).toFixed(1)} °C`, buildYearSeries((r) => safeVal(r?.tmean)), yearChartExtra);
    }

    if (param === "temp_min") {
      return buildYearChart(baseChart, "Temperatura minima", xAxis, "°C", yearRows, (v) => `${Number(v).toFixed(1)} °C`, buildYearSeries((r) => safeVal(r?.tmin)), yearChartExtra);
    }

    if (param === "rain") {
      return buildYearChart(baseChart, "Precipitazione giornaliera", xAxis, "mm", yearRows, (v) => `${Number(v).toFixed(1)} mm`, buildYearBarSeries((r) => safeVal(r?.rain_total)), yearChartExtra);
    }

    if (param === "rain_cum") {
      return buildYearChart(baseChart, "Precipitazione cumulata", xAxis, "mm", yearRows, (v) => `${Number(v).toFixed(1)} mm`, buildYearCumLineSeries((r) => safeVal(r?.rain_total)), yearChartExtra);
    }

    if (param === "humidity_max") {
      return buildYearChart(baseChart, "Umidità massima", xAxis, "%", yearRows, (v) => `${Math.round(Number(v))} %`, buildYearSeries((r) => safeVal(getRhMax(r))), {
        ...yearChartExtra,
        min: 0,
        max: 100,
        axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
      });
    }

    if (param === "humidity_mean") {
      return buildYearChart(baseChart, "Umidità media", xAxis, "%", yearRows, (v) => `${Math.round(Number(v))} %`, buildYearSeries((r) => safeVal(getRhMean(r))), {
        ...yearChartExtra,
        min: 0,
        max: 100,
        axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
      });
    }

    if (param === "humidity_min") {
      return buildYearChart(baseChart, "Umidità minima", xAxis, "%", yearRows, (v) => `${Math.round(Number(v))} %`, buildYearSeries((r) => safeVal(getRhMin(r))), {
        ...yearChartExtra,
        min: 0,
        max: 100,
        axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
      });
    }

    if (param === "wind") {
      return buildYearChart(baseChart, "Vento medio", xAxis, "km/h", yearRows, (v) => `${Number(v).toFixed(1)} km/h`, buildYearSeries((r) => safeVal(r?.wind_avg)), {
        ...yearChartExtra,
        axisLabelFormatter: (v) => Number(v).toFixed(0),
      });
    }

    if (param === "gust") {
      return buildYearChart(baseChart, "Raffiche", xAxis, "km/h", yearRows, (v) => `${Number(v).toFixed(1)} km/h`, buildYearSeries((r) => safeVal(r?.gust_max)), {
        ...yearChartExtra,
        axisLabelFormatter: (v) => Number(v).toFixed(0),
      });
    }

    if (param === "pressure") {
      return buildYearChart(baseChart, "Pressione media", xAxis, "hPa", yearRows, (v) => `${Number(v).toFixed(1)} hPa`, buildYearSeries((r) => safeVal(r?.press_avg)), {
        ...yearChartExtra,
        axisLabelFormatter: (v) => Number(v).toFixed(0),
      });
    }

    if (param === "uv") {
      return buildYearChart(baseChart, "UV medio", xAxis, "UV", yearRows, (v) => `${Number(v).toFixed(1)}`, buildYearSeries((r) => safeVal(r?.uv_mean_pos)), {
        ...yearChartExtra,
        axisLabelFormatter: (v) => Number(v).toFixed(1),
      });
    }

    return buildYearChart(baseChart, "Radiazione media", xAxis, "W/m²", yearRows, (v) => `${Math.round(Number(v))} W/m²`, buildYearSeries((r) => safeVal(r?.solar_mean_pos)), {
      ...yearChartExtra,
      axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
      nameGap: 56,
    });
  }, [mode, param, daySelections, monthSelections, yearSelections, seriesLabels, intradayData, daily, baseChart, zoomSpan]);

  const chartKey = useMemo(() => {
    return JSON.stringify({
      mode,
      param,
      days: daySelections,
      months: monthSelections,
      years: yearSelections,
      intradayKeys: Object.keys(intradayData).sort(),
    });
  }, [mode, param, daySelections, monthSelections, yearSelections, intradayData]);

  return (
    <SiteLayout
      headerProps={{
        title: "Confronto climatico",
        subtitle: "Confronta giorni, mesi e anni dell’archivio meteo scegliendo il parametro da analizzare.",
        showPeriod: false,
        currentPath: "/confronto-climatico",
      }}
    >
      <div className="wrap">
        <section className="hero">
          <div className="pageDescription">
            Questa pagina permette di confrontare tra loro giorni, mesi e anni presenti nell’archivio della stazione meteo. Per usarla, scegli prima il tipo di confronto, poi seleziona il parametro da visualizzare e aggiungi uno o più elementi con il pulsante dedicato. Ogni nuovo elemento viene proposto automaticamente partendo dal dato più recente e andando via via verso quelli precedenti; puoi comunque modificare manualmente giorno, mese o anno dai menu. Il grafico si aggiorna subito e, nella modalità annuale, l’asse temporale resta allineato alle date reali: se un anno non ha dati a gennaio, la linea inizierà solo dal primo giorno realmente disponibile.
          </div>

          <div className="topControls">
            <div className="controlCard">
              <div className="controlLabel">Tipo di confronto</div>
              <div className="pillRow">
                {MODE_OPTIONS.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    className={`pill ${mode === opt.key ? "active" : ""}`}
                    onClick={() => setMode(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="controlCard controlCardWide">
              <div className="controlLabel">Parametro</div>
              <div className="selectWrap">
                <select value={param} onChange={(e) => setParam(e.target.value)} className="selectNative">
                  {currentParams.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="toolbarRow">
            {mode === "giorni" && (
              <button type="button" className="addButton" onClick={addDaySelection}>
                + Aggiungi giorno
              </button>
            )}

            {mode === "mesi" && (
              <button type="button" className="addButton" onClick={addMonthSelection}>
                + Aggiungi mese
              </button>
            )}

            {mode === "anni" && (
              <button type="button" className="addButton" onClick={addYearSelection}>
                + Aggiungi anno
              </button>
            )}

            {activeSelectionCount > 0 && (
              <button type="button" className="clearButton" onClick={clearCurrentSelections}>
                Cancella tutto
              </button>
            )}
          </div>

          {mode === "giorni" && daySelections.length > 0 && (
            <details className="selectionDrawer" open={daySelections.length <= 8 ? true : undefined}>
              <summary className="selectionSummary">
                <span>{daySelections.length} giorni selezionati</span>
                <span className="selectionHint">Apri / modifica selezioni</span>
              </summary>

              <div className="compactList">
                {daySelections.map((sel, index) => {
                  const months = monthsByYear[sel.year] || [];
                  const days = daysByYearMonth[`${sel.year}-${sel.month}`] || [];

                  return (
                    <div className="compactRow dayCompactRow" key={`day-${index}`}>
                      <div className="compactTitle">Giorno {index + 1}</div>

                      <select
                        className="compactSelect daySelect"
                        value={sel.day}
                        onChange={(e) => updateDaySelection(index, { day: e.target.value })}
                      >
                        {days.map((d) => (
                          <option key={d} value={d}>
                            {Number(d)}
                          </option>
                        ))}
                      </select>

                      <select
                        className="compactSelect monthSelect"
                        value={sel.month}
                        onChange={(e) => updateDaySelection(index, { month: e.target.value })}
                      >
                        {months.map((m) => (
                          <option key={m} value={m}>
                            {MONTHS_IT_FULL[Number(m) - 1]}
                          </option>
                        ))}
                      </select>

                      <select
                        className="compactSelect yearSelect"
                        value={sel.year}
                        onChange={(e) => updateDaySelection(index, { year: e.target.value })}
                      >
                        {availableYears.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>

                      <button type="button" className="compactRemove" onClick={() => removeDaySelection(index)}>
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {mode === "mesi" && monthSelections.length > 0 && (
            <details className="selectionDrawer" open={monthSelections.length <= 8 ? true : undefined}>
              <summary className="selectionSummary">
                <span>{monthSelections.length} mesi selezionati</span>
                <span className="selectionHint">Apri / modifica selezioni</span>
              </summary>

              <div className="compactList">
                {monthSelections.map((sel, index) => {
                  const months = monthsByYear[sel.year] || [];

                  return (
                    <div className="compactRow monthCompactRow" key={`month-${index}`}>
                      <div className="compactTitle">Mese {index + 1}</div>

                      <select
                        className="compactSelect monthSelect"
                        value={sel.month}
                        onChange={(e) => updateMonthSelection(index, { month: e.target.value })}
                      >
                        {months.map((m) => (
                          <option key={m} value={m}>
                            {MONTHS_IT_FULL[Number(m) - 1]}
                          </option>
                        ))}
                      </select>

                      <select
                        className="compactSelect yearSelect"
                        value={sel.year}
                        onChange={(e) => updateMonthSelection(index, { year: e.target.value })}
                      >
                        {availableYears.map((y) => (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        ))}
                      </select>

                      <button type="button" className="compactRemove" onClick={() => removeMonthSelection(index)}>
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {mode === "anni" && yearSelections.length > 0 && (
            <details className="selectionDrawer" open={yearSelections.length <= 8 ? true : undefined}>
              <summary className="selectionSummary">
                <span>{yearSelections.length} anni selezionati</span>
                <span className="selectionHint">Apri / modifica selezioni</span>
              </summary>

              <div className="compactList">
                {yearSelections.map((sel, index) => (
                  <div className="compactRow yearCompactRow" key={`year-${index}`}>
                    <div className="compactTitle">Anno {index + 1}</div>

                    <select
                      className="compactSelect yearSelect"
                      value={sel.year}
                      onChange={(e) => updateYearSelection(index, { year: e.target.value })}
                    >
                      {availableYears.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>

                    <button type="button" className="compactRemove" onClick={() => removeYearSelection(index)}>
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>

        {mounted && (
          <section className="chartSection">
            <div className="chartBox">
              <ReactECharts
                key={chartKey}
                option={chartOption}
                onEvents={chartEvents}
                notMerge={true}
                lazyUpdate={false}
                style={{ height: chartHeight, width: "100%" }}
              />

              <div className="chartDescription">
                {chartDescription}
              </div>
            </div>
          </section>
        )}

        <style jsx>{`
          .wrap {
            background: transparent;
          }

          .hero {
            margin-top: 14px;
            border: 1px solid #ececec;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.9);
            box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02), 0 12px 34px rgba(0, 0, 0, 0.04);
            padding: 18px;
          }

          .pageDescription {
            margin-bottom: 14px;
            border: 1px solid #e5e7eb;
            border-radius: 16px;
            background: #f8fafc;
            color: #475569;
            font-size: 15px;
            font-weight: 650;
            line-height: 1.6;
            padding: 14px 16px;
          }

          .topControls {
            display: grid;
            grid-template-columns: 1fr 1.4fr;
            gap: 12px;
          }

          .controlCard {
            border: 1px solid #ececec;
            border-radius: 16px;
            background: #fcfcfc;
            padding: 12px 14px;
          }

          .controlCardWide {
            min-width: 0;
          }

          .controlLabel {
            font-size: 12px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #374151;
            font-weight: 900;
            margin-bottom: 10px;
          }

          .pillRow {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
          }

          .pill {
            appearance: none;
            border: 1px solid #d8dbe2;
            background: #fff;
            color: #0b1b3b;
            border-radius: 14px;
            padding: 12px 16px;
            font-size: 14px;
            font-weight: 900;
            line-height: 1;
            cursor: pointer;
            box-shadow: 0 2px 10px rgba(12, 25, 56, 0.04);
            transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
          }

          .pill:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(12, 25, 56, 0.08);
            background: #fbfcff;
          }

          .pill.active {
            background: #f5f8ff;
            border-color: #cfd8ea;
          }

          .toolbarRow {
            margin-top: 12px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            justify-content: flex-start;
          }

          .addButton,
          .clearButton {
            appearance: none;
            border-radius: 13px;
            padding: 10px 14px;
            font-size: 14px;
            font-weight: 900;
            cursor: pointer;
          }

          .addButton {
            border: 1px solid #cfd8ea;
            background: #f5f8ff;
            color: #0b1b3b;
          }

          .clearButton {
            border: 1px solid #ead1d1;
            background: #fff7f7;
            color: #991b1b;
          }

          .selectWrap {
            position: relative;
            display: inline-flex;
            align-items: center;
            width: 100%;
            border-radius: 14px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            border: 1px solid #e5e7eb;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
            overflow: hidden;
          }

          .selectNative {
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            width: 100%;
            min-height: 40px;
            padding: 0 12px;
            border: 0;
            background: transparent;
            cursor: pointer;
            font-weight: 800;
            font-size: 13px;
            color: #111111;
            color-scheme: light;
          }

          .selectNative:focus {
            outline: none;
          }

          .selectNative option,
          .selectNative optgroup {
            color: #111111;
            background: #ffffff;
          }

          .selectionDrawer {
            margin-top: 10px;
            border: 1px solid #ececec;
            border-radius: 15px;
            background: #fcfcfc;
            overflow: hidden;
          }

          .selectionSummary {
            list-style: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 10px 12px;
            color: #0f172a;
            font-size: 13px;
            font-weight: 950;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            user-select: none;
          }

          .selectionSummary::-webkit-details-marker {
            display: none;
          }

          .selectionSummary::after {
            content: "▾";
            color: #64748b;
            font-size: 13px;
            font-weight: 900;
            transition: transform 120ms ease;
          }

          .selectionDrawer[open] .selectionSummary::after {
            transform: rotate(180deg);
          }

          .selectionHint {
            margin-left: auto;
            color: #64748b;
            font-size: 11px;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: none;
          }

          .compactList {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 7px;
            border-top: 1px solid #ececec;
            padding: 9px;
          }

          .compactRow {
            display: flex;
            flex-wrap: nowrap;
            align-items: center;
            gap: 5px;
            min-width: 0;
            width: 100%;
            border: 1px solid #ececec;
            border-radius: 12px;
            background: #ffffff;
            padding: 6px;
          }

          .compactTitle {
            flex: 0 0 auto;
            color: #374151;
            font-size: 10px;
            font-weight: 950;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            white-space: nowrap;
          }

          .compactSelect {
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            min-height: 30px;
            border: 1px solid #e5e7eb;
            border-radius: 10px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            color: #111111;
            font-size: 13px;
            font-weight: 900;
            padding: 0 7px;
            cursor: pointer;
            color-scheme: light;
          }

          .daySelect {
            flex: 0 0 48px;
            width: 48px;
          }

          .monthSelect {
            flex: 1 1 78px;
            min-width: 78px;
          }

          .yearSelect {
            flex: 0 0 72px;
            width: 72px;
          }

          .compactRemove {
            appearance: none;
            flex: 0 0 30px;
            width: 30px;
            height: 30px;
            border: 1px solid #ead1d1;
            background: #fff7f7;
            color: #991b1b;
            border-radius: 10px;
            font-size: 17px;
            font-weight: 900;
            cursor: pointer;
            line-height: 1;
          }

          .chartSection {
            margin-top: 12px;
          }

          .chartBox {
            border: 1px solid #e7e7e7;
            border-radius: 16px;
            padding: 10px;
            background: rgba(255, 255, 255, 0.94);
          }

          .chartDescription {
            margin: 0 8px 8px 8px;
            border: 1px solid #e5e7eb;
            border-radius: 14px;
            background: #f8fafc;
            color: #475569;
            font-size: 14px;
            font-weight: 650;
            line-height: 1.55;
            padding: 12px 14px;
          }

          @media (max-width: 1320px) {
            .compactList {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 900px) {
            .topControls {
              grid-template-columns: 1fr;
            }

            .selectionSummary {
              align-items: flex-start;
              flex-direction: column;
            }

            .selectionHint {
              margin-left: 0;
            }

            .compactList {
              grid-template-columns: 1fr;
            }

            .compactRow {
              flex-wrap: wrap;
            }

            .compactTitle {
              flex: 0 0 100%;
              margin-bottom: 2px;
            }

            .daySelect {
              flex: 0 0 62px;
              width: 62px;
            }

            .monthSelect {
              flex: 1 1 120px;
              min-width: 0;
            }

            .yearSelect {
              flex: 1 1 90px;
              width: auto;
            }

            .compactRemove {
              width: 36px;
              flex: 0 0 36px;
            }
          }
        `}</style>
      </div>
    </SiteLayout>
  );
}

function buildDayLineChart(baseChart, title, xAxis, yName, selected, intradayData, getValue, formatter, extra = {}) {
  return {
    ...baseChart,
    title: { ...baseChart.title, text: title },
    xAxis: { ...baseChart.xAxis, data: xAxis },
    yAxis: {
      type: "value",
      name: yName,
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: extra.nameGap || 52,
      scale: extra.min === undefined && extra.max === undefined,
      min: extra.min,
      max: extra.max,
      axisLabel: {
        formatter:
          extra.axisLabelFormatter ||
          ((v) => {
            if (yName === "%") return `${Math.round(Number(v))}`;
            if (yName === "W/m²") return `${Math.round(Number(v))}`;
            if (yName === "hPa" || yName === "km/h") return Number(v).toFixed(0);
            return Number(v).toFixed(1);
          }),
      },
    },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(
          params,
          selected.map((s) => ({
            name: s.label,
            formatter: (v) => (v == null ? "—" : formatter(v)),
          }))
        ),
    },
    series: selected.map((s) => {
      const map = new Map((intradayData[s.iso] || []).map((r) => [r.time, r]));
      return {
        name: s.label,
        type: "line",
        data: xAxis.map((t) => getValue(map.get(t))),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: s.color },
        itemStyle: { color: s.color },
      };
    }),
  };
}

function buildSimpleLineChart({
  baseChart,
  title,
  xAxis,
  yName,
  formatValue,
  seriesData,
  getValue,
  yMin,
  yMax,
  axisLabelFormatter,
  nameGap = 52,
}) {
  return {
    ...baseChart,
    title: { ...baseChart.title, text: title },
    xAxis: { ...baseChart.xAxis, data: xAxis },
    yAxis: {
      type: "value",
      name: yName,
      nameLocation: "middle",
      nameRotate: 90,
      nameGap,
      scale: yMin === undefined && yMax === undefined,
      min: yMin,
      max: yMax,
      axisLabel: {
        formatter:
          axisLabelFormatter ||
          ((v) => {
            if (yName === "%") return `${Math.round(Number(v))}`;
            if (yName === "W/m²") return `${Math.round(Number(v))}`;
            if (yName === "hPa" || yName === "km/h") return Number(v).toFixed(0);
            return Number(v).toFixed(1);
          }),
      },
    },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(
          params,
          seriesData.map((s) => ({
            name: s.label,
            formatter: formatValue,
          }))
        ),
    },
    series: seriesData.map((s) => ({
      name: s.label,
      type: "line",
      data: xAxis.map((d) => getValue(s.map, d)),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 3, color: s.color },
      itemStyle: { color: s.color },
    })),
  };
}

function buildYearChart(baseChart, title, xAxis, yName, yearRows, formatter, series, extra = {}) {
  return {
    ...baseChart,
    title: { ...baseChart.title, text: title },
    xAxis: {
      ...baseChart.xAxis,
      data: xAxis,
      axisLabel: {
        rotate: 0,
        margin: 14,
        interval: getYearAxisLabelInterval(extra.zoomSpan ?? 100),
        hideOverlap: true,
        formatter: (v) => String(v),
      },
    },
    yAxis: {
      type: "value",
      name: yName,
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: extra.nameGap || 52,
      scale: extra.min === undefined && extra.max === undefined,
      min: extra.min,
      max: extra.max,
      axisLabel: {
        formatter:
          extra.axisLabelFormatter ||
          ((v) => {
            if (yName === "%") return `${Math.round(Number(v))}`;
            if (yName === "W/m²") return `${Math.round(Number(v))}`;
            if (yName === "hPa" || yName === "km/h") return Number(v).toFixed(0);
            return Number(v).toFixed(1);
          }),
      },
    },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(
          params,
          yearRows.map((s) => ({
            name: s.label,
            formatter: (v) => (v == null ? "—" : formatter(v)),
          }))
        ),
    },
    series,
  };
}