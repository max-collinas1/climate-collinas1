import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

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

function toNull(x) {
  if (x === null || x === undefined) return null;
  if (typeof x === "string" && x.trim() === "") return null;
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// 1 decimale SEMPRE (no 2.4000000000004)
function round1(x) {
  const n = toNull(x);
  if (!Number.isFinite(n)) return null;
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
  return v2 !== null ? v2 : 0;
}

function minMax(arr) {
  const v = arr.filter((x) => Number.isFinite(x));
  if (!v.length) return { min: 0, max: 1 };
  return { min: Math.min(...v), max: Math.max(...v) };
}

// tick/griglia più “ordinati”
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

// -------------------- ZOOM dinamico (dataZoom) --------------------
// Mostra tutto se pochi punti; se tanti, parte già "zoomato" sugli ultimi N punti.
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

  const ym = day.date.slice(0, 7);
  const labels = intraday.map((x) => String(x.t).slice(11, 16)); // HH:MM
  const N = labels.length;
  const DZ = makeDataZoom(N, 144);

  const temp = intraday.map((x) => toNull(x.temp_c));
  const dew = intraday.map((x) => toNull(x.dewpoint_c));
  const rh = intraday.map((x) => toNull(x.rh_pct));

  const press = intraday.map((x) => toNull(x.press_hpa));

  const wind = intraday.map((x) => toNull(x.wind_kmh));
  const gust = intraday.map((x) => toNull(x.gust_kmh));
  const windDir = intraday.map((x) => toNull(x.wind_dir_deg)); // 0..360

  const uv = intraday.map((x) => toNull(x.uv));
  const solar = intraday.map((x) => toNull(x.solar_wm2));

  const rain15 = intraday.map((x) => {
    const v = Number(x.rain_15m_mm);
    return Number.isFinite(v) ? v : 0;
  });

  let acc = 0;
  const rainCum = rain15.map((v) => (acc += v));

  const wrapStyle = { maxWidth: 950, margin: "0 auto" };
  const chartStyleSmall = { height: 280, width: "100%" };

  // bottom più alto per lasciare spazio allo slider dello zoom
  const gridNoLegend = { left: 55, right: 30, top: 55, bottom: 55 };
  const gridWithLegend = { left: 55, right: 55, top: 85, bottom: 55 };

  // asse T comune per temp+dew (sinistra)
  const tm = minMax([...temp, ...dew].map((x) => (Number.isFinite(x) ? x : NaN)));
  const tAxis = axisNice(
    Number.isFinite(tm.min) ? tm.min - 1 : 0,
    Number.isFinite(tm.max) ? tm.max + 1 : 1,
    6
  );

  const DEW_COLOR = "#d62728";

  // base comune per xAxis (così lo zoom lavora uguale ovunque)
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

  // -------------------- 1) Temperatura e Punto di rugiada --------------------
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
        lineStyle: { width: 2, color: DEW_COLOR },
        itemStyle: { color: DEW_COLOR },
      },
    ],
  };

  // -------------------- 2) Umidità --------------------
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

  // -------------------- 3) Precipitazioni --------------------
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
      { name: "Cumulata (mm)", type: "line", data: rainCum, yAxisIndex: 1, showSymbol: false, smooth: false },
    ],
  };

  // -------------------- 4) Vento medio e Raffiche + Direzione --------------------
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
        for (const p of params) {
          if (p.seriesName === "Direzione") {
            lines.push(`${p.marker}${p.seriesName}: ${degToCardinal8(p.data)}`);
          } else {
            lines.push(`${p.marker}${p.seriesName}: ${Number(p.data).toFixed(1)}`);
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

  // -------------------- 6) Pressione --------------------
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
      { name: "Pressione (hPa)", type: "line", data: press, showSymbol: false, connectNulls: false, smooth: false },
    ],
  };

  // -------------------- 7) UV e Radiazione Solare --------------------
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
      { name: "UV", type: "line", data: uv, showSymbol: false, connectNulls: false, smooth: false, yAxisIndex: 0 },
      {
        name: "Radiazione (W/m²)",
        type: "line",
        data: solar,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        yAxisIndex: 1,
        lineStyle: { width: 2, color: DEW_COLOR },
        itemStyle: { color: DEW_COLOR },
      },
    ],
  };

  return (
    <main style={{ padding: 20, fontFamily: "system-ui" }}>
      <div style={wrapStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href={`/anni/${day.date.slice(0, 4)}`}>← Anno</Link>
            <Link href={`/mesi/${day.date.slice(0, 4)}/${day.date.slice(5, 7)}`}>← Mese {ym}</Link>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {prev ? <Link href={`/giorni/${prev}`}>← {prev}</Link> : <span />}
            {next ? <Link href={`/giorni/${next}`}>{next} →</Link> : <span />}
          </div>
        </div>

        <h1 style={{ marginBottom: 8, marginTop: 12 }}>{day.date}</h1>

        <ul style={{ marginTop: 0 }}>
          <li>Tmin: {fmt1(day.tmin)} °C</li>
          <li>Tmax: {fmt1(day.tmax)} °C</li>
          <li>Pioggia giorno: {fmt1(getRainTotal(day), "0.0")} mm</li>
          <li>Max 1h: {fmt1(day.rain_1h_max || 0)} mm</li>
          <li>Max 24h: {fmt1(day.rain_24h_max || 0)} mm</li>
        </ul>

        {intraday.length ? (
          <>
            <ReactECharts option={tempDewOption} style={chartStyleSmall} />
            <div style={{ height: 30 }} />

            <ReactECharts option={rhOption} style={chartStyleSmall} />
            <div style={{ height: 30 }} />

            <ReactECharts option={rainOption} style={chartStyleSmall} />
            <div style={{ height: 30 }} />

            <ReactECharts option={windOption} style={chartStyleSmall} />
            <div style={{ height: 30 }} />

            <ReactECharts option={pressOption} style={chartStyleSmall} />
            <div style={{ height: 30 }} />

            <ReactECharts option={uvSolarOption} style={chartStyleSmall} />
          </>
        ) : (
          <p>Nessun dato intraday.</p>
        )}
      </div>
    </main>
  );
}