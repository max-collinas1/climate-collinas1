import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";

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
  const rows = readDaily();
  const ix = rows.findIndex((r) => r.date === params.date);
  const day = ix >= 0 ? rows[ix] : null;

  const prev = ix > 0 ? rows[ix - 1]?.date ?? null : null;
  const next = ix >= 0 && ix < rows.length - 1 ? rows[ix + 1]?.date ?? null : null;

  const intraday = readIntraday(params.date);

  return { props: { day, intraday, prev, next } };
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

// compatibilità: se nel daily hai "rain" invece di "rain_total"
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

// direzione vento: N, NE, E, SE, S, SW, W, NW
function degToCardinal8(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  const d = ((n % 360) + 360) % 360;
  const ix = Math.round(d / 45) % 8;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][ix];
}

// data in italiano: "13 aprile 2021"
const MONTHS_IT = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
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

// timeline uniforme 15-min (mostra i buchi in asse X)
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

// zoom dinamico
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

function StatRow({ label, value, unit }) {
  return (
    <div className="row">
      <div className="k">{label}</div>
      <div className="v">
        {value} {unit ? <span className="u">{unit}</span> : null}
      </div>
    </div>
  );
}

// -------------------- page --------------------
export default function DayPage({ day, intraday, prev, next }) {
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

  // timeline uniforme (96 punti a 15 minuti)
  const labels = buildLabels(15);
  const byHHMM = mapIntradayByHHMM(intraday);

  // se manca il dato -> null (linea spezzata)
  const temp = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.temp_c));
  const dew = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.dewpoint_c));
  const rh = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.rh_pct));
  const press = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.press_hpa));
  const wind = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.wind_kmh));
  const gust = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.gust_kmh));
  const windDir = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.wind_dir_deg));
  const uv = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.uv));
  const solar = labels.map((hhmm) => toNull(byHHMM.get(hhmm)?.solar_wm2));

  // pioggia 15m: se manca riga -> null; cumulata resta piatta nei buchi
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

  const wrapStyle = { maxWidth: 1000, margin: "0 auto" };
  const chartStyleSmall = { height: 280, width: "100%" };

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
      { name: "Temperatura (°C)", type: "line", data: temp, showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: 2 } },
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
    tooltip: { trigger: "axis", valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)) },
    xAxis: xAxisCommon,
    yAxis: { type: "value", name: "% RH", position: "left", min: 0, max: 100, scale: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitNumber: 6 },
    series: [{ name: "Umidità (%)", type: "line", data: rh, showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: 2 } }],
  };

  const rainOption = {
    title: { text: "Precipitazioni", left: "center", top: 10 },
    grid: gridWithLegend,
    toolbox: toolboxZoom,
    dataZoom: DZ,
    tooltip: { trigger: "axis", valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)) },
    legend: { top: 40, left: "center" },
    xAxis: xAxisCommon,
    yAxis: [
      { type: "value", name: "mm (15 min)", scale: false, splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: true } },
      { type: "value", name: "mm cum.", position: "right", scale: false, splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: false } },
    ],
    series: [
      { name: "15 min (mm)", type: "bar", data: rain15, yAxisIndex: 0 },
      { name: "Cumulata (mm)", type: "line", data: rainCum, yAxisIndex: 1, showSymbol: false, smooth: false, connectNulls: false },
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
      { type: "value", name: "km/h", scale: false, splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: true } },
      { type: "value", name: "Dir", position: "right", min: 0, max: 360, interval: 45, scale: false, splitNumber: 8, axisLabel: { formatter: (v) => degToCardinal8(v) }, splitLine: { show: false } },
    ],
    series: [
      { name: "Vento medio", type: "line", data: wind, showSymbol: false, connectNulls: false, smooth: false, yAxisIndex: 0 },
      { name: "Raffiche", type: "line", data: gust, showSymbol: false, connectNulls: false, smooth: false, yAxisIndex: 0 },
      { name: "Direzione", type: "scatter", data: windDir, yAxisIndex: 1, symbolSize: 5, itemStyle: { color: "#2ca02c" } },
    ],
  };

  const pressOption = {
    title: { text: "Pressione", left: "center", top: 10 },
    grid: gridNoLegend,
    toolbox: toolboxZoom,
    dataZoom: DZ,
    tooltip: { trigger: "axis", valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)) },
    xAxis: xAxisCommon,
    yAxis: { type: "value", name: "hPa", scale: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitNumber: 6 },
    series: [{ name: "Pressione (hPa)", type: "line", data: press, showSymbol: false, connectNulls: false, smooth: false }],
  };

  const uvSolarOption = {
    title: { text: "UV e Radiazione Solare", left: "center", top: 10 },
    grid: gridWithLegend,
    toolbox: toolboxZoom,
    dataZoom: DZ,
    tooltip: { trigger: "axis", valueFormatter: (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1)) },
    legend: { top: 40, left: "center" },
    xAxis: xAxisCommon,
    yAxis: [
      { type: "value", name: "UV", scale: false, min: 0, splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: true } },
      { type: "value", name: "W/m²", position: "right", scale: false, min: 0, splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: false } },
    ],
    series: [
      { name: "UV", type: "line", data: uv, showSymbol: false, connectNulls: false, smooth: false, yAxisIndex: 0 },
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

  // ---- riepilogo: qui mettiamo Max 15 min + Max 1h (e rimuoviamo Max 24h) ----
  const rainDay = getRainTotal(day);
  const rain15Max = maxFinite(rain15);
  const rain1h = toNull(day?.rain_1h_max);

  return (
    <main className="wrap">
      <div style={wrapStyle}>
        <div className="topbar">
          <div className="crumbs">
            <Link className="crumbLink" href={`/anni/${year}`}>
              ← Anno
            </Link>
            <span className="sep">/</span>
            <Link className="crumbLink" href={`/mesi/${year}/${month}`}>
              Mese {ym}
            </Link>
          </div>

          <div className="navBtns">
            <Link className={`navBtn ${!prev ? "disabled" : ""}`} href={prev ? `/giorni/${prev}` : "#"} aria-disabled={!prev}>
              ← Giorno precedente
            </Link>
            <Link className={`navBtn ${!next ? "disabled" : ""}`} href={next ? `/giorni/${next}` : "#"} aria-disabled={!next}>
              Giorno successivo →
            </Link>
          </div>
        </div>

        <header className="header">
          <div className="titleBlock">
            <h1 className="h1">{formatDateIT(day.date)}</h1>
            <div className="subtitle">Dettaglio giornaliero</div>
          </div>
        </header>

        <section className="panel">
          <div className="panelTitle">Dati principali</div>

          <div className="grid">
            <div className="col">
              <StatRow label="Temperatura massima" value={fmt1(day.tmax)} unit="°C" />
              <StatRow label="Temperatura media" value={fmt1(day.tmean)} unit="°C" />
              <StatRow label="Temperatura minima" value={fmt1(day.tmin)} unit="°C" />
            </div>

            <div className="col">
              <StatRow label="Pioggia giorno" value={fmt1(rainDay, "0.0")} unit="mm" />
              <StatRow label="Max 15 min" value={rain15Max === null ? "—" : fmt1(rain15Max)} unit="mm" />
              <StatRow label="Max 1h" value={rain1h === null ? "—" : fmt1(rain1h)} unit="mm" />
            </div>

            <div className="col">
              <StatRow label="Vento medio" value={fmt1(day.wind_avg)} unit="km/h" />
              <StatRow label="Vento max" value={fmt1(day.wind_max)} unit="km/h" />
              <StatRow label="Raffica max" value={fmt1(day.gust_max)} unit="km/h" />
            </div>
          </div>
        </section>

        {intraday.length ? (
          <section className="charts">
            <div className="chartBox">
              <ReactECharts option={tempDewOption} style={chartStyleSmall} />
            </div>
            <div className="chartBox">
              <ReactECharts option={rhOption} style={chartStyleSmall} />
            </div>
            <div className="chartBox">
              <ReactECharts option={rainOption} style={chartStyleSmall} />
            </div>
            <div className="chartBox">
              <ReactECharts option={windOption} style={chartStyleSmall} />
            </div>
            <div className="chartBox">
              <ReactECharts option={pressOption} style={chartStyleSmall} />
            </div>
            <div className="chartBox">
              <ReactECharts option={uvSolarOption} style={chartStyleSmall} />
            </div>
          </section>
        ) : (
          <section className="panel" style={{ marginTop: 12 }}>
            <div className="panelTitle">Dati intraday</div>
            <div className="muted">Nessun dato intraday.</div>
          </section>
        )}
      </div>

      <style jsx>{`
        .wrap {
          padding: 18px 16px 48px;
          font-family: system-ui;
          background: #fff;
        }

        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 0;
        }

        .crumbs {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .crumbLink {
          text-decoration: none;
          color: #111;
          font-weight: 800;
          opacity: 0.85;
        }
        .crumbLink:hover {
          opacity: 1;
          text-decoration: underline;
        }
        .sep {
          opacity: 0.35;
        }

        .navBtns {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .navBtn {
          text-decoration: none;
          border: 1px solid #e3e3e3;
          background: #fff;
          color: #111;
          padding: 10px 12px;
          border-radius: 12px;
          font-weight: 900;
          white-space: nowrap;
        }
        .navBtn:hover {
          border-color: #bdbdbd;
          background: #fafafa;
        }
        .navBtn.disabled {
          pointer-events: none;
          opacity: 0.45;
        }

        .header {
          margin-top: 6px;
          padding: 18px;
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          background: linear-gradient(180deg, #fff, #fbfbfb);
        }
        .titleBlock {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .h1 {
          margin: 0;
          font-size: 42px;
          line-height: 1.05;
          letter-spacing: -0.02em;
        }
        .subtitle {
          opacity: 0.7;
          font-weight: 700;
        }

        .panel {
          margin-top: 12px;
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          background: #fff;
          padding: 14px;
        }
        .panelTitle {
          font-weight: 950;
          letter-spacing: 0.02em;
          margin-bottom: 10px;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .col {
          display: grid;
          gap: 10px;
        }

        .row {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 16px;
          align-items: baseline;
          padding: 10px 12px;
          border-radius: 12px;
          background: #fcfcfc;
          border: 1px solid #f0f0f0;
        }
        .k {
          opacity: 0.75;
          font-weight: 800;
        }
        .v {
          font-weight: 950;
          white-space: nowrap;
        }
        .u {
          opacity: 0.75;
          font-weight: 800;
          margin-left: 6px;
        }

        .charts {
          margin-top: 12px;
          display: grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        .chartBox {
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          padding: 8px;
          background: #fff;
        }

        .muted {
          opacity: 0.7;
          font-weight: 700;
        }

        @media (max-width: 980px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 720px) {
          .topbar {
            align-items: flex-start;
            flex-direction: column;
          }
          .navBtns {
            width: 100%;
          }
          .navBtn {
            width: 100%;
            text-align: center;
          }
          .h1 {
            font-size: 34px;
          }
        }
      `}</style>
    </main>
  );
}