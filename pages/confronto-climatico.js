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
// COSTANTI
// -----------------------------------------------------
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

const MODE_OPTIONS = [
  { key: "giorni", label: "Giorni" },
  { key: "mesi", label: "Mesi" },
  { key: "anni", label: "Anni" },
];

const CHART_VIEW_OPTIONS = [
  { key: "values", label: "Valori reali" },
  { key: "difference", label: "Differenze dal riferimento" },
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

const PERIOD_PARAMS = [
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

const REFERENCE_COLOR = "#173b6c";
const COMPARISON_COLORS = [
  "#2563eb",
  "#f97316",
  "#16a34a",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#65a30d",
  "#be185d",
  "#4f46e5",
  "#0f766e",
];

// -----------------------------------------------------
// HELPERS GENERALI
// -----------------------------------------------------
function n(x) {
  if (x === null || x === undefined || x === "") return NaN;
  const value = Number(x);
  return Number.isFinite(value) ? value : NaN;
}

function getAny(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function safeVal(value, decimals = 2) {
  const parsed = n(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(decimals)) : null;
}

function avgFinite(values) {
  let sum = 0;
  let count = 0;

  for (const value of values || []) {
    const parsed = n(value);
    if (!Number.isFinite(parsed)) continue;
    sum += parsed;
    count += 1;
  }

  return count ? sum / count : NaN;
}

function sumFinite(values) {
  let sum = 0;
  let count = 0;

  for (const value of values || []) {
    const parsed = n(value);
    if (!Number.isFinite(parsed)) continue;
    sum += parsed;
    count += 1;
  }

  return count ? sum : NaN;
}

function minFinite(values) {
  const valid = (values || []).map(n).filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : NaN;
}

function maxFinite(values) {
  const valid = (values || []).map(n).filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : NaN;
}

function findExtremeRow(rows, getter, type = "max") {
  let selected = null;
  let selectedValue = type === "min" ? Infinity : -Infinity;

  for (const row of rows || []) {
    const value = n(getter(row));
    if (!Number.isFinite(value)) continue;

    if (
      (type === "min" && value < selectedValue) ||
      (type === "max" && value > selectedValue)
    ) {
      selected = row;
      selectedValue = value;
    }
  }

  return selected
    ? {
        value: selectedValue,
        date: selected.date,
      }
    : {
        value: NaN,
        date: "",
      };
}

function cumulative(values) {
  let sum = 0;
  let seen = false;

  return (values || []).map((value) => {
    const parsed = n(value);

    if (Number.isFinite(parsed)) {
      sum += parsed;
      seen = true;
      return Number(sum.toFixed(2));
    }

    return seen ? Number(sum.toFixed(2)) : null;
  });
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isLeapYear(year) {
  const parsed = Number(year);
  if (!Number.isFinite(parsed)) return false;
  return (parsed % 4 === 0 && parsed % 100 !== 0) || parsed % 400 === 0;
}

function pickColor(index) {
  return COMPARISON_COLORS[index % COMPARISON_COLORS.length];
}

function monthFull(yearMonth) {
  const month = Number(String(yearMonth).slice(5, 7));
  return MONTHS_IT_FULL[month - 1] || String(yearMonth).slice(5, 7);
}

function formatMonthYear(yearMonth) {
  const year = String(yearMonth).slice(0, 4);
  return `${monthFull(yearMonth)} ${year}`;
}

function formatDateIt(dateString) {
  const value = String(dateString ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "—";

  const [year, month, day] = value.split("-");
  const monthName = MONTHS_IT_FULL[Number(month) - 1] || month;
  return `${Number(day)} ${monthName} ${year}`;
}

function formatMonthDayIt(monthDay) {
  const value = String(monthDay ?? "");
  if (!/^\d{2}-\d{2}$/.test(value)) return value || "—";

  const [month, day] = value.split("-");
  const monthName = MONTHS_IT_FULL[Number(month) - 1] || month;
  return `${Number(day)} ${monthName.toLowerCase()}`;
}

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function buildYearAxisItems(years = []) {
  const includeLeapDay = years.some((year) => isLeapYear(year));
  const baseYear = includeLeapDay ? 2020 : 2021;
  const totalDays = includeLeapDay ? 366 : 365;

  return Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(baseYear, 0, index + 1);
    const month = pad2(date.getMonth() + 1);
    const day = pad2(date.getDate());

    return {
      key: `${month}-${day}`,
      label: `${date.getDate()} ${MONTHS_IT_SHORT[date.getMonth()]}`,
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
    if (zoomSpan > 9) {
      return day === 1 || day === 5 || day === 10 || day === 15 || day === 20 || day === 25;
    }
    if (zoomSpan > 4) return day === 1 || day % 2 === 1;

    return true;
  };
}

function axisTooltipFormatter(params, specs) {
  if (!Array.isArray(params) || !params.length) return "";

  const title = params[0]?.axisValueLabel ?? params[0]?.name ?? "—";
  const lines = [`<b>${title}</b>`];

  for (const spec of specs) {
    const point = params.find((item) => item.seriesName === spec.name);
    if (!point) continue;

    const rawValue = Array.isArray(point.value) ? point.value[1] : point.value;
    const text = spec.formatter ? spec.formatter(rawValue) : rawValue;
    lines.push(`${point.marker}${spec.name}: <b>${text}</b>`);
  }

  return lines.join("<br/>");
}

function circularMeanDeg(values) {
  const valid = (values || []).map(n).filter(Number.isFinite);
  if (!valid.length) return NaN;

  let x = 0;
  let y = 0;

  for (const value of valid) {
    const radians = (value * Math.PI) / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
  }

  if (x === 0 && y === 0) return NaN;

  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return (degrees + 360) % 360;
}

function circularDifferenceDeg(comparison, reference) {
  const a = n(comparison);
  const b = n(reference);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return ((a - b + 540) % 360) - 180;
}

function windCardinal(degrees) {
  const value = n(degrees);
  if (!Number.isFinite(value)) return "";

  const labels = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSO",
    "SO",
    "OSO",
    "O",
    "ONO",
    "NO",
    "NNO",
  ];

  return labels[Math.round((((value % 360) + 360) % 360) / 22.5) % 16];
}

function selectionFromDate(dateString) {
  const [year = "", month = "", day = ""] = String(dateString || "").split("-");
  return { year, month, day };
}

function selectionFromMonth(yearMonth) {
  const [year = "", month = ""] = String(yearMonth || "").split("-");
  return { year, month };
}

function selectionFromYear(year) {
  return { year: String(year || "") };
}

function daySelectionId(selection) {
  return selection?.year && selection?.month && selection?.day
    ? `${selection.year}-${selection.month}-${selection.day}`
    : "";
}

function monthSelectionId(selection) {
  return selection?.year && selection?.month ? `${selection.year}-${selection.month}` : "";
}

function yearSelectionId(selection) {
  return selection?.year || "";
}

function pickUnusedFromEnd(list, usedValues) {
  const used = new Set((usedValues || []).filter(Boolean));

  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (!used.has(list[index])) return list[index];
  }

  return list[list.length - 1] || "";
}

function getIntradayCandidatePaths(isoDate) {
  const [year, month, day] = String(isoDate).split("-");

  return [
    `/data/intraday/${year}/${month}/${day}.json`,
    `/data/intraday/${year}/${month}/${year}-${month}-${day}.json`,
    `/data/intraday/${year}-${month}-${day}.json`,
    `/data/${year}/${month}/${day}.json`,
  ];
}

function buildEmptyChart(baseChart, text = "Seleziona almeno un periodo da confrontare") {
  return {
    ...baseChart,
    legend: { show: false },
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
          fontSize: 17,
          fontWeight: 700,
          align: "center",
        },
      },
    ],
    series: [],
  };
}

// -----------------------------------------------------
// NORMALIZZAZIONE DAILY.JSON
// -----------------------------------------------------
function normalizeDailyRow(row) {
  return {
    date: String(row?.date ?? "").slice(0, 10),

    tmin: n(getAny(row, ["tmin", "temp_min", "tempMin", "temperatureMin", "min_temp"])),
    tmean: n(
      getAny(row, [
        "tmean",
        "tavg",
        "temp_avg",
        "tempAvg",
        "temperatureAvg",
        "avg_temp",
        "temp_mean",
      ])
    ),
    tmax: n(getAny(row, ["tmax", "temp_max", "tempMax", "temperatureMax", "max_temp"])),

    rain_total: n(
      getAny(row, ["rain_total", "rain", "rainSum", "rain_sum", "precipitation", "precip_total"])
    ),
    rainrate_max: n(
      getAny(row, ["rainrate_max", "rain_rate_max", "rainRateMax", "precip_rate_max"])
    ),

    rh_min: n(getAny(row, ["rh_min", "rh_pct_min", "hum_min", "humidity_min"])),
    rh_mean: n(getAny(row, ["rh_mean", "rh_pct_mean", "hum_avg", "humidity_avg"])),
    rh_max: n(getAny(row, ["rh_max", "rh_pct_max", "hum_max", "humidity_max"])),

    wind_avg: n(getAny(row, ["wind_avg", "wind_mean", "windAvg", "avg_wind", "wind_speed_avg"])),
    gust_max: n(getAny(row, ["gust_max", "gust", "wind_gust", "windGust", "max_gust"])),
    wind_dir_mean_deg: n(
      getAny(row, ["wind_dir_mean_deg", "wind_dir_deg", "windDirectionAvg", "wind_dir_avg_deg"])
    ),

    press_min: n(getAny(row, ["press_min", "pressure_min", "pressMin"])),
    press_avg: n(
      getAny(row, ["press_avg", "pressure_avg", "pressureAvg", "avg_pressure", "pressure_mean"])
    ),
    press_max: n(getAny(row, ["press_max", "pressure_max", "pressMax"])),

    uv_mean_pos: n(getAny(row, ["uv_mean_pos", "uv_avg", "uvAvg", "avg_uv", "uv_mean"])),
    uv_max: n(getAny(row, ["uv_max", "uvMax"])),

    solar_mean_pos: n(
      getAny(row, [
        "solar_mean_pos",
        "solar_avg",
        "solarAvg",
        "rad_avg",
        "radiation_avg",
        "avg_solar",
        "solar_mean",
      ])
    ),
    solar_max: n(getAny(row, ["solar_max", "solarMax", "radiation_max"])),
  };
}

// -----------------------------------------------------
// NORMALIZZAZIONE DATI INTRADAY
// -----------------------------------------------------
function extractTimeLabel(rawTimestamp) {
  if (rawTimestamp === null || rawTimestamp === undefined) return "";

  if (typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp)) {
    const milliseconds = rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
    const date = new Date(milliseconds);
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }

  const value = String(rawTimestamp).trim();
  if (!value) return "";

  const match = value.match(/(\d{1,2}):(\d{2})/);
  if (match) return `${pad2(match[1])}:${match[2]}`;

  return "";
}

function normalizeIntradayRow(row) {
  const rawTimestamp =
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
    time: extractTimeLabel(rawTimestamp),
    temp: n(getAny(row, ["temp_c", "temp", "temperature", "outTemp", "temp_out"])),
    rh: n(getAny(row, ["rh_pct", "humidity", "hum", "outHumidity", "rh"])),
    rain: n(getAny(row, ["rain_15m_mm", "rain", "rain_step", "rainDelta", "rain_delta", "precip"])),
    wind: n(getAny(row, ["wind_kmh", "wind", "wind_avg", "windSpeed", "wind_speed", "avg_wind"])),
    gust: n(getAny(row, ["gust_kmh", "gust", "wind_gust", "windGust"])),
    press: n(
      getAny(row, ["press_hpa", "pressure", "barometer", "press", "relativePressure", "stationPressure"])
    ),
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
// RIEPILOGHI E DIFFERENZE
// -----------------------------------------------------
function summarizeRows(rows) {
  const validRows = (rows || []).filter(Boolean);
  const coldest = findExtremeRow(validRows, (row) => row.tmin, "min");
  const hottest = findExtremeRow(validRows, (row) => row.tmax, "max");
  const wettest = findExtremeRow(validRows, (row) => row.rain_total, "max");
  const strongestGust = findExtremeRow(validRows, (row) => row.gust_max, "max");

  const rainValues = validRows.map((row) => row.rain_total).map(n).filter(Number.isFinite);

  return {
    days: validRows.length,

    tmin_mean: avgFinite(validRows.map((row) => row.tmin)),
    tmean: avgFinite(validRows.map((row) => row.tmean)),
    tmax_mean: avgFinite(validRows.map((row) => row.tmax)),
    temp_range_mean: avgFinite(validRows.map((row) => n(row.tmax) - n(row.tmin))),
    tmin_abs: coldest.value,
    tmin_abs_date: coldest.date,
    tmax_abs: hottest.value,
    tmax_abs_date: hottest.date,

    rain_total: sumFinite(rainValues),
    rain_days: rainValues.length ? rainValues.filter((value) => value > 0).length : NaN,
    rain_day_max: wettest.value,
    rain_day_max_date: wettest.date,
    rainrate_max: maxFinite(validRows.map((row) => row.rainrate_max)),

    rh_min_abs: minFinite(validRows.map((row) => row.rh_min)),
    rh_mean: avgFinite(validRows.map((row) => row.rh_mean)),
    rh_max_abs: maxFinite(validRows.map((row) => row.rh_max)),

    wind_avg: avgFinite(validRows.map((row) => row.wind_avg)),
    gust_max: strongestGust.value,
    gust_max_date: strongestGust.date,
    wind_dir: circularMeanDeg(validRows.map((row) => row.wind_dir_mean_deg)),

    press_min_abs: minFinite(validRows.map((row) => row.press_min)),
    press_avg: avgFinite(validRows.map((row) => row.press_avg)),
    press_max_abs: maxFinite(validRows.map((row) => row.press_max)),

    uv_mean: avgFinite(validRows.map((row) => row.uv_mean_pos)),
    uv_max: maxFinite(validRows.map((row) => row.uv_max)),

    solar_mean: avgFinite(validRows.map((row) => row.solar_mean_pos)),
    solar_max: maxFinite(validRows.map((row) => row.solar_max)),
  };
}

function getMetricDefinitions(mode) {
  const isDay = mode === "giorni";

  return [
    ...(!isDay
      ? [
          {
            key: "days",
            label: "Giorni utilizzati",
            decimals: 0,
            unit: "",
            showPercent: true,
          },
        ]
      : []),
    {
      key: "tmin_mean",
      label: isDay ? "Temperatura minima" : "Media delle temperature minime",
      decimals: 1,
      unit: "°C",
      diffUnit: "°C",
    },
    {
      key: "tmean",
      label: "Temperatura media",
      decimals: 1,
      unit: "°C",
      diffUnit: "°C",
    },
    {
      key: "tmax_mean",
      label: isDay ? "Temperatura massima" : "Media delle temperature massime",
      decimals: 1,
      unit: "°C",
      diffUnit: "°C",
    },
    {
      key: "temp_range_mean",
      label: isDay ? "Escursione termica" : "Escursione termica media",
      decimals: 1,
      unit: "°C",
      diffUnit: "°C",
    },
    ...(!isDay
      ? [
          {
            key: "tmin_abs",
            label: "Temperatura minima assoluta",
            decimals: 1,
            unit: "°C",
            diffUnit: "°C",
            noteKey: "tmin_abs_date",
          },
          {
            key: "tmax_abs",
            label: "Temperatura massima assoluta",
            decimals: 1,
            unit: "°C",
            diffUnit: "°C",
            noteKey: "tmax_abs_date",
          },
        ]
      : []),
    {
      key: "rain_total",
      label: "Precipitazione totale",
      decimals: 1,
      unit: "mm",
      diffUnit: "mm",
      showPercent: true,
    },
    ...(!isDay
      ? [
          {
            key: "rain_days",
            label: "Giorni piovosi",
            decimals: 0,
            unit: "",
            diffUnit: "",
            showPercent: true,
          },
          {
            key: "rain_day_max",
            label: "Massima precipitazione giornaliera",
            decimals: 1,
            unit: "mm",
            diffUnit: "mm",
            noteKey: "rain_day_max_date",
            showPercent: true,
          },
        ]
      : []),
    {
      key: "rainrate_max",
      label: "Intensità massima della pioggia",
      decimals: 1,
      unit: "mm/h",
      diffUnit: "mm/h",
      showPercent: true,
    },
    {
      key: "rh_min_abs",
      label: isDay ? "Umidità minima" : "Umidità minima assoluta",
      decimals: 0,
      unit: "%",
      diffUnit: "punti",
    },
    {
      key: "rh_mean",
      label: "Umidità media",
      decimals: 0,
      unit: "%",
      diffUnit: "punti",
    },
    {
      key: "rh_max_abs",
      label: isDay ? "Umidità massima" : "Umidità massima assoluta",
      decimals: 0,
      unit: "%",
      diffUnit: "punti",
    },
    {
      key: "wind_avg",
      label: "Vento medio",
      decimals: 1,
      unit: "km/h",
      diffUnit: "km/h",
      showPercent: true,
    },
    {
      key: "gust_max",
      label: "Raffica massima",
      decimals: 1,
      unit: "km/h",
      diffUnit: "km/h",
      noteKey: isDay ? null : "gust_max_date",
      showPercent: true,
    },
    {
      key: "wind_dir",
      label: "Direzione media del vento",
      decimals: 0,
      unit: "°",
      diffUnit: "°",
      circular: true,
    },
    {
      key: "press_min_abs",
      label: isDay ? "Pressione minima" : "Pressione minima assoluta",
      decimals: 1,
      unit: "hPa",
      diffUnit: "hPa",
    },
    {
      key: "press_avg",
      label: "Pressione media",
      decimals: 1,
      unit: "hPa",
      diffUnit: "hPa",
    },
    {
      key: "press_max_abs",
      label: isDay ? "Pressione massima" : "Pressione massima assoluta",
      decimals: 1,
      unit: "hPa",
      diffUnit: "hPa",
    },
    {
      key: "uv_mean",
      label: "Indice UV medio",
      decimals: 1,
      unit: "",
      diffUnit: "",
      showPercent: true,
    },
    {
      key: "uv_max",
      label: "Indice UV massimo",
      decimals: 1,
      unit: "",
      diffUnit: "",
      showPercent: true,
    },
    {
      key: "solar_mean",
      label: "Radiazione solare media",
      decimals: 0,
      unit: "W/m²",
      diffUnit: "W/m²",
      showPercent: true,
    },
    {
      key: "solar_max",
      label: "Radiazione solare massima",
      decimals: 0,
      unit: "W/m²",
      diffUnit: "W/m²",
      showPercent: true,
    },
  ];
}

function formatNumber(value, decimals = 1, signed = false) {
  const parsed = n(value);
  if (!Number.isFinite(parsed)) return "—";

  const rounded = Math.abs(parsed) < Math.pow(10, -decimals) / 2 ? 0 : parsed;
  const text = rounded.toLocaleString("it-IT", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  if (!signed || rounded === 0) return text;
  return rounded > 0 ? `+${text}` : text;
}

function formatMetricValue(value, metric, summary) {
  const parsed = n(value);
  if (!Number.isFinite(parsed)) return { main: "—", note: "" };

  if (metric.circular) {
    return {
      main: `${formatNumber(parsed, 0)}° ${windCardinal(parsed)}`,
      note: "",
    };
  }

  return {
    main: `${formatNumber(parsed, metric.decimals)}${metric.unit ? ` ${metric.unit}` : ""}`,
    note: metric.noteKey && summary?.[metric.noteKey] ? formatDateIt(summary[metric.noteKey]) : "",
  };
}

function metricDifference(metric, comparisonValue, referenceValue) {
  if (metric.circular) return circularDifferenceDeg(comparisonValue, referenceValue);

  const comparison = n(comparisonValue);
  const reference = n(referenceValue);
  if (!Number.isFinite(comparison) || !Number.isFinite(reference)) return NaN;
  return comparison - reference;
}

function formatMetricDifference(metric, difference) {
  const parsed = n(difference);
  if (!Number.isFinite(parsed)) return "—";

  return `${formatNumber(parsed, metric.decimals, true)}${metric.diffUnit ? ` ${metric.diffUnit}` : ""}`;
}

function formatVariationPercent(metric, comparisonValue, referenceValue) {
  if (!metric.showPercent) return "—";

  const comparison = n(comparisonValue);
  const reference = n(referenceValue);

  if (!Number.isFinite(comparison) || !Number.isFinite(reference) || reference === 0) return "—";

  const percentage = ((comparison - reference) / Math.abs(reference)) * 100;
  return `${formatNumber(percentage, 1, true)}%`;
}

function differenceClass(value) {
  const parsed = n(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) < 0.000001) return "differenceNeutral";
  return parsed > 0 ? "differencePositive" : "differenceNegative";
}

function rowsForMonth(daily, yearMonth) {
  return daily
    .filter((row) => row.date.startsWith(`${yearMonth}-`))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function rowsForYear(daily, year) {
  return daily
    .filter((row) => row.date.startsWith(`${year}-`))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function intersectKeys(referenceRows, comparisonRows, keyGetter) {
  const referenceKeys = new Set(referenceRows.map(keyGetter));
  const comparisonKeys = new Set(comparisonRows.map(keyGetter));

  return Array.from(referenceKeys)
    .filter((key) => comparisonKeys.has(key))
    .sort();
}

function buildComparisonRecord({ mode, referenceId, comparisonId, daily, rangeMode }) {
  if (!referenceId || !comparisonId) return null;

  if (mode === "giorni") {
    const referenceRow = daily.find((row) => row.date === referenceId);
    const comparisonRow = daily.find((row) => row.date === comparisonId);

    if (!referenceRow || !comparisonRow) return null;

    return {
      id: comparisonId,
      referenceLabel: formatDateIt(referenceId),
      comparisonLabel: formatDateIt(comparisonId),
      referenceSummary: summarizeRows([referenceRow]),
      comparisonSummary: summarizeRows([comparisonRow]),
      note: "Differenza calcolata come giorno confrontato meno giorno di riferimento.",
    };
  }

  const referenceRows =
    mode === "mesi" ? rowsForMonth(daily, referenceId) : rowsForYear(daily, referenceId);
  const comparisonRows =
    mode === "mesi" ? rowsForMonth(daily, comparisonId) : rowsForYear(daily, comparisonId);

  if (!referenceRows.length || !comparisonRows.length) return null;

  let usedReferenceRows = referenceRows;
  let usedComparisonRows = comparisonRows;
  let note = "";

  if (rangeMode === "common") {
    const keyGetter =
      mode === "mesi" ? (row) => row.date.slice(8, 10) : (row) => row.date.slice(5, 10);
    const commonKeys = intersectKeys(referenceRows, comparisonRows, keyGetter);
    const commonSet = new Set(commonKeys);

    usedReferenceRows = referenceRows.filter((row) => commonSet.has(keyGetter(row)));
    usedComparisonRows = comparisonRows.filter((row) => commonSet.has(keyGetter(row)));

    if (mode === "mesi") {
      const firstDay = commonKeys.length ? Number(commonKeys[0]) : null;
      const lastDay = commonKeys.length ? Number(commonKeys[commonKeys.length - 1]) : null;
      const contiguous = commonKeys.length && lastDay - firstDay + 1 === commonKeys.length;

      note = contiguous
        ? `Confronto eseguito sui giorni comuni ${firstDay}–${lastDay} del mese.`
        : `Confronto eseguito su ${commonKeys.length} giorni disponibili in entrambi i mesi.`;
    } else {
      const first = commonKeys[0];
      const last = commonKeys[commonKeys.length - 1];
      note = commonKeys.length
        ? `Confronto eseguito sulle date comuni dal ${formatMonthDayIt(first)} al ${formatMonthDayIt(last)}.`
        : "Nessuna data comune disponibile tra i due anni.";
    }
  } else {
    note = `Confronto eseguito sull’intero periodo disponibile: ${referenceRows.length} giorni nel riferimento e ${comparisonRows.length} nel confronto.`;
  }

  return {
    id: comparisonId,
    referenceLabel: mode === "mesi" ? formatMonthYear(referenceId) : referenceId,
    comparisonLabel: mode === "mesi" ? formatMonthYear(comparisonId) : comparisonId,
    referenceSummary: summarizeRows(usedReferenceRows),
    comparisonSummary: summarizeRows(usedComparisonRows),
    note: `${note} La differenza è sempre calcolata come periodo confrontato meno periodo di riferimento.`,
  };
}

// -----------------------------------------------------
// CONFIGURAZIONE GRAFICI
// -----------------------------------------------------
function getChartConfig(mode, param) {
  if (mode === "giorni") {
    const configs = {
      temp: {
        title: "Temperatura",
        unit: "°C",
        getter: (row) => row?.temp,
        decimals: 1,
      },
      rh: {
        title: "Umidità relativa",
        unit: "%",
        getter: (row) => row?.rh,
        decimals: 0,
        min: 0,
        max: 100,
      },
      rain: {
        title: "Precipitazioni cumulate",
        unit: "mm",
        getter: (row) => row?.rain,
        decimals: 1,
        cumulative: true,
      },
      wind: {
        title: "Vento medio",
        unit: "km/h",
        getter: (row) => row?.wind,
        decimals: 1,
      },
      gust: {
        title: "Raffiche",
        unit: "km/h",
        getter: (row) => row?.gust,
        decimals: 1,
      },
      press: {
        title: "Pressione relativa",
        unit: "hPa",
        getter: (row) => row?.press,
        decimals: 1,
      },
      uv: {
        title: "Indice UV",
        unit: "",
        getter: (row) => row?.uv,
        decimals: 1,
      },
      solar: {
        title: "Radiazione solare",
        unit: "W/m²",
        getter: (row) => row?.solar,
        decimals: 0,
      },
    };

    return configs[param] || configs.temp;
  }

  const configs = {
    temp_max: {
      title: "Temperatura massima",
      unit: "°C",
      getter: (row) => row?.tmax,
      decimals: 1,
    },
    temp_mean: {
      title: "Temperatura media",
      unit: "°C",
      getter: (row) => row?.tmean,
      decimals: 1,
    },
    temp_min: {
      title: "Temperatura minima",
      unit: "°C",
      getter: (row) => row?.tmin,
      decimals: 1,
    },
    rain: {
      title: "Precipitazione giornaliera",
      unit: "mm",
      getter: (row) => row?.rain_total,
      decimals: 1,
      bar: true,
    },
    rain_cum: {
      title: "Precipitazione cumulata",
      unit: "mm",
      getter: (row) => row?.rain_total,
      decimals: 1,
      cumulative: true,
    },
    humidity_max: {
      title: "Umidità massima",
      unit: "%",
      getter: (row) => row?.rh_max,
      decimals: 0,
      min: 0,
      max: 100,
    },
    humidity_mean: {
      title: "Umidità media",
      unit: "%",
      getter: (row) => row?.rh_mean,
      decimals: 0,
      min: 0,
      max: 100,
    },
    humidity_min: {
      title: "Umidità minima",
      unit: "%",
      getter: (row) => row?.rh_min,
      decimals: 0,
      min: 0,
      max: 100,
    },
    wind: {
      title: "Vento medio",
      unit: "km/h",
      getter: (row) => row?.wind_avg,
      decimals: 1,
    },
    gust: {
      title: "Raffiche",
      unit: "km/h",
      getter: (row) => row?.gust_max,
      decimals: 1,
    },
    pressure: {
      title: "Pressione media",
      unit: "hPa",
      getter: (row) => row?.press_avg,
      decimals: 1,
    },
    uv: {
      title: "UV medio",
      unit: "",
      getter: (row) => row?.uv_mean_pos,
      decimals: 1,
    },
    solar: {
      title: "Radiazione media",
      unit: "W/m²",
      getter: (row) => row?.solar_mean_pos,
      decimals: 0,
    },
  };

  return configs[param] || configs.temp_mean;
}

function formatChartValue(value, config, signed = false) {
  const parsed = n(value);
  if (!Number.isFinite(parsed)) return "—";

  const text = formatNumber(parsed, config.decimals, signed);
  return `${text}${config.unit ? ` ${config.unit}` : ""}`;
}

function subtractSeries(comparisonValues, referenceValues) {
  return comparisonValues.map((comparison, index) => {
    const a = n(comparison);
    const b = n(referenceValues[index]);

    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Number((a - b).toFixed(3));
  });
}

function buildComparisonChart({
  baseChart,
  mode,
  config,
  xAxis,
  datasets,
  chartView,
  referenceLabel,
  zoomSpan,
}) {
  if (!datasets.length || datasets.length < 2) {
    return buildEmptyChart(baseChart, "Aggiungi almeno un periodo da confrontare");
  }

  const preparedDatasets = datasets.map((dataset) => ({
    ...dataset,
    values: config.cumulative ? cumulative(dataset.values) : dataset.values,
  }));

  const reference = preparedDatasets[0];
  const displayedDatasets =
    chartView === "values"
      ? preparedDatasets
      : preparedDatasets.slice(1).map((dataset) => ({
          ...dataset,
          label: `${dataset.label} − riferimento`,
          values: subtractSeries(dataset.values, reference.values),
        }));

  if (!displayedDatasets.length) {
    return buildEmptyChart(baseChart, "Aggiungi almeno un periodo da confrontare");
  }

  const differenceMode = chartView === "difference";
  const title = differenceMode
    ? `${config.title}: differenze rispetto a ${referenceLabel}`
    : config.title;

  const yAxis = {
    type: "value",
    name: config.unit,
    nameLocation: "middle",
    nameRotate: 90,
    nameGap: config.unit === "W/m²" ? 58 : 52,
    scale: differenceMode || (config.min === undefined && config.max === undefined),
    min: differenceMode ? undefined : config.min,
    max: differenceMode ? undefined : config.max,
    axisLabel: {
      formatter: (value) => formatNumber(value, config.decimals, differenceMode),
    },
  };

  const series = displayedDatasets.map((dataset) => ({
    name: dataset.label,
    type: config.bar ? "bar" : "line",
    data: dataset.values,
    barMaxWidth: 16,
    showSymbol: false,
    connectNulls: false,
    lineStyle: {
      width: dataset.isReference ? 3.5 : 3,
      color: dataset.color,
    },
    itemStyle: {
      color: dataset.color,
      opacity: config.bar && chartView === "values" && dataset.isReference ? 0.72 : 1,
    },
    markLine:
      differenceMode && dataset === displayedDatasets[0]
        ? {
            silent: true,
            symbol: "none",
            lineStyle: {
              color: "#64748b",
              type: "dashed",
              width: 1.5,
            },
            label: {
              formatter: "0",
              position: "insideEndTop",
              color: "#64748b",
            },
            data: [{ yAxis: 0 }],
          }
        : undefined,
  }));

  return {
    ...baseChart,
    title: {
      ...baseChart.title,
      text: title,
    },
    legend: {
      ...baseChart.legend,
      data: displayedDatasets.map((dataset) => dataset.label),
    },
    xAxis: {
      ...baseChart.xAxis,
      data: xAxis,
      axisLabel:
        mode === "anni"
          ? {
              rotate: 0,
              margin: 14,
              interval: getYearAxisLabelInterval(zoomSpan),
              hideOverlap: true,
            }
          : {
              rotate: 0,
              margin: 14,
              hideOverlap: true,
            },
    },
    yAxis,
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(
          params,
          displayedDatasets.map((dataset) => ({
            name: dataset.label,
            formatter: (value) => formatChartValue(value, config, differenceMode),
          }))
        ),
    },
    graphic: [],
    series,
  };
}

function getChartDescription(mode, chartView) {
  if (chartView === "difference") {
    if (mode === "giorni") {
      return "Il grafico mostra, ora per ora, la differenza tra ciascun giorno confrontato e il giorno di riferimento. Valori superiori a zero indicano valori maggiori rispetto al riferimento; valori inferiori a zero indicano valori minori.";
    }

    return "Il grafico mostra la differenza tra ciascun periodo confrontato e il riferimento sulle stesse date del calendario. La linea orizzontale dello zero rappresenta l’assenza di scarto. Le differenze vengono visualizzate soltanto dove entrambi i periodi dispongono del dato.";
  }

  if (mode === "giorni") {
    return "Il grafico mostra l’andamento intragiornaliero del parametro scelto. Il periodo di riferimento è rappresentato in blu scuro, mentre gli altri colori identificano i giorni confrontati.";
  }

  if (mode === "mesi") {
    return "Il grafico sovrappone l’andamento giornaliero del parametro nei mesi selezionati. Il periodo di riferimento è rappresentato in blu scuro; i mesi confrontati sono allineati in base al giorno del mese.";
  }

  return "Il grafico sovrappone l’andamento del parametro negli anni selezionati, allineando le serie sulle stesse date del calendario. Gli anni incompleti iniziano e terminano soltanto dove il dato è realmente disponibile.";
}

// -----------------------------------------------------
// PAGINA
// -----------------------------------------------------
export default function ConfrontoPage({ dailyRows }) {
  const [mounted, setMounted] = useState(false);
  const [zoomRange, setZoomRange] = useState({ start: 0, end: 100 });

  useEffect(() => setMounted(true), []);

  const daily = useMemo(() => dailyRows.map(normalizeDailyRow), [dailyRows]);

  const availableDates = useMemo(
    () => daily.map((row) => row.date).filter(Boolean).sort(),
    [daily]
  );

  const availableMonths = useMemo(
    () => Array.from(new Set(availableDates.map((date) => date.slice(0, 7)))).sort(),
    [availableDates]
  );

  const availableYears = useMemo(
    () => Array.from(new Set(availableDates.map((date) => date.slice(0, 4)))).sort(),
    [availableDates]
  );

  const monthsByYear = useMemo(() => {
    const map = {};

    for (const year of availableYears) {
      map[year] = Array.from(
        new Set(
          availableDates
            .filter((date) => date.startsWith(`${year}-`))
            .map((date) => date.slice(5, 7))
        )
      ).sort();
    }

    return map;
  }, [availableDates, availableYears]);

  const daysByYearMonth = useMemo(() => {
    const map = {};

    for (const date of availableDates) {
      const key = date.slice(0, 7);
      if (!map[key]) map[key] = [];
      map[key].push(date.slice(8, 10));
    }

    return map;
  }, [availableDates]);

  const latestDate = availableDates[availableDates.length - 1] || "";
  const previousDate = availableDates[availableDates.length - 2] || "";
  const latestMonth = availableMonths[availableMonths.length - 1] || "";
  const previousMonth = availableMonths[availableMonths.length - 2] || "";
  const latestYear = availableYears[availableYears.length - 1] || "";
  const previousYear = availableYears[availableYears.length - 2] || "";

  const [mode, setMode] = useState("giorni");
  const [param, setParam] = useState("temp");
  const [chartView, setChartView] = useState("values");
  const [rangeMode, setRangeMode] = useState("common");

  const [dayReference, setDayReference] = useState(() => selectionFromDate(latestDate));
  const [monthReference, setMonthReference] = useState(() => selectionFromMonth(latestMonth));
  const [yearReference, setYearReference] = useState(() => selectionFromYear(latestYear));

  const [dayComparisons, setDayComparisons] = useState(() =>
    previousDate && previousDate !== latestDate ? [selectionFromDate(previousDate)] : []
  );
  const [monthComparisons, setMonthComparisons] = useState(() =>
    previousMonth && previousMonth !== latestMonth ? [selectionFromMonth(previousMonth)] : []
  );
  const [yearComparisons, setYearComparisons] = useState(() =>
    previousYear && previousYear !== latestYear ? [selectionFromYear(previousYear)] : []
  );

  const [intradayData, setIntradayData] = useState({});

  const currentParams = mode === "giorni" ? DAILY_PARAMS : PERIOD_PARAMS;
  const zoomSpan = Math.max(0, zoomRange.end - zoomRange.start);

  const referenceId =
    mode === "giorni"
      ? daySelectionId(dayReference)
      : mode === "mesi"
      ? monthSelectionId(monthReference)
      : yearSelectionId(yearReference);

  const currentComparisons =
    mode === "giorni"
      ? dayComparisons
      : mode === "mesi"
      ? monthComparisons
      : yearComparisons;

  const comparisonIds = currentComparisons
    .map((selection) =>
      mode === "giorni"
        ? daySelectionId(selection)
        : mode === "mesi"
        ? monthSelectionId(selection)
        : yearSelectionId(selection)
    )
    .filter(Boolean);

  const activeSelectionCount = comparisonIds.length;
  const chartHeight = activeSelectionCount <= 3 ? 560 : Math.min(800, 560 + activeSelectionCount * 24);
  const legendRows = Math.max(1, Math.ceil((activeSelectionCount + 1) / 4));
  const gridBottom = Math.min(210, 92 + legendRows * 25);

  useEffect(() => {
    const valid = currentParams.some((option) => option.key === param);
    if (!valid) setParam(currentParams[0]?.key || "");
  }, [mode, param, currentParams]);

  useEffect(() => {
    setZoomRange({ start: 0, end: 100 });
  }, [mode, param, chartView, referenceId, comparisonIds.join("|")]);

  useEffect(() => {
    if (mode !== "giorni") {
      setIntradayData({});
      return;
    }

    const ids = Array.from(new Set([daySelectionId(dayReference), ...dayComparisons.map(daySelectionId)]))
      .filter(Boolean);

    if (!ids.length) {
      setIntradayData({});
      return;
    }

    let alive = true;

    async function fetchIntradayByCandidates(isoDate) {
      for (const candidatePath of getIntradayCandidatePaths(isoDate)) {
        try {
          const response = await fetch(candidatePath, { cache: "no-store" });
          if (!response.ok) continue;

          const json = await response.json();
          const rows = parseIntradayPayload(json);
          if (rows.length) return rows;
        } catch {
          // Prova automaticamente il percorso successivo.
        }
      }

      return [];
    }

    async function loadAll() {
      const next = {};

      await Promise.all(
        ids.map(async (isoDate) => {
          const rows = await fetchIntradayByCandidates(isoDate);
          next[isoDate] = rows
            .map(normalizeIntradayRow)
            .filter((row) => row.time)
            .sort((a, b) => rowTimeCompare(a.time, b.time));
        })
      );

      if (alive) setIntradayData(next);
    }

    loadAll();

    return () => {
      alive = false;
    };
  }, [mode, dayReference, dayComparisons]);

  function rowTimeCompare(a, b) {
    return String(a).localeCompare(String(b));
  }

  function updateDaySelection(setter, index, patch, isReference = false) {
    setter((previous) => {
      const base = isReference ? previous : previous[index];
      const current = { ...base, ...patch };

      if (patch.year !== undefined) {
        const months = monthsByYear[current.year] || [];
        if (!months.includes(current.month)) current.month = months[months.length - 1] || "";
      }

      if (patch.year !== undefined || patch.month !== undefined) {
        const days = daysByYearMonth[`${current.year}-${current.month}`] || [];
        if (!days.includes(current.day)) current.day = days[days.length - 1] || "";
      }

      if (isReference) return current;

      const next = [...previous];
      next[index] = current;
      return next;
    });
  }

  function updateMonthSelection(setter, index, patch, isReference = false) {
    setter((previous) => {
      const base = isReference ? previous : previous[index];
      const current = { ...base, ...patch };

      if (patch.year !== undefined) {
        const months = monthsByYear[current.year] || [];
        if (!months.includes(current.month)) current.month = months[months.length - 1] || "";
      }

      if (isReference) return current;

      const next = [...previous];
      next[index] = current;
      return next;
    });
  }

  function updateYearSelection(setter, index, patch, isReference = false) {
    setter((previous) => {
      const current = { ...(isReference ? previous : previous[index]), ...patch };
      if (isReference) return current;

      const next = [...previous];
      next[index] = current;
      return next;
    });
  }

  function addComparison() {
    if (mode === "giorni") {
      const used = [daySelectionId(dayReference), ...dayComparisons.map(daySelectionId)];
      const picked = pickUnusedFromEnd(availableDates, used);
      if (picked) setDayComparisons((previous) => [...previous, selectionFromDate(picked)]);
      return;
    }

    if (mode === "mesi") {
      const used = [monthSelectionId(monthReference), ...monthComparisons.map(monthSelectionId)];
      const picked = pickUnusedFromEnd(availableMonths, used);
      if (picked) setMonthComparisons((previous) => [...previous, selectionFromMonth(picked)]);
      return;
    }

    const used = [yearSelectionId(yearReference), ...yearComparisons.map(yearSelectionId)];
    const picked = pickUnusedFromEnd(availableYears, used);
    if (picked) setYearComparisons((previous) => [...previous, selectionFromYear(picked)]);
  }

  function removeComparison(index) {
    if (mode === "giorni") {
      setDayComparisons((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
      return;
    }

    if (mode === "mesi") {
      setMonthComparisons((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
      return;
    }

    setYearComparisons((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  }

  function clearComparisons() {
    if (mode === "giorni") setDayComparisons([]);
    if (mode === "mesi") setMonthComparisons([]);
    if (mode === "anni") setYearComparisons([]);
  }

  const comparisonRecords = useMemo(
    () =>
      comparisonIds
        .map((comparisonId) =>
          buildComparisonRecord({
            mode,
            referenceId,
            comparisonId,
            daily,
            rangeMode,
          })
        )
        .filter(Boolean),
    [mode, referenceId, comparisonIds.join("|"), daily, rangeMode]
  );

  const metricDefinitions = useMemo(() => getMetricDefinitions(mode), [mode]);

  const baseChart = useMemo(
    () => ({
      animation: false,
      grid: {
        left: 72,
        right: 42,
        top: 72,
        bottom: gridBottom,
      },
      title: {
        left: "center",
        top: 12,
        textStyle: {
          fontSize: 17,
          fontWeight: 800,
          color: "#0f172a",
        },
      },
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
        right: 8,
        top: 10,
        itemSize: 20,
        feature: {
          restore: {
            show: true,
            title: "Ripristina grafico",
          },
        },
      },
      tooltip: {
        trigger: "axis",
        order: "seriesAsc",
      },
      xAxis: {
        type: "category",
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
    }),
    [zoomRange, gridBottom]
  );

  const chartOption = useMemo(() => {
    const config = getChartConfig(mode, param);

    if (!referenceId || !comparisonIds.length) {
      return buildEmptyChart(baseChart);
    }

    if (mode === "giorni") {
      const selectedIds = [referenceId, ...comparisonIds];
      const xAxis = Array.from(
        new Set(selectedIds.flatMap((id) => (intradayData[id] || []).map((row) => row.time)))
      ).sort();

      if (!xAxis.length) {
        return buildEmptyChart(baseChart, "Nessun dato intraday disponibile per i giorni selezionati");
      }

      const datasets = selectedIds.map((id, index) => {
        const rows = intradayData[id] || [];
        const rowMap = new Map(rows.map((row) => [row.time, row]));

        return {
          id,
          label: formatDateIt(id),
          color: index === 0 ? REFERENCE_COLOR : pickColor(index - 1),
          isReference: index === 0,
          values: xAxis.map((time) => safeVal(config.getter(rowMap.get(time)))),
        };
      });

      return buildComparisonChart({
        baseChart,
        mode,
        config,
        xAxis,
        datasets,
        chartView,
        referenceLabel: formatDateIt(referenceId),
        zoomSpan,
      });
    }

    if (mode === "mesi") {
      const selectedIds = [referenceId, ...comparisonIds];
      const maxDays = Math.max(
        ...selectedIds.map((id) => daysInMonth(id.slice(0, 4), id.slice(5, 7)))
      );
      const xAxis = Array.from({ length: maxDays }, (_, index) => String(index + 1));

      const datasets = selectedIds.map((id, index) => {
        const rows = rowsForMonth(daily, id);
        const rowMap = new Map(rows.map((row) => [Number(row.date.slice(8, 10)), row]));

        return {
          id,
          label: formatMonthYear(id),
          color: index === 0 ? REFERENCE_COLOR : pickColor(index - 1),
          isReference: index === 0,
          values: xAxis.map((day) => safeVal(config.getter(rowMap.get(Number(day))))),
        };
      });

      return buildComparisonChart({
        baseChart,
        mode,
        config,
        xAxis,
        datasets,
        chartView,
        referenceLabel: formatMonthYear(referenceId),
        zoomSpan,
      });
    }

    const selectedIds = [referenceId, ...comparisonIds];
    const axisItems = buildYearAxisItems(selectedIds);
    const xAxis = axisItems.map((item) => item.label);

    const datasets = selectedIds.map((id, index) => {
      const rows = rowsForYear(daily, id);
      const rowMap = new Map(rows.map((row) => [row.date.slice(5, 10), row]));

      return {
        id,
        label: id,
        color: index === 0 ? REFERENCE_COLOR : pickColor(index - 1),
        isReference: index === 0,
        values: axisItems.map((item) => safeVal(config.getter(rowMap.get(item.key)))),
      };
    });

    return buildComparisonChart({
      baseChart,
      mode,
      config,
      xAxis,
      datasets,
      chartView,
      referenceLabel: referenceId,
      zoomSpan,
    });
  }, [
    mode,
    param,
    chartView,
    referenceId,
    comparisonIds.join("|"),
    intradayData,
    daily,
    baseChart,
    zoomSpan,
  ]);

  const chartEvents = useMemo(
    () => ({
      datazoom: (params) => {
        const payload = Array.isArray(params?.batch) ? params.batch[0] : params;
        const start = Number(payload?.start);
        const end = Number(payload?.end);

        if (!Number.isFinite(start) || !Number.isFinite(end)) return;

        setZoomRange((previous) => {
          if (
            Math.abs(previous.start - start) < 0.1 &&
            Math.abs(previous.end - end) < 0.1
          ) {
            return previous;
          }

          return { start, end };
        });
      },
      restore: () => setZoomRange({ start: 0, end: 100 }),
    }),
    []
  );

  const chartKey = useMemo(
    () =>
      JSON.stringify({
        mode,
        param,
        chartView,
        referenceId,
        comparisons: comparisonIds,
        intradayKeys: Object.keys(intradayData).sort(),
      }),
    [mode, param, chartView, referenceId, comparisonIds.join("|"), intradayData]
  );

  const chartDescription = getChartDescription(mode, chartView);

  return (
    <SiteLayout
      headerProps={{
        title: "Confronto climatico",
        subtitle:
          "Scegli un periodo di riferimento e confrontalo con uno o più giorni, mesi o anni dell’archivio.",
        showPeriod: false,
        currentPath: "/confronto-climatico",
      }}
    >
      <div className="wrap">
        <section className="hero">
          <div className="pageDescription">
            La pagina confronta uno o più periodi con un giorno, un mese o un anno scelto come riferimento. Le tabelle mostrano i valori dei principali parametri meteorologici, la differenza assoluta e, dove utile, la variazione percentuale. La differenza è sempre calcolata come <strong>periodo confrontato meno periodo di riferimento</strong>. Il grafico può mostrare sia i valori reali sia gli scarti rispetto al riferimento.
          </div>

          <div className="modeCard">
            <div className="controlLabel">Tipo di confronto</div>
            <div className="pillRow">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`pill ${mode === option.key ? "active" : ""}`}
                  onClick={() => setMode(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="selectionColumns">
            <section className="referenceCard">
              <div className="selectionCardHeader">
                <div>
                  <div className="eyebrow">Base del confronto</div>
                  <h2>Periodo di riferimento</h2>
                </div>
                <span className="referenceBadge">Riferimento</span>
              </div>

              {mode === "giorni" && (
                <div className="selectorRow selectorRowDay">
                  <label>
                    <span>Giorno</span>
                    <select
                      value={dayReference.day}
                      onChange={(event) =>
                        updateDaySelection(
                          setDayReference,
                          0,
                          { day: event.target.value },
                          true
                        )
                      }
                    >
                      {(daysByYearMonth[`${dayReference.year}-${dayReference.month}`] || []).map(
                        (day) => (
                          <option key={day} value={day}>
                            {Number(day)}
                          </option>
                        )
                      )}
                    </select>
                  </label>

                  <label>
                    <span>Mese</span>
                    <select
                      value={dayReference.month}
                      onChange={(event) =>
                        updateDaySelection(
                          setDayReference,
                          0,
                          { month: event.target.value },
                          true
                        )
                      }
                    >
                      {(monthsByYear[dayReference.year] || []).map((month) => (
                        <option key={month} value={month}>
                          {MONTHS_IT_FULL[Number(month) - 1]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Anno</span>
                    <select
                      value={dayReference.year}
                      onChange={(event) =>
                        updateDaySelection(
                          setDayReference,
                          0,
                          { year: event.target.value },
                          true
                        )
                      }
                    >
                      {availableYears.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {mode === "mesi" && (
                <div className="selectorRow">
                  <label>
                    <span>Mese</span>
                    <select
                      value={monthReference.month}
                      onChange={(event) =>
                        updateMonthSelection(
                          setMonthReference,
                          0,
                          { month: event.target.value },
                          true
                        )
                      }
                    >
                      {(monthsByYear[monthReference.year] || []).map((month) => (
                        <option key={month} value={month}>
                          {MONTHS_IT_FULL[Number(month) - 1]}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>Anno</span>
                    <select
                      value={monthReference.year}
                      onChange={(event) =>
                        updateMonthSelection(
                          setMonthReference,
                          0,
                          { year: event.target.value },
                          true
                        )
                      }
                    >
                      {availableYears.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              {mode === "anni" && (
                <div className="selectorRow">
                  <label>
                    <span>Anno</span>
                    <select
                      value={yearReference.year}
                      onChange={(event) =>
                        updateYearSelection(
                          setYearReference,
                          0,
                          { year: event.target.value },
                          true
                        )
                      }
                    >
                      {availableYears.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}

              <div className="selectedReferenceLabel">
                {mode === "giorni"
                  ? formatDateIt(daySelectionId(dayReference))
                  : mode === "mesi"
                  ? formatMonthYear(monthSelectionId(monthReference))
                  : yearSelectionId(yearReference)}
              </div>
            </section>

            <section className="comparisonCard">
              <div className="selectionCardHeader">
                <div>
                  <div className="eyebrow">Periodi secondari</div>
                  <h2>Periodi da confrontare</h2>
                </div>
                <span className="comparisonCount">{activeSelectionCount}</span>
              </div>

              <div className="comparisonToolbar">
                <button type="button" className="addButton" onClick={addComparison}>
                  + Aggiungi {mode === "giorni" ? "giorno" : mode === "mesi" ? "mese" : "anno"}
                </button>

                {activeSelectionCount > 0 && (
                  <button type="button" className="clearButton" onClick={clearComparisons}>
                    Cancella confronti
                  </button>
                )}
              </div>

              {activeSelectionCount === 0 && (
                <div className="emptyComparisons">
                  Aggiungi almeno un periodo per visualizzare differenze, tabelle e grafico.
                </div>
              )}

              <div className="comparisonList">
                {mode === "giorni" &&
                  dayComparisons.map((selection, index) => {
                    const months = monthsByYear[selection.year] || [];
                    const days = daysByYearMonth[`${selection.year}-${selection.month}`] || [];

                    return (
                      <div className="comparisonRow" key={`day-${index}`}>
                        <span className="comparisonIndex">{index + 1}</span>

                        <select
                          value={selection.day}
                          onChange={(event) =>
                            updateDaySelection(setDayComparisons, index, {
                              day: event.target.value,
                            })
                          }
                        >
                          {days.map((day) => (
                            <option key={day} value={day}>
                              {Number(day)}
                            </option>
                          ))}
                        </select>

                        <select
                          className="comparisonMonthSelect"
                          value={selection.month}
                          onChange={(event) =>
                            updateDaySelection(setDayComparisons, index, {
                              month: event.target.value,
                            })
                          }
                        >
                          {months.map((month) => (
                            <option key={month} value={month}>
                              {MONTHS_IT_FULL[Number(month) - 1]}
                            </option>
                          ))}
                        </select>

                        <select
                          value={selection.year}
                          onChange={(event) =>
                            updateDaySelection(setDayComparisons, index, {
                              year: event.target.value,
                            })
                          }
                        >
                          {availableYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          className="removeButton"
                          onClick={() => removeComparison(index)}
                          aria-label={`Rimuovi giorno ${index + 1}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}

                {mode === "mesi" &&
                  monthComparisons.map((selection, index) => {
                    const months = monthsByYear[selection.year] || [];

                    return (
                      <div className="comparisonRow comparisonRowMonth" key={`month-${index}`}>
                        <span className="comparisonIndex">{index + 1}</span>

                        <select
                          className="comparisonMonthSelect"
                          value={selection.month}
                          onChange={(event) =>
                            updateMonthSelection(setMonthComparisons, index, {
                              month: event.target.value,
                            })
                          }
                        >
                          {months.map((month) => (
                            <option key={month} value={month}>
                              {MONTHS_IT_FULL[Number(month) - 1]}
                            </option>
                          ))}
                        </select>

                        <select
                          value={selection.year}
                          onChange={(event) =>
                            updateMonthSelection(setMonthComparisons, index, {
                              year: event.target.value,
                            })
                          }
                        >
                          {availableYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          className="removeButton"
                          onClick={() => removeComparison(index)}
                          aria-label={`Rimuovi mese ${index + 1}`}
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}

                {mode === "anni" &&
                  yearComparisons.map((selection, index) => (
                    <div className="comparisonRow comparisonRowYear" key={`year-${index}`}>
                      <span className="comparisonIndex">{index + 1}</span>

                      <select
                        value={selection.year}
                        onChange={(event) =>
                          updateYearSelection(setYearComparisons, index, {
                            year: event.target.value,
                          })
                        }
                      >
                        {availableYears.map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        className="removeButton"
                        onClick={() => removeComparison(index)}
                        aria-label={`Rimuovi anno ${index + 1}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
              </div>
            </section>
          </div>

          {mode !== "giorni" && activeSelectionCount > 0 && (
            <div className="rangeControl">
              <div>
                <div className="controlLabel">Periodo utilizzato nelle tabelle</div>
                <div className="rangeDescription">
                  L’intervallo comune evita di confrontare periodi completi con mesi o anni ancora in corso.
                </div>
              </div>

              <div className="pillRow compactPills">
                <button
                  type="button"
                  className={`pill small ${rangeMode === "common" ? "active" : ""}`}
                  onClick={() => setRangeMode("common")}
                >
                  Intervallo comune
                </button>
                <button
                  type="button"
                  className={`pill small ${rangeMode === "available" ? "active" : ""}`}
                  onClick={() => setRangeMode("available")}
                >
                  Periodi disponibili
                </button>
              </div>
            </div>
          )}
        </section>

        {comparisonRecords.length > 0 && (
          <section className="summarySection">
            <div className="sectionHeading">
              <div>
                <div className="eyebrow">Riepilogo numerico</div>
                <h2>Tabelle delle differenze</h2>
              </div>
              <div className="formulaBadge">Differenza = confronto − riferimento</div>
            </div>

            <div className="tablesGrid">
              {comparisonRecords.map((record, recordIndex) => (
                <article className="differenceCard" key={`${record.id}-${recordIndex}`}>
                  <div className="differenceCardHeader">
                    <div>
                      <div className="comparisonAgainst">Confronto con il riferimento</div>
                      <h3>{record.comparisonLabel}</h3>
                      <div className="referenceLine">
                        rispetto a <strong>{record.referenceLabel}</strong>
                      </div>
                    </div>
                    <span
                      className="seriesDot"
                      style={{ backgroundColor: pickColor(recordIndex) }}
                    />
                  </div>

                  <div className="tableNote">{record.note}</div>

                  <div className="tableScroll">
                    <table className="differenceTable">
                      <thead>
                        <tr>
                          <th>Parametro</th>
                          <th>Riferimento</th>
                          <th>Confronto</th>
                          <th>Differenza</th>
                          <th>Variazione</th>
                        </tr>
                      </thead>
                      <tbody>
                        {metricDefinitions.map((metric) => {
                          const referenceValue = record.referenceSummary[metric.key];
                          const comparisonValue = record.comparisonSummary[metric.key];
                          const difference = metricDifference(
                            metric,
                            comparisonValue,
                            referenceValue
                          );
                          const referenceFormatted = formatMetricValue(
                            referenceValue,
                            metric,
                            record.referenceSummary
                          );
                          const comparisonFormatted = formatMetricValue(
                            comparisonValue,
                            metric,
                            record.comparisonSummary
                          );

                          return (
                            <tr key={metric.key}>
                              <td className="metricName" data-label="Parametro">
                                {metric.label}
                              </td>
                              <td data-label="Riferimento">
                                <span className="cellMain">{referenceFormatted.main}</span>
                                {referenceFormatted.note && (
                                  <span className="cellNote">{referenceFormatted.note}</span>
                                )}
                              </td>
                              <td data-label="Confronto">
                                <span className="cellMain">{comparisonFormatted.main}</span>
                                {comparisonFormatted.note && (
                                  <span className="cellNote">{comparisonFormatted.note}</span>
                                )}
                              </td>
                              <td
                                data-label="Differenza"
                                className={`differenceCell ${differenceClass(difference)}`}
                              >
                                {formatMetricDifference(metric, difference)}
                              </td>
                              <td data-label="Variazione" className="variationCell">
                                {formatVariationPercent(
                                  metric,
                                  comparisonValue,
                                  referenceValue
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="chartControlsSection">
          <div className="chartControlsGrid">
            <div className="controlCard">
              <div className="controlLabel">Parametro del grafico</div>
              <div className="selectWrap">
                <select
                  value={param}
                  onChange={(event) => setParam(event.target.value)}
                  className="selectNative"
                >
                  {currentParams.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="controlCard">
              <div className="controlLabel">Visualizzazione</div>
              <div className="pillRow compactPills">
                {CHART_VIEW_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`pill small ${chartView === option.key ? "active" : ""}`}
                    onClick={() => setChartView(option.key)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
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

              <div className="chartDescription">{chartDescription}</div>
            </div>
          </section>
        )}

        <style jsx>{`
          .wrap {
            background: transparent;
          }

          .hero,
          .summarySection,
          .chartControlsSection,
          .chartBox {
            border: 1px solid #e7e7e7;
            background: rgba(255, 255, 255, 0.94);
            box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02), 0 12px 34px rgba(0, 0, 0, 0.04);
          }

          .hero {
            margin-top: 14px;
            border-radius: 18px;
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
            line-height: 1.65;
            padding: 14px 16px;
          }

          .pageDescription strong {
            color: #0f172a;
          }

          .modeCard,
          .controlCard {
            border: 1px solid #ececec;
            border-radius: 16px;
            background: #fcfcfc;
            padding: 13px 14px;
          }

          .controlLabel,
          .eyebrow,
          .comparisonAgainst {
            font-size: 11px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            font-weight: 900;
          }

          .controlLabel {
            color: #374151;
            margin-bottom: 10px;
          }

          .eyebrow,
          .comparisonAgainst {
            color: #64748b;
            margin-bottom: 4px;
          }

          .pillRow {
            display: flex;
            flex-wrap: wrap;
            gap: 9px;
          }

          .pill {
            appearance: none;
            border: 1px solid #d8dbe2;
            background: #ffffff;
            color: #0b1b3b;
            border-radius: 14px;
            padding: 11px 16px;
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
          }

          .pill.active {
            background: #eef4ff;
            border-color: #b9c9e7;
            color: #0f2e65;
          }

          .pill.small {
            padding: 10px 13px;
            font-size: 13px;
          }

          .selectionColumns {
            display: grid;
            grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr);
            gap: 12px;
            margin-top: 12px;
          }

          .referenceCard,
          .comparisonCard {
            border-radius: 17px;
            padding: 15px;
          }

          .referenceCard {
            border: 1px solid #bfcee8;
            background: linear-gradient(180deg, #f7faff, #eef4ff);
          }

          .comparisonCard {
            border: 1px solid #e5e7eb;
            background: #fcfcfc;
          }

          .selectionCardHeader,
          .sectionHeading,
          .differenceCardHeader {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
          }

          .selectionCardHeader h2,
          .sectionHeading h2,
          .differenceCardHeader h3 {
            margin: 0;
            color: #0f172a;
          }

          .selectionCardHeader h2,
          .sectionHeading h2 {
            font-size: 20px;
          }

          .differenceCardHeader h3 {
            font-size: 19px;
          }

          .referenceBadge,
          .comparisonCount,
          .formulaBadge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 900;
          }

          .referenceBadge {
            border: 1px solid #b7c7e3;
            background: #ffffff;
            color: #1e3a68;
            padding: 7px 10px;
          }

          .comparisonCount {
            min-width: 34px;
            height: 34px;
            background: #eef2f7;
            color: #334155;
          }

          .selectorRow {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
            margin-top: 14px;
          }

          .selectorRowDay {
            grid-template-columns: 0.72fr 1.35fr 0.9fr;
          }

          .selectorRow label {
            display: flex;
            flex-direction: column;
            gap: 6px;
            color: #475569;
            font-size: 11px;
            font-weight: 900;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          select {
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            min-width: 0;
            min-height: 40px;
            border: 1px solid #dfe4ec;
            border-radius: 11px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            color: #111827;
            font-size: 13px;
            font-weight: 850;
            padding: 0 10px;
            cursor: pointer;
            color-scheme: light;
          }

          select:focus {
            outline: 2px solid rgba(37, 99, 235, 0.18);
            outline-offset: 1px;
          }

          select option,
          select optgroup {
            color: #111111;
            background: #ffffff;
          }

          .selectedReferenceLabel {
            margin-top: 12px;
            border-top: 1px solid rgba(99, 123, 163, 0.22);
            padding-top: 11px;
            color: #102a56;
            font-size: 17px;
            font-weight: 950;
          }

          .comparisonToolbar {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 14px;
          }

          .addButton,
          .clearButton,
          .removeButton {
            appearance: none;
            cursor: pointer;
            font-weight: 900;
          }

          .addButton,
          .clearButton {
            border-radius: 12px;
            padding: 10px 13px;
            font-size: 13px;
          }

          .addButton {
            border: 1px solid #c6d3e8;
            background: #eef4ff;
            color: #14396f;
          }

          .clearButton {
            border: 1px solid #ead1d1;
            background: #fff7f7;
            color: #991b1b;
          }

          .emptyComparisons {
            margin-top: 11px;
            border: 1px dashed #cbd5e1;
            border-radius: 12px;
            color: #64748b;
            font-size: 13px;
            font-weight: 650;
            line-height: 1.5;
            padding: 12px;
          }

          .comparisonList {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 7px;
            margin-top: 10px;
          }

          .comparisonRow {
            display: grid;
            grid-template-columns: 28px 54px minmax(92px, 1fr) 78px 34px;
            align-items: center;
            gap: 5px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            background: #ffffff;
            padding: 6px;
          }

          .comparisonRowMonth {
            grid-template-columns: 28px minmax(110px, 1fr) 78px 34px;
          }

          .comparisonRowYear {
            grid-template-columns: 28px minmax(90px, 1fr) 34px;
          }

          .comparisonIndex {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 26px;
            height: 26px;
            border-radius: 9px;
            background: #f1f5f9;
            color: #475569;
            font-size: 12px;
            font-weight: 950;
          }

          .comparisonRow select {
            width: 100%;
            min-height: 34px;
            padding: 0 7px;
          }

          .removeButton {
            width: 34px;
            height: 34px;
            border: 1px solid #ead1d1;
            border-radius: 10px;
            background: #fff7f7;
            color: #991b1b;
            font-size: 17px;
            line-height: 1;
          }

          .rangeControl {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin-top: 12px;
            border: 1px solid #e5e7eb;
            border-radius: 15px;
            background: #f8fafc;
            padding: 13px 14px;
          }

          .rangeControl .controlLabel {
            margin-bottom: 4px;
          }

          .rangeDescription {
            color: #64748b;
            font-size: 13px;
            font-weight: 650;
            line-height: 1.45;
          }

          .summarySection {
            margin-top: 12px;
            border-radius: 18px;
            padding: 18px;
          }

          .sectionHeading {
            align-items: center;
            margin-bottom: 12px;
          }

          .formulaBadge {
            border: 1px solid #d7deea;
            background: #f8fafc;
            color: #475569;
            padding: 8px 11px;
          }

          .tablesGrid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .differenceCard {
            min-width: 0;
            border: 1px solid #e2e8f0;
            border-radius: 16px;
            background: #ffffff;
            overflow: hidden;
          }

          .differenceCardHeader {
            padding: 14px 15px 10px;
          }

          .referenceLine {
            margin-top: 4px;
            color: #64748b;
            font-size: 13px;
            font-weight: 650;
          }

          .referenceLine strong {
            color: #334155;
          }

          .seriesDot {
            flex: 0 0 auto;
            width: 12px;
            height: 12px;
            border-radius: 999px;
            margin-top: 7px;
          }

          .tableNote {
            margin: 0 15px 12px;
            border: 1px solid #e5e7eb;
            border-radius: 11px;
            background: #f8fafc;
            color: #64748b;
            font-size: 12px;
            font-weight: 650;
            line-height: 1.5;
            padding: 9px 10px;
          }

          .tableScroll {
            overflow-x: auto;
            border-top: 1px solid #e5e7eb;
          }

          .differenceTable {
            width: 100%;
            min-width: 690px;
            border-collapse: collapse;
            color: #1f2937;
          }

          .differenceTable th,
          .differenceTable td {
            border-bottom: 1px solid #edf0f4;
            padding: 9px 10px;
            text-align: right;
            vertical-align: middle;
          }

          .differenceTable th {
            position: sticky;
            top: 0;
            z-index: 1;
            background: #f8fafc;
            color: #475569;
            font-size: 10px;
            font-weight: 950;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            white-space: nowrap;
          }

          .differenceTable th:first-child,
          .differenceTable td:first-child {
            text-align: left;
          }

          .differenceTable tbody tr:last-child td {
            border-bottom: 0;
          }

          .differenceTable tbody tr:hover td {
            background-color: rgba(248, 250, 252, 0.74);
          }

          .metricName {
            color: #334155;
            font-size: 12px;
            font-weight: 850;
          }

          .cellMain {
            display: block;
            font-size: 12px;
            font-weight: 850;
            white-space: nowrap;
          }

          .cellNote {
            display: block;
            margin-top: 2px;
            color: #94a3b8;
            font-size: 10px;
            font-weight: 700;
            white-space: nowrap;
          }

          .differenceCell,
          .variationCell {
            font-size: 12px;
            font-weight: 950;
            white-space: nowrap;
          }

          .differencePositive {
            color: #9a3412;
            background: #fff7ed;
          }

          .differenceNegative {
            color: #1d4ed8;
            background: #eff6ff;
          }

          .differenceNeutral {
            color: #64748b;
            background: #f8fafc;
          }

          .variationCell {
            color: #475569;
          }

          .chartControlsSection {
            margin-top: 12px;
            border-radius: 18px;
            padding: 14px;
          }

          .chartControlsGrid {
            display: grid;
            grid-template-columns: 1.2fr 1fr;
            gap: 10px;
          }

          .selectWrap {
            position: relative;
            display: inline-flex;
            align-items: center;
            width: 100%;
            border-radius: 13px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            border: 1px solid #e5e7eb;
            overflow: hidden;
          }

          .selectNative {
            width: 100%;
            min-height: 40px;
            border: 0;
            border-radius: 0;
            background: transparent;
            font-size: 13px;
            font-weight: 850;
            padding: 0 12px;
          }

          .chartSection {
            margin-top: 12px;
          }

          .chartBox {
            border-radius: 16px;
            padding: 10px;
          }

          .chartDescription {
            margin: 0 8px 8px;
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
            .tablesGrid {
              grid-template-columns: 1fr;
            }

            .comparisonList {
              grid-template-columns: 1fr;
            }
          }

          @media (max-width: 900px) {
            .selectionColumns,
            .chartControlsGrid {
              grid-template-columns: 1fr;
            }

            .rangeControl,
            .sectionHeading {
              align-items: flex-start;
              flex-direction: column;
            }
          }

          @media (max-width: 680px) {
            .hero,
            .summarySection {
              padding: 12px;
            }

            .pageDescription {
              font-size: 14px;
              padding: 12px;
            }

            .selectorRow,
            .selectorRowDay {
              grid-template-columns: 1fr;
            }

            .comparisonRow,
            .comparisonRowMonth,
            .comparisonRowYear {
              grid-template-columns: 28px minmax(0, 1fr) 42px;
            }

            .comparisonRow select {
              grid-column: 2;
            }

            .comparisonRow .comparisonIndex {
              grid-column: 1;
              grid-row: 1;
            }

            .comparisonRow .removeButton {
              grid-column: 3;
              grid-row: 1;
              width: 40px;
              height: 40px;
            }

            .comparisonRow select:nth-of-type(1) {
              grid-row: 1;
            }

            .comparisonRow select:nth-of-type(2),
            .comparisonRow select:nth-of-type(3) {
              grid-column: 2 / 4;
            }

            .comparisonToolbar,
            .compactPills {
              display: grid;
              grid-template-columns: 1fr;
              width: 100%;
            }

            .addButton,
            .clearButton,
            .pill.small {
              width: 100%;
            }

            .differenceCardHeader {
              padding: 13px 12px 9px;
            }

            .tableNote {
              margin: 0 12px 10px;
            }

            .tableScroll {
              overflow: visible;
            }

            .differenceTable {
              min-width: 0;
              display: block;
            }

            .differenceTable thead {
              display: none;
            }

            .differenceTable tbody {
              display: block;
            }

            .differenceTable tr {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 7px;
              border-bottom: 1px solid #e2e8f0;
              padding: 10px 11px;
            }

            .differenceTable tbody tr:last-child {
              border-bottom: 0;
            }

            .differenceTable td,
            .differenceTable td:first-child {
              display: flex;
              flex-direction: column;
              align-items: flex-start;
              gap: 3px;
              border: 1px solid #edf0f4;
              border-radius: 10px;
              background: #ffffff;
              padding: 8px;
              text-align: left;
              white-space: normal;
            }

            .differenceTable td::before {
              content: attr(data-label);
              color: #94a3b8;
              font-size: 9px;
              font-weight: 950;
              letter-spacing: 0.08em;
              text-transform: uppercase;
            }

            .differenceTable .metricName {
              grid-column: 1 / -1;
              border: 0;
              border-radius: 0;
              background: transparent;
              padding: 0 0 2px;
              color: #0f172a;
              font-size: 13px;
            }

            .differenceTable .metricName::before {
              display: none;
            }

            .differenceTable .differencePositive {
              background: #fff7ed;
            }

            .differenceTable .differenceNegative {
              background: #eff6ff;
            }

            .differenceTable .differenceNeutral {
              background: #f8fafc;
            }

            .formulaBadge {
              width: 100%;
              justify-content: flex-start;
            }
          }
        `}</style>
      </div>
    </SiteLayout>
  );
}