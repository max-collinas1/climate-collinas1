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

function fmt(x, d = 1) {
  const v = n(x);
  return Number.isFinite(v) ? v.toFixed(d) : "—";
}

function fmtInt(x) {
  const v = n(x);
  return Number.isFinite(v) ? String(Math.round(v)) : "—";
}

function sumFinite(arr) {
  let s = 0;
  let ok = false;
  for (const x of arr) {
    const v = n(x);
    if (Number.isFinite(v)) {
      s += v;
      ok = true;
    }
  }
  return ok ? s : NaN;
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

function minFinite(arr) {
  let m = Infinity;
  let ok = false;
  for (const x of arr) {
    const v = n(x);
    if (Number.isFinite(v)) {
      m = Math.min(m, v);
      ok = true;
    }
  }
  return ok ? m : NaN;
}

function maxFinite(arr) {
  let m = -Infinity;
  let ok = false;
  for (const x of arr) {
    const v = n(x);
    if (Number.isFinite(v)) {
      m = Math.max(m, v);
      ok = true;
    }
  }
  return ok ? m : NaN;
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

function degToCardinal16(v) {
  const n0 = Number(v);
  if (!Number.isFinite(n0)) return "—";
  const d = ((n0 % 360) + 360) % 360;
  const ix = Math.round(d / 22.5) % 16;
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][ix];
}

function circularMeanDeg(values) {
  const vals = (values || []).map(n).filter(Number.isFinite);
  if (!vals.length) return NaN;

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

function summarizeDailyIntraday(rows) {
  return {
    tempMin: minFinite(rows.map((r) => r.temp)),
    tempAvg: avgFinite(rows.map((r) => r.temp)),
    tempMax: maxFinite(rows.map((r) => r.temp)),

    rhMin: minFinite(rows.map((r) => r.rh)),
    rhAvg: avgFinite(rows.map((r) => r.rh)),
    rhMax: maxFinite(rows.map((r) => r.rh)),

    rainTotal: sumFinite(rows.map((r) => r.rain)),
    windAvg: avgFinite(rows.map((r) => r.wind)),
    gustMax: maxFinite(rows.map((r) => r.gust)),
    pressAvg: avgFinite(rows.map((r) => r.press)),
    uvAvg: avgFinite(rows.map((r) => r.uv)),
    solarAvg: avgFinite(rows.map((r) => r.solar)),
  };
}

function summarizePeriodDailyRows(rows) {
  return {
    tmax_mean: avgFinite(rows.map((d) => d.tmax)),
    tmean: avgFinite(rows.map((d) => d.tmean)),
    tmin_mean: avgFinite(rows.map((d) => d.tmin)),

    rainSum: sumFinite(rows.map((d) => d.rain_total)),
    rainrate_max: maxFinite(rows.map((d) => d.rainrate_max)),

    rh_max_mean: avgFinite(rows.map((d) => getRhMax(d))),
    rh_mean: avgFinite(rows.map((d) => getRhMean(d))),
    rh_min_mean: avgFinite(rows.map((d) => getRhMin(d))),

    wind_mean: avgFinite(rows.map((d) => d.wind_avg)),
    gust_max: maxFinite(rows.map((d) => d.gust_max)),
    wind_dir_mean_deg: circularMeanDeg(rows.map((d) => d.wind_dir_mean_deg)),

    press_mean: avgFinite(rows.map((d) => d.press_avg)),

    uv_mean: avgFinite(rows.map((d) => d.uv_mean_pos)),
    solar_mean: avgFinite(rows.map((d) => d.solar_mean_pos)),
  };
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

const MAX_COMPARE = 4;

// -----------------------------------------------------
// PAGE
// -----------------------------------------------------
export default function ConfrontoPage({ dailyRows }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const daily = useMemo(() => dailyRows.map(normalizeDailyRow), [dailyRows]);

  const availableDates = useMemo(() => daily.map((r) => r.date).sort(), [daily]);

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

  const allMonths = useMemo(() => {
    return Array.from(new Set(daily.map((r) => r.date.slice(0, 7)))).sort();
  }, [daily]);

  const [mode, setMode] = useState("giorni");
  const [param, setParam] = useState("temp");

  const dayDefaults = useMemo(() => {
    const last = availableDates[availableDates.length - 1] || "";
    const prev = availableDates[availableDates.length - 2] || last || "";
    const prev2 = availableDates[availableDates.length - 3] || prev || "";
    const prev3 = availableDates[availableDates.length - 4] || prev2 || "";
    return [prev3, prev2, prev, last].filter(Boolean);
  }, [availableDates]);

  const monthDefaults = useMemo(() => {
    const last = allMonths[allMonths.length - 1] || "";
    const prev = allMonths[allMonths.length - 2] || last || "";
    const prev2 = allMonths[allMonths.length - 3] || prev || "";
    const prev3 = allMonths[allMonths.length - 4] || prev2 || "";
    return [prev3, prev2, prev, last].filter(Boolean);
  }, [allMonths]);

  const yearDefaults = useMemo(() => {
    const last = availableYears[availableYears.length - 1] || "";
    const prev = availableYears[availableYears.length - 2] || last || "";
    const prev2 = availableYears[availableYears.length - 3] || prev || "";
    const prev3 = availableYears[availableYears.length - 4] || prev2 || "";
    return [prev3, prev2, prev, last].filter(Boolean);
  }, [availableYears]);

  const [daySelections, setDaySelections] = useState(() =>
    Array.from({ length: MAX_COMPARE }, (_, i) => ({
      year: dayDefaults[i]?.slice(0, 4) || availableYears[0] || "",
      month: dayDefaults[i]?.slice(5, 7) || (monthsByYear[availableYears[0] || ""]?.[0] || ""),
      day: dayDefaults[i]?.slice(8, 10) || "",
    }))
  );

  const [monthSelections, setMonthSelections] = useState(() =>
    Array.from({ length: MAX_COMPARE }, (_, i) => ({
      year: monthDefaults[i]?.slice(0, 4) || availableYears[0] || "",
      month: monthDefaults[i]?.slice(5, 7) || "",
    }))
  );

  const [yearSelections, setYearSelections] = useState(() =>
    Array.from({ length: MAX_COMPARE }, (_, i) => ({
      year: yearDefaults[i] || availableYears[0] || "",
    }))
  );

  const [activeCount, setActiveCount] = useState(2);
  const [intradayData, setIntradayData] = useState({});

  useEffect(() => {
    if (mode === "giorni" && !DAILY_PARAMS.some((p) => p.key === param)) {
      setParam("temp");
    }
    if ((mode === "mesi" || mode === "anni") && !PERIOD_PARAMS.some((p) => p.key === param)) {
      setParam("temp_max");
    }
  }, [mode, param]);

  useEffect(() => {
    if (mode !== "giorni") return;

    const ids = daySelections
      .slice(0, activeCount)
      .map((s) => (s.year && s.month && s.day ? `${s.year}-${s.month}-${s.day}` : ""))
      .filter(Boolean);

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
  }, [mode, activeCount, daySelections]);

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

  const currentParams = mode === "giorni" ? DAILY_PARAMS : PERIOD_PARAMS;
  const colors = ["#ff2d20", "#2563eb", "#2f9e44", "#f28c28"];

  const seriesLabels = useMemo(() => {
    if (mode === "giorni") {
      return makeUniqueLabels(
        daySelections.slice(0, activeCount).map((s) => {
          if (!s.year || !s.month || !s.day) return "—";
          return formatDateIt(`${s.year}-${s.month}-${s.day}`);
        })
      );
    }

    if (mode === "mesi") {
      return makeUniqueLabels(
        monthSelections.slice(0, activeCount).map((s) => {
          if (!s.year || !s.month) return "—";
          return formatMonthYear(`${s.year}-${s.month}`);
        })
      );
    }

    return makeUniqueLabels(yearSelections.slice(0, activeCount).map((s) => s.year || "—"));
  }, [mode, activeCount, daySelections, monthSelections, yearSelections]);

  const baseChart = useMemo(() => {
    return {
      animation: false,
      grid: { left: 72, right: 56, top: 58, bottom: 120 },
      title: { left: "center", top: 10 },
      legend: {
        bottom: 44,
        left: "center",
        itemGap: 16,
        padding: [8, 10, 2, 10],
      },
      toolbox: { feature: { restore: {} }, right: 10, top: 10 },
      tooltip: { trigger: "axis", order: "seriesAsc" },
      xAxis: {
        type: "category",
        axisLabel: { rotate: 0, margin: 14 },
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          filterMode: "none",
        },
        {
          type: "slider",
          xAxisIndex: 0,
          height: 24,
          bottom: 18,
          filterMode: "none",
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
    };
  }, []);

  const chartOption = useMemo(() => {
    // ---------------------- GIORNI ----------------------
    if (mode === "giorni") {
      const selected = daySelections
        .slice(0, activeCount)
        .map((s, i) => ({
          iso: s.year && s.month && s.day ? `${s.year}-${s.month}-${s.day}` : "",
          label: seriesLabels[i],
        }))
        .filter((x) => x.iso);

      const xAxis = Array.from(
        new Set(selected.flatMap((item) => (intradayData[item.iso] || []).map((r) => r.time)))
      ).sort();

      if (param === "temp") {
        return buildDayLineChart(baseChart, "Temperatura", xAxis, "°C", selected, intradayData, colors, (row) => safeVal(row?.temp), (v) => `${Number(v).toFixed(1)} °C`);
      }

      if (param === "rh") {
        return buildDayLineChart(baseChart, "Umidità relativa", xAxis, "%", selected, intradayData, colors, (row) => safeVal(row?.rh), (v) => `${Math.round(Number(v))} %`, {
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
          yAxis: {
            type: "value",
            name: "mm",
            nameLocation: "middle",
            nameRotate: 90,
            nameGap: 52,
            scale: true,
            axisLabel: { formatter: (v) => Number(v).toFixed(1) },
          },
          series: selected.map((s, i) => {
            const map = new Map((intradayData[s.iso] || []).map((r) => [r.time, r]));
            return {
              name: s.label,
              type: "bar",
              barMaxWidth: 18,
              data: cumulative(xAxis.map((t) => n(map.get(t)?.rain))),
              itemStyle: { color: colors[i] },
            };
          }),
        };
      }

      if (param === "wind") {
        return buildDayLineChart(baseChart, "Vento medio", xAxis, "km/h", selected, intradayData, colors, (row) => safeVal(row?.wind), (v) => `${Number(v).toFixed(1)} km/h`, {
          axisLabelFormatter: (v) => Number(v).toFixed(0),
        });
      }

      if (param === "gust") {
        return buildDayLineChart(baseChart, "Raffiche", xAxis, "km/h", selected, intradayData, colors, (row) => safeVal(row?.gust), (v) => `${Number(v).toFixed(1)} km/h`, {
          axisLabelFormatter: (v) => Number(v).toFixed(0),
        });
      }

      if (param === "press") {
        return buildDayLineChart(baseChart, "Pressione relativa", xAxis, "hPa", selected, intradayData, colors, (row) => safeVal(row?.press), (v) => `${Number(v).toFixed(1)} hPa`, {
          axisLabelFormatter: (v) => Number(v).toFixed(0),
        });
      }

      if (param === "uv") {
        return buildDayLineChart(baseChart, "Indice UV", xAxis, "UV", selected, intradayData, colors, (row) => safeVal(row?.uv), (v) => `${Number(v).toFixed(1)}`, {
          axisLabelFormatter: (v) => Number(v).toFixed(1),
        });
      }

      return buildDayLineChart(baseChart, "Radiazione solare", xAxis, "W/m²", selected, intradayData, colors, (row) => safeVal(row?.solar), (v) => `${Math.round(Number(v))} W/m²`, {
        axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
        nameGap: 56,
      });
    }

    // ---------------------- MESI ----------------------
    if (mode === "mesi") {
      const selected = monthSelections
        .slice(0, activeCount)
        .map((s, i) => ({
          ym: s.year && s.month ? `${s.year}-${s.month}` : "",
          label: seriesLabels[i],
        }))
        .filter((x) => x.ym);

      const maxDays = Math.max(...selected.map((s) => daysInMonth(s.ym.slice(0, 4), s.ym.slice(5, 7))), 31);
      const xAxis = Array.from({ length: maxDays }, (_, i) => String(i + 1));

      const seriesData = selected.map((s) => {
        const [y, m] = s.ym.split("-");
        const rows = aggregateMonthRows(daily, y, m);
        const map = new Map(rows.map((r) => [Number(r.date.slice(8, 10)), r]));
        return { ...s, map, rows };
      });

      if (param === "temp_max") {
        return buildSimpleLineChart({
          baseChart,
          title: "Temperatura massima",
          xAxis,
          yName: "°C",
          formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`),
          seriesData,
          colors,
          getValue: (map, d) => safeVal(map.get(Number(d))?.tmax),
        });
      }

      if (param === "temp_mean") {
        return buildSimpleLineChart({
          baseChart,
          title: "Temperatura media",
          xAxis,
          yName: "°C",
          formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`),
          seriesData,
          colors,
          getValue: (map, d) => safeVal(map.get(Number(d))?.tmean),
        });
      }

      if (param === "temp_min") {
        return buildSimpleLineChart({
          baseChart,
          title: "Temperatura minima",
          xAxis,
          yName: "°C",
          formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`),
          seriesData,
          colors,
          getValue: (map, d) => safeVal(map.get(Number(d))?.tmin),
        });
      }

      if (param === "rain") {
        return buildSimpleLineChart({
          baseChart,
          title: "Precipitazione giornaliera",
          xAxis,
          yName: "mm",
          formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} mm`),
          seriesData,
          colors,
          getValue: (map, d) => safeVal(map.get(Number(d))?.rain_total),
        });
      }

      if (param === "rain_cum") {
        return {
          ...baseChart,
          title: { ...baseChart.title, text: "Precipitazione cumulata" },
          xAxis: { ...baseChart.xAxis, data: xAxis },
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
          yAxis: {
            type: "value",
            name: "mm",
            nameLocation: "middle",
            nameRotate: 90,
            nameGap: 52,
            scale: true,
            axisLabel: { formatter: (v) => Number(v).toFixed(1) },
          },
          series: seriesData.map((s, i) => ({
            name: s.label,
            type: "bar",
            barMaxWidth: 18,
            data: cumulative(xAxis.map((d) => n(s.map.get(Number(d))?.rain_total))),
            itemStyle: { color: colors[i] },
          })),
        };
      }

      if (param === "humidity_max") {
        return buildSimpleLineChart({
          baseChart,
          title: "Umidità massima",
          xAxis,
          yName: "%",
          formatValue: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`),
          seriesData,
          colors,
          yMin: 0,
          yMax: 100,
          getValue: (map, d) => safeVal(getRhMax(map.get(Number(d)))),
          axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
        });
      }

      if (param === "humidity_mean") {
        return buildSimpleLineChart({
          baseChart,
          title: "Umidità media",
          xAxis,
          yName: "%",
          formatValue: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`),
          seriesData,
          colors,
          yMin: 0,
          yMax: 100,
          getValue: (map, d) => safeVal(getRhMean(map.get(Number(d)))),
          axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
        });
      }

      if (param === "humidity_min") {
        return buildSimpleLineChart({
          baseChart,
          title: "Umidità minima",
          xAxis,
          yName: "%",
          formatValue: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`),
          seriesData,
          colors,
          yMin: 0,
          yMax: 100,
          getValue: (map, d) => safeVal(getRhMin(map.get(Number(d)))),
          axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
        });
      }

      if (param === "wind") {
        return buildSimpleLineChart({
          baseChart,
          title: "Vento medio",
          xAxis,
          yName: "km/h",
          formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} km/h`),
          seriesData,
          colors,
          getValue: (map, d) => safeVal(map.get(Number(d))?.wind_avg),
          axisLabelFormatter: (v) => Number(v).toFixed(0),
        });
      }

      if (param === "gust") {
        return buildSimpleLineChart({
          baseChart,
          title: "Raffiche",
          xAxis,
          yName: "km/h",
          formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} km/h`),
          seriesData,
          colors,
          getValue: (map, d) => safeVal(map.get(Number(d))?.gust_max),
          axisLabelFormatter: (v) => Number(v).toFixed(0),
        });
      }

      if (param === "pressure") {
        return buildSimpleLineChart({
          baseChart,
          title: "Pressione media",
          xAxis,
          yName: "hPa",
          formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`),
          seriesData,
          colors,
          getValue: (map, d) => safeVal(map.get(Number(d))?.press_avg),
          axisLabelFormatter: (v) => Number(v).toFixed(0),
        });
      }

      if (param === "uv") {
        return buildSimpleLineChart({
          baseChart,
          title: "UV medio",
          xAxis,
          yName: "UV",
          formatValue: (v) => (v == null ? "—" : `${Number(v).toFixed(1)}`),
          seriesData,
          colors,
          getValue: (map, d) => safeVal(map.get(Number(d))?.uv_mean_pos),
          axisLabelFormatter: (v) => Number(v).toFixed(1),
        });
      }

      return buildSimpleLineChart({
        baseChart,
        title: "Radiazione media",
        xAxis,
        yName: "W/m²",
        formatValue: (v) => (v == null ? "—" : `${Math.round(Number(v))} W/m²`),
        seriesData,
        colors,
        getValue: (map, d) => safeVal(map.get(Number(d))?.solar_mean_pos),
        axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
        nameGap: 56,
      });
    }

    // ---------------------- ANNI ----------------------
    const selected = yearSelections
      .slice(0, activeCount)
      .map((s, i) => ({
        year: s.year || "",
        label: seriesLabels[i],
      }))
      .filter((x) => x.year);

    const yearRows = selected.map((s) => ({
      ...s,
      rows: aggregateYearRows(daily, s.year),
    }));

    const maxDays = Math.max(...yearRows.map((s) => s.rows.length), 366, 365);
    const xAxis = Array.from({ length: maxDays }, (_, i) => String(i + 1));

    function buildYearSeries(getValue) {
      return yearRows.map((s, i) => ({
        name: s.label,
        type: "line",
        data: xAxis.map((_, idx) => getValue(s.rows[idx])),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: colors[i] },
        itemStyle: { color: colors[i] },
      }));
    }

    function buildYearCumBarSeries(getValue) {
      return yearRows.map((s, i) => ({
        name: s.label,
        type: "bar",
        barMaxWidth: 12,
        data: cumulative(xAxis.map((_, idx) => n(getValue(s.rows[idx])))),
        itemStyle: { color: colors[i] },
      }));
    }

    if (param === "temp_max") {
      return buildYearChart(baseChart, "Temperatura massima", xAxis, "°C", yearRows, (v) => `${Number(v).toFixed(1)} °C`, buildYearSeries((r) => safeVal(r?.tmax)));
    }

    if (param === "temp_mean") {
      return buildYearChart(baseChart, "Temperatura media", xAxis, "°C", yearRows, (v) => `${Number(v).toFixed(1)} °C`, buildYearSeries((r) => safeVal(r?.tmean)));
    }

    if (param === "temp_min") {
      return buildYearChart(baseChart, "Temperatura minima", xAxis, "°C", yearRows, (v) => `${Number(v).toFixed(1)} °C`, buildYearSeries((r) => safeVal(r?.tmin)));
    }

    if (param === "rain") {
      return buildYearChart(baseChart, "Precipitazione giornaliera", xAxis, "mm", yearRows, (v) => `${Number(v).toFixed(1)} mm`, buildYearSeries((r) => safeVal(r?.rain_total)));
    }

    if (param === "rain_cum") {
      return buildYearChart(baseChart, "Precipitazione cumulata", xAxis, "mm", yearRows, (v) => `${Number(v).toFixed(1)} mm`, buildYearCumBarSeries((r) => safeVal(r?.rain_total)));
    }

    if (param === "humidity_max") {
      return buildYearChart(baseChart, "Umidità massima", xAxis, "%", yearRows, (v) => `${Math.round(Number(v))} %`, buildYearSeries((r) => safeVal(getRhMax(r))), {
        min: 0,
        max: 100,
        axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
      });
    }

    if (param === "humidity_mean") {
      return buildYearChart(baseChart, "Umidità media", xAxis, "%", yearRows, (v) => `${Math.round(Number(v))} %`, buildYearSeries((r) => safeVal(getRhMean(r))), {
        min: 0,
        max: 100,
        axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
      });
    }

    if (param === "humidity_min") {
      return buildYearChart(baseChart, "Umidità minima", xAxis, "%", yearRows, (v) => `${Math.round(Number(v))} %`, buildYearSeries((r) => safeVal(getRhMin(r))), {
        min: 0,
        max: 100,
        axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
      });
    }

    if (param === "wind") {
      return buildYearChart(baseChart, "Vento medio", xAxis, "km/h", yearRows, (v) => `${Number(v).toFixed(1)} km/h`, buildYearSeries((r) => safeVal(r?.wind_avg)), {
        axisLabelFormatter: (v) => Number(v).toFixed(0),
      });
    }

    if (param === "gust") {
      return buildYearChart(baseChart, "Raffiche", xAxis, "km/h", yearRows, (v) => `${Number(v).toFixed(1)} km/h`, buildYearSeries((r) => safeVal(r?.gust_max)), {
        axisLabelFormatter: (v) => Number(v).toFixed(0),
      });
    }

    if (param === "pressure") {
      return buildYearChart(baseChart, "Pressione media", xAxis, "hPa", yearRows, (v) => `${Number(v).toFixed(1)} hPa`, buildYearSeries((r) => safeVal(r?.press_avg)), {
        axisLabelFormatter: (v) => Number(v).toFixed(0),
      });
    }

    if (param === "uv") {
      return buildYearChart(baseChart, "UV medio", xAxis, "UV", yearRows, (v) => `${Number(v).toFixed(1)}`, buildYearSeries((r) => safeVal(r?.uv_mean_pos)), {
        axisLabelFormatter: (v) => Number(v).toFixed(1),
      });
    }

    return buildYearChart(baseChart, "Radiazione media", xAxis, "W/m²", yearRows, (v) => `${Math.round(Number(v))} W/m²`, buildYearSeries((r) => safeVal(r?.solar_mean_pos)), {
      axisLabelFormatter: (v) => `${Math.round(Number(v))}`,
      nameGap: 56,
    });
  }, [
    mode,
    param,
    activeCount,
    daySelections,
    monthSelections,
    yearSelections,
    seriesLabels,
    intradayData,
    daily,
    baseChart,
  ]);

  const summaries = useMemo(() => {
    if (mode === "giorni") {
      return daySelections.slice(0, activeCount).map((s) => {
        const iso = s.year && s.month && s.day ? `${s.year}-${s.month}-${s.day}` : "";
        const rows = iso ? intradayData[iso] || [] : [];
        const sum = summarizeDailyIntraday(rows);

        if (param === "temp") {
          return {
            title: iso ? formatDateIt(iso) : "—",
            items: [
              ["Min", `${fmt(sum.tempMin, 1)} °C`],
              ["Media", `${fmt(sum.tempAvg, 1)} °C`],
              ["Max", `${fmt(sum.tempMax, 1)} °C`],
            ],
          };
        }

        if (param === "rh") {
          return {
            title: iso ? formatDateIt(iso) : "—",
            items: [
              ["Min", `${fmtInt(sum.rhMin)} %`],
              ["Media", `${fmtInt(sum.rhAvg)} %`],
              ["Max", `${fmtInt(sum.rhMax)} %`],
            ],
          };
        }

        if (param === "rain") {
          return {
            title: iso ? formatDateIt(iso) : "—",
            items: [["Cumulata totale", `${fmt(sum.rainTotal, 1)} mm`]],
          };
        }

        if (param === "wind") {
          return {
            title: iso ? formatDateIt(iso) : "—",
            items: [["Media", `${fmt(sum.windAvg, 1)} km/h`]],
          };
        }

        if (param === "gust") {
          return {
            title: iso ? formatDateIt(iso) : "—",
            items: [["Max", `${fmt(sum.gustMax, 1)} km/h`]],
          };
        }

        if (param === "press") {
          return {
            title: iso ? formatDateIt(iso) : "—",
            items: [["Media", `${fmt(sum.pressAvg, 1)} hPa`]],
          };
        }

        if (param === "uv") {
          return {
            title: iso ? formatDateIt(iso) : "—",
            items: [["Media", fmt(sum.uvAvg, 1)]],
          };
        }

        return {
          title: iso ? formatDateIt(iso) : "—",
          items: [["Media", Number.isFinite(n(sum.solarAvg)) ? `${Math.round(n(sum.solarAvg))} W/m²` : "—"]],
        };
      });
    }

    if (mode === "mesi") {
      return monthSelections.slice(0, activeCount).map((s) => {
        const ym = s.year && s.month ? `${s.year}-${s.month}` : "";
        const rows = ym ? aggregateMonthRows(daily, s.year, s.month) : [];
        const sum = summarizePeriodDailyRows(rows);
        return buildPeriodSummaryCard(param, ym ? formatMonthYear(ym) : "—", sum);
      });
    }

    return yearSelections.slice(0, activeCount).map((s) => {
      const rows = s.year ? aggregateYearRows(daily, s.year) : [];
      const sum = summarizePeriodDailyRows(rows);
      return buildPeriodSummaryCard(param, s.year || "—", sum);
    });
  }, [mode, param, activeCount, daySelections, monthSelections, yearSelections, intradayData, daily]);

  return (
    <SiteLayout headerProps={{}}>
      <div className="wrap">
        <section className="hero">
          <div className="heroHead">
            <div>
              <div className="kicker">Archivio meteo</div>
              <h1 className="pageTitle">Confronti climatici</h1>
              <p className="pageSub">
                Confronto tra giorni, mesi e anni diversi con cumulata totale, cumulata grafica per la precipitazione e barra in basso per restringere l&apos;intervallo del grafico.
              </p>
            </div>
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

            <div className="controlCard">
              <div className="controlLabel">Numero confronti</div>
              <div className="pillRow">
                {[2, 3, 4].map((count) => (
                  <button
                    key={count}
                    type="button"
                    className={`pill ${activeCount === count ? "active" : ""}`}
                    onClick={() => setActiveCount(count)}
                  >
                    {count}
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

          {mode === "giorni" && (
            <div className="selectorsGrid">
              {daySelections.slice(0, activeCount).map((sel, index) => {
                const months = monthsByYear[sel.year] || [];
                const days = daysByYearMonth[`${sel.year}-${sel.month}`] || [];

                return (
                  <div className="selectorCard" key={`day-${index}`}>
                    <div className="selectorTitle">Giorno {index + 1}</div>

                    <div className="tripleGrid">
                      <div>
                        <div className="miniLabel">Anno</div>
                        <div className="selectWrap">
                          <select
                            className="selectNative"
                            value={sel.year}
                            onChange={(e) => updateDaySelection(index, { year: e.target.value })}
                          >
                            {availableYears.map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <div className="miniLabel">Mese</div>
                        <div className="selectWrap">
                          <select
                            className="selectNative"
                            value={sel.month}
                            onChange={(e) => updateDaySelection(index, { month: e.target.value })}
                          >
                            {months.map((m) => (
                              <option key={m} value={m}>
                                {MONTHS_IT_FULL[Number(m) - 1]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <div className="miniLabel">Giorno</div>
                        <div className="selectWrap">
                          <select
                            className="selectNative"
                            value={sel.day}
                            onChange={(e) => updateDaySelection(index, { day: e.target.value })}
                          >
                            {days.map((d) => (
                              <option key={d} value={d}>
                                {Number(d)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {mode === "mesi" && (
            <div className="selectorsGrid">
              {monthSelections.slice(0, activeCount).map((sel, index) => {
                const months = monthsByYear[sel.year] || [];

                return (
                  <div className="selectorCard" key={`month-${index}`}>
                    <div className="selectorTitle">Mese {index + 1}</div>

                    <div className="doubleGrid">
                      <div>
                        <div className="miniLabel">Mese</div>
                        <div className="selectWrap">
                          <select
                            className="selectNative"
                            value={sel.month}
                            onChange={(e) => updateMonthSelection(index, { month: e.target.value })}
                          >
                            {months.map((m) => (
                              <option key={m} value={m}>
                                {MONTHS_IT_FULL[Number(m) - 1]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <div className="miniLabel">Anno</div>
                        <div className="selectWrap">
                          <select
                            className="selectNative"
                            value={sel.year}
                            onChange={(e) => updateMonthSelection(index, { year: e.target.value })}
                          >
                            {availableYears.map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {mode === "anni" && (
            <div className="selectorsGrid">
              {yearSelections.slice(0, activeCount).map((sel, index) => (
                <div className="selectorCard" key={`year-${index}`}>
                  <div className="selectorTitle">Anno {index + 1}</div>

                  <div className="singleGrid">
                    <div>
                      <div className="miniLabel">Anno</div>
                      <div className="selectWrap">
                        <select
                          className="selectNative"
                          value={sel.year}
                          onChange={(e) => updateYearSelection(index, { year: e.target.value })}
                        >
                          {availableYears.map((y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={`summaryGrid cols-${activeCount}`}>
            {summaries.map((card, index) => (
              <div className="summaryCard" key={`${card.title}-${index}`}>
                <div className="summaryTitle">{card.title}</div>
                <div className="summaryList">
                  {card.items.map(([k, v]) => (
                    <div className="summaryRow" key={`${card.title}-${k}`}>
                      <span>{k}</span>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {mounted && (
          <section className="chartSection">
            <div className="chartBox">
              <ReactECharts option={chartOption} style={{ height: 560, width: "100%" }} />
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
            padding: 22px;
          }

          .heroHead {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 18px;
            margin-bottom: 18px;
          }

          .kicker {
            font-size: 12px;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            opacity: 0.6;
            margin-bottom: 8px;
          }

          .pageTitle {
            margin: 0;
            font-size: 42px;
            line-height: 1;
            letter-spacing: -0.04em;
          }

          .pageSub {
            margin: 10px 0 0;
            font-size: 14px;
            line-height: 1.5;
            color: #667085;
            font-weight: 700;
          }

          .topControls {
            display: grid;
            grid-template-columns: 1fr 1fr 1.4fr;
            gap: 12px;
          }

          .controlCard,
          .selectorCard,
          .summaryCard {
            border: 1px solid #ececec;
            border-radius: 16px;
            background: #fcfcfc;
            padding: 14px 16px;
          }

          .controlCardWide {
            min-width: 0;
          }

          .controlLabel,
          .selectorTitle {
            font-size: 12px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #374151;
            font-weight: 900;
            margin-bottom: 12px;
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

          .selectorsGrid {
            margin-top: 12px;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px;
          }

          .tripleGrid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
          }

          .doubleGrid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .singleGrid {
            display: grid;
            grid-template-columns: 1fr;
            gap: 10px;
          }

          .miniLabel {
            font-size: 11px;
            font-weight: 800;
            color: #6b7280;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
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
            min-height: 46px;
            padding: 0 16px;
            border: 0;
            background: transparent;
            cursor: pointer;
            font-weight: 800;
            font-size: 14px;
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

          .summaryGrid {
            margin-top: 18px;
            display: grid;
            gap: 12px;
          }

          .summaryGrid.cols-2 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .summaryGrid.cols-3 {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .summaryGrid.cols-4 {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

          .summaryTitle {
            font-size: 18px;
            line-height: 1.15;
            font-weight: 950;
            letter-spacing: -0.02em;
            margin-bottom: 12px;
            color: #0f172a;
          }

          .summaryList {
            display: grid;
            gap: 10px;
          }

          .summaryRow {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding-bottom: 10px;
            border-bottom: 1px solid #ececec;
            font-size: 14px;
            color: #4b5563;
          }

          .summaryRow:last-child {
            border-bottom: 0;
            padding-bottom: 0;
          }

          .summaryRow strong {
            color: #0f172a;
            font-weight: 900;
            text-align: right;
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

          @media (max-width: 1280px) {
            .topControls {
              grid-template-columns: 1fr 1fr;
            }

            .controlCardWide {
              grid-column: 1 / -1;
            }

            .summaryGrid.cols-4 {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
          }

          @media (max-width: 1100px) {
            .selectorsGrid,
            .summaryGrid.cols-3,
            .summaryGrid.cols-2 {
              grid-template-columns: 1fr;
            }

            .summaryGrid.cols-4 {
              grid-template-columns: 1fr;
            }

            .tripleGrid,
            .doubleGrid {
              grid-template-columns: 1fr;
            }
          }

          @media (max-width: 720px) {
            .topControls {
              grid-template-columns: 1fr;
            }

            .pageTitle {
              font-size: 32px;
            }
          }

          @media (max-width: 520px) {
            .pageTitle {
              font-size: 28px;
            }

            .pill {
              width: 100%;
            }
          }
        `}</style>
      </div>
    </SiteLayout>
  );
}

function buildDayLineChart(baseChart, title, xAxis, yName, selected, intradayData, colors, getValue, formatter, extra = {}) {
  return {
    ...baseChart,
    title: { ...baseChart.title, text: title },
    xAxis: { ...baseChart.xAxis, data: xAxis },
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
    series: selected.map((s, i) => {
      const map = new Map((intradayData[s.iso] || []).map((r) => [r.time, r]));
      return {
        name: s.label,
        type: "line",
        data: xAxis.map((t) => getValue(map.get(t))),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: colors[i] },
        itemStyle: { color: colors[i] },
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
  colors,
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
    series: seriesData.map((s, i) => ({
      name: s.label,
      type: "line",
      data: xAxis.map((d) => getValue(s.map, d)),
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 3, color: colors[i] },
      itemStyle: { color: colors[i] },
    })),
  };
}

function buildYearChart(baseChart, title, xAxis, yName, yearRows, formatter, series, extra = {}) {
  return {
    ...baseChart,
    title: { ...baseChart.title, text: title },
    xAxis: { ...baseChart.xAxis, data: xAxis, axisLabel: { rotate: 0, margin: 14, interval: 29 } },
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
    series,
  };
}

function buildPeriodSummaryCard(param, title, sum) {
  if (param === "temp_max") {
    return { title, items: [["Media periodo", `${fmt(sum.tmax_mean, 1)} °C`]] };
  }

  if (param === "temp_mean") {
    return { title, items: [["Media periodo", `${fmt(sum.tmean, 1)} °C`]] };
  }

  if (param === "temp_min") {
    return { title, items: [["Media periodo", `${fmt(sum.tmin_mean, 1)} °C`]] };
  }

  if (param === "rain" || param === "rain_cum") {
    return {
      title,
      items: [
        ["Cumulata totale", `${fmt(sum.rainSum, 1)} mm`],
        ["Rate max", `${fmt(sum.rainrate_max, 1)} mm/h`],
      ],
    };
  }

  if (param === "humidity_max") {
    return { title, items: [["Media periodo", `${fmtInt(sum.rh_max_mean)} %`]] };
  }

  if (param === "humidity_mean") {
    return { title, items: [["Media periodo", `${fmtInt(sum.rh_mean)} %`]] };
  }

  if (param === "humidity_min") {
    return { title, items: [["Media periodo", `${fmtInt(sum.rh_min_mean)} %`]] };
  }

  if (param === "wind") {
    return {
      title,
      items: [
        ["Media periodo", `${fmt(sum.wind_mean, 1)} km/h`],
        ["Direzione media", degToCardinal16(sum.wind_dir_mean_deg)],
      ],
    };
  }

  if (param === "gust") {
    return { title, items: [["Massima", `${fmt(sum.gust_max, 1)} km/h`]] };
  }

  if (param === "pressure") {
    return { title, items: [["Media periodo", `${fmt(sum.press_mean, 1)} hPa`]] };
  }

  if (param === "uv") {
    return { title, items: [["Media periodo", fmt(sum.uv_mean, 1)]] };
  }

  return {
    title,
    items: [["Media periodo", Number.isFinite(n(sum.solar_mean)) ? `${Math.round(n(sum.solar_mean))} W/m²` : "—"]],
  };
}