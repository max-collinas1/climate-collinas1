import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export async function getStaticPaths() {
  const rows = readDaily();
  const years = Array.from(new Set(rows.map((r) => String(r.date).slice(0, 4)))).sort();
  return { paths: years.map((y) => ({ params: { year: y } })), fallback: false };
}

export async function getStaticProps({ params }) {
  const rows = readDaily();
  const year = String(params.year);

  const days = rows
    .filter((r) => String(r.date).startsWith(year + "-"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const monthsInYear = Array.from(new Set(days.map((d) => String(d.date).slice(0, 7)))).sort();

  return { props: { year, days, monthsInYear } };
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

// umidità (compat)
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

// media circolare semplice
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

// -------------------- page --------------------
export default function YearOverviewPage(props) {
  const year = props.year ?? "";
  const days = Array.isArray(props.days) ? props.days : [];
  const monthsInYear = Array.isArray(props.monthsInYear) ? props.monthsInYear : [];

  const [mounted, setMounted] = useState(false);
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

      // Temperature
      const tmin_abs = minFinite(arr.map((d) => d.tmin));
      const tmax_abs = maxFinite(arr.map((d) => d.tmax));
      const tmin_mean = avgFinite(arr.map((d) => d.tmin));
      const tmean = avgFinite(arr.map((d) => d.tmean));
      const tmax_mean = avgFinite(arr.map((d) => d.tmax));

      // Pioggia
      const rainSum = sumFinite(arr.map((d) => d.rain_total));
      const rainyDays = arr.map((d) => n(d.rain_total)).filter((x) => Number.isFinite(x) && x >= 1).length;
      const rainrate_max = maxFinite(arr.map((d) => d.rainrate_max));

      // Umidità (medie + assoluti)
      const rh_min_mean = avgFinite(arr.map((d) => getRhMin(d)));
      const rh_mean = avgFinite(arr.map((d) => getRhMean(d)));
      const rh_max_mean = avgFinite(arr.map((d) => getRhMax(d)));
      const rh_min_abs = minFinite(arr.map((d) => getRhMin(d)));
      const rh_max_abs = maxFinite(arr.map((d) => getRhMax(d)));

      // Vento
      const wind_mean = avgFinite(arr.map((d) => d.wind_avg));
      const gust_mean = avgFinite(arr.map((d) => d.gust_max));
      const gust_max = maxFinite(arr.map((d) => d.gust_max));
      const wind_dir_mean_deg = circularMeanDeg(arr.map((d) => d.wind_dir_mean_deg));

      // Pressione (medie + assoluti)
      const press_min_mean = avgFinite(arr.map((d) => d.press_min));
      const press_mean = avgFinite(arr.map((d) => d.press_avg));
      const press_max_mean = avgFinite(arr.map((d) => d.press_max));
      const press_min_abs = minFinite(arr.map((d) => d.press_min));
      const press_max_abs = maxFinite(arr.map((d) => d.press_max));

      // UV/Rad (medie positive + max assoluti + media dei massimi)
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
    const ndays = days.length;

    // Temperature
    const tmin_abs = minFinite(days.map((d) => d.tmin));
    const tmax_abs = maxFinite(days.map((d) => d.tmax));
    const tmin_mean = avgFinite(days.map((d) => d.tmin));
    const tmean = avgFinite(days.map((d) => d.tmean));
    const tmax_mean = avgFinite(days.map((d) => d.tmax));

    // Pioggia
    const rainSum = sumFinite(days.map((d) => d.rain_total));
    const rainyDays = days.map((d) => n(d.rain_total)).filter((x) => Number.isFinite(x) && x >= 1).length;
    const rainrate_max = maxFinite(days.map((d) => d.rainrate_max));

    // Umidità
    const rh_min_mean = avgFinite(days.map((d) => getRhMin(d)));
    const rh_mean = avgFinite(days.map((d) => getRhMean(d)));
    const rh_max_mean = avgFinite(days.map((d) => getRhMax(d)));
    const rh_min_abs = minFinite(days.map((d) => getRhMin(d)));
    const rh_max_abs = maxFinite(days.map((d) => getRhMax(d)));

    // Vento
    const wind_mean = avgFinite(days.map((d) => d.wind_avg));
    const gust_mean = avgFinite(days.map((d) => d.gust_max));
    const gust_max = maxFinite(days.map((d) => d.gust_max));
    const wind_dir_mean_deg = circularMeanDeg(days.map((d) => d.wind_dir_mean_deg));

    // Pressione
    const press_min_mean = avgFinite(days.map((d) => d.press_min));
    const press_mean = avgFinite(days.map((d) => d.press_avg));
    const press_max_mean = avgFinite(days.map((d) => d.press_max));
    const press_min_abs = minFinite(days.map((d) => d.press_min));
    const press_max_abs = maxFinite(days.map((d) => d.press_max));

    // UV/Rad
    const uv_mean = avgFinite(days.map((d) => d.uv_mean_pos));
    const uv_max = maxFinite(days.map((d) => d.uv_max));
    const uv_max_mean = avgFinite(days.map((d) => d.uv_max));

    const solar_mean = avgFinite(days.map((d) => d.solar_mean_pos));
    const solar_max = maxFinite(days.map((d) => d.solar_max));
    const solar_max_mean = avgFinite(days.map((d) => d.solar_max));

    return {
      ndays,

      tmin_abs,
      tmean,
      tmax_abs,
      tmin_mean,
      tmax_mean,

      rainSum,
      rainyDays,
      rainrate_max,

      rh_mean,
      rh_min_mean,
      rh_max_mean,
      rh_min_abs,
      rh_max_abs,

      wind_mean,
      gust_mean,
      gust_max,
      wind_dir_mean_deg,

      press_mean,
      press_min_mean,
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
  }, [days]);

  // -------------------- charts --------------------
  const x = monthly.map((m) => monthShort(m.ym));

  const baseChart = {
    animation: false,
    grid: { left: 56, right: 44, top: 92, bottom: 46 },
    xAxis: { type: "category", data: x, axisLabel: { rotate: 0, margin: 14 } },
    title: { left: "center", top: 10 },
    legend: { top: 44, left: "center", itemGap: 16, padding: [6, 10, 10, 10] },
    toolbox: { feature: { restore: {} }, right: 10, top: 10 },
    tooltip: { trigger: "axis" },
  };

  // Temperature: Min assoluta BLU, Max assoluta ARANCIONE
  const optTemp = {
    ...baseChart,
    title: { ...baseChart.title, text: "Temperature mensili" },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`) },
    yAxis: { type: "value", name: "°C", scale: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) } },
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
      { type: "value", name: "mm", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) } },
      { type: "value", name: "mm/h", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) } },
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
          `G prec: ${Number.isFinite(gp) ? Math.round(gp) : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "Pioggia", type: "bar", data: seriesLine(rainMonthly), yAxisIndex: 0 },
      { name: "Progressivo", type: "line", data: seriesLine(rainCum), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rate max", type: "scatter", data: seriesLine(monthly.map((m) => m.rainrate_max)), yAxisIndex: 1, symbolSize: 7 },
    ],
  };

  // Umidità: aggiungo Min/Max assoluta (punti)
  const optRh = {
    ...baseChart,
    title: { ...baseChart.title, text: "Umidità" },
    yAxis: { type: "value", name: "%", min: 0, max: 100, splitNumber: 5, axisLabel: { formatter: (v) => `${Math.round(Number(v))}` } },
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
      { type: "value", name: "km/h", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => Number(v).toFixed(0) } },
      { type: "value", name: "°", min: 0, max: 360, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => `${Math.round(Number(v))}` } },
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
          `Dir media: ${Number.isFinite(dir) ? `${degToCardinal16(dir)} (${Math.round(dir)}°)` : "—"}`,
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

  // Pressione: aggiungo Min/Max assoluta (punti)
  const optPress = {
    ...baseChart,
    title: { ...baseChart.title, text: "Pressione" },
    yAxis: { type: "value", name: "hPa", scale: true, splitNumber: 5, axisLabel: { formatter: (v) => Number(v).toFixed(0) } },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`) },
    series: [
      { name: "Min media", type: "line", data: seriesLine(monthly.map((m) => m.press_min_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Media", type: "line", data: seriesLine(monthly.map((m) => m.press_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Max media", type: "line", data: seriesLine(monthly.map((m) => m.press_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Min assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.press_min_abs)), symbolSize: 7 },
      { name: "Max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.press_max_abs)), symbolSize: 7 },
    ],
  };

  // ✅ QUI LA MODIFICA: più spazio sopra per evitare sovrapposizione legenda/grafico
  const optUvRad = {
    ...baseChart,
    grid: { ...baseChart.grid, top: 120 }, // <-- prima era 92
    legend: { ...baseChart.legend, top: 34 }, // <-- prima era 44
    title: { ...baseChart.title, text: "UV e Radiazione" },
    yAxis: [
      { type: "value", name: "UV", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) } },
      { type: "value", name: "W/m²", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => String(Math.round(Number(v))) } },
    ],
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const i = params?.[0]?.dataIndex ?? 0;
        const mm = x[i] ?? "—";
        const uvM = n(monthly[i]?.uv_mean);
        const uvX = n(monthly[i]?.uv_max);
        const uvXmean = n(monthly[i]?.uv_max_mean);
        const solM = n(monthly[i]?.solar_mean);
        const solX = n(monthly[i]?.solar_max);
        const solXmean = n(monthly[i]?.solar_max_mean);
        return [
          `<b>${mm}</b>`,
          `UV medio: ${Number.isFinite(uvM) ? uvM.toFixed(1) : "—"}`,
          `UV max medio: ${Number.isFinite(uvXmean) ? uvXmean.toFixed(1) : "—"}`,
          `UV max (ass): ${Number.isFinite(uvX) ? uvX.toFixed(1) : "—"}`,
          `Rad media: ${Number.isFinite(solM) ? Math.round(solM) + " W/m²" : "—"}`,
          `Rad max media: ${Number.isFinite(solXmean) ? Math.round(solXmean) + " W/m²" : "—"}`,
          `Rad max (ass): ${Number.isFinite(solX) ? Math.round(solX) + " W/m²" : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "UV medio", type: "line", data: seriesLine(monthly.map((m) => m.uv_mean)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "UV max medio", type: "line", data: seriesLine(monthly.map((m) => m.uv_max_mean)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "UV max", type: "scatter", data: seriesLine(monthly.map((m) => m.uv_max)), yAxisIndex: 0, symbolSize: 7 },

      { name: "Rad media", type: "line", data: seriesLine(monthly.map((m) => m.solar_mean)), yAxisIndex: 1, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rad max media", type: "line", data: seriesLine(monthly.map((m) => m.solar_max_mean)), yAxisIndex: 1, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rad max", type: "scatter", data: seriesLine(monthly.map((m) => m.solar_max)), yAxisIndex: 1, symbolSize: 7 },
    ],
  };

  const dirTxt = Number.isFinite(n(annual.wind_dir_mean_deg)) ? degToCardinal16(annual.wind_dir_mean_deg) : "—";
  const dirDeg = n(annual.wind_dir_mean_deg);

  return (
    <div className="wrap">
      <div className="topbar">
        <Link className="back" href="/">
          ← Home
        </Link>
        <div className="brand">
          <div className="brandTitle">Archivio Meteo</div>
          <div className="brandSub">Collinas • riepilogo annuale • {year}</div>
        </div>
      </div>

      <header className="hero">
        <div className="heroTop">
          <div className="heroLeft">
            <div className="kicker">Anno</div>
            <h1 className="year">{year}</h1>
          </div>

          <div className="heroRight">
            <div className="dirBox">
              <div className="dirLabel">Direzione media</div>
              <div className="dirValue">
                {dirTxt} {Number.isFinite(dirDeg) ? <span className="dirDeg">({Math.round(dirDeg)}°)</span> : null}
              </div>
            </div>
          </div>
        </div>

        <nav className="monthNav" aria-label="Vai al mese">
          {monthsInYear.map((ym) => {
            const mm = monthNum(ym);
            return (
              <Link key={ym} href={`/mesi/${year}/${mm}`} className="monthLink" title={`Apri ${monthFull(ym)}`} aria-label={`Apri ${monthFull(ym)}`}>
                <span className="ext" aria-hidden="true">
                  ↗
                </span>
                <span className="monthText">{monthFull(ym)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="kpi4">
          <div className="kCard">
            <div className="kLabel">Giorni</div>
            <div className="kValue">{fmtInt(annual.ndays)}</div>
            <div className="kMeta">dati presenti</div>
          </div>

          <div className="kCard">
            <div className="kLabel">Pioggia</div>
            <div className="kValue">{fmt(annual.rainSum, 1)} mm</div>
            <div className="kMeta">
              G prec: <b>{fmtInt(annual.rainyDays)}</b> • Rate max: <b>{fmt(annual.rainrate_max, 1)} mm/h</b>
            </div>
          </div>

          <div className="kCard">
            <div className="kLabel">Temperatura media</div>
            <div className="kValue">{fmt(annual.tmean, 1)} °C</div>
            <div className="kMeta">
              Min ass: <b>{fmt(annual.tmin_abs, 1)}°</b> • Max ass: <b>{fmt(annual.tmax_abs, 1)}°</b>
            </div>
          </div>

          <div className="kCard">
            <div className="kLabel">Vento medio</div>
            <div className="kValue">{fmt(annual.wind_mean, 1)} km/h</div>
            <div className="kMeta">
              Raffica media: <b>{fmt(annual.gust_mean, 1)}</b> • Raffica max: <b>{fmt(annual.gust_max, 1)}</b>
            </div>
          </div>
        </div>

        <details className="details">
          <summary>Mostra dettagli (umidità, pressione, UV/radiazione)</summary>
          <div className="detailsGrid">
            <div className="dCard">
              <div className="dTitle">Umidità</div>
              <div className="dBig">{fmtInt(annual.rh_mean)} %</div>
              <div className="dMeta">
                Min media: <b>{fmtInt(annual.rh_min_mean)}%</b> • Max media: <b>{fmtInt(annual.rh_max_mean)}%</b>
              </div>
              <div className="dMeta">
                Min ass: <b>{fmtInt(annual.rh_min_abs)}%</b> • Max ass: <b>{fmtInt(annual.rh_max_abs)}%</b>
              </div>
            </div>

            <div className="dCard">
              <div className="dTitle">Pressione</div>
              <div className="dBig">{fmt(annual.press_mean, 1)} hPa</div>
              <div className="dMeta">
                Min media: <b>{fmt(annual.press_min_mean, 1)}</b> • Max media: <b>{fmt(annual.press_max_mean, 1)}</b>
              </div>
              <div className="dMeta">
                Min ass: <b>{fmt(annual.press_min_abs, 1)}</b> • Max ass: <b>{fmt(annual.press_max_abs, 1)}</b>
              </div>
            </div>

            <div className="dCard">
              <div className="dTitle">UV / Radiazione</div>
              <div className="dMeta">
                UV medio: <b>{fmt(annual.uv_mean, 1)}</b> • UV max medio: <b>{fmt(annual.uv_max_mean, 1)}</b> • UV max: <b>{fmt(annual.uv_max, 1)}</b>
              </div>
              <div className="dMeta">
                Rad media: <b>{Number.isFinite(n(annual.solar_mean)) ? `${Math.round(n(annual.solar_mean))} W/m²` : "—"}</b> • Rad max media:{" "}
                <b>{Number.isFinite(n(annual.solar_max_mean)) ? `${Math.round(n(annual.solar_max_mean))} W/m²` : "—"}</b> • Rad max:{" "}
                <b>{Number.isFinite(n(annual.solar_max)) ? `${Math.round(n(annual.solar_max))} W/m²` : "—"}</b>
              </div>
            </div>
          </div>
        </details>
      </header>

      {mounted && (
        <section className="charts2">
          <div className="chartBox">
            <ReactECharts option={optTemp} style={{ height: 300, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optRain} style={{ height: 300, width: "100%" }} />
          </div>

          <div className="chartBox">
            <ReactECharts option={optRh} style={{ height: 300, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optWind} style={{ height: 300, width: "100%" }} />
          </div>

          <div className="chartBox">
            <ReactECharts option={optPress} style={{ height: 300, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optUvRad} style={{ height: 300, width: "100%" }} />
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
              <th className="group temp bR" colSpan={3}>
                Temperature
              </th>
              <th className="group rain bR" colSpan={3}>
                Precipitazioni
              </th>
              <th className="group hum bR" colSpan={3}>
                Umidità
              </th>
              <th className="group wind bR" colSpan={4}>
                Vento
              </th>
              <th className="group press bR" colSpan={3}>
                Pressione
              </th>
              <th className="group rad" colSpan={4}>
                Rad/UV
              </th>
            </tr>

            <tr className="colRow">
              <th className="bR stickyHead"> </th>

              <th>Min media</th>
              <th>Media</th>
              <th className="bR">Max media</th>

              <th>Pioggia</th>
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
              <th>UV max</th>
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
                  <td>{fmt(m.uv_max, 1)}</td>
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
              <td>{fmt(annual.uv_max, 1)}</td>
              <td>{Number.isFinite(n(annual.solar_mean)) ? `${Math.round(n(annual.solar_mean))} W/m²` : "—"}</td>
              <td>{Number.isFinite(n(annual.solar_max)) ? `${Math.round(n(annual.solar_max))} W/m²` : "—"}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <style jsx>{`
        :global(body) {
          background: #fff;
        }

        .wrap {
          max-width: 1280px;
          margin: 0 auto;
          padding: 18px 10px 50px;
          background: #fff;
        }

        .topbar {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 14px;
        }
        .back {
          text-decoration: none;
          color: #111;
          opacity: 0.75;
          white-space: nowrap;
        }
        .back:hover {
          opacity: 1;
        }
        .brandTitle {
          font-weight: 800;
          letter-spacing: 0.02em;
        }
        .brandSub {
          font-size: 12px;
          opacity: 0.7;
          margin-top: 2px;
        }

        .hero {
          border: 1px solid #ececec;
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02), 0 12px 34px rgba(0, 0, 0, 0.04);
          padding: 18px;
        }

        .heroTop {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: flex-start;
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
          font-size: 56px;
          line-height: 1;
          letter-spacing: -0.03em;
        }

        .monthNav {
          margin-top: 10px;
          width: 100%;
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          align-items: center;
          gap: 10px;
          text-align: center;
        }

        .monthLink {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 10px;
          text-decoration: none;
          color: #111;
          font-weight: 900;
          font-size: 16px;
          line-height: 1.1;
          transition: background 120ms ease, transform 120ms ease, box-shadow 120ms ease;
        }
        .monthText {
          font-weight: 900;
        }
        .monthLink:hover {
          background: #f4f4f4;
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

        .heroLeft {
          flex: 1;
          min-width: 0;
        }

        .heroRight {
          flex: 0 0 auto;
        }

        .dirBox {
          border: 1px solid #ededed;
          border-radius: 14px;
          padding: 12px 14px;
          background: #fbfbfb;
          min-width: 190px;
        }
        .dirLabel {
          font-size: 12px;
          opacity: 0.65;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .dirValue {
          margin-top: 8px;
          font-weight: 950;
          font-size: 22px;
          letter-spacing: -0.01em;
        }
        .dirDeg {
          margin-left: 8px;
          font-size: 13px;
          opacity: 0.65;
          font-weight: 700;
        }

        .kpi4 {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
        }
        .kCard {
          border: 1px solid #ededed;
          border-radius: 14px;
          padding: 12px 12px 10px;
          background: #fff;
        }
        .kLabel {
          font-size: 12px;
          opacity: 0.65;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .kValue {
          margin-top: 8px;
          font-weight: 950;
          font-size: 26px;
          letter-spacing: -0.02em;
        }
        .kMeta {
          margin-top: 8px;
          font-size: 12px;
          opacity: 0.74;
          line-height: 1.35;
        }
        .kMeta b {
          font-weight: 900;
          opacity: 0.95;
        }

        .details {
          margin-top: 12px;
          border-top: 1px solid #efefef;
          padding-top: 10px;
        }
        .details summary {
          cursor: pointer;
          font-weight: 900;
          font-size: 13px;
          opacity: 0.85;
          user-select: none;
        }
        .detailsGrid {
          margin-top: 10px;
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px;
        }
        .dCard {
          border: 1px solid #ededed;
          border-radius: 14px;
          padding: 12px;
          background: #fff;
        }
        .dTitle {
          font-size: 12px;
          opacity: 0.65;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-weight: 900;
        }
        .dBig {
          margin-top: 8px;
          font-weight: 950;
          font-size: 22px;
          letter-spacing: -0.02em;
        }
        .dMeta {
          margin-top: 8px;
          font-size: 12px;
          opacity: 0.76;
          line-height: 1.35;
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
          background: #fff;
        }

        .tableWrap {
          margin-top: 12px;
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          overflow: auto;
          background: #fff;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          min-width: 1620px;
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
          .heroTop {
            flex-direction: column;
          }
          .kpi4 {
            grid-template-columns: 1fr 1fr;
          }
          .detailsGrid {
            grid-template-columns: 1fr;
          }
          .charts2 {
            grid-template-columns: 1fr;
          }
          .dirBox {
            min-width: auto;
            width: fit-content;
          }
        }

        @media (max-width: 520px) {
          .kpi4 {
            grid-template-columns: 1fr;
          }
          .year {
            font-size: 48px;
          }
          .monthLink {
            font-size: 14px;
            padding: 6px 8px;
          }
        }
      `}</style>
    </div>
  );
}