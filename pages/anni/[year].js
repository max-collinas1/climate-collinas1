// pages/anni/[year].js
import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// -------------------- data load --------------------
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

  return { props: { year, days } };
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

const MONTHS_ABBR_IT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
function monthAbbrFromYm(ym) {
  const mm = Number(String(ym).slice(5, 7));
  return MONTHS_ABBR_IT[mm - 1] || ym;
}
const MONTHS_IT = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
function monthFullFromYm(ym) {
  const mm = Number(String(ym).slice(5, 7));
  return MONTHS_IT[mm - 1] || ym;
}

function degToCardinal16(v) {
  const n0 = Number(v);
  if (!Number.isFinite(n0)) return "—";
  const d = ((n0 % 360) + 360) % 360;
  const ix = Math.round(d / 22.5) % 16;
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][ix];
}
function circularMeanDeg(degs) {
  const vals = (degs || []).map(n).filter(Number.isFinite);
  if (!vals.length) return NaN;

  let sx = 0;
  let sy = 0;
  for (const d of vals) {
    const r = (d * Math.PI) / 180;
    sx += Math.cos(r);
    sy += Math.sin(r);
  }
  const meanR = Math.atan2(sy / vals.length, sx / vals.length);
  let out = (meanR * 180) / Math.PI;
  if (out < 0) out += 360;
  return out;
}

// umidità (compatibile con daily.json)
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

// -------------------- page --------------------
export default function YearOverviewPage({ year, days }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // mesi presenti
  const months = useMemo(() => {
    const set = new Set((days || []).map((d) => String(d.date).slice(0, 7)));
    return Array.from(set).sort();
  }, [days]);

  // raggruppo per mese
  const byMonth = useMemo(() => {
    const m = new Map();
    for (const d of days || []) {
      const ym = String(d.date).slice(0, 7);
      if (!m.has(ym)) m.set(ym, []);
      m.get(ym).push(d);
    }
    return m;
  }, [days]);

  // -------------------- monthly aggregates --------------------
  const monthly = useMemo(() => {
    return months.map((ym) => {
      const arr = byMonth.get(ym) || [];

      const tmin_abs = minFinite(arr.map((d) => d.tmin));
      const tmax_abs = maxFinite(arr.map((d) => d.tmax));
      const tmin_mean = avgFinite(arr.map((d) => d.tmin));
      const tmax_mean = avgFinite(arr.map((d) => d.tmax));
      const tmean = avgFinite(arr.map((d) => d.tmean));

      const rainSum = sumFinite(arr.map((d) => d.rain_total));
      const rainrate_max = maxFinite(arr.map((d) => d.rainrate_max));
      const rainyDays = arr.map((d) => n(d.rain_total)).filter((x) => Number.isFinite(x) && x >= 1).length;

      const rh_min_abs = minFinite(arr.map((d) => getRhMin(d)));
      const rh_max_abs = maxFinite(arr.map((d) => getRhMax(d)));
      const rh_min_mean = avgFinite(arr.map((d) => getRhMin(d)));
      const rh_max_mean = avgFinite(arr.map((d) => getRhMax(d)));
      const rh_mean = avgFinite(arr.map((d) => getRhMean(d)));

      const wind_mean = avgFinite(arr.map((d) => d.wind_avg));
      const gust_mean = avgFinite(arr.map((d) => d.gust_max));
      const gust_max = maxFinite(arr.map((d) => d.gust_max));
      const wind_dir_mean_deg = circularMeanDeg(arr.map((d) => d.wind_dir_mean_deg));

      const press_min_abs = minFinite(arr.map((d) => d.press_min));
      const press_max_abs = maxFinite(arr.map((d) => d.press_max));
      const press_min_mean = avgFinite(arr.map((d) => d.press_min));
      const press_max_mean = avgFinite(arr.map((d) => d.press_max));
      const press_mean = avgFinite(arr.map((d) => d.press_avg));

      const uv_mean = avgFinite(arr.map((d) => d.uv_mean_pos));
      const uv_max_mean = avgFinite(arr.map((d) => d.uv_max));
      const solar_mean = avgFinite(arr.map((d) => d.solar_mean_pos));
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

        rh_min_abs,
        rh_max_abs,
        rh_min_mean,
        rh_mean,
        rh_max_mean,

        wind_mean,
        gust_mean,
        gust_max,
        wind_dir_mean_deg,

        press_min_abs,
        press_max_abs,
        press_min_mean,
        press_mean,
        press_max_mean,

        uv_mean,
        uv_max_mean,
        solar_mean,
        solar_max_mean,
      };
    });
  }, [months, byMonth]);

  // -------------------- annual summary (migliorato) --------------------
  const annual = useMemo(() => {
    const tmin_abs = minFinite(days.map((d) => d.tmin));
    const tmax_abs = maxFinite(days.map((d) => d.tmax));
    const tmin_mean = avgFinite(days.map((d) => d.tmin));
    const tmax_mean = avgFinite(days.map((d) => d.tmax));
    const tmean = avgFinite(days.map((d) => d.tmean));

    const rainSum = sumFinite(days.map((d) => d.rain_total));
    const rainyDays = days.map((d) => n(d.rain_total)).filter((x) => Number.isFinite(x) && x >= 1).length;

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

    return {
      ndays: days.length,
      rainSum,
      rainyDays,

      tmin_abs,
      tmax_abs,
      tmin_mean,
      tmean,
      tmax_mean,

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
    };
  }, [days]);

  // -------------------- charts base --------------------
  const xLabels = monthly.map((m) => monthAbbrFromYm(m.ym));

  const baseChart = {
    animation: false,
    grid: { left: 52, right: 40, top: 72, bottom: 44 },
    xAxis: { type: "category", data: xLabels, boundaryGap: true, axisLabel: { rotate: 0, interval: 0 } },
    toolbox: { feature: { restore: {} }, right: 10, top: 8 },
    title: { left: "center", top: 6 },
    legend: { top: 34, left: "center" },
    tooltip: { trigger: "axis" },
  };

  const C_MIN = "#4aa3ff";
  const C_MED = "#2f2f2f";
  const C_MAX = "#f59e0b";

  // -------------------- charts --------------------
  const optTemp = {
    ...baseChart,
    title: { ...baseChart.title, text: "Temperature mensili" },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`) },
    yAxis: { type: "value", name: "°C", scale: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) } },
    series: [
      { name: "Min media", type: "line", data: seriesLine(monthly.map((m) => m.tmin_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: C_MIN }, itemStyle: { color: C_MIN } },
      { name: "Media", type: "line", data: seriesLine(monthly.map((m) => m.tmean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: C_MED }, itemStyle: { color: C_MED } },
      { name: "Max media", type: "line", data: seriesLine(monthly.map((m) => m.tmax_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: C_MAX }, itemStyle: { color: C_MAX } },
      { name: "Min Assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.tmin_abs)), symbolSize: 8, itemStyle: { color: C_MIN } },
      { name: "Max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.tmax_abs)), symbolSize: 8, itemStyle: { color: C_MAX } },
    ],
  };

  const rainMonthly = monthly.map((m) => m.rainSum);
  const rainCum = cumulative(rainMonthly);

  const optRain = {
    ...baseChart,
    title: { ...baseChart.title, text: "Precipitazioni mensili" },
    yAxis: [
      { type: "value", name: "mm", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) } },
      { type: "value", name: "mm/h", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) } },
    ],
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const i = params?.[0]?.dataIndex ?? 0;
        const m = monthly[i];
        const acc = n(m?.rainSum);
        const cum = n(rainCum[i]);
        const rr = n(m?.rainrate_max);
        return [
          `<b>${monthFullFromYm(m?.ym || "")}</b>`,
          `Accumulo: ${Number.isFinite(acc) ? acc.toFixed(1) + " mm" : "—"}`,
          `Progressivo: ${Number.isFinite(cum) ? cum.toFixed(1) + " mm" : "—"}`,
          `Rain rate max: ${Number.isFinite(rr) ? rr.toFixed(1) + " mm/h" : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "Accumulo", type: "bar", data: seriesLine(rainMonthly), yAxisIndex: 0 },
      { name: "Progressivo", type: "line", data: seriesLine(rainCum), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rain rate max", type: "scatter", data: seriesLine(monthly.map((m) => m.rainrate_max)), yAxisIndex: 1, symbolSize: 8 },
    ],
  };

  const optRh = {
    ...baseChart,
    title: { ...baseChart.title, text: "Umidità mensile" },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`) },
    yAxis: { type: "value", name: "%", min: 0, max: 100, splitNumber: 5, axisLabel: { formatter: (v) => `${Math.round(Number(v))}` } },
    series: [
      { name: "Min media", type: "line", data: seriesLine(monthly.map((m) => m.rh_min_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: C_MIN }, itemStyle: { color: C_MIN } },
      { name: "Media", type: "line", data: seriesLine(monthly.map((m) => m.rh_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: C_MED }, itemStyle: { color: C_MED } },
      { name: "Max media", type: "line", data: seriesLine(monthly.map((m) => m.rh_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: C_MAX }, itemStyle: { color: C_MAX } },
      { name: "Min Assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.rh_min_abs)), symbolSize: 8, itemStyle: { color: C_MIN } },
      { name: "Max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.rh_max_abs)), symbolSize: 8, itemStyle: { color: C_MAX } },
    ],
  };

  const optWind = {
    ...baseChart,
    title: { ...baseChart.title, text: "Vento mensile" },
    yAxis: [
      { type: "value", name: "km/h", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => Number(v).toFixed(0) } },
      { type: "value", name: "°", min: 0, max: 360, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => `${Math.round(Number(v))}` } },
    ],
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const i = params?.[0]?.dataIndex ?? 0;
        const m = monthly[i];
        const w = n(m?.wind_mean);
        const g = n(m?.gust_mean);
        const dir = n(m?.wind_dir_mean_deg);
        return [
          `<b>${monthFullFromYm(m?.ym || "")}</b>`,
          `Vento medio (mensile): ${Number.isFinite(w) ? w.toFixed(1) + " km/h" : "—"}`,
          `Raffica media (mensile): ${Number.isFinite(g) ? g.toFixed(1) + " km/h" : "—"}`,
          `Direzione media: ${Number.isFinite(dir) ? `${degToCardinal16(dir)} (${Math.round(dir)}°)` : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "Vento medio", type: "line", data: seriesLine(monthly.map((m) => m.wind_mean)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Raffica media", type: "line", data: seriesLine(monthly.map((m) => m.gust_mean)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Direzione media", type: "scatter", data: seriesLine(monthly.map((m) => m.wind_dir_mean_deg)), yAxisIndex: 1, symbolSize: 8 },
    ],
  };

  const optPress = {
    ...baseChart,
    title: { ...baseChart.title, text: "Pressione mensile" },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`) },
    yAxis: { type: "value", name: "hPa", scale: true, splitNumber: 5, axisLabel: { formatter: (v) => Number(v).toFixed(0) } },
    series: [
      { name: "Min media", type: "line", data: seriesLine(monthly.map((m) => m.press_min_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: C_MIN }, itemStyle: { color: C_MIN } },
      { name: "Media", type: "line", data: seriesLine(monthly.map((m) => m.press_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: C_MED }, itemStyle: { color: C_MED } },
      { name: "Max media", type: "line", data: seriesLine(monthly.map((m) => m.press_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: C_MAX }, itemStyle: { color: C_MAX } },
      { name: "Min Assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.press_min_abs)), symbolSize: 8, itemStyle: { color: C_MIN } },
      { name: "Max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.press_max_abs)), symbolSize: 8, itemStyle: { color: C_MAX } },
    ],
  };

  const optUvRad = {
    ...baseChart,
    title: { ...baseChart.title, text: "UV e Radiazione mensili" },
    yAxis: [
      { type: "value", name: "UV", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) } },
      { type: "value", name: "W/m²", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => String(Math.round(Number(v))) } },
    ],
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const i = params?.[0]?.dataIndex ?? 0;
        const m = monthly[i];
        const uvM = n(m?.uv_mean);
        const uvX = n(m?.uv_max_mean);
        const solM = n(m?.solar_mean);
        const solX = n(m?.solar_max_mean);
        return [
          `<b>${monthFullFromYm(m?.ym || "")}</b>`,
          `UV medio: ${Number.isFinite(uvM) ? uvM.toFixed(1) : "—"}`,
          `UV max medio: ${Number.isFinite(uvX) ? uvX.toFixed(1) : "—"}`,
          `Rad media: ${Number.isFinite(solM) ? Math.round(solM) + " W/m²" : "—"}`,
          `Rad max media: ${Number.isFinite(solX) ? Math.round(solX) + " W/m²" : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "UV medio", type: "line", data: seriesLine(monthly.map((m) => m.uv_mean)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "UV max medio", type: "line", data: seriesLine(monthly.map((m) => m.uv_max_mean)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rad media", type: "line", data: seriesLine(monthly.map((m) => m.solar_mean)), yAxisIndex: 1, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rad max media", type: "line", data: seriesLine(monthly.map((m) => m.solar_max_mean)), yAxisIndex: 1, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
    ],
  };

  // -------------------- NEW: riepilogo top “migliore” --------------------
  const dirTxtAnnual = useMemo(() => {
    const d = n(annual.wind_dir_mean_deg);
    return Number.isFinite(d) ? `${degToCardinal16(d)} (${Math.round(d)}°)` : "—";
  }, [annual.wind_dir_mean_deg]);

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
        <div className="heroLeft">
          <div className="kicker">Anno</div>
          <h1>{year}</h1>

          <div className="chips">
            <div className="chip">
              <span className="chipK">Giorni</span>
              <span className="chipV">{annual.ndays}</span>
            </div>
            <div className="chip">
              <span className="chipK">Pioggia</span>
              <span className="chipV">{fmt(annual.rainSum, 1)} mm</span>
            </div>
            <div className="chip">
              <span className="chipK">G prec.</span>
              <span className="chipV">{annual.rainyDays}</span>
            </div>
            <div className="chip">
              <span className="chipK">Dir media</span>
              <span className="chipV">{dirTxtAnnual}</span>
            </div>
          </div>

          <div className="note">
            Tmin/Tmax: <b>assolute</b> dell’anno. Linee mensili: <b>medie</b> dei valori giornalieri.
          </div>
        </div>

        <div className="cards">
          <div className="card big">
            <div className="label">Temperature</div>
            <div className="row3">
              <div className="mini">
                <div className="k">Tmin ass.</div>
                <div className="v">{fmt(annual.tmin_abs, 1)} °C</div>
              </div>
              <div className="mini">
                <div className="k">T media</div>
                <div className="v">{fmt(annual.tmean, 1)} °C</div>
              </div>
              <div className="mini">
                <div className="k">Tmax ass.</div>
                <div className="v">{fmt(annual.tmax_abs, 1)} °C</div>
              </div>
            </div>
            <div className="subrow">
              <span>Min media: {fmt(annual.tmin_mean, 1)} °C</span>
              <span>Max media: {fmt(annual.tmax_mean, 1)} °C</span>
            </div>
          </div>

          <div className="card">
            <div className="label">Umidità</div>
            <div className="value">{fmtInt(annual.rh_mean)} %</div>
            <div className="subrow">
              <span>Min media: {fmtInt(annual.rh_min_mean)} %</span>
              <span>Max media: {fmtInt(annual.rh_max_mean)} %</span>
            </div>
          </div>

          <div className="card">
            <div className="label">Vento</div>
            <div className="value">{fmt(annual.wind_mean, 1)} km/h</div>
            <div className="subrow">
              <span>Raffica media: {fmt(annual.gust_mean, 1)} km/h</span>
              <span>Raffica max: {fmt(annual.gust_max, 1)} km/h</span>
            </div>
          </div>

          <div className="card">
            <div className="label">Pressione</div>
            <div className="value">{fmt(annual.press_mean, 1)} hPa</div>
            <div className="subrow">
              <span>Min media: {fmt(annual.press_min_mean, 1)} hPa</span>
              <span>Max media: {fmt(annual.press_max_mean, 1)} hPa</span>
            </div>
          </div>
        </div>
      </header>

      {mounted && (
        <section className="charts">
          <div className="chartBox">
            <ReactECharts option={optTemp} style={{ height: 320, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optRain} style={{ height: 320, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optRh} style={{ height: 320, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optWind} style={{ height: 320, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optPress} style={{ height: 320, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optUvRad} style={{ height: 320, width: "100%" }} />
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
              <th className="group wind bR" colSpan={3}>
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
              <th className="bR stickyHead">{"\u00A0"}</th>

              <th>Min media</th>
              <th className="strongHead">Media</th>
              <th className="bR">Max media</th>

              <th>Pioggia</th>
              <th>Rate max</th>
              <th className="bR">G prec.</th>

              <th>Min media</th>
              <th className="strongHead">Media</th>
              <th className="bR">Max media</th>

              <th>Medio</th>
              <th>Raffica media</th>
              <th className="bR">Dir media</th>

              <th>Min media</th>
              <th className="strongHead">Media</th>
              <th className="bR">Max media</th>

              <th>UV medio</th>
              <th>UV max medio</th>
              <th>Rad media</th>
              <th>Rad max media</th>
            </tr>
          </thead>

          <tbody>
            {monthly.map((m) => {
              const mm = String(m.ym).slice(5, 7);
              const rs = n(m.rainSum);
              const dirDeg = n(m.wind_dir_mean_deg);
              const dirTxt = Number.isFinite(dirDeg) ? degToCardinal16(dirDeg) : "—";

              return (
                <tr key={m.ym}>
                  <td className="month sticky bR">
                    <Link href={`/mesi/${year}/${mm}`}>{monthFullFromYm(m.ym)}</Link>
                  </td>

                  <td>{fmt(m.tmin_mean, 1)} °C</td>
                  <td className="strong">{fmt(m.tmean, 1)} °C</td>
                  <td className="bR">{fmt(m.tmax_mean, 1)} °C</td>

                  <td className={Number.isFinite(rs) && rs > 0 ? "rainy" : ""}>{fmt(m.rainSum, 1)} mm</td>
                  <td className={`strong ${n(m.rainrate_max) > 0 ? "rainy" : ""}`}>{fmt(m.rainrate_max, 1)} mm/h</td>
                  <td className="bR">{fmtInt(m.rainyDays)}</td>

                  <td>{Number.isFinite(n(m.rh_min_mean)) ? `${Math.round(n(m.rh_min_mean))} %` : "—"}</td>
                  <td className="strong">{Number.isFinite(n(m.rh_mean)) ? `${Math.round(n(m.rh_mean))} %` : "—"}</td>
                  <td className="bR">{Number.isFinite(n(m.rh_max_mean)) ? `${Math.round(n(m.rh_max_mean))} %` : "—"}</td>

                  <td>{fmt(m.wind_mean, 1)} km/h</td>
                  <td>{fmt(m.gust_mean, 1)} km/h</td>
                  <td className="bR">
                    {dirTxt}
                    {Number.isFinite(dirDeg) ? <span style={{ opacity: 0.65 }}> ({Math.round(dirDeg)}°)</span> : null}
                  </td>

                  <td>{fmt(m.press_min_mean, 1)} hPa</td>
                  <td className="strong">{fmt(m.press_mean, 1)} hPa</td>
                  <td className="bR">{fmt(m.press_max_mean, 1)} hPa</td>

                  <td>{fmt(m.uv_mean, 1)}</td>
                  <td>{fmt(m.uv_max_mean, 1)}</td>
                  <td>{Number.isFinite(n(m.solar_mean)) ? `${Math.round(n(m.solar_mean))} W/m²` : "—"}</td>
                  <td>{Number.isFinite(n(m.solar_max_mean)) ? `${Math.round(n(m.solar_max_mean))} W/m²` : "—"}</td>
                </tr>
              );
            })}

            {!monthly.length && (
              <tr>
                <td colSpan={20} className="empty">
                  Nessun dato per l’anno selezionato.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <style jsx>{`
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

        /* ---- HERO migliorato ---- */
        .hero {
          display: grid;
          grid-template-columns: 1.05fr 1.2fr;
          gap: 14px;
          padding: 18px;
          border: 1px solid #e7e7e7;
          border-radius: 18px;
          background: linear-gradient(180deg, #fff, #fbfbfb);
        }
        .kicker {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          opacity: 0.65;
          margin-bottom: 6px;
        }
        h1 {
          margin: 0;
          font-size: 48px;
          line-height: 1.0;
        }

        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .chip {
          border: 1px solid #e7e7e7;
          background: #fff;
          border-radius: 999px;
          padding: 8px 10px;
          display: inline-flex;
          align-items: baseline;
          gap: 8px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
        }
        .chipK {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          opacity: 0.65;
        }
        .chipV {
          font-weight: 900;
        }
        .note {
          margin-top: 10px;
          font-size: 12px;
          opacity: 0.7;
          line-height: 1.35;
        }

        .cards {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
        }
        .card {
          border: 1px solid #ededed;
          border-radius: 16px;
          padding: 12px;
          background: #fff;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
        }
        .card.big {
          grid-column: span 2;
          padding: 14px;
          border-color: #e6e6e6;
        }
        .label {
          font-size: 12px;
          opacity: 0.7;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .value {
          font-size: 26px;
          margin-top: 6px;
          font-weight: 900;
          line-height: 1.1;
        }

        .row3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          margin-top: 10px;
        }
        .mini {
          border: 1px solid #f0f0f0;
          border-radius: 14px;
          padding: 10px;
          background: #fcfcfc;
        }
        .mini .k {
          font-size: 11px;
          opacity: 0.7;
        }
        .mini .v {
          font-size: 22px;
          font-weight: 950;
          margin-top: 6px;
        }

        .subrow {
          margin-top: 10px;
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 12px;
          opacity: 0.75;
        }
        .subrow span {
          border: 1px solid #f0f0f0;
          background: #fff;
          padding: 6px 8px;
          border-radius: 999px;
        }

        .charts {
          margin-top: 12px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .chartBox {
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          padding: 8px;
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
        .month a {
          color: #111;
          text-decoration: none;
          font-weight: 900;
          display: inline-block;
          width: 100%;
          text-align: left;
        }
        .month a:hover {
          text-decoration: underline;
        }
        .strong {
          font-weight: 900;
        }
        .strongHead {
          font-weight: 950;
        }
        .rainy {
          font-weight: 900;
        }
        .empty {
          padding: 18px 10px;
          opacity: 0.7;
          text-align: center;
          font-size: 13px;
        }

        @media (max-width: 980px) {
          .hero {
            grid-template-columns: 1fr;
          }
          .charts {
            grid-template-columns: 1fr;
          }
          .cards {
            grid-template-columns: 1fr;
          }
          .card.big {
            grid-column: span 1;
          }
        }
      `}</style>
    </div>
  );
}