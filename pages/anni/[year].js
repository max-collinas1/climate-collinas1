import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import SiteLayout from "../../components/SiteLayout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(raw) ? raw : [];
}

export async function getStaticPaths() {
  const rows = readDaily();

  const years = Array.from(
    new Set(
      rows
        .map((r) => String(r?.date ?? "").trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .map((d) => d.slice(0, 4))
    )
  ).sort();

  return {
    paths: years.map((y) => ({ params: { year: y } })),
    fallback: false,
  };
}

export async function getStaticProps({ params }) {
  const rows = readDaily();
  const year = String(params?.year ?? "");

  const days = rows
    .filter((r) => String(r?.date ?? "").startsWith(year + "-"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const monthsInYear = Array.from(
    new Set(
      days
        .map((d) => String(d?.date ?? ""))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .map((d) => d.slice(0, 7))
    )
  ).sort();

  return {
    props: {
      year,
      days,
      monthsInYear,
    },
  };
}

// -------------------- helpers --------------------
function n(x) {
  if (x === null || x === undefined || x === "") return NaN;
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

function fmt(x, d = 1) {
  const v = n(x);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

function fmtInt(x) {
  const v = n(x);
  if (!Number.isFinite(v)) return "—";
  return String(Math.round(v));
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
      c++;
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

function getMaxRecord(rows, keyOrGetter) {
  let best = null;
  for (const row of rows || []) {
    const value = typeof keyOrGetter === "function" ? n(keyOrGetter(row)) : n(row?.[keyOrGetter]);
    if (!Number.isFinite(value)) continue;
    if (!best || value > best.value) {
      best = { value, date: String(row?.date ?? "") };
    }
  }
  return best;
}

function getMinRecord(rows, keyOrGetter) {
  let best = null;
  for (const row of rows || []) {
    const value = typeof keyOrGetter === "function" ? n(keyOrGetter(row)) : n(row?.[keyOrGetter]);
    if (!Number.isFinite(value)) continue;
    if (!best || value < best.value) {
      best = { value, date: String(row?.date ?? "") };
    }
  }
  return best;
}

// umidità compat
function getRhMin(d) {
  const a = n(d?.rh_min);
  if (Number.isFinite(a)) return a;
  const b = n(d?.rh_pct_min);
  if (Number.isFinite(b)) return b;
  return NaN;
}

function getRhMax(d) {
  const a = n(d?.rh_max);
  if (Number.isFinite(a)) return a;
  const b = n(d?.rh_pct_max);
  if (Number.isFinite(b)) return b;
  return NaN;
}

function getRhMean(d) {
  const a = n(d?.rh_mean);
  if (Number.isFinite(a)) return a;
  const b = n(d?.rh_pct_mean);
  if (Number.isFinite(b)) return b;
  return NaN;
}

// cardinali
function degToCardinal16(v) {
  const n0 = Number(v);
  if (!Number.isFinite(n0)) return "—";
  const d = ((n0 % 360) + 360) % 360;
  const ix = Math.round(d / 22.5) % 16;
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][ix];
}

// media circolare
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

const MONTHS_IT_SHORT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
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

function monthShort(ym) {
  const mm = Number(String(ym).slice(5, 7));
  return MONTHS_IT_SHORT[mm - 1] || String(ym).slice(5, 7);
}

function monthFull(ym) {
  const mm = Number(String(ym).slice(5, 7));
  return MONTHS_IT_FULL[mm - 1] || String(ym).slice(5, 7);
}

function monthNum(ym) {
  return String(ym).slice(5, 7);
}

function formatDateIt(dateStr) {
  const s = String(dateStr ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "—";
  const [y, m, d] = s.split("-");
  const mName = MONTHS_IT_FULL[Number(m) - 1] || m;
  return `${Number(d)} ${mName} ${y}`;
}

function dayHref(dateStr) {
  return `/giorni/${String(dateStr ?? "")}`;
}

function seriesLine(arr) {
  return arr.map((v) => (Number.isFinite(n(v)) ? n(v) : null));
}

function cumulative(arr) {
  let s = 0;
  let started = false;
  return arr.map((v) => {
    const x = n(v);
    if (Number.isFinite(x)) {
      s += x;
      started = true;
      return s;
    }
    return started ? s : null;
  });
}

export default function YearOverviewPage(props) {
  const year = props.year ?? "";
  const days = Array.isArray(props.days) ? props.days : [];
  const monthsInYear = Array.isArray(props.monthsInYear) ? props.monthsInYear : [];

  const [mounted, setMounted] = useState(false);
  const [showRecords, setShowRecords] = useState(false);

  useEffect(() => setMounted(true), []);

  const byMonth = useMemo(() => {
    const m = new Map();
    for (const d of days) {
      const ym = String(d.date).slice(0, 7);
      if (!m.has(ym)) m.set(ym, []);
      m.get(ym).push(d);
    }
    return m;
  }, [days]);

  const months = useMemo(() => Array.from(byMonth.keys()).sort(), [byMonth]);

  const monthly = useMemo(() => {
    return months.map((ym) => {
      const arr = byMonth.get(ym) || [];

      const tmin_abs = minFinite(arr.map((d) => d.tmin));
      const tmax_abs = maxFinite(arr.map((d) => d.tmax));
      const tmin_mean = avgFinite(arr.map((d) => d.tmin));
      const tmean = avgFinite(arr.map((d) => d.tmean));
      const tmax_mean = avgFinite(arr.map((d) => d.tmax));

      const rainSum = sumFinite(arr.map((d) => d.rain_total));
      const rainDailyMax = maxFinite(arr.map((d) => d.rain_total));
      const rainyDays = arr.map((d) => n(d.rain_total)).filter((x) => Number.isFinite(x) && x > 1).length;
      const rainrate_max = maxFinite(arr.map((d) => d.rainrate_max));

      const rh_min_mean = avgFinite(arr.map((d) => getRhMin(d)));
      const rh_mean = avgFinite(arr.map((d) => getRhMean(d)));
      const rh_max_mean = avgFinite(arr.map((d) => getRhMax(d)));
      const rh_min_abs = minFinite(arr.map((d) => getRhMin(d)));
      const rh_max_abs = maxFinite(arr.map((d) => getRhMax(d)));

      const wind_mean = avgFinite(arr.map((d) => d.wind_avg));
      const gust_mean = avgFinite(arr.map((d) => d.gust_max));
      const gust_max = maxFinite(arr.map((d) => d.gust_max));
      const wind_dir_mean_deg = circularMeanDeg(arr.map((d) => d.wind_dir_mean_deg));

      const press_min_mean = avgFinite(arr.map((d) => d.press_min));
      const press_mean = avgFinite(arr.map((d) => d.press_avg));
      const press_max_mean = avgFinite(arr.map((d) => d.press_max));
      const press_min_abs = minFinite(arr.map((d) => d.press_min));
      const press_max_abs = maxFinite(arr.map((d) => d.press_max));

      const uv_mean = avgFinite(arr.map((d) => d.uv_mean_pos));
      const uv_max = maxFinite(arr.map((d) => d.uv_max));
      const uv_max_mean = avgFinite(arr.map((d) => d.uv_max));

      const solar_mean = avgFinite(arr.map((d) => d.solar_mean_pos));
      const solar_max = maxFinite(arr.map((d) => d.solar_max));
      const solar_max_mean = avgFinite(arr.map((d) => d.solar_max));

      return {
        ym,
        days: arr.length,

        tmin_abs,
        tmax_abs,
        tmin_mean,
        tmean,
        tmax_mean,

        rainSum,
        rainDailyMax,
        rainrate_max,
        rainyDays,

        rh_min_mean,
        rh_mean,
        rh_max_mean,
        rh_min_abs,
        rh_max_abs,

        wind_mean,
        gust_mean,
        gust_max,
        wind_dir_mean_deg,

        press_min_mean,
        press_mean,
        press_max_mean,
        press_min_abs,
        press_max_abs,

        uv_mean,
        uv_max,
        uv_max_mean,
        solar_mean,
        solar_max,
        solar_max_mean,
      };
    });
  }, [months, byMonth]);

  const annual = useMemo(() => {
    const tmin_mean = avgFinite(days.map((d) => d.tmin));
    const tmean = avgFinite(days.map((d) => d.tmean));
    const tmax_mean = avgFinite(days.map((d) => d.tmax));

    const rainSum = sumFinite(days.map((d) => d.rain_total));
    const rainDailyMax = maxFinite(days.map((d) => d.rain_total));
    const rainyDays = days.map((d) => n(d.rain_total)).filter((x) => Number.isFinite(x) && x > 1).length;
    const rainrate_max = maxFinite(days.map((d) => d.rainrate_max));

    const rh_min_mean = avgFinite(days.map((d) => getRhMin(d)));
    const rh_mean = avgFinite(days.map((d) => getRhMean(d)));
    const rh_max_mean = avgFinite(days.map((d) => getRhMax(d)));

    const wind_mean = avgFinite(days.map((d) => d.wind_avg));
    const gust_mean = avgFinite(days.map((d) => d.gust_max));
    const gust_max = maxFinite(days.map((d) => d.gust_max));
    const wind_dir_mean_deg = circularMeanDeg(days.map((d) => d.wind_dir_mean_deg));

    const press_min_mean = avgFinite(days.map((d) => d.press_min));
    const press_mean = avgFinite(days.map((d) => d.press_avg));
    const press_max_mean = avgFinite(days.map((d) => d.press_max));

    const uv_mean = avgFinite(days.map((d) => d.uv_mean_pos));
    const uv_max = maxFinite(days.map((d) => d.uv_max));
    const uv_max_mean = avgFinite(days.map((d) => d.uv_max));

    const solar_mean = avgFinite(days.map((d) => d.solar_mean_pos));
    const solar_max = maxFinite(days.map((d) => d.solar_max));
    const solar_max_mean = avgFinite(days.map((d) => d.solar_max));

    return {
      tmin_mean,
      tmean,
      tmax_mean,

      rainSum,
      rainDailyMax,
      rainyDays,
      rainrate_max,

      rh_min_mean,
      rh_mean,
      rh_max_mean,

      wind_mean,
      gust_mean,
      gust_max,
      wind_dir_mean_deg,

      press_min_mean,
      press_mean,
      press_max_mean,

      uv_mean,
      uv_max,
      uv_max_mean,

      solar_mean,
      solar_max,
      solar_max_mean,
    };
  }, [days]);

  const annualRecords = useMemo(() => {
    const rows = [
      {
        label: "Temperatura massima giornaliera",
        min: getMinRecord(days, "tmax"),
        max: getMaxRecord(days, "tmax"),
        unit: "°C",
      },
      {
        label: "Temperatura minima giornaliera",
        min: getMinRecord(days, "tmin"),
        max: getMaxRecord(days, "tmin"),
        unit: "°C",
      },
      {
        label: "Pioggia giornaliera",
        min: getMinRecord(days, "rain_total"),
        max: getMaxRecord(days, "rain_total"),
        unit: "mm",
      },
      {
        label: "Rain rate",
        min: getMinRecord(days, "rainrate_max"),
        max: getMaxRecord(days, "rainrate_max"),
        unit: "mm/h",
      },
      {
        label: "Umidità minima giornaliera",
        min: getMinRecord(days, (d) => getRhMin(d)),
        max: getMaxRecord(days, (d) => getRhMin(d)),
        unit: "%",
      },
      {
        label: "Umidità massima giornaliera",
        min: getMinRecord(days, (d) => getRhMax(d)),
        max: getMaxRecord(days, (d) => getRhMax(d)),
        unit: "%",
      },
      {
        label: "Vento medio",
        min: getMinRecord(days, "wind_avg"),
        max: getMaxRecord(days, "wind_avg"),
        unit: "km/h",
      },
      {
        label: "Raffica massima",
        min: getMinRecord(days, "gust_max"),
        max: getMaxRecord(days, "gust_max"),
        unit: "km/h",
      },
      {
        label: "Pressione minima giornaliera",
        min: getMinRecord(days, "press_min"),
        max: getMaxRecord(days, "press_min"),
        unit: "hPa",
      },
      {
        label: "Pressione massima giornaliera",
        min: getMinRecord(days, "press_max"),
        max: getMaxRecord(days, "press_max"),
        unit: "hPa",
      },
      {
        label: "UV massimo",
        min: getMinRecord(days, "uv_max"),
        max: getMaxRecord(days, "uv_max"),
        unit: "",
      },
      {
        label: "Radiazione massima",
        min: getMinRecord(days, "solar_max"),
        max: getMaxRecord(days, "solar_max"),
        unit: "W/m²",
      },
    ];

    return rows;
  }, [days]);

  const x = monthly.map((m) => monthShort(m.ym));
  const dirTxt = Number.isFinite(n(annual.wind_dir_mean_deg)) ? degToCardinal16(annual.wind_dir_mean_deg) : "—";

  const baseChart = {
    animation: false,
    grid: { left: 72, right: 56, top: 58, bottom: 92 },
    xAxis: {
      type: "category",
      data: x,
      axisLabel: { rotate: 0, margin: 14 },
    },
    title: { left: "center", top: 10 },
    legend: {
      bottom: 8,
      left: "center",
      itemGap: 16,
      padding: [8, 10, 2, 10],
    },
    toolbox: { feature: { restore: {} }, right: 10, top: 10 },
    tooltip: { trigger: "axis" },
  };

  const optTemp = {
    ...baseChart,
    title: { ...baseChart.title, text: "Temperature mensili" },
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`),
    },
    yAxis: {
      type: "value",
      name: "°C",
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 52,
      scale: true,
      axisLabel: { formatter: (v) => Number(v).toFixed(1) },
    },
    series: [
      { name: "Min media", type: "line", data: seriesLine(monthly.map((m) => m.tmin_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Media", type: "line", data: seriesLine(monthly.map((m) => m.tmean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Max media", type: "line", data: seriesLine(monthly.map((m) => m.tmax_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Min assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.tmin_abs)), symbolSize: 7, itemStyle: { color: "#2f80ed" } },
      { name: "Max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.tmax_abs)), symbolSize: 7, itemStyle: { color: "#f2994a" } },
    ],
  };

  const rainMonthly = monthly.map((m) => m.rainSum);
  const rainCum = cumulative(rainMonthly);

  const optRain = {
    ...baseChart,
    title: { ...baseChart.title, text: "Precipitazioni" },
    yAxis: [
      {
        type: "value",
        name: "mm",
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: 52,
        scale: true,
        splitNumber: 5,
        alignTicks: true,
        axisLabel: { formatter: (v) => Number(v).toFixed(1) },
      },
      {
        type: "value",
        name: "mm/h",
        nameLocation: "middle",
        nameRotate: 270,
        nameGap: 56,
        scale: true,
        splitNumber: 5,
        alignTicks: true,
        axisLabel: { formatter: (v) => Number(v).toFixed(1) },
      },
    ],
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const i = params?.[0]?.dataIndex ?? 0;
        const mm = x[i] ?? "—";
        const acc = n(monthly[i]?.rainSum);
        const cum = n(rainCum[i]);
        const rr = n(monthly[i]?.rainrate_max);
        const gp = n(monthly[i]?.rainyDays);
        return [
          `<b>${mm}</b>`,
          `Pioggia: ${Number.isFinite(acc) ? acc.toFixed(1) + " mm" : "—"}`,
          `Progressivo: ${Number.isFinite(cum) ? cum.toFixed(1) + " mm" : "—"}`,
          `Rate max: ${Number.isFinite(rr) ? rr.toFixed(1) + " mm/h" : "—"}`,
          `Giorni > 1 mm: ${Number.isFinite(gp) ? Math.round(gp) : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "Pioggia", type: "bar", data: seriesLine(rainMonthly), yAxisIndex: 0 },
      { name: "Progressivo", type: "line", data: seriesLine(rainCum), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rate max", type: "scatter", data: seriesLine(monthly.map((m) => m.rainrate_max)), yAxisIndex: 1, symbolSize: 7 },
    ],
  };

  const optRh = {
    ...baseChart,
    title: { ...baseChart.title, text: "Umidità" },
    yAxis: {
      type: "value",
      name: "%",
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 52,
      min: 0,
      max: 100,
      splitNumber: 5,
      axisLabel: { formatter: (v) => `${Math.round(Number(v))}` },
    },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`) },
    series: [
      { name: "Min media", type: "line", data: seriesLine(monthly.map((m) => m.rh_min_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Media", type: "line", data: seriesLine(monthly.map((m) => m.rh_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Max media", type: "line", data: seriesLine(monthly.map((m) => m.rh_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Min assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.rh_min_abs)), symbolSize: 7 },
      { name: "Max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.rh_max_abs)), symbolSize: 7 },
    ],
  };

  const optWind = {
    ...baseChart,
    title: { ...baseChart.title, text: "Vento" },
    yAxis: [
      {
        type: "value",
        name: "km/h",
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: 52,
        scale: true,
        splitNumber: 5,
        alignTicks: true,
        axisLabel: { formatter: (v) => Number(v).toFixed(0) },
      },
      {
        type: "value",
        name: "°",
        nameLocation: "middle",
        nameRotate: 270,
        nameGap: 56,
        min: 0,
        max: 360,
        splitNumber: 5,
        alignTicks: true,
        axisLabel: { formatter: (v) => `${Math.round(Number(v))}` },
      },
    ],
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const i = params?.[0]?.dataIndex ?? 0;
        const mm = x[i] ?? "—";
        const w = n(monthly[i]?.wind_mean);
        const gm = n(monthly[i]?.gust_mean);
        const gx = n(monthly[i]?.gust_max);
        const dir = n(monthly[i]?.wind_dir_mean_deg);
        return [
          `<b>${mm}</b>`,
          `Vento medio: ${Number.isFinite(w) ? w.toFixed(1) + " km/h" : "—"}`,
          `Raffica media: ${Number.isFinite(gm) ? gm.toFixed(1) + " km/h" : "—"}`,
          `Raffica max: ${Number.isFinite(gx) ? gx.toFixed(1) + " km/h" : "—"}`,
          `Direzione media: ${Number.isFinite(dir) ? `${degToCardinal16(dir)} (${Math.round(dir)}°)` : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "Vento medio", type: "line", data: seriesLine(monthly.map((m) => m.wind_mean)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Raffica media", type: "line", data: seriesLine(monthly.map((m) => m.gust_mean)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Raffica max", type: "scatter", data: seriesLine(monthly.map((m) => m.gust_max)), yAxisIndex: 0, symbolSize: 7 },
      { name: "Dir media", type: "scatter", data: seriesLine(monthly.map((m) => m.wind_dir_mean_deg)), yAxisIndex: 1, symbolSize: 7 },
    ],
  };

  const optPress = {
    ...baseChart,
    title: { ...baseChart.title, text: "Pressione" },
    yAxis: {
      type: "value",
      name: "hPa",
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 52,
      scale: true,
      splitNumber: 5,
      axisLabel: { formatter: (v) => Number(v).toFixed(0) },
    },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`) },
    series: [
      { name: "Min media", type: "line", data: seriesLine(monthly.map((m) => m.press_min_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Media", type: "line", data: seriesLine(monthly.map((m) => m.press_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Max media", type: "line", data: seriesLine(monthly.map((m) => m.press_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Min assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.press_min_abs)), symbolSize: 7 },
      { name: "Max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.press_max_abs)), symbolSize: 7 },
    ],
  };

  const optUv = {
    ...baseChart,
    title: { ...baseChart.title, text: "UV" },
    yAxis: {
      type: "value",
      name: "UV",
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 52,
      scale: true,
      splitNumber: 5,
      axisLabel: { formatter: (v) => Number(v).toFixed(1) },
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const i = params?.[0]?.dataIndex ?? 0;
        const mm = x[i] ?? "—";
        const uvM = n(monthly[i]?.uv_mean);
        const uvXmean = n(monthly[i]?.uv_max_mean);
        const uvX = n(monthly[i]?.uv_max);
        return [
          `<b>${mm}</b>`,
          `UV medio: ${Number.isFinite(uvM) ? uvM.toFixed(1) : "—"}`,
          `UV max medio: ${Number.isFinite(uvXmean) ? uvXmean.toFixed(1) : "—"}`,
          `UV max assoluto: ${Number.isFinite(uvX) ? uvX.toFixed(1) : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "UV medio", type: "line", data: seriesLine(monthly.map((m) => m.uv_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "UV max medio", type: "line", data: seriesLine(monthly.map((m) => m.uv_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "UV max assoluto", type: "scatter", data: seriesLine(monthly.map((m) => m.uv_max)), symbolSize: 7 },
    ],
  };

  const optSolar = {
    ...baseChart,
    title: { ...baseChart.title, text: "Radiazione" },
    yAxis: {
      type: "value",
      name: "W/m²",
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 56,
      scale: true,
      splitNumber: 5,
      axisLabel: { formatter: (v) => `${Math.round(Number(v))}` },
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const i = params?.[0]?.dataIndex ?? 0;
        const mm = x[i] ?? "—";
        const sM = n(monthly[i]?.solar_mean);
        const sXmean = n(monthly[i]?.solar_max_mean);
        const sX = n(monthly[i]?.solar_max);
        return [
          `<b>${mm}</b>`,
          `Rad media: ${Number.isFinite(sM) ? Math.round(sM) + " W/m²" : "—"}`,
          `Rad max media: ${Number.isFinite(sXmean) ? Math.round(sXmean) + " W/m²" : "—"}`,
          `Rad max assoluta: ${Number.isFinite(sX) ? Math.round(sX) + " W/m²" : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "Rad media", type: "line", data: seriesLine(monthly.map((m) => m.solar_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rad max media", type: "line", data: seriesLine(monthly.map((m) => m.solar_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rad max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.solar_max)), symbolSize: 7 },
    ],
  };

  return (
    <SiteLayout headerProps={{}}>
      <div className="wrap">
        <header className="hero">
          <div className="heroTop">
            <div className="heroLeft">
              <div className="kicker">Anno</div>
              <h1 className="year">{year}</h1>
            </div>
          </div>

          <section className="monthsBar" aria-label="Seleziona mese">
            <div className="monthsBarHead">Seleziona mese</div>
            <nav className="monthNav">
              {monthsInYear.map((ym) => {
                const mm = monthNum(ym);
                return (
                  <Link
                    key={ym}
                    href={`/mesi/${year}/${mm}`}
                    className="monthLink"
                    title={`Apri ${monthFull(ym)}`}
                    aria-label={`Apri ${monthFull(ym)}`}
                  >
                    <span className="ext" aria-hidden="true">
                      ↗
                    </span>
                    <span className="monthText">{monthFull(ym)}</span>
                  </Link>
                );
              })}
            </nav>
          </section>

          <section className="summaryCompact">
            <div className="summaryHead">
              <div>
                <h2>Sintesi annuale</h2>
                <p>Lettura rapida dei dati principali dell&apos;anno.</p>
              </div>
            </div>

            <div className="summaryGridCompact">
              <div className="miniCard">
                <div className="miniTitle">Temperature</div>
                <div className="miniMain threeCols">
                  <div>
                    <span className="miniKey">Max media</span>
                    <strong>{fmt(annual.tmax_mean, 1)} °C</strong>
                  </div>
                  <div>
                    <span className="miniKey">Media</span>
                    <strong>{fmt(annual.tmean, 1)} °C</strong>
                  </div>
                  <div>
                    <span className="miniKey">Min media</span>
                    <strong>{fmt(annual.tmin_mean, 1)} °C</strong>
                  </div>
                </div>
              </div>

              <div className="miniCard">
                <div className="miniTitle">Precipitazioni</div>
                <div className="miniMain twoCols">
                  <div>
                    <span className="miniKey">Totale</span>
                    <strong>{fmt(annual.rainSum, 1)} mm</strong>
                  </div>
                  <div>
                    <span className="miniKey">Giorni &gt; 1 mm</span>
                    <strong>{fmtInt(annual.rainyDays)}</strong>
                  </div>
                </div>
              </div>

              <div className="miniCard">
                <div className="miniTitle">Umidità</div>
                <div className="miniMain threeCols">
                  <div>
                    <span className="miniKey">Max media</span>
                    <strong>{fmtInt(annual.rh_max_mean)} %</strong>
                  </div>
                  <div>
                    <span className="miniKey">Media</span>
                    <strong>{fmtInt(annual.rh_mean)} %</strong>
                  </div>
                  <div>
                    <span className="miniKey">Min media</span>
                    <strong>{fmtInt(annual.rh_min_mean)} %</strong>
                  </div>
                </div>
              </div>

              <div className="miniCard">
                <div className="miniTitle">Vento</div>
                <div className="miniMain threeCols">
                  <div>
                    <span className="miniKey">Medio</span>
                    <strong>{fmt(annual.wind_mean, 1)} km/h</strong>
                  </div>
                  <div>
                    <span className="miniKey">Raffica media</span>
                    <strong>{fmt(annual.gust_mean, 1)} km/h</strong>
                  </div>
                  <div>
                    <span className="miniKey">Direzione media</span>
                    <strong>{dirTxt}</strong>
                  </div>
                </div>
              </div>

              <div className="miniCard">
                <div className="miniTitle">Pressione</div>
                <div className="miniMain threeCols">
                  <div>
                    <span className="miniKey">Max media</span>
                    <strong>{fmt(annual.press_max_mean, 1)} hPa</strong>
                  </div>
                  <div>
                    <span className="miniKey">Media</span>
                    <strong>{fmt(annual.press_mean, 1)} hPa</strong>
                  </div>
                  <div>
                    <span className="miniKey">Min media</span>
                    <strong>{fmt(annual.press_min_mean, 1)} hPa</strong>
                  </div>
                </div>
              </div>

              <div className="miniCard">
                <div className="miniTitle">UV</div>
                <div className="miniMain twoCols">
                  <div>
                    <span className="miniKey">UV medio</span>
                    <strong>{fmt(annual.uv_mean, 1)}</strong>
                  </div>
                  <div>
                    <span className="miniKey">UV max medio</span>
                    <strong>{fmt(annual.uv_max_mean, 1)}</strong>
                  </div>
                </div>
              </div>

              <div className="miniCard">
                <div className="miniTitle">Radiazione</div>
                <div className="miniMain twoCols">
                  <div>
                    <span className="miniKey">Rad media</span>
                    <strong>{Number.isFinite(n(annual.solar_mean)) ? `${Math.round(n(annual.solar_mean))} W/m²` : "—"}</strong>
                  </div>
                  <div>
                    <span className="miniKey">Rad max media</span>
                    <strong>{Number.isFinite(n(annual.solar_max_mean)) ? `${Math.round(n(annual.solar_max_mean))} W/m²` : "—"}</strong>
                  </div>
                </div>
              </div>
            </div>

            <div className="recordsAction">
              <button
                type="button"
                className={`toggleRecords ${showRecords ? "active" : ""}`}
                onClick={() => setShowRecords((v) => !v)}
                aria-expanded={showRecords}
                aria-controls="records-year-table"
              >
                {showRecords ? "Nascondi record anno" : "Record anno"}
              </button>
            </div>

            {showRecords && (
              <div id="records-year-table" className="recordsWrap">
                <div className="recordsHead">Record anno {year}</div>

                <div className="recordsTableWrap">
                  <table className="recordsTable">
                    <thead>
                      <tr>
                        <th>Parametro</th>
                        <th>Minimo</th>
                        <th>Data</th>
                        <th>Massimo</th>
                        <th>Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {annualRecords.map((r) => (
                        <tr key={r.label}>
                          <td className="recordName">{r.label}</td>

                          <td>{r.min ? `${fmt(r.min.value, 1)}${r.unit ? ` ${r.unit}` : ""}` : "—"}</td>
                          <td>
                            {r.min?.date ? (
                              <Link href={dayHref(r.min.date)} className="dateLink">
                                {formatDateIt(r.min.date)}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>

                          <td>{r.max ? `${fmt(r.max.value, 1)}${r.unit ? ` ${r.unit}` : ""}` : "—"}</td>
                          <td>
                            {r.max?.date ? (
                              <Link href={dayHref(r.max.date)} className="dateLink">
                                {formatDateIt(r.max.date)}
                              </Link>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </header>

        {mounted && (
          <section className="charts2">
            <div className="chartBox">
              <ReactECharts option={optTemp} style={{ height: 340, width: "100%" }} />
            </div>
            <div className="chartBox">
              <ReactECharts option={optRain} style={{ height: 340, width: "100%" }} />
            </div>

            <div className="chartBox">
              <ReactECharts option={optRh} style={{ height: 340, width: "100%" }} />
            </div>
            <div className="chartBox">
              <ReactECharts option={optWind} style={{ height: 340, width: "100%" }} />
            </div>

            <div className="chartBox">
              <ReactECharts option={optPress} style={{ height: 340, width: "100%" }} />
            </div>
            <div className="chartBox">
              <ReactECharts option={optUv} style={{ height: 340, width: "100%" }} />
            </div>

            <div className="chartBox chartBoxWide">
              <ReactECharts option={optSolar} style={{ height: 340, width: "100%" }} />
            </div>
          </section>
        )}

        <section className="tableWrap">
          <table>
            <thead>
              <tr className="groupRow">
                <th className="group stickyHead bR" colSpan={1}>
                  Mese
                </th>
                <th className="group bR" colSpan={3}>
                  Temperature
                </th>
                <th className="group bR" colSpan={4}>
                  Precipitazioni
                </th>
                <th className="group bR" colSpan={3}>
                  Umidità
                </th>
                <th className="group bR" colSpan={4}>
                  Vento
                </th>
                <th className="group bR" colSpan={3}>
                  Pressione
                </th>
                <th className="group bR" colSpan={2}>
                  UV
                </th>
                <th className="group" colSpan={2}>
                  Radiazione
                </th>
              </tr>

              <tr className="colRow">
                <th className="bR stickyHead"> </th>

                <th>Min media</th>
                <th>Media</th>
                <th className="bR">Max media</th>

                <th>Pioggia</th>
                <th>Max giorno</th>
                <th>Rate max</th>
                <th className="bR">G prec</th>

                <th>Min media</th>
                <th>Media</th>
                <th className="bR">Max media</th>

                <th>Medio</th>
                <th>Raffica media</th>
                <th>Raffica max</th>
                <th className="bR">Dir media</th>

                <th>Min media</th>
                <th>Media</th>
                <th className="bR">Max media</th>

                <th>UV medio</th>
                <th className="bR">UV max</th>

                <th>Rad media</th>
                <th>Rad max</th>
              </tr>
            </thead>

            <tbody>
              {monthly.map((m) => {
                const mm = String(m.ym).slice(5, 7);
                const dir = n(m.wind_dir_mean_deg);

                return (
                  <tr key={m.ym}>
                    <td className="date sticky bR">
                      <Link href={`/mesi/${year}/${mm}`} className="cellLink">
                        <span className="extCell" aria-hidden="true">
                          ↗
                        </span>
                        <span className="cellText">{monthFull(m.ym)}</span>
                      </Link>
                    </td>

                    <td>{fmt(m.tmin_mean, 1)} °C</td>
                    <td className="strong">{fmt(m.tmean, 1)} °C</td>
                    <td className="bR">{fmt(m.tmax_mean, 1)} °C</td>

                    <td className={Number.isFinite(n(m.rainSum)) && n(m.rainSum) > 0 ? "rainy" : ""}>{fmt(m.rainSum, 1)} mm</td>
                    <td className={Number.isFinite(n(m.rainDailyMax)) && n(m.rainDailyMax) > 0 ? "rainy" : ""}>{fmt(m.rainDailyMax, 1)} mm</td>
                    <td className={Number.isFinite(n(m.rainrate_max)) && n(m.rainrate_max) > 0 ? "rainy" : ""}>{fmt(m.rainrate_max, 1)} mm/h</td>
                    <td className="bR">{fmtInt(m.rainyDays)}</td>

                    <td>{fmtInt(m.rh_min_mean)} %</td>
                    <td className="strong">{fmtInt(m.rh_mean)} %</td>
                    <td className="bR">{fmtInt(m.rh_max_mean)} %</td>

                    <td>{fmt(m.wind_mean, 1)} km/h</td>
                    <td>{fmt(m.gust_mean, 1)} km/h</td>
                    <td>{fmt(m.gust_max, 1)} km/h</td>
                    <td className="bR">
                      {Number.isFinite(dir) ? degToCardinal16(dir) : "—"}
                      {Number.isFinite(dir) ? <span style={{ opacity: 0.65 }}> ({Math.round(dir)}°)</span> : null}
                    </td>

                    <td>{fmt(m.press_min_mean, 1)} hPa</td>
                    <td className="strong">{fmt(m.press_mean, 1)} hPa</td>
                    <td className="bR">{fmt(m.press_max_mean, 1)} hPa</td>

                    <td>{fmt(m.uv_mean, 1)}</td>
                    <td className="bR">{fmt(m.uv_max, 1)}</td>

                    <td>{Number.isFinite(n(m.solar_mean)) ? `${Math.round(n(m.solar_mean))} W/m²` : "—"}</td>
                    <td>{Number.isFinite(n(m.solar_max)) ? `${Math.round(n(m.solar_max))} W/m²` : "—"}</td>
                  </tr>
                );
              })}

              <tr className="yearRow">
                <td className="date sticky bR">
                  <span className="yearTag">Anno</span>
                </td>

                <td>{fmt(annual.tmin_mean, 1)} °C</td>
                <td className="strong">{fmt(annual.tmean, 1)} °C</td>
                <td className="bR">{fmt(annual.tmax_mean, 1)} °C</td>

                <td className={Number.isFinite(n(annual.rainSum)) && n(annual.rainSum) > 0 ? "rainy" : ""}>{fmt(annual.rainSum, 1)} mm</td>
                <td className={Number.isFinite(n(annual.rainDailyMax)) && n(annual.rainDailyMax) > 0 ? "rainy" : ""}>{fmt(annual.rainDailyMax, 1)} mm</td>
                <td className={Number.isFinite(n(annual.rainrate_max)) && n(annual.rainrate_max) > 0 ? "rainy" : ""}>{fmt(annual.rainrate_max, 1)} mm/h</td>
                <td className="bR">{fmtInt(annual.rainyDays)}</td>

                <td>{fmtInt(annual.rh_min_mean)} %</td>
                <td className="strong">{fmtInt(annual.rh_mean)} %</td>
                <td className="bR">{fmtInt(annual.rh_max_mean)} %</td>

                <td>{fmt(annual.wind_mean, 1)} km/h</td>
                <td>{fmt(annual.gust_mean, 1)} km/h</td>
                <td>{fmt(annual.gust_max, 1)} km/h</td>
                <td className="bR">
                  {Number.isFinite(n(annual.wind_dir_mean_deg)) ? degToCardinal16(annual.wind_dir_mean_deg) : "—"}
                  {Number.isFinite(n(annual.wind_dir_mean_deg)) ? <span style={{ opacity: 0.65 }}> ({Math.round(n(annual.wind_dir_mean_deg))}°)</span> : null}
                </td>

                <td>{fmt(annual.press_min_mean, 1)} hPa</td>
                <td className="strong">{fmt(annual.press_mean, 1)} hPa</td>
                <td className="bR">{fmt(annual.press_max_mean, 1)} hPa</td>

                <td>{fmt(annual.uv_mean, 1)}</td>
                <td className="bR">{fmt(annual.uv_max, 1)}</td>

                <td>{Number.isFinite(n(annual.solar_mean)) ? `${Math.round(n(annual.solar_mean))} W/m²` : "—"}</td>
                <td>{Number.isFinite(n(annual.solar_max)) ? `${Math.round(n(annual.solar_max))} W/m²` : "—"}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <style jsx>{`
          .wrap {
            background: transparent;
          }

          .hero {
            border: 1px solid #ececec;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.9);
            box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02), 0 12px 34px rgba(0, 0, 0, 0.04);
            padding: 22px;
          }

          .heroTop {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            align-items: flex-start;
          }

          .heroLeft {
            flex: 1;
            min-width: 0;
          }

          .kicker {
            font-size: 12px;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            opacity: 0.6;
            margin-bottom: 8px;
          }

          .year {
            margin: 0;
            font-size: 68px;
            line-height: 1;
            letter-spacing: -0.04em;
          }

          .monthsBar {
            margin-top: 18px;
            border: 1px solid #ececec;
            border-radius: 16px;
            background: #fcfcfc;
            padding: 14px 16px;
          }

          .monthsBarHead {
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #666;
            font-weight: 900;
            margin-bottom: 12px;
            text-align: center;
          }

          .monthNav {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
            gap: 10px;
            text-align: center;
          }

          .monthLink {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 8px 12px;
            border-radius: 11px;
            text-decoration: none;
            color: #111;
            font-weight: 900;
            font-size: 15px;
            line-height: 1.1;
            background: #fff;
            border: 1px solid #ececec;
            transition: background 120ms ease, transform 120ms ease, box-shadow 120ms ease;
          }

          .monthText {
            font-weight: 900;
          }

          .monthLink:hover {
            background: #f6f6f6;
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
          }

          .monthLink:focus-visible {
            outline: 2px solid #111;
            outline-offset: 2px;
          }

          .ext {
            font-size: 14px;
            opacity: 0.65;
            transform: translateY(-1px);
          }

          .summaryCompact {
            margin-top: 18px;
            border-top: 1px solid #efefef;
            padding-top: 16px;
          }

          .summaryHead {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 14px;
            margin-bottom: 14px;
          }

          .summaryHead h2 {
            margin: 0;
            font-size: 18px;
            line-height: 1.15;
            font-weight: 950;
            letter-spacing: -0.02em;
          }

          .summaryHead p {
            margin: 5px 0 0;
            font-size: 13px;
            line-height: 1.4;
            color: #666;
            font-weight: 700;
          }

          .summaryGridCompact {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
          }

          .miniCard {
            border: 1px solid #ececec;
            border-radius: 14px;
            background: #fcfcfc;
            padding: 12px 13px;
          }

          .miniTitle {
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: #666;
            font-weight: 900;
            margin-bottom: 10px;
          }

          .miniMain {
            display: grid;
            gap: 10px;
            align-items: start;
          }

          .miniMain.threeCols {
            grid-template-columns: repeat(3, 1fr);
          }

          .miniMain.twoCols {
            grid-template-columns: repeat(2, 1fr);
          }

          .miniKey {
            display: block;
            font-size: 11px;
            color: #6f6f6f;
            font-weight: 800;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
          }

          .miniMain strong {
            display: block;
            font-size: 22px;
            line-height: 1.05;
            font-weight: 950;
            letter-spacing: -0.02em;
            color: #0f172a;
          }

          .recordsAction {
            margin-top: 14px;
          }

          .toggleRecords {
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

          .toggleRecords:hover {
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(12, 25, 56, 0.08);
            background: #fbfcff;
          }

          .toggleRecords.active {
            background: #f5f8ff;
          }

          .recordsWrap {
            margin-top: 14px;
            border: 1px solid #e8ebf2;
            border-radius: 16px;
            background: #fff;
            overflow: hidden;
          }

          .recordsHead {
            padding: 12px 14px;
            background: #f8fafc;
            border-bottom: 1px solid #eceff5;
            font-weight: 900;
            letter-spacing: 0.02em;
          }

          .recordsTableWrap {
            overflow: auto;
          }

          .recordsTable {
            width: 100%;
            border-collapse: collapse;
            min-width: 900px;
          }

          .recordsTable th,
          .recordsTable td {
            padding: 11px 14px;
            border-bottom: 1px solid #f0f2f6;
            text-align: left;
            font-size: 13px;
            white-space: nowrap;
          }

          .recordsTable th {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #667085;
            background: #fff;
          }

          .recordsTable tbody tr:nth-child(even) td {
            background: #fcfcfd;
          }

          .recordName {
            font-weight: 800;
            color: #0f172a;
          }

          .dateLink {
            color: #0b1b3b;
            text-decoration: none;
            font-weight: 800;
          }

          .dateLink:hover {
            text-decoration: underline;
          }

          .charts2 {
            margin-top: 12px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          .chartBox {
            border: 1px solid #e7e7e7;
            border-radius: 16px;
            padding: 10px;
            background: rgba(255, 255, 255, 0.94);
          }

          .chartBoxWide {
            grid-column: 1 / -1;
          }

          .tableWrap {
            margin-top: 12px;
            border: 1px solid #e7e7e7;
            border-radius: 16px;
            overflow: auto;
            background: rgba(255, 255, 255, 0.94);
          }

          table {
            width: 100%;
            border-collapse: collapse;
            min-width: 1800px;
          }

          thead th {
            position: sticky;
            top: 0;
            background: #fff;
            border-bottom: 1px solid #e7e7e7;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            opacity: 0.85;
            padding: 10px 10px;
            text-align: center;
            white-space: nowrap;
            user-select: none;
          }

          .groupRow th {
            font-size: 11px;
            letter-spacing: 0.12em;
            opacity: 0.9;
            border-bottom: 0;
            padding: 12px 10px 12px;
            background: #fbfbfb;
          }

          .colRow th {
            top: 44px;
            background: #fff;
            border-top: 1px solid #efefef;
            padding-top: 12px;
          }

          .group {
            font-weight: 950;
          }

          tbody td {
            border-bottom: 1px solid #f1f1f1;
            padding: 9px 10px;
            white-space: nowrap;
            text-align: center;
            font-size: 13px;
          }

          .bR {
            border-right: 1px solid #e9e9e9;
          }

          tbody tr:hover td {
            background: #fafafa;
          }

          tbody tr:nth-child(even) td {
            background: #fcfcfc;
          }

          .sticky {
            position: sticky;
            left: 0;
            z-index: 10;
            background: #fff;
            box-shadow: 2px 0 0 #e9e9e9;
          }

          tbody tr:nth-child(even) td.sticky {
            background: #fcfcfc;
          }

          tbody tr:hover td.sticky {
            background: #fafafa;
          }

          .stickyHead {
            position: sticky;
            left: 0;
            z-index: 20;
            background: #fbfbfb;
            box-shadow: 2px 0 0 #e9e9e9;
          }

          .colRow .stickyHead {
            background: #fff;
          }

          .cellLink {
            color: #111;
            text-decoration: none;
            font-weight: 900;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            width: 100%;
            justify-content: center;
          }

          .cellText {
            font-weight: 900;
          }

          .cellLink:hover {
            text-decoration: underline;
          }

          .extCell {
            font-size: 12px;
            opacity: 0.65;
            transform: translateY(-1px);
          }

          .strong {
            font-weight: 900;
          }

          .rainy {
            font-weight: 900;
          }

          .yearRow td {
            border-top: 2px solid #e7e7e7;
            background: #fbfbfb !important;
            font-weight: 900;
          }

          .yearTag {
            display: inline-block;
            font-weight: 950;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            font-size: 12px;
            opacity: 0.85;
          }

          @media (max-width: 1100px) {
            .summaryGridCompact {
              grid-template-columns: 1fr;
            }

            .charts2 {
              grid-template-columns: 1fr;
            }

            .chartBoxWide {
              grid-column: auto;
            }
          }

          @media (max-width: 720px) {
            .miniMain.threeCols,
            .miniMain.twoCols {
              grid-template-columns: 1fr;
            }

            .monthNav {
              gap: 8px;
            }
          }

          @media (max-width: 520px) {
            .year {
              font-size: 52px;
            }

            .monthLink {
              font-size: 14px;
              padding: 7px 10px;
            }

            .miniMain strong {
              font-size: 20px;
            }
          }
        `}</style>
      </div>
    </SiteLayout>
  );
}