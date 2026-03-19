import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { useRouter } from "next/router";

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
function round1(x) {
  const n = toNull(x);
  if (n === null) return null;
  return Math.round((n + Number.EPSILON) * 10) / 10;
}
function fmt1(x, fallback = "—") {
  const r = round1(x);
  return r === null ? fallback : r.toFixed(1);
}
function fmt2(x, fallback = "—") {
  const n = toNull(x);
  return n === null ? fallback : n.toFixed(2);
}
function getRainTotal(d) {
  const v = toNull(d?.rain_total);
  if (v !== null) return v;
  const v2 = toNull(d?.rain);
  if (v2 !== null) return v2;
  return 0;
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
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const d = ((n % 360) + 360) % 360;
  const ix = Math.round(d / 45) % 8;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][ix];
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

function pad2(n) {
  return String(n).padStart(2, "0");
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
function defaultZoomPercent(n, windowPoints = 144) {
  if (!Number.isFinite(n) || n <= 0) return { start: 0, end: 100 };
  if (n <= windowPoints) return { start: 0, end: 100 };
  const start = ((n - windowPoints) / n) * 100;
  return { start, end: 100 };
}
function makeDataZoom(n, windowPoints = 144) {
  const { start, end } = defaultZoomPercent(n, windowPoints);
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

function KpiCard({ label, value, unit, hint }) {
  return (
    <div className="kpi">
      <div className="kpiLabel">{label}</div>
      <div className="kpiValue">
        {value} {unit ? <span className="kpiUnit">{unit}</span> : null}
      </div>
      {hint ? <div className="kpiHint">{hint}</div> : null}

      <style jsx>{`
        .kpi {
          border: 1px solid #e9e9e9;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
          padding: 12px 14px;
        }
        .kpiLabel {
          font-size: 12px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.68);
        }
        .kpiValue {
          margin-top: 6px;
          font-size: 22px;
          font-weight: 950;
          letter-spacing: -0.01em;
          color: #0f172a;
          white-space: nowrap;
        }
        .kpiUnit {
          font-size: 12px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.58);
          margin-left: 6px;
        }
        .kpiHint {
          margin-top: 6px;
          font-size: 11px;
          font-weight: 800;
          color: rgba(15, 23, 42, 0.55);
        }
      `}</style>
    </div>
  );
}

// -------------------- page --------------------
export default function DayPage({ day, intraday, prev, next, compareOptions = [] }) {
  const router = useRouter();

  if (!day) {
    return (
      <main style={{ padding: 20, fontFamily: "system-ui" }}>
        <p>
          <Link href="/">← Home</Link>
        </p>
        <p>Giorno non trovato.</p>
      </main>
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
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

  let acc = 0;
  const rainCum = rain15.map((v) => {
    if (Number.isFinite(v)) acc += v;
    return acc;
  });

  const CHART_H = 360;
  const chartStyle = { height: CHART_H, width: "100%" };

  const N = labels.length;
  const DZ = makeDataZoom(N, 144);

  const gridNoLegend = { left: 55, right: 30, top: 55, bottom: 55 };
  const gridWithLegend = { left: 55, right: 55, top: 85, bottom: 55 };

  const tm = minMax([...temp, ...dew].map((x) => (Number.isFinite(x) ? x : NaN)));
  const tAxis = axisNice(
    Number.isFinite(tm.min) ? tm.min - 1 : 0,
    Number.isFinite(tm.max) ? tm.max + 1 : 1,
    6
  );

  const ACCENT_RED = "#d62728";
  const xAxisCommon = {
    type: "category",
    data: labels,
    boundaryGap: false,
    axisLabel: { hideOverlap: true },
  };

  const toolboxZoom = {
    feature: {
      dataZoom: { yAxisIndex: "none" },
      restore: {},
    },
    right: 10,
    top: 8,
  };

  const tempDewOption = {
    title: { text: "Temperatura e Punto di rugiada", left: "center", top: 10 },
    grid: gridWithLegend,
    toolbox: toolboxZoom,
    dataZoom: DZ,
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)),
    },
    legend: { top: 40, left: "center" },
    xAxis: xAxisCommon,
    yAxis: [
      {
        type: "value",
        name: "°C",
        min: tAxis.min,
        max: tAxis.max,
        interval: tAxis.interval,
        splitNumber: 6,
        scale: false,
        axisLabel: { formatter: (v) => Number(v).toFixed(1) },
        splitLine: { show: true },
      },
    ],
    series: [
      {
        name: "Temperatura (°C)",
        type: "line",
        data: temp,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 2 },
      },
      {
        name: "Punto di rugiada (°C)",
        type: "line",
        data: dew,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 2, color: ACCENT_RED },
        itemStyle: { color: ACCENT_RED },
      },
    ],
  };

  const rhOption = {
    title: { text: "Umidità", left: "center", top: 10 },
    grid: gridNoLegend,
    toolbox: toolboxZoom,
    dataZoom: DZ,
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)),
    },
    xAxis: xAxisCommon,
    yAxis: {
      type: "value",
      name: "% RH",
      position: "left",
      min: 0,
      max: 100,
      scale: true,
      axisLabel: { formatter: (v) => Number(v).toFixed(1) },
      splitNumber: 6,
    },
    series: [
      {
        name: "Umidità (%)",
        type: "line",
        data: rh,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 2 },
      },
    ],
  };

  const rainOption = {
    title: { text: "Precipitazioni", left: "center", top: 10 },
    grid: gridWithLegend,
    toolbox: toolboxZoom,
    dataZoom: DZ,
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)),
    },
    legend: { top: 40, left: "center" },
    xAxis: xAxisCommon,
    yAxis: [
      {
        type: "value",
        name: "mm (15 min)",
        scale: false,
        splitNumber: 6,
        axisLabel: { formatter: (v) => Number(v).toFixed(1) },
        splitLine: { show: true },
      },
      {
        type: "value",
        name: "mm cum.",
        position: "right",
        scale: false,
        splitNumber: 6,
        axisLabel: { formatter: (v) => Number(v).toFixed(1) },
        splitLine: { show: false },
      },
    ],
    series: [
      { name: "15 min (mm)", type: "bar", data: rain15, yAxisIndex: 0 },
      {
        name: "Cumulata (mm)",
        type: "line",
        data: rainCum,
        yAxisIndex: 1,
        showSymbol: false,
        smooth: false,
        connectNulls: false,
      },
    ],
  };

  const windOption = {
    title: { text: "Vento medio e Raffiche", left: "center", top: 10 },
    grid: gridWithLegend,
    toolbox: toolboxZoom,
    dataZoom: DZ,
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const time = params?.[0]?.axisValue ?? "";
        const lines = [`${time}`];
        for (const p of params || []) {
          if (p.seriesName === "Direzione") {
            lines.push(`${p.marker}${p.seriesName}: ${p.data === null ? "—" : degToCardinal8(p.data)}`);
          } else {
            lines.push(`${p.marker}${p.seriesName}: ${p.data === null ? "—" : Number(p.data).toFixed(1)}`);
          }
        }
        return lines.join("<br/>");
      },
    },
    legend: { top: 40, left: "center" },
    xAxis: xAxisCommon,
    yAxis: [
      {
        type: "value",
        name: "km/h",
        scale: false,
        splitNumber: 6,
        axisLabel: { formatter: (v) => Number(v).toFixed(1) },
        splitLine: { show: true },
      },
      {
        type: "value",
        name: "Dir",
        position: "right",
        min: 0,
        max: 360,
        interval: 45,
        scale: false,
        splitNumber: 8,
        axisLabel: { formatter: (v) => degToCardinal8(v) },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "Vento medio",
        type: "line",
        data: wind,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        yAxisIndex: 0,
      },
      {
        name: "Raffiche",
        type: "line",
        data: gust,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        yAxisIndex: 0,
      },
      {
        name: "Direzione",
        type: "scatter",
        data: windDir,
        yAxisIndex: 1,
        symbolSize: 5,
        itemStyle: { color: "#2ca02c" },
      },
    ],
  };

  const pressOption = {
    title: { text: "Pressione", left: "center", top: 10 },
    grid: gridNoLegend,
    toolbox: toolboxZoom,
    dataZoom: DZ,
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)),
    },
    xAxis: xAxisCommon,
    yAxis: {
      type: "value",
      name: "hPa",
      scale: true,
      axisLabel: { formatter: (v) => Number(v).toFixed(1) },
      splitNumber: 6,
    },
    series: [
      {
        name: "Pressione (hPa)",
        type: "line",
        data: press,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
      },
    ],
  };

  const uvSolarOption = {
    title: { text: "UV e Radiazione Solare", left: "center", top: 10 },
    grid: gridWithLegend,
    toolbox: toolboxZoom,
    dataZoom: DZ,
    tooltip: {
      trigger: "axis",
      valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)),
    },
    legend: { top: 40, left: "center" },
    xAxis: xAxisCommon,
    yAxis: [
      {
        type: "value",
        name: "UV",
        scale: false,
        min: 0,
        splitNumber: 6,
        axisLabel: { formatter: (v) => Number(v).toFixed(1) },
        splitLine: { show: true },
      },
      {
        type: "value",
        name: "W/m²",
        position: "right",
        scale: false,
        min: 0,
        splitNumber: 6,
        axisLabel: { formatter: (v) => Number(v).toFixed(1) },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "UV",
        type: "line",
        data: uv,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        yAxisIndex: 0,
      },
      {
        name: "Radiazione (W/m²)",
        type: "line",
        data: solar,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        yAxisIndex: 1,
        lineStyle: { width: 2, color: ACCENT_RED },
        itemStyle: { color: ACCENT_RED },
      },
    ],
  };

  const rainDay = getRainTotal(day);
  const rain15Max = maxFinite(rain15);
  const rain1h = toNull(day?.rain_1h_max);

  const tabs = useMemo(
    () => [
      { key: "temp", label: "Temperatura", option: tempDewOption },
      { key: "rh", label: "Umidità", option: rhOption },
      { key: "rain", label: "Pioggia", option: rainOption },
      { key: "wind", label: "Vento", option: windOption },
      { key: "press", label: "Pressione", option: pressOption },
      { key: "uv", label: "UV/Radiazione", option: uvSolarOption },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [day.date]
  );

  const [activeTab, setActiveTab] = useState("temp");
  const [showAllCharts, setShowAllCharts] = useState(false);
  const active = tabs.find((t) => t.key === activeTab) || tabs[0];
  const oneChartKey = `${day.date}::${activeTab}::one`;

  const compareAvailable = compareOptions.filter((x) => x?.date && x.year && x.date !== day.date);
  const [comparePick, setComparePick] = useState(compareAvailable?.[0]?.date ?? "");

  function onCompareChange(e) {
    const targetDate = String(e.target.value || "");
    setComparePick(targetDate);
    if (targetDate) router.push(`/giorni/${targetDate}`);
  }

  const [showTable, setShowTable] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.date]);

  return (
    <main className="page">
      <div className="container">
        {/* TOP BAR */}
        <div className="topBar">
          <div className="topMain">
            <div className="crumbs" role="navigation" aria-label="Breadcrumb">
              <Link className="navChip" href="/">
                <span className="chipIcon">←</span>
                <span>Home</span>
              </Link>

              <Link className="navChip" href={`/anni/${year}`}>
                <span>{year}</span>
              </Link>

              <Link className="navChip" href={`/mesi/${year}/${month}`}>
                <span>{formatMonthIT(ym)}</span>
              </Link>
            </div>

            <div className="navActions">
              <Link
                className={`navChip ghost ${!prev ? "disabled" : ""}`}
                href={prev ? `/giorni/${prev}` : "#"}
                aria-disabled={!prev}
              >
                <span className="chipIcon">←</span>
                <span>Precedente</span>
              </Link>

              <span className="navChip selectDayChip staticChip" aria-disabled="true">
                <span>Seleziona giorno</span>
              </span>

              <Link
                className={`navChip ghost ${!next ? "disabled" : ""}`}
                href={next ? `/giorni/${next}` : "#"}
                aria-disabled={!next}
              >
                <span>Successivo</span>
                <span className="chipIcon">→</span>
              </Link>
            </div>
          </div>

          <div className={`compareCompact ${compareAvailable.length ? "" : "disabled"}`}>
            <div className="compareMiniLabel">Confronto {mmdd}</div>
            <select
              className="compareSelect"
              value={comparePick}
              onChange={onCompareChange}
              disabled={!compareAvailable.length}
            >
              <option value="">
                {compareAvailable.length ? "Stesso giorno in…" : "Nessun altro anno"}
              </option>
              {compareAvailable.map((o) => (
                <option key={o.date} value={o.date}>
                  {o.year} → {o.date}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* HEADER */}
        <header className="hero">
          <div className="heroInner">
            <div className="heroTitle">
              <h1 className="h1">{formatDateIT(day.date)}</h1>
              <div className="sub">Dettaglio giornaliero</div>
            </div>
          </div>
        </header>

        {/* AVVISO PIOGGIA */}
        <section className="rainNotice">
          <div className="rainNoticeBadge">Attenzione</div>
          <div className="rainNoticeText">
            Il totale di pioggia del giorno mostrato nel riepilogo è il dato più affidabile. Il grafico della pioggia
            può risultare più basso perché usa dati intraday provenienti da una fonte diversa. In caso di differenza,
            considera corretto il totale giornaliero indicato nel riepilogo.
          </div>
        </section>

        {/* KPI SUMMARY */}
        <section className="panel">
          <div className="panelHead">
            <div>
              <div className="panelTitle">Riepilogo</div>
              <div className="panelHint">Valori principali del giorno.</div>
            </div>
          </div>

          <div className="kpiGrid">
            <KpiCard label="Temperatura max" value={fmt1(day.tmax)} unit="°C" />
            <KpiCard label="Temperatura media" value={fmt1(day.tmean)} unit="°C" />
            <KpiCard label="Temperatura min" value={fmt1(day.tmin)} unit="°C" />

            <KpiCard label="Pioggia giorno" value={fmt1(rainDay, "0.0")} unit="mm" />
            <KpiCard
              label="Pioggia max 15 min"
              value={rain15Max === null ? "—" : fmt1(rain15Max)}
              unit="mm"
              hint="Picco su 15 minuti"
            />
            <KpiCard
              label="Pioggia max 1h"
              value={rain1h === null ? "—" : fmt1(rain1h)}
              unit="mm"
              hint="Picco su 1 ora"
            />

            <KpiCard label="Vento medio" value={fmt1(day.wind_avg)} unit="km/h" />
            <KpiCard label="Vento max" value={fmt1(day.wind_max)} unit="km/h" />
            <KpiCard label="Raffica max" value={fmt1(day.gust_max)} unit="km/h" />
          </div>
        </section>

        {/* CHARTS */}
        <section className="panel">
          <div className="panelHead chartsHead">
            <div>
              <div className="panelTitle">Grafici intraday</div>
              <div className="panelHint">Seleziona un grafico oppure mostra tutto.</div>
            </div>

            <div className="chartTools">
              <button className="toggle" onClick={() => setShowAllCharts((s) => !s)}>
                {showAllCharts ? "Mostra 1 grafico" : "Mostra tutti i grafici"}
              </button>
            </div>
          </div>

          {!intraday.length ? (
            <div className="muted">Nessun dato intraday per questo giorno.</div>
          ) : (
            <>
              {!showAllCharts && (
                <>
                  <div className="tabs">
                    {tabs.map((t) => (
                      <button
                        key={t.key}
                        className={`tab ${activeTab === t.key ? "active" : ""}`}
                        onClick={() => setActiveTab(t.key)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  <div className="chartBox">
                    <ReactECharts
                      key={oneChartKey}
                      option={active.option}
                      style={chartStyle}
                      notMerge={true}
                      lazyUpdate={true}
                    />
                  </div>
                </>
              )}

              {showAllCharts && (
                <div className="allCharts">
                  {tabs.map((t) => (
                    <div key={`${day.date}::${t.key}::all`} className="chartBox">
                      <ReactECharts
                        option={t.option}
                        style={chartStyle}
                        notMerge={true}
                        lazyUpdate={true}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="tablePanel">
                <button className="tableToggle" onClick={() => setShowTable((v) => !v)}>
                  {showTable ? "Nascondi tabella dati giornalieri" : "Mostra tabella dati giornalieri"}
                </button>

                {showTable && (
                  <div className="tableWrap">
                    <table className="dataTable">
                      <thead>
                        <tr>
                          <th>Ora</th>
                          <th>T (°C)</th>
                          <th>Td (°C)</th>
                          <th>UR (%)</th>
                          <th>Press (hPa)</th>
                          <th>Vento (km/h)</th>
                          <th>Raff. (km/h)</th>
                          <th>Dir</th>
                          <th>Pioggia 15m (mm)</th>
                          <th>Cumulata (mm)</th>
                          <th>UV</th>
                          <th>Rad (W/m²)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tableRows.map((r) => (
                          <tr key={r.time} className={!r._has ? "missing" : ""}>
                            <td className="mono">{r.time}</td>
                            <td>{r.temp == null ? "—" : fmt1(r.temp)}</td>
                            <td>{r.dew == null ? "—" : fmt1(r.dew)}</td>
                            <td>{r.rh == null ? "—" : fmt1(r.rh)}</td>
                            <td>{r.press == null ? "—" : fmt1(r.press)}</td>
                            <td>{r.wind == null ? "—" : fmt1(r.wind)}</td>
                            <td>{r.gust == null ? "—" : fmt1(r.gust)}</td>
                            <td className="mono">
                              {r.dirDeg == null ? "—" : `${r.dirCard} (${Math.round(r.dirDeg)}°)`}
                            </td>
                            <td>{r.rain15 == null ? "—" : fmt2(r.rain15)}</td>
                            <td>{r.rainCum == null ? "—" : fmt2(r.rainCum)}</td>
                            <td>{r.uv == null ? "—" : fmt1(r.uv)}</td>
                            <td>{r.solar == null ? "—" : fmt1(r.solar)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="tableHint">
                      Nota: le righe sbiadite indicano assenza dato a quell’orario.
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <style jsx>{`
        .page {
          padding: 16px 14px 60px;
          font-family: system-ui;
          background: radial-gradient(900px 420px at 15% 0%, rgba(59, 130, 246, 0.08), transparent 55%),
            radial-gradient(900px 420px at 85% 10%, rgba(16, 185, 129, 0.06), transparent 60%),
            linear-gradient(180deg, #ffffff, #f8fafc);
          min-height: 100vh;
        }

        .container {
          max-width: 1100px;
          margin: 0 auto;
        }

        .topBar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 8px 10px;
          position: sticky;
          top: 0;
          z-index: 5;
          backdrop-filter: blur(10px);
          background: rgba(248, 250, 252, 0.82);
          border: 1px solid rgba(15, 23, 42, 0.08);
          border-radius: 16px;
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.05);
        }

        .topMain {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex: 1;
        }

        .crumbs,
        .navActions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          min-width: 0;
        }

        .navChip {
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          white-space: nowrap;
          padding: 8px 12px;
          border-radius: 999px;
          border: 1px solid rgba(15, 23, 42, 0.08);
          background: rgba(255, 255, 255, 0.72);
          color: rgba(15, 23, 42, 0.86);
          font-size: 13px;
          font-weight: 850;
          line-height: 1;
          transition: all 140ms ease;
          box-shadow: 0 3px 10px rgba(15, 23, 42, 0.04);
        }

        .navChip:hover {
          transform: translateY(-1px);
          background: #ffffff;
          border-color: rgba(15, 23, 42, 0.14);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
          color: #0f172a;
        }

        .navChip:focus-visible {
          outline: 3px solid rgba(59, 130, 246, 0.28);
          outline-offset: 2px;
        }

        .navChip.ghost {
          background: transparent;
          border-color: transparent;
          box-shadow: none;
          color: rgba(15, 23, 42, 0.72);
        }

        .navChip.ghost:hover {
          background: rgba(255, 255, 255, 0.8);
          border-color: rgba(15, 23, 42, 0.08);
          color: #0f172a;
          box-shadow: 0 6px 16px rgba(15, 23, 42, 0.06);
        }

        .navChip.disabled {
          pointer-events: none;
          opacity: 0.45;
        }

        .selectDayChip {
          min-width: 150px;
          padding-left: 18px;
          padding-right: 18px;
          background: rgba(255, 255, 255, 0.95);
          border-color: rgba(15, 23, 42, 0.1);
          color: #0f172a;
          font-weight: 900;
        }

        .staticChip {
          cursor: default;
          user-select: none;
          pointer-events: none;
        }

        .staticChip:hover {
          transform: none;
          background: rgba(255, 255, 255, 0.95);
          border-color: rgba(15, 23, 42, 0.1);
          box-shadow: 0 3px 10px rgba(15, 23, 42, 0.04);
          color: #0f172a;
        }

        .chipIcon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          background: rgba(15, 23, 42, 0.06);
        }

        .compareCompact {
          flex: 0 0 230px;
          display: grid;
          gap: 4px;
          padding-left: 12px;
          border-left: 1px solid rgba(15, 23, 42, 0.08);
        }

        .compareCompact.disabled {
          opacity: 0.6;
        }

        .compareMiniLabel {
          font-size: 11px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.58);
          padding-left: 2px;
        }

        .compareSelect {
          width: 100%;
          border: 1px solid rgba(15, 23, 42, 0.1);
          border-radius: 12px;
          padding: 8px 10px;
          font-weight: 850;
          font-size: 13px;
          color: #0f172a;
          background: rgba(255, 255, 255, 0.9);
          outline: none;
        }

        .hero {
          border: 1px solid #e9e9e9;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);
          padding: 18px;
          margin-top: 10px;
        }

        .heroInner {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
        }

        .h1 {
          margin: 0;
          font-size: 44px;
          line-height: 1.05;
          letter-spacing: -0.02em;
          color: #0f172a;
          font-weight: 950;
        }

        .sub {
          margin-top: 6px;
          font-weight: 800;
          color: rgba(15, 23, 42, 0.66);
        }

        .rainNotice {
          margin-top: 14px;
          border: 1px solid rgba(245, 158, 11, 0.26);
          background: linear-gradient(180deg, rgba(255, 251, 235, 0.96), rgba(255, 247, 237, 0.96));
          border-radius: 20px;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.05);
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

        .panel {
          margin-top: 14px;
          border: 1px solid #e9e9e9;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
          padding: 14px;
        }

        .panelHead {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
          padding: 2px 4px 10px;
        }

        .panelTitle {
          font-weight: 950;
          letter-spacing: -0.01em;
          color: #0f172a;
          font-size: 16px;
        }

        .panelHint {
          margin-top: 4px;
          font-size: 12px;
          font-weight: 800;
          color: rgba(15, 23, 42, 0.6);
        }

        .kpiGrid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }

        .chartsHead {
          align-items: center;
        }

        .chartTools {
          display: flex;
          gap: 10px;
        }

        .toggle {
          border: 1px solid #e7e7e7;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 14px;
          padding: 10px 12px;
          font-weight: 950;
          color: #0f172a;
          cursor: pointer;
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
        }

        .toggle:hover {
          transform: translateY(-1px);
          border-color: #d6d6d6;
          background: #fff;
        }

        .tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 2px 4px 10px;
        }

        .tab {
          border: 1px solid #e7e7e7;
          background: rgba(248, 250, 252, 0.8);
          border-radius: 999px;
          padding: 8px 10px;
          font-weight: 950;
          font-size: 12px;
          color: rgba(15, 23, 42, 0.74);
          cursor: pointer;
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
        }

        .tab:hover {
          transform: translateY(-1px);
          border-color: #d6d6d6;
          background: #fff;
        }

        .tab.active {
          background: #0f172a;
          border-color: #0f172a;
          color: #fff;
        }

        .chartBox {
          border: 1px solid #ececec;
          border-radius: 18px;
          background: #fff;
          padding: 8px;
        }

        .allCharts {
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }

        .muted {
          opacity: 0.7;
          font-weight: 800;
          padding: 6px 4px;
        }

        .tablePanel {
          margin-top: 12px;
          border-top: 1px solid rgba(15, 23, 42, 0.08);
          padding-top: 12px;
        }

        .tableToggle {
          border: 1px solid #e7e7e7;
          background: rgba(248, 250, 252, 0.8);
          border-radius: 14px;
          padding: 10px 12px;
          font-weight: 950;
          color: #0f172a;
          cursor: pointer;
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
        }

        .tableToggle:hover {
          transform: translateY(-1px);
          border-color: #d6d6d6;
          background: #fff;
        }

        .tableWrap {
          margin-top: 10px;
          border: 1px solid #ececec;
          border-radius: 16px;
          background: #fff;
          overflow: auto;
        }

        .dataTable {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        .dataTable th,
        .dataTable td {
          padding: 10px 10px;
          border-bottom: 1px solid #f0f0f0;
          text-align: left;
          white-space: nowrap;
        }

        .dataTable thead th {
          position: sticky;
          top: 0;
          background: #ffffff;
          z-index: 1;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.78);
          border-bottom: 1px solid #e9e9e9;
        }

        .mono {
          font-variant-numeric: tabular-nums;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono",
            "Courier New", monospace;
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

        @media (max-width: 1100px) {
          .topBar {
            flex-direction: column;
            align-items: stretch;
          }

          .topMain {
            flex-direction: column;
            align-items: stretch;
          }

          .compareCompact {
            flex: unset;
            padding-left: 0;
            border-left: 0;
            border-top: 1px solid rgba(15, 23, 42, 0.08);
            padding-top: 8px;
          }
        }

        @media (max-width: 980px) {
          .kpiGrid {
            grid-template-columns: 1fr;
          }

          .h1 {
            font-size: 34px;
          }

          .rainNoticeText {
            font-size: 13px;
          }

          :global(.echarts-for-react) {
            height: 320px !important;
          }
        }
      `}</style>
    </main>
  );
}