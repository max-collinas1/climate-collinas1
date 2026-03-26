import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import SiteLayout from "../../components/SiteLayout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// -------------------- data load --------------------
function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readIntraday(date) {
  const filePath = path.join(process.cwd(), "public", "data", "intraday", `${date}.json`);
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export async function getStaticPaths() {
  const rows = readDaily();
  return { paths: rows.map((r) => ({ params: { date: r.date } })), fallback: false };
}

export async function getStaticProps({ params }) {
  const rows = readDaily().sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));
  const ix = rows.findIndex((r) => r.date === params.date);
  const day = ix >= 0 ? rows[ix] : null;

  const prev = ix > 0 ? rows[ix - 1]?.date ?? null : null;
  const next = ix >= 0 && ix < rows.length - 1 ? rows[ix + 1]?.date ?? null : null;

  const intraday = readIntraday(params.date);

  const mmdd = String(params?.date || "").slice(5, 10);
  const sameDay = rows
    .filter((r) => String(r?.date || "").slice(5, 10) === mmdd)
    .map((r) => String(r.date))
    .sort();

  const compareOptions = sameDay.map((d) => ({ year: d.slice(0, 4), date: d }));

  return { props: { day, intraday, prev, next, compareOptions } };
}

// -------------------- helpers --------------------
function toNull(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "string" && x.trim() === "") return null;
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function n(x) {
  if (x === null || x === undefined || x === "") return NaN;
  const v = Number(String(x).replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
}

function round1(x) {
  const v = toNull(x);
  if (v === null) return null;
  return Math.round((v + Number.EPSILON) * 10) / 10;
}

function fmt1(x, fallback = "—") {
  const r = round1(x);
  return r === null ? fallback : r.toFixed(1);
}

function fmt2(x, fallback = "—") {
  const v = toNull(x);
  return v === null ? fallback : v.toFixed(2);
}

function fmtInt(x, fallback = "—") {
  const v = toNull(x);
  return v === null ? fallback : String(Math.round(v));
}

function getRainTotal(d) {
  const v = toNull(d?.rain_total);
  if (v !== null) return v;
  const v2 = toNull(d?.rain);
  if (v2 !== null) return v2;
  return 0;
}

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

function minMax(arr) {
  const v = arr.filter((x) => Number.isFinite(x));
  if (!v.length) return { min: 0, max: 1 };
  return { min: Math.min(...v), max: Math.max(...v) };
}

function niceStep(range, targetTicks = 6) {
  if (!Number.isFinite(range) || range <= 0) return 1;
  const rough = range / targetTicks;
  const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
  const r = rough / pow10;
  let step;
  if (r <= 1) step = 1;
  else if (r <= 2) step = 2;
  else if (r <= 2.5) step = 2.5;
  else if (r <= 5) step = 5;
  else step = 10;
  return step * pow10;
}

function axisNice(min, max, targetTicks = 6) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return { min: 0, max: 1, interval: 0.2 };
  }
  const range = max - min;
  const interval = niceStep(range, targetTicks);
  const niceMin = Math.floor(min / interval) * interval;
  const niceMax = Math.ceil(max / interval) * interval;
  return { min: niceMin, max: niceMax, interval };
}

function degToCardinal8(v) {
  const n0 = Number(v);
  if (!Number.isFinite(n0)) return "—";
  const d = ((n0 % 360) + 360) % 360;
  const ix = Math.round(d / 45) % 8;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][ix];
}

function degToCardinal16(v) {
  const n0 = Number(v);
  if (!Number.isFinite(n0)) return "—";
  const d = ((n0 % 360) + 360) % 360;
  const ix = Math.round(d / 22.5) % 16;
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][ix];
}

const MONTHS_IT = [
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

function formatDateIT(iso) {
  const s = String(iso || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const yyyy = Number(m[1]);
  const mm = Number(m[2]);
  const dd = Number(m[3]);
  const monthName = MONTHS_IT[mm - 1] || String(mm);
  return `${dd} ${monthName} ${yyyy}`;
}

function formatMonthIT(ym) {
  const s = String(ym || "");
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return s;
  const yyyy = m[1];
  const mm = Number(m[2]);
  const monthName = MONTHS_IT[mm - 1] || m[2];
  return `${monthName} ${yyyy}`;
}

function pad2(v) {
  return String(v).padStart(2, "0");
}

function buildLabels(stepMin = 15) {
  const out = [];
  for (let t = 0; t < 24 * 60; t += stepMin) {
    const hh = Math.floor(t / 60);
    const mm = t % 60;
    out.push(`${pad2(hh)}:${pad2(mm)}`);
  }
  return out;
}

function mapIntradayByHHMM(intraday) {
  const m = new Map();
  for (const x of intraday || []) {
    const hhmm = String(x?.t || "").slice(11, 16);
    if (/^\d{2}:\d{2}$/.test(hhmm)) m.set(hhmm, x);
  }
  return m;
}

function maxFinite(arr) {
  let m = -Infinity;
  let ok = false;
  for (const x of arr) {
    const v = Number(x);
    if (Number.isFinite(v)) {
      m = Math.max(m, v);
      ok = true;
    }
  }
  return ok ? m : null;
}

function defaultZoomPercent(nPoints, windowPoints = 144) {
  if (!Number.isFinite(nPoints) || nPoints <= 0) return { start: 0, end: 100 };
  if (nPoints <= windowPoints) return { start: 0, end: 100 };
  const start = ((nPoints - windowPoints) / nPoints) * 100;
  return { start, end: 100 };
}

function makeDataZoom(nPoints, windowPoints = 144) {
  const { start, end } = defaultZoomPercent(nPoints, windowPoints);
  return [
    {
      type: "inside",
      xAxisIndex: 0,
      filterMode: "none",
      zoomOnMouseWheel: true,
      moveOnMouseWheel: true,
      moveOnMouseMove: true,
    },
    {
      type: "slider",
      xAxisIndex: 0,
      start,
      end,
      bottom: 8,
      height: 22,
      showDetail: false,
    },
  ];
}

// -------------------- page --------------------
export default function DayPage({ day, intraday, prev, next, compareOptions = [] }) {
  const router = useRouter();

  if (!day) {
    return (
      <SiteLayout headerProps={{}}>
        <main style={{ padding: 20, fontFamily: "system-ui" }}>
          <p>Giorno non trovato.</p>
        </main>
      </SiteLayout>
    );
  }

  const year = day.date.slice(0, 4);
  const month = day.date.slice(5, 7);
  const ym = day.date.slice(0, 7);
  const mmdd = day.date.slice(5, 10);

  const labels = buildLabels(15);
  const byHHMM = mapIntradayByHHMM(intraday);

  const temp = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.temp_c));
  const dew = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.dewpoint_c));
  const rh = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.rh_pct));
  const press = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.press_hpa));
  const wind = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.wind_kmh));
  const gust = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.gust_kmh));
  const windDir = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.wind_dir_deg));
  const uv = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.uv));
  const solar = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.solar_wm2));

  const rain15 = labels.map((hhmm) => {
    const v = byHHMM.get(hhmm)?.rain_15m_mm;
    const n0 = Number(v);
    return Number.isFinite(n0) ? n0 : null;
  });

  let acc = 0;
  const rainCum = rain15.map((v) => {
    if (Number.isFinite(v)) acc += v;
    return acc;
  });

  const CHART_H = 340;
  const chartStyle = { height: CHART_H, width: "100%" };

  const N = labels.length;
  const DZ = makeDataZoom(N, 144);

  const tm = minMax([...temp, ...dew].map((x) => (Number.isFinite(x) ? x : NaN)));
  const tAxis = axisNice(
    Number.isFinite(tm.min) ? tm.min - 1 : 0,
    Number.isFinite(tm.max) ? tm.max + 1 : 1,
    6
  );

  const gridNoLegend = { left: 72, right: 56, top: 58, bottom: 92 };
  const gridWithLegend = { left: 72, right: 56, top: 58, bottom: 92 };

  const COLORS = {
    red: "#ff2d20",
    orange: "#f28c28",
    grayDark: "#4b5563",
    blueLight: "#60a5fa",
    blue: "#2563eb",
    indigo: "#312e81",
    greenStrong: "#2f9e44",
    windDir: "#f4a261",
  };

  const baseChart = {
    animation: false,
    grid: gridNoLegend,
    xAxis: {
      type: "category",
      data: labels,
      boundaryGap: false,
      axisLabel: { hideOverlap: true, margin: 14 },
    },
    title: { left: "center", top: 10 },
    legend: {
      bottom: 8,
      left: "center",
      itemGap: 16,
      padding: [8, 10, 2, 10],
    },
    toolbox: { feature: { dataZoom: { yAxisIndex: "none" }, restore: {} }, right: 10, top: 10 },
    tooltip: { trigger: "axis", order: "seriesAsc" },
    dataZoom: DZ,
  };

  const tempDewOption = {
    ...baseChart,
    grid: gridWithLegend,
    title: { ...baseChart.title, text: "Temperatura e punto di rugiada" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)} °C`),
    },
    yAxis: {
      type: "value",
      name: "°C",
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 52,
      min: tAxis.min,
      max: tAxis.max,
      interval: tAxis.interval,
      splitNumber: 6,
      scale: false,
      axisLabel: { formatter: (v) => Number(v).toFixed(1) },
    },
    series: [
      {
        name: "Temperatura",
        type: "line",
        data: temp,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
      {
        name: "Punto di rugiada",
        type: "line",
        data: dew,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 2, color: COLORS.red },
        itemStyle: { color: COLORS.red },
      },
    ],
  };

  const rhOption = {
    ...baseChart,
    title: { ...baseChart.title, text: "Umidità" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)} %`),
    },
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
    series: [
      {
        name: "Umidità",
        type: "line",
        data: rh,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
    ],
  };

  const rainOption = {
    ...baseChart,
    grid: gridWithLegend,
    title: { ...baseChart.title, text: "Precipitazioni" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)),
    },
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
        name: "mm",
        nameLocation: "middle",
        nameRotate: 270,
        nameGap: 56,
        scale: true,
        splitNumber: 5,
        alignTicks: true,
        axisLabel: { formatter: (v) => Number(v).toFixed(1) },
      },
    ],
    series: [
      {
        name: "Cumulata",
        type: "line",
        data: rainCum,
        yAxisIndex: 1,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 4, color: COLORS.greenStrong },
        itemStyle: { color: COLORS.greenStrong },
        z: 6,
      },
      {
        name: "Pioggia 15 min",
        type: "bar",
        data: rain15,
        yAxisIndex: 0,
        itemStyle: { color: "#4f6fd5" },
        z: 2,
      },
    ],
  };

  const windOption = {
    ...baseChart,
    grid: gridWithLegend,
    title: { ...baseChart.title, text: "Vento" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) => {
        if (!Array.isArray(params) || !params.length) return "";
        const time = params[0]?.axisValue ?? "";
        const lines = [`<b>${time}</b>`];
        for (const p of params) {
          if (p.seriesName === "Direzione") {
            lines.push(
              `${p.marker}${p.seriesName}: <b>${
                p.data === null ? "—" : `${degToCardinal16(p.data)} (${Math.round(Number(p.data))}°)`
              }</b>`
            );
          } else {
            lines.push(
              `${p.marker}${p.seriesName}: <b>${p.data === null ? "—" : `${Number(p.data).toFixed(1)} km/h`}</b>`
            );
          }
        }
        return lines.join("<br/>");
      },
    },
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
        name: "",
        min: 0,
        max: 360,
        interval: 45,
        axisLabel: { formatter: (v) => degToCardinal16(v) },
      },
    ],
    series: [
      {
        name: "Raffiche",
        type: "line",
        data: gust,
        yAxisIndex: 0,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 2, color: "#a3c614" },
        itemStyle: { color: "#a3c614" },
      },
      {
        name: "Vento medio",
        type: "line",
        data: wind,
        yAxisIndex: 0,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 2, color: "#4f6fd5" },
        itemStyle: { color: "#4f6fd5" },
      },
      {
        name: "Direzione",
        type: "scatter",
        data: windDir,
        yAxisIndex: 1,
        symbolSize: 7,
        itemStyle: { color: COLORS.windDir },
      },
    ],
  };

  const pressOption = {
    ...baseChart,
    title: { ...baseChart.title, text: "Pressione" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(1)} hPa`),
    },
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
    series: [
      {
        name: "Pressione",
        type: "line",
        data: press,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
    ],
  };

  const uvOption = {
    ...baseChart,
    title: { ...baseChart.title, text: "UV" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)),
    },
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
    series: [
      {
        name: "UV",
        type: "line",
        data: uv,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
    ],
  };

  const solarOption = {
    ...baseChart,
    title: { ...baseChart.title, text: "Radiazione" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : `${Math.round(Number(v))} W/m²`),
    },
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
    series: [
      {
        name: "Radiazione",
        type: "line",
        data: solar,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
    ],
  };

  const rainDay = getRainTotal(day);
  const rain15Max = maxFinite(rain15);
  const rain1h = toNull(day?.rain_1h_max);

  const compareAvailable = compareOptions.filter((x) => x?.date && x.year && x.date !== day.date);
  const [comparePick, setComparePick] = useState(compareAvailable?.[0]?.date ?? "");
  const [showTable, setShowTable] = useState(false);

  function onCompareChange(e) {
    const targetDate = String(e.target.value || "");
    setComparePick(targetDate);
    if (targetDate) router.push(`/giorni/${targetDate}`);
  }

  const tableRows = useMemo(() => {
    return labels.map((hhmm, i) => {
      const t = byHHMM.get(hhmm) || null;
      const wd = windDir[i];
      return {
        time: hhmm,
        temp: temp[i],
        dew: dew[i],
        rh: rh[i],
        press: press[i],
        wind: wind[i],
        gust: gust[i],
        dirDeg: wd,
        dirCard: degToCardinal8(wd),
        rain15: rain15[i],
        rainCum: rainCum[i],
        uv: uv[i],
        solar: solar[i],
        _has: !!t,
      };
    });
  }, [labels, byHHMM, windDir, temp, dew, rh, press, wind, gust, rain15, rainCum, uv, solar]);

  const dirTxt = Number.isFinite(n(day?.wind_dir_mean_deg)) ? degToCardinal16(day.wind_dir_mean_deg) : "—";

  return (
    <SiteLayout headerProps={{}}>
      <div className="wrap">
        <header className="hero">
          <div className="dayTopRow">
            <div className="dayBlock">
              <div className="kicker">Giorno</div>

              <div className="dayAndNav">
                <div>
                  <h1 className="dayTitle">{formatDateIT(day.date)}</h1>
                  <div className="daySubline">
                    <Link href={`/anni/${year}`} className="subLink">
                      {year}
                    </Link>
                    <span className="subSep">•</span>
                    <Link href={`/mesi/${year}/${month}`} className="subLink">
                      {formatMonthIT(ym)}
                    </Link>
                  </div>
                </div>

                <div className="dayNav">
                  {prev ? (
                    <Link href={`/giorni/${prev}`} className="dayNavLink">
                      <span className="navArrow">←</span>
                      <span>Precedente</span>
                    </Link>
                  ) : (
                    <span className="dayNavLink disabled">
                      <span className="navArrow">←</span>
                      <span>Precedente</span>
                    </span>
                  )}

                  <div className="daySelectWrap" aria-hidden="true">
                    <span className="daySelectLabel">Seleziona giorno</span>
                  </div>

                  {next ? (
                    <Link href={`/giorni/${next}`} className="dayNavLink">
                      <span>Successivo</span>
                      <span className="navArrow">→</span>
                    </Link>
                  ) : (
                    <span className="dayNavLink disabled">
                      <span>Successivo</span>
                      <span className="navArrow">→</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {compareAvailable.length > 0 && (
            <section className="compareBar" aria-label={`Confronto ${mmdd}`}>
              <div className="compareBarHead">Confronto {mmdd}</div>

              <div className="compareBarInner">
                <label htmlFor="compare-day-select" className="srOnly">
                  Confronta lo stesso giorno in un altro anno
                </label>
                <select
                  id="compare-day-select"
                  className="compareSelect"
                  value={comparePick}
                  onChange={onCompareChange}
                >
                  <option value="">Stesso giorno in…</option>
                  {compareAvailable.map((o) => (
                    <option key={o.date} value={o.date}>
                      {o.year} → {o.date}
                    </option>
                  ))}
                </select>
              </div>
            </section>
          )}

          <section className="summaryCompact">
            <div className="summaryHead">
              <div>
                <h2>Riepilogo giornaliero</h2>
                <p>Lettura rapida dei dati principali del giorno.</p>
              </div>
            </div>

            <div className="summaryRows">
              <div className="summaryRow">
                <div className="summaryLabel">Temperature</div>
                <div className="summaryMetrics three">
                  <div className="summaryMetric">
                    <span className="summaryKey">Max</span>
                    <strong>{fmt1(day.tmax)} °C</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Media</span>
                    <strong>{fmt1(day.tmean)} °C</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Min</span>
                    <strong>{fmt1(day.tmin)} °C</strong>
                  </div>
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Precipitazioni</div>
                <div className="summaryMetrics three">
                  <div className="summaryMetric">
                    <span className="summaryKey">Totale</span>
                    <strong>{fmt1(rainDay, "0.0")} mm</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Max 15 min</span>
                    <strong>{rain15Max === null ? "—" : `${fmt1(rain15Max)} mm`}</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Max 1h</span>
                    <strong>{rain1h === null ? "—" : `${fmt1(rain1h)} mm`}</strong>
                  </div>
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Umidità</div>
                <div className="summaryMetrics three">
                  <div className="summaryMetric">
                    <span className="summaryKey">Max</span>
                    <strong>{fmtInt(getRhMax(day))} %</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Media</span>
                    <strong>{fmtInt(getRhMean(day))} %</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Min</span>
                    <strong>{fmtInt(getRhMin(day))} %</strong>
                  </div>
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Vento</div>
                <div className="summaryMetrics three">
                  <div className="summaryMetric">
                    <span className="summaryKey">Medio</span>
                    <strong>{fmt1(day.wind_avg)} km/h</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Raffica max</span>
                    <strong>{fmt1(day.gust_max)} km/h</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Direzione media</span>
                    <strong>{dirTxt}</strong>
                  </div>
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Pressione</div>
                <div className="summaryMetrics three">
                  <div className="summaryMetric">
                    <span className="summaryKey">Max</span>
                    <strong>{fmt1(day.press_max)} hPa</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Media</span>
                    <strong>{fmt1(day.press_avg)} hPa</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Min</span>
                    <strong>{fmt1(day.press_min)} hPa</strong>
                  </div>
                </div>
              </div>

              <div className="summaryRow dual">
                <div className="summaryHalf">
                  <div className="summaryLabel">UV</div>
                  <div className="summaryMetrics two">
                    <div className="summaryMetric">
                      <span className="summaryKey">UV medio</span>
                      <strong>{fmt1(day.uv_mean_pos)}</strong>
                    </div>
                    <div className="summaryMetric">
                      <span className="summaryKey">UV max</span>
                      <strong>{fmt1(day.uv_max)}</strong>
                    </div>
                  </div>
                </div>

                <div className="summaryHalf">
                  <div className="summaryLabel">Radiazione</div>
                  <div className="summaryMetrics two">
                    <div className="summaryMetric">
                      <span className="summaryKey">Rad media</span>
                      <strong>{Number.isFinite(n(day.solar_mean_pos)) ? `${Math.round(n(day.solar_mean_pos))} W/m²` : "—"}</strong>
                    </div>
                    <div className="summaryMetric">
                      <span className="summaryKey">Rad max</span>
                      <strong>{Number.isFinite(n(day.solar_max)) ? `${Math.round(n(day.solar_max))} W/m²` : "—"}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rainNotice">
            <div className="rainNoticeBadge">Attenzione</div>
            <div className="rainNoticeText">
              Il totale di pioggia del giorno mostrato nel riepilogo è il dato più affidabile. Il grafico della
              pioggia può risultare più basso perché usa dati intraday provenienti da una fonte diversa. In caso di
              differenza, considera corretto il totale giornaliero indicato nel riepilogo.
            </div>
          </section>
        </header>

        {intraday.length ? (
          <section className="charts2">
            <div className="chartBox chartBoxWide">
              <ReactECharts option={tempDewOption} style={chartStyle} />
            </div>

            <div className="chartBox">
              <ReactECharts option={rainOption} style={chartStyle} />
            </div>
            <div className="chartBox">
              <ReactECharts option={rhOption} style={chartStyle} />
            </div>

            <div className="chartBox">
              <ReactECharts option={windOption} style={chartStyle} />
            </div>
            <div className="chartBox">
              <ReactECharts option={pressOption} style={chartStyle} />
            </div>

            <div className="chartBox">
              <ReactECharts option={uvOption} style={chartStyle} />
            </div>
            <div className="chartBox">
              <ReactECharts option={solarOption} style={chartStyle} />
            </div>
          </section>
        ) : (
          <section className="noDataBox">
            Nessun dato intraday per questo giorno.
          </section>
        )}

        <section className="dayTableHead">
          <div className="dayTableTitle">Riepilogo giornaliero</div>
        </section>

        <section className="recordsAction">
          <button
            type="button"
            className={`toggleRecords ${showTable ? "active" : ""}`}
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            aria-controls="table-day-data"
          >
            {showTable ? "Nascondi tabella dati giornalieri" : "Mostra tabella dati giornalieri"}
          </button>
        </section>

        {showTable && (
          <section id="table-day-data" className="tableWrap">
            <table>
              <thead>
                <tr className="groupRow">
                  <th className="group stickyHead bR" colSpan={1}>
                    Ora
                  </th>
                  <th className="group bR" colSpan={2}>
                    Temperature
                  </th>
                  <th className="group bR" colSpan={1}>
                    Umidità
                  </th>
                  <th className="group bR" colSpan={1}>
                    Pressione
                  </th>
                  <th className="group bR" colSpan={3}>
                    Vento
                  </th>
                  <th className="group bR" colSpan={2}>
                    Precipitazioni
                  </th>
                  <th className="group bR" colSpan={1}>
                    UV
                  </th>
                  <th className="group" colSpan={1}>
                    Radiazione
                  </th>
                </tr>

                <tr className="colRow">
                  <th className="bR stickyHead"> </th>

                  <th>T</th>
                  <th className="bR">Td</th>

                  <th className="bR">UR</th>

                  <th className="bR">Press</th>

                  <th>Vento</th>
                  <th>Raff.</th>
                  <th className="bR">Dir</th>

                  <th>15 min</th>
                  <th className="bR">Cumulata</th>

                  <th className="bR">UV</th>

                  <th>Rad</th>
                </tr>
              </thead>

              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.time} className={!r._has ? "missing" : ""}>
                    <td className="date sticky bR">{r.time}</td>

                    <td>{r.temp == null ? "—" : `${fmt1(r.temp)} °C`}</td>
                    <td className="bR">{r.dew == null ? "—" : `${fmt1(r.dew)} °C`}</td>

                    <td className="bR">{r.rh == null ? "—" : `${fmt1(r.rh)} %`}</td>

                    <td className="bR">{r.press == null ? "—" : `${fmt1(r.press)} hPa`}</td>

                    <td>{r.wind == null ? "—" : `${fmt1(r.wind)} km/h`}</td>
                    <td>{r.gust == null ? "—" : `${fmt1(r.gust)} km/h`}</td>
                    <td className="bR">{r.dirDeg == null ? "—" : `${r.dirCard} (${Math.round(r.dirDeg)}°)`}</td>

                    <td>{r.rain15 == null ? "—" : `${fmt2(r.rain15)} mm`}</td>
                    <td className="bR">{r.rainCum == null ? "—" : `${fmt2(r.rainCum)} mm`}</td>

                    <td className="bR">{r.uv == null ? "—" : fmt1(r.uv)}</td>

                    <td>{r.solar == null ? "—" : `${fmt1(r.solar)} W/m²`}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="tableHint">
              Nota: le righe sbiadite indicano assenza dato a quell’orario.
            </div>
          </section>
        )}

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

          .dayTopRow {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 18px;
          }

          .dayBlock {
            width: 100%;
          }

          .kicker {
            font-size: 12px;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            opacity: 0.6;
            margin-bottom: 8px;
          }

          .dayAndNav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 24px;
            flex-wrap: wrap;
          }

          .dayTitle {
            margin: 0;
            font-size: 68px;
            line-height: 1;
            letter-spacing: -0.04em;
            color: #0f172a;
          }

          .daySubline {
            margin-top: 10px;
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            font-size: 14px;
            font-weight: 800;
            color: #64748b;
          }

          .subLink {
            text-decoration: none;
            color: #64748b;
          }

          .subLink:hover {
            text-decoration: underline;
            color: #0f172a;
          }

          .subSep {
            opacity: 0.5;
          }

          .dayNav {
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
          }

          .dayNavLink {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            text-decoration: none;
            color: #111827;
            font-weight: 700;
            padding: 10px 12px;
            border-radius: 999px;
            background: #fff;
            border: 1px solid #e5e7eb;
            transition: background 120ms ease, transform 120ms ease, box-shadow 120ms ease;
          }

          .dayNavLink:hover {
            background: #f8fafc;
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
          }

          .dayNavLink.disabled {
            opacity: 0.45;
            pointer-events: none;
          }

          .navArrow {
            font-size: 14px;
            line-height: 1;
          }

          .daySelectWrap {
            position: relative;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 190px;
            height: 46px;
            padding: 0 18px;
            border-radius: 999px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            border: 1px solid #e5e7eb;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
          }

          .daySelectLabel {
            font-weight: 900;
            font-size: 15px;
            color: #0f172a;
          }

          .compareBar {
            margin-top: 18px;
            border: 1px solid #ececec;
            border-radius: 16px;
            background: #fcfcfc;
            padding: 16px 16px 14px;
          }

          .compareBarHead {
            font-size: 13px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #374151;
            font-weight: 900;
            margin-bottom: 14px;
            text-align: center;
          }

          .compareBarInner {
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .compareSelect {
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            min-width: 260px;
            height: 46px;
            padding: 0 16px;
            border-radius: 999px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            border: 1px solid #e5e7eb;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
            font-weight: 900;
            font-size: 15px;
            color: #0f172a;
            cursor: pointer;
            color-scheme: light;
          }

          .compareSelect:focus {
            outline: none;
            box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.9);
          }

          .compareSelect option,
          .compareSelect optgroup {
            color: #111111;
            background: #ffffff;
          }

          .summaryCompact {
            margin-top: 18px;
            border-top: 1px solid #efefef;
            padding-top: 18px;
          }

          .summaryHead {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 14px;
            margin-bottom: 16px;
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

          .summaryRows {
            display: grid;
            gap: 10px;
          }

          .summaryRow {
            display: grid;
            grid-template-columns: 190px 1fr;
            gap: 14px;
            align-items: stretch;
            border: 1px solid #ececec;
            border-radius: 16px;
            background: #fcfcfc;
            padding: 14px 16px;
          }

          .summaryRow.dual {
            grid-template-columns: 1fr 1fr;
            padding: 0;
            border: 0;
            background: transparent;
          }

          .summaryHalf {
            display: grid;
            grid-template-columns: 190px 1fr;
            gap: 14px;
            align-items: stretch;
            border: 1px solid #ececec;
            border-radius: 16px;
            background: #fcfcfc;
            padding: 14px 16px;
          }

          .summaryLabel {
            display: flex;
            align-items: center;
            font-size: 15px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #4b5563;
            font-weight: 900;
            padding-right: 8px;
            border-right: 1px solid #ececec;
          }

          .summaryMetrics {
            display: grid;
            gap: 10px;
            align-items: center;
          }

          .summaryMetrics.three {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .summaryMetrics.two {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .summaryMetric {
            min-width: 0;
          }

          .summaryKey {
            display: block;
            font-size: 10px;
            color: #6b7280;
            font-weight: 800;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
          }

          .summaryMetric strong {
            display: block;
            font-size: 19px;
            line-height: 1.05;
            font-weight: 900;
            letter-spacing: -0.02em;
            color: #0f172a;
          }

          .rainNotice {
            margin-top: 18px;
            border: 1px solid rgba(245, 158, 11, 0.26);
            background: linear-gradient(180deg, rgba(255, 251, 235, 0.96), rgba(255, 247, 237, 0.96));
            border-radius: 16px;
            padding: 14px 16px;
          }

          .rainNoticeBadge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(245, 158, 11, 0.14);
            color: #9a3412;
            font-size: 12px;
            font-weight: 950;
            margin-bottom: 8px;
          }

          .rainNoticeText {
            font-size: 14px;
            line-height: 1.5;
            font-weight: 800;
            color: rgba(15, 23, 42, 0.78);
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

          .noDataBox {
            margin-top: 12px;
            border: 1px solid #e7e7e7;
            border-radius: 16px;
            padding: 18px;
            background: rgba(255, 255, 255, 0.94);
            font-weight: 800;
            color: #475569;
          }

          .dayTableHead {
            margin-top: 16px;
            display: flex;
            justify-content: center;
          }

          .dayTableTitle {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 11px 22px;
            min-width: 220px;
            border-radius: 999px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            border: 1px solid #e5e7eb;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
            font-weight: 900;
            font-size: 15px;
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

          .tableWrap {
            margin-top: 10px;
            border: 1px solid #e7e7e7;
            border-radius: 16px;
            overflow: auto;
            background: rgba(255, 255, 255, 0.94);
          }

          table {
            width: 100%;
            border-collapse: collapse;
            min-width: 1400px;
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

          .date {
            font-weight: 900;
          }

          .missing {
            opacity: 0.55;
          }

          .tableHint {
            padding: 10px 12px;
            font-size: 11px;
            font-weight: 800;
            color: rgba(15, 23, 42, 0.55);
          }

          .srOnly {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          }

          @media (max-width: 1100px) {
            .summaryRow {
              grid-template-columns: 1fr;
            }

            .summaryHalf {
              grid-template-columns: 1fr;
            }

            .summaryLabel {
              border-right: 0;
              border-bottom: 1px solid #ececec;
              padding-right: 0;
              padding-bottom: 10px;
            }

            .summaryRow.dual {
              grid-template-columns: 1fr;
            }

            .charts2 {
              grid-template-columns: 1fr;
            }

            .chartBoxWide {
              grid-column: auto;
            }

            .dayAndNav {
              align-items: flex-start;
            }
          }

          @media (max-width: 720px) {
            .summaryMetrics.three,
            .summaryMetrics.two {
              grid-template-columns: 1fr;
            }

            .dayNav {
              width: 100%;
            }

            .daySelectWrap,
            .compareSelect {
              width: 100%;
              min-width: 100%;
            }
          }

          @media (max-width: 520px) {
            .dayTitle {
              font-size: 52px;
            }

            .summaryMetric strong {
              font-size: 20px;
            }
          }
        `}</style>
      </div>
    </SiteLayout>
  );
}