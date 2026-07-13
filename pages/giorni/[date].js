import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
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
  const ym = String(params?.date || "").slice(0, 7);

  const sameDay = rows
    .filter((r) => String(r?.date || "").slice(5, 10) === mmdd)
    .map((r) => String(r.date))
    .sort();

  const compareOptions = sameDay.map((d) => ({ year: d.slice(0, 4), date: d }));

  const monthDays = rows
    .filter((r) => String(r?.date || "").startsWith(`${ym}-`))
    .map((r) => String(r.date))
    .sort()
    .map((date) => ({
      date,
      dayNum: String(Number(date.slice(8, 10))),
    }));

  return { props: { day, intraday, prev, next, compareOptions, monthDays } };
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
export default function DayPage({ day, intraday, prev, next, compareOptions = [], monthDays = [] }) {
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setIsMobile(media.matches);

    update();
    media.addEventListener?.("change", update);

    return () => media.removeEventListener?.("change", update);
  }, []);

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
  const dayTitle = `${Number(day.date.slice(8, 10))} ${
    MONTHS_IT[Number(month) - 1] || month
  }`;

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

  const rainCum = labels.map((hhmm, index) => {
    /*
     * Se non esiste un'osservazione per questo quarto d'ora,
     * la cumulata resta nulla. In questo modo la linea non
     * prosegue artificialmente nelle ore future o nei buchi reali.
     */
    if (!byHHMM.has(hhmm)) {
      return null;
    }

    const value = rain15[index];

    if (Number.isFinite(value)) {
      acc += value;
    }

    return Math.round(
      (acc + Number.EPSILON) * 100
    ) / 100;
  });

  const LARGE_CHART_H = isMobile ? 325 : 390;
  const NORMAL_CHART_H = isMobile ? 305 : 370;

  const N = labels.length;
  const DZ = makeDataZoom(N, 144);

  const tm = minMax([...temp, ...dew].map((x) => (Number.isFinite(x) ? x : NaN)));
  const tAxis = axisNice(
    Number.isFinite(tm.min) ? tm.min - 1 : 0,
    Number.isFinite(tm.max) ? tm.max + 1 : 1,
    6
  );

  const gridNoLegend = isMobile
    ? { left: 50, right: 50, top: 64, bottom: 108 }
    : { left: 64, right: 34, top: 92, bottom: 118 };

  const gridWithLegend = isMobile
    ? { left: 50, right: 50, top: 64, bottom: 108 }
    : { left: 64, right: 34, top: 92, bottom: 118 };

  const COLORS = {
    red: "#ff2d20",
    orange: "#f28c28",
    grayDark: "#4b5563",
    blueLight: "#60a5fa",
    blue: "#2563eb",
    greenStrong: "#2f9e44",
    windDir: "#7c3aed",
  };

  const baseChart = {
    animation: false,
    grid: gridNoLegend,
    xAxis: {
      type: "category",
      data: labels,
      boundaryGap: false,
      axisLabel: {
        hideOverlap: true,
        margin: 14,
        fontSize: isMobile ? 10 : 11,
      },
    },
    title: {
      left: "center",
      top: 10,
      textStyle: {
        fontSize: isMobile ? 15 : 17,
        fontWeight: 900,
        width: isMobile ? 230 : 300,
        overflow: "break",
      },
    },
    legend: {
      bottom: 36,
      left: "center",
      type: "scroll",
      itemGap: 12,
      padding: [6, 10, 6, 10],
      textStyle: {
        fontSize: isMobile ? 10 : 11,
        fontWeight: 700,
      },
    },
    toolbox: {
      feature: { dataZoom: { yAxisIndex: "none" }, restore: {} },
      right: 4,
      top: 8,
      itemSize: 14,
    },
    tooltip: { trigger: "axis", order: "seriesAsc", confine: true },
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
        lineStyle: { width: 3, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "Punto di rugiada",
        type: "line",
        data: dew,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        lineStyle: { width: 2, color: COLORS.blueLight },
        itemStyle: { color: COLORS.blueLight },
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
        lineStyle: { width: 3, color: COLORS.blue },
        itemStyle: { color: COLORS.blue },
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
        lineStyle: { width: 3, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
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
        lineStyle: { width: 3, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
    ],
  };

  const rainDay = getRainTotal(day);
  const rain15Max = maxFinite(rain15);
  const rain1h = toNull(day?.rain_1h_max);

  const compareAvailable = compareOptions.filter((x) => x?.date && x.year && x.date !== day.date);
  const [comparePick, setComparePick] = useState(compareAvailable?.[0]?.year ?? "");

  function yearToDayHref(targetYear) {
    const found = compareAvailable.find((o) => String(o.year) === String(targetYear));
    return found?.date ? `/giorni/${found.date}` : "#";
  }

  function onCompareChange(e) {
    const targetYear = String(e.target.value || "");
    setComparePick(targetYear);
    if (targetYear) router.push(yearToDayHref(targetYear));
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

  function downloadDailyCsv() {
    const columns = [
      "date",
      "time",
      "temp_c",
      "dewpoint_c",
      "rh_pct",
      "press_hpa",
      "wind_kmh",
      "gust_kmh",
      "wind_dir_deg",
      "wind_dir_txt",
      "rain_15m_mm",
      "rain_cum_mm",
      "uv",
      "solar_wm2",
    ];

    const csvRows = tableRows
      .filter((row) => row._has)
      .map((row) => [
        day.date,
        row.time,
        row.temp,
        row.dew,
        row.rh,
        row.press,
        row.wind,
        row.gust,
        row.dirDeg,
        row.dirCard,
        row.rain15,
        row.rainCum,
        row.uv,
        row.solar,
      ]);

    const escapeCsv = (value) => {
      if (value === null || value === undefined || value === "") return "";
      const raw = String(value);
      const escaped = raw.replaceAll('"', '""');
      return /[",\n]/.test(raw) ? `"${escaped}"` : escaped;
    };

    const csv = [
      columns.join(","),
      ...csvRows.map((row) => row.map(escapeCsv).join(",")),
    ].join("\n");

    const blob = new Blob(["\uFEFF", csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = `${day.date}_dati_15min.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  const dirTxt = Number.isFinite(n(day?.wind_dir_mean_deg)) ? degToCardinal16(day.wind_dir_mean_deg) : "—";

  return (
    <SiteLayout headerProps={{}}>
      <div className="wrap">
        <header className="hero">
          <div className="yearTopRow">
            <div className="yearBlock">
              <div className="dayHeaderGrid">
                <div className="daySelectHeaderWrap">
                  <span className="selectorLabel">Seleziona giorno</span>

                  <select
                    className="selectorPill dayHeaderSelect"
                    value={day.date}
                    onChange={(e) => {
                      const targetDate = e.target.value;
                      if (!targetDate) return;
                      router.push(`/giorni/${targetDate}`);
                    }}
                    aria-label={`Seleziona giorno ${formatMonthIT(ym)}`}
                  >
                    {monthDays.map((item) => (
                      <option key={item.date} value={item.date}>
                        Giorno {item.dayNum}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="titleMain">
                  <div className="kicker">Giorno</div>

                  <div className="dayTitleLine">
                    {prev ? (
                      <Link
                        href={`/giorni/${prev}`}
                        className="arrowCircle"
                        aria-label="Giorno precedente"
                        title="Precedente"
                      >
                        <svg viewBox="0 0 32 32" aria-hidden="true" className="arrowSvg">
                          <path
                            d="M21 6.5L9.5 16L21 25.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="4.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </Link>
                    ) : (
                      <span className="arrowCircle disabled" aria-hidden="true">
                        <svg viewBox="0 0 32 32" aria-hidden="true" className="arrowSvg">
                          <path
                            d="M21 6.5L9.5 16L21 25.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="4.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    )}

                    <h1 className="year">{dayTitle}</h1>

                    {next ? (
                      <Link
                        href={`/giorni/${next}`}
                        className="arrowCircle"
                        aria-label="Giorno successivo"
                        title="Successivo"
                      >
                        <svg viewBox="0 0 32 32" aria-hidden="true" className="arrowSvg">
                          <path
                            d="M11 6.5L22.5 16L11 25.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="4.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </Link>
                    ) : (
                      <span className="arrowCircle disabled" aria-hidden="true">
                        <svg viewBox="0 0 32 32" aria-hidden="true" className="arrowSvg">
                          <path
                            d="M11 6.5L22.5 16L11 25.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="4.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    )}
                  </div>

                  <div className="dayContextLinks">
                    <Link
                      href={`/anni/${year}`}
                      className="contextPill"
                      aria-label={`Apri l'anno ${year}`}
                    >
                      {year}
                    </Link>

                    <Link
                      href={`/mesi/${year}/${month}`}
                      className="contextPill contextPillMonth"
                      aria-label={`Apri ${formatMonthIT(ym)}`}
                    >
                      {formatMonthIT(ym)}
                    </Link>
                  </div>
                </div>

                {compareAvailable.length > 0 ? (
                  <div className="inlineCompareWrap">
                    <span className="selectorLabel">Giorno negli altri anni</span>

                    <select
                      id="compare-day-select"
                      className="selectorPill compareSelectMini"
                      value={comparePick}
                      onChange={onCompareChange}
                    >
                      <option value="">Anno</option>
                      {compareAvailable.map((o) => (
                        <option key={o.date} value={o.year}>
                          {o.year}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="headerSideSpacer" aria-hidden="true" />
                )}
              </div>
            </div>
          </div>

          <section className="summaryCompact">
            <div className="summaryHead centered">
              <div>
                <h2>Sintesi giornaliera</h2>
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
              <ReactECharts option={tempDewOption} style={{ height: LARGE_CHART_H, width: "100%" }} />
            </div>

            <div className="chartBox chartBoxWide">
              <ReactECharts option={rainOption} style={{ height: LARGE_CHART_H, width: "100%" }} />
            </div>

            <div className="chartBox chartBoxWide">
              <ReactECharts option={windOption} style={{ height: LARGE_CHART_H, width: "100%" }} />
            </div>

            <div className="chartBox">
              <ReactECharts option={rhOption} style={{ height: NORMAL_CHART_H, width: "100%" }} />
            </div>

            <div className="chartBox">
              <ReactECharts option={pressOption} style={{ height: NORMAL_CHART_H, width: "100%" }} />
            </div>

            <div className="chartBox">
              <ReactECharts option={uvOption} style={{ height: NORMAL_CHART_H, width: "100%" }} />
            </div>

            <div className="chartBox">
              <ReactECharts option={solarOption} style={{ height: NORMAL_CHART_H, width: "100%" }} />
            </div>
          </section>
        ) : (
          <section className="noDataBox">
            Nessun dato intraday per questo giorno.
          </section>
        )}

        <section className="dayTableHead">
          <div className="dayTableTitle">Dati ogni 15 minuti</div>

          <button
            type="button"
            className="downloadCsvDesktop"
            onClick={downloadDailyCsv}
            aria-label={`Scarica i dati del ${day.date} in formato CSV`}
          >
            Scarica CSV giornaliero
          </button>
        </section>

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

          .yearTopRow {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 18px;
          }

          .yearBlock {
            width: 100%;
          }

          .kicker {
            font-size: 12px;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            opacity: 0.6;
            margin-bottom: 8px;
          }

          .titleLine {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 22px;
            flex-wrap: wrap;
          }

          .titleMain {
            display: inline-flex;
            align-items: center;
            gap: 16px;
            flex-wrap: wrap;
          }

          .year {
            margin: 0;
            font-size: 68px;
            line-height: 1;
            letter-spacing: -0.04em;
            color: #0f172a;
            flex: 0 0 auto;
          }

          .titleActions {
            display: inline-flex !important;
            align-items: center !important;
            gap: 12px !important;
            flex: 0 0 auto;
            margin-left: 6px;
          }

          .arrowCircle {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 62px !important;
            height: 62px !important;
            min-width: 62px !important;
            min-height: 62px !important;
            border-radius: 999px !important;
            border: 2.2px solid #1f1f1f !important;
            background: #ffffff !important;
            color: #1f1f1f !important;
            text-decoration: none !important;
            box-sizing: border-box !important;
            transition: transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
          }

          .arrowCircle:hover {
            background: #fafafa !important;
            transform: translateY(-1px);
            box-shadow: 0 10px 18px rgba(0, 0, 0, 0.06);
          }

          .arrowCircle:active {
            transform: scale(0.98);
          }

          .arrowCircle.disabled {
            opacity: 0.3;
            pointer-events: none;
          }

          .arrowSvg {
            width: 26px !important;
            height: 26px !important;
            display: block !important;
            color: #1f1f1f !important;
            flex: 0 0 auto;
          }

          .inlineCompareWrap {
            display: inline-flex;
            align-items: center;
            justify-content: flex-end;
            gap: 10px;
            flex-wrap: nowrap;
            min-width: 0;
          }

          .inlineCompareLabel {
            font-size: 14px;
            font-weight: 900;
            color: #475569;
            white-space: nowrap;
          }

          .compareSelectMini {
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            width: 104px;
            min-width: 104px;
            max-width: 104px;
            height: 54px;
            padding: 0 14px;
            border-radius: 999px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            border: 1px solid #d8dee7;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 4px 14px rgba(15, 23, 42, 0.04);
            font-weight: 900;
            font-size: 16px;
            color: #0f172a;
            cursor: pointer;
            color-scheme: light;
            text-align: center;
          }

          .compareSelectMini:focus {
            outline: none;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 4px 14px rgba(15, 23, 42, 0.05);
            border-color: #b9c5d6;
          }

          .compareSelectMini option,
          .compareSelectMini optgroup {
            color: #111111;
            background: #ffffff;
          }

          .dayMeta {
            margin-top: 16px;
            display: flex;
            align-items: center;
            gap: 10px;
            flex-wrap: wrap;
            font-size: 16px;
            font-weight: 900;
            color: #5f7897;
          }

          .subLink {
            text-decoration: none;
            color: #5f7897;
            font-size: 16px;
            font-weight: 900;
            letter-spacing: -0.01em;
          }

          .subLink:hover {
            text-decoration: underline;
            color: #0f172a;
          }

          .subSep {
            opacity: 0.5;
          }

          .daysBar {
            margin-top: 18px;
            border: 1px solid #ececec;
            border-radius: 16px;
            background: #fcfcfc;
            padding: 16px 16px 14px;
          }

          .daysBarHead {
            font-size: 13px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #374151;
            font-weight: 900;
            margin-bottom: 14px;
            text-align: center;
          }

          .dayNavGrid {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: center;
            gap: 10px;
          }

          .dayLink {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 50px;
            height: 42px;
            padding: 0 12px;
            border-radius: 12px;
            text-decoration: none;
            color: #111;
            font-weight: 900;
            font-size: 15px;
            line-height: 1;
            background: #fff;
            border: 1px solid #ececec;
            transition: background 120ms ease, transform 120ms ease, box-shadow 120ms ease;
          }

          .daySelectMobile {
            display: none;
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            width: 100%;
            height: 50px;
            padding: 0 16px;
            border-radius: 999px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            border: 1px solid #d8dee7;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 4px 14px rgba(15, 23, 42, 0.04);
            font-weight: 900;
            font-size: 15px;
            color: #0f172a;
            cursor: pointer;
            color-scheme: light;
            text-align: center;
          }

          .daySelectMobile:focus {
            outline: none;
            border-color: #b9c5d6;
            box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12),
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 4px 14px rgba(15, 23, 42, 0.05);
          }

          .daySelectMobile option {
            color: #111111;
            background: #ffffff;
          }

          .dayLinkNum {
            font-weight: 900;
          }

          .dayLink:hover {
            background: #f6f6f6;
            transform: translateY(-1px);
            box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
          }

          .dayLink.active {
            background: #f5f8ff;
            border-color: #d8dbe2;
            box-shadow: 0 8px 20px rgba(12, 25, 56, 0.06);
          }

          .dayLink:focus-visible {
            outline: 2px solid #111;
            outline-offset: 2px;
          }

          .summaryCompact {
            margin-top: 18px;
            border-top: 1px solid #efefef;
            padding-top: 18px;
          }

          .summaryHead {
            margin-bottom: 16px;
          }

          .summaryHead.centered {
            text-align: center;
          }

          .summaryHead h2 {
            margin: 0;
            font-size: 24px;
            line-height: 1.1;
            font-weight: 950;
            letter-spacing: -0.03em;
          }

          .summaryHead p {
            margin: 6px 0 0;
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

          @media (max-width: 1220px) {
            .titleLine {
              align-items: flex-start;
            }

            .inlineCompareWrap {
              justify-content: flex-start;
            }
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
          }

          @media (max-width: 980px) {
            .year {
              font-size: 58px;
            }

            .arrowCircle {
              width: 56px !important;
              height: 56px !important;
              min-width: 56px !important;
              min-height: 56px !important;
            }
          }

          @media (max-width: 820px) {
            .titleLine {
              flex-direction: column;
              align-items: flex-start;
            }

            .inlineCompareWrap {
              width: 100%;
            }
          }

          @media (max-width: 720px) {
            .summaryMetrics.three,
            .summaryMetrics.two {
              grid-template-columns: 1fr;
            }

            .titleMain {
              align-items: flex-start;
            }

            .inlineCompareWrap {
              flex-direction: column;
              align-items: stretch;
              gap: 6px;
            }

            .compareSelectMini {
              width: 100%;
              min-width: 100%;
              max-width: 100%;
            }

            .dayNavGrid {
              gap: 8px;
            }

            .dayLink {
              min-width: 44px;
              height: 40px;
              padding: 0 10px;
            }
          }

          @media (max-width: 520px) {
            .year {
              width: 100%;
              max-width: 100%;
              font-size: 34px;
              line-height: 1.05;
              letter-spacing: -0.04em;
              white-space: normal;
              overflow-wrap: anywhere;
            }

            .titleMain {
              gap: 12px;
            }

            .summaryMetric strong {
              font-size: 20px;
            }

            .dayMeta,
            .subLink {
              font-size: 17px;
            }

            .daysBar {
              padding: 14px;
            }

            .daysBarHead {
              margin-bottom: 10px;
              font-size: 12px;
            }

            .daySelectMobile {
              display: block;
            }

            .dayNavGrid {
              display: none;
            }

            .arrowCircle {
              width: 50px !important;
              height: 50px !important;
              min-width: 50px !important;
              min-height: 50px !important;
            }

            .arrowSvg {
              width: 22px !important;
              height: 22px !important;
            }

            .dayLink {
              min-width: 40px;
              height: 38px;
              border-radius: 10px;
              font-size: 14px;
            }
          }

          /* Header giornaliero coerente con le pagine mese e anno */
          .yearTopRow,
          .yearBlock {
            width: 100%;
          }

          .dayHeaderGrid {
            display: grid;
            grid-template-columns:
              minmax(190px, 260px)
              minmax(360px, 1fr)
              minmax(190px, 260px);
            gap: 22px;
            align-items: center;
            width: 100%;
            min-height: 160px;
          }

          .daySelectHeaderWrap,
          .inlineCompareWrap {
            display: grid;
            justify-items: center;
            align-items: center;
            gap: 10px;
            min-width: 0;
          }

          .daySelectHeaderWrap {
            justify-self: start;
          }

          .inlineCompareWrap {
            justify-self: end;
          }

          .headerSideSpacer {
            min-width: 0;
          }

          .selectorLabel {
            font-size: 13px;
            font-weight: 950;
            color: #475569;
            white-space: nowrap;
            letter-spacing: 0.13em;
            text-transform: uppercase;
            text-align: center;
          }

          .selectorPill {
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            width: 132px;
            min-width: 132px;
            max-width: 132px;
            height: 54px;
            padding: 0 18px;
            border-radius: 999px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            border: 1px solid #d8dee7;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 4px 14px rgba(15, 23, 42, 0.04);
            font-weight: 950;
            font-size: 15px;
            color: #0f172a;
            cursor: pointer;
            color-scheme: light;
            text-align: center;
          }

          .selectorPill:focus {
            outline: none;
            border-color: #b9c5d6;
            box-shadow:
              0 0 0 2px rgba(37, 99, 235, 0.12),
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 4px 14px rgba(15, 23, 42, 0.05);
          }

          .selectorPill option {
            color: #111111;
            background: #ffffff;
          }

          .dayHeaderSelect {
            width: 150px;
            min-width: 150px;
            max-width: 150px;
          }

          .compareSelectMini {
            width: 112px;
            min-width: 112px;
            max-width: 112px;
          }

          .titleMain {
            display: grid;
            justify-items: center;
            align-items: center;
            text-align: center;
            min-width: 0;
          }

          .kicker {
            margin-bottom: 8px;
            text-align: center;
          }

          .dayTitleLine {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 14px;
            width: max-content;
            max-width: 100%;
          }

          .year {
            margin: 0;
            font-size: 58px;
            line-height: 1;
            letter-spacing: -0.04em;
            text-align: center;
            white-space: nowrap;
            color: #111111;
          }

          .arrowCircle {
            width: 48px !important;
            height: 48px !important;
            min-width: 48px !important;
            min-height: 48px !important;
            border: 0 !important;
            background: transparent !important;
            color: #475569 !important;
            opacity: 0.82;
            box-shadow: none !important;
          }

          .arrowCircle:hover {
            background: rgba(15, 23, 42, 0.05) !important;
            transform: translateY(-1px);
            opacity: 1;
          }

          .arrowSvg {
            width: 32px !important;
            height: 32px !important;
            color: #475569 !important;
          }

          .dayContextLinks {
            margin-top: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            flex-wrap: wrap;
          }

          .contextPill {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 34px;
            padding: 0 14px;
            border-radius: 999px;
            border: 1px solid #d8dee7;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            text-decoration: none;
            color: #5f7897;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 4px 14px rgba(15, 23, 42, 0.035);
            font-size: 14px;
            line-height: 1;
            font-weight: 950;
            transition:
              transform 120ms ease,
              box-shadow 120ms ease,
              background 120ms ease;
          }

          .contextPill:hover {
            transform: translateY(-1px);
            background: #ffffff;
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
          }

          .contextPillMonth {
            padding-left: 16px;
            padding-right: 16px;
          }

          /* Sintesi giornaliera nello stesso stile della sintesi mensile */
          .summaryCompact {
            padding-top: 22px;
          }

          .summaryRows {
            gap: 12px;
          }

          .summaryRow {
            grid-template-columns: 190px 1fr;
            gap: 14px;
            border: 1px solid #e7e7e7;
            border-radius: 18px;
            background: linear-gradient(180deg, #ffffff, #fcfcfc);
            padding: 14px 16px;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.025);
          }

          .summaryHalf {
            grid-template-columns: 170px 1fr;
            gap: 14px;
            border: 1px solid #e7e7e7;
            border-radius: 18px;
            background: linear-gradient(180deg, #ffffff, #fcfcfc);
            padding: 14px 16px;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.025);
          }

          .summaryLabel {
            font-size: 16px;
            letter-spacing: 0.13em;
            color: #41546d;
            font-weight: 950;
            padding-right: 12px;
            border-right-color: #e7e7e7;
          }

          .summaryMetric {
            min-width: 0;
            display: grid;
            align-content: start;
            gap: 6px;
            padding: 11px 12px;
            border-radius: 15px;
            background: rgba(255, 255, 255, 0.92);
            border: 1px solid rgba(226, 232, 240, 0.95);
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 5px 14px rgba(15, 23, 42, 0.025);
          }

          .summaryRow:nth-child(1) .summaryMetric:nth-child(1),
          .summaryRow:nth-child(2) .summaryMetric,
          .summaryRow:nth-child(3) .summaryMetric:nth-child(1),
          .summaryRow:nth-child(4) .summaryMetric:nth-child(2),
          .summaryRow:nth-child(5) .summaryMetric:nth-child(1),
          .summaryHalf .summaryMetric:nth-child(2) {
            border-color: rgba(242, 140, 40, 0.25);
            background: linear-gradient(180deg, #fff, rgba(255, 247, 237, 0.72));
          }

          .summaryRow:nth-child(1) .summaryMetric:nth-child(3),
          .summaryRow:nth-child(3) .summaryMetric:nth-child(3),
          .summaryRow:nth-child(5) .summaryMetric:nth-child(3) {
            border-color: rgba(79, 70, 229, 0.22);
            background: linear-gradient(180deg, #fff, rgba(238, 242, 255, 0.74));
          }

          .summaryRow:nth-child(1) .summaryMetric:nth-child(1) strong,
          .summaryRow:nth-child(2) .summaryMetric strong,
          .summaryRow:nth-child(3) .summaryMetric:nth-child(1) strong,
          .summaryRow:nth-child(4) .summaryMetric:nth-child(2) strong,
          .summaryRow:nth-child(5) .summaryMetric:nth-child(1) strong,
          .summaryHalf .summaryMetric:nth-child(2) strong {
            color: #c2410c;
          }

          .summaryRow:nth-child(1) .summaryMetric:nth-child(3) strong,
          .summaryRow:nth-child(3) .summaryMetric:nth-child(3) strong,
          .summaryRow:nth-child(5) .summaryMetric:nth-child(3) strong {
            color: #3730a3;
          }

          .summaryKey {
            font-size: 10px;
            line-height: 1.2;
            color: #64748b;
            font-weight: 950;
            letter-spacing: 0.07em;
          }

          .summaryMetric strong {
            font-size: 21px;
            line-height: 1.05;
            font-weight: 950;
            letter-spacing: -0.035em;
          }

          @media (max-width: 1280px) {
            .dayHeaderGrid {
              grid-template-columns:
                minmax(170px, 220px)
                minmax(300px, 1fr)
                minmax(170px, 220px);
              gap: 18px;
            }

            .year {
              font-size: 52px;
            }

            .selectorLabel {
              font-size: 12px;
            }
          }

          @media (max-width: 1100px) {
            .dayHeaderGrid {
              grid-template-columns: 1fr 1fr;
              grid-template-areas:
                "daySelect compareYear"
                "title title";
              row-gap: 18px;
            }

            .daySelectHeaderWrap {
              grid-area: daySelect;
              justify-self: center;
            }

            .inlineCompareWrap,
            .headerSideSpacer {
              grid-area: compareYear;
              justify-self: center;
            }

            .titleMain {
              grid-area: title;
            }
          }

          @media (max-width: 760px) {
            .dayHeaderGrid {
              grid-template-columns: 1fr;
              grid-template-areas:
                "daySelect"
                "title"
                "compareYear";
              row-gap: 16px;
            }

            .daySelectHeaderWrap,
            .inlineCompareWrap {
              width: 100%;
              justify-self: stretch;
            }

            .selectorPill,
            .dayHeaderSelect,
            .compareSelectMini {
              width: 100%;
              min-width: 0;
              max-width: none;
            }

            .dayTitleLine {
              gap: 8px;
            }

            .year {
              font-size: 42px;
            }

            .arrowCircle {
              width: 40px !important;
              height: 40px !important;
              min-width: 40px !important;
              min-height: 40px !important;
            }

            .arrowSvg {
              width: 27px !important;
              height: 27px !important;
            }
          }

          @media (max-width: 520px) {
            .hero {
              padding: 14px;
              border-radius: 16px;
            }

            .year {
              width: auto;
              max-width: calc(100vw - 120px);
              font-size: 36px;
              line-height: 1.02;
              white-space: nowrap;
              overflow-wrap: normal;
            }

            .dayTitleLine {
              gap: 4px;
            }

            .arrowCircle {
              width: 32px !important;
              height: 38px !important;
              min-width: 32px !important;
              min-height: 38px !important;
            }

            .arrowSvg {
              width: 23px !important;
              height: 23px !important;
            }

            .contextPill {
              min-height: 32px;
              padding: 0 12px;
              font-size: 13px;
            }

            .summaryMetric {
              padding: 11px;
            }

            .summaryMetric strong {
              font-size: 19px;
            }

            .chartBox {
              padding: 6px;
              border-radius: 14px;
              overflow: hidden;
            }
          }

          @media (max-width: 390px) {
            .year {
              max-width: calc(100vw - 104px);
              font-size: 31px;
            }

            .arrowCircle {
              width: 28px !important;
              min-width: 28px !important;
            }

            .arrowSvg {
              width: 21px !important;
              height: 21px !important;
            }
          }

          /* Rifiniture finali per centratura e compattezza su mobile */
          .dayTableHead {
            position: relative;
            min-height: 48px;
            align-items: center;
          }

          .downloadCsvDesktop {
            appearance: none;
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            min-height: 42px;
            padding: 0 16px;
            border: 1px solid #d8dee7;
            border-radius: 999px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            color: #0f172a;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 4px 14px rgba(15, 23, 42, 0.04);
            font-size: 13px;
            font-weight: 950;
            cursor: pointer;
            transition:
              transform 120ms ease,
              box-shadow 120ms ease,
              background 120ms ease;
          }

          .downloadCsvDesktop:hover {
            transform: translateY(calc(-50% - 1px));
            background: #ffffff;
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.07);
          }

          .charts2,
          .chartBox {
            min-width: 0;
            box-sizing: border-box;
          }

          .chartBox > :global(div) {
            width: 100% !important;
            margin-left: auto !important;
            margin-right: auto !important;
          }

          @media (max-width: 760px) {
            .daySelectHeaderWrap {
              width: min(100%, 286px);
              max-width: 286px;
              margin-left: auto;
              margin-right: auto;
              justify-self: center;
            }

            .inlineCompareWrap {
              grid-area: compareYear;
              grid-column: 1 / -1;
              width: 100% !important;
              max-width: none !important;
              margin: 0 !important;
              justify-self: stretch !important;
              display: flex !important;
              flex-direction: column !important;
              align-items: center !important;
              justify-content: center !important;
              text-align: center !important;
            }

            .inlineCompareWrap .selectorLabel {
              width: auto;
              max-width: 100%;
              margin: 0 auto;
              text-align: center;
            }

            .inlineCompareWrap .compareSelectMini {
              width: min(286px, 100%) !important;
              min-width: 0 !important;
              max-width: 286px !important;
              margin-left: auto !important;
              margin-right: auto !important;
            }

            .selectorLabel {
              text-align: center;
            }

            .titleMain,
            .dayContextLinks {
              width: 100%;
              justify-content: center;
              justify-items: center;
              text-align: center;
            }

            .charts2 {
              width: 100%;
              justify-items: center;
              gap: 12px;
            }

            .chartBox,
            .chartBoxWide {
              width: 100%;
              max-width: 100%;
              margin-left: auto;
              margin-right: auto;
              padding: 4px 2px;
              overflow: hidden;
            }

            .summaryRows {
              gap: 9px;
            }

            .summaryRow,
            .summaryHalf {
              display: block;
              padding: 10px;
              border-radius: 15px;
            }

            .summaryRow.dual {
              gap: 9px;
            }

            .summaryLabel {
              justify-content: center;
              border-right: 0;
              border-bottom: 1px solid #eceff3;
              margin: 0 0 9px;
              padding: 0 0 8px;
              font-size: 13px;
              letter-spacing: 0.105em;
              text-align: center;
            }

            .summaryMetrics.three {
              grid-template-columns: repeat(3, minmax(0, 1fr));
              gap: 6px;
            }

            .summaryMetrics.two {
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 6px;
            }

            .summaryMetric {
              min-height: 72px;
              padding: 8px 5px;
              align-content: center;
              justify-items: center;
              text-align: center;
              border-radius: 12px;
            }

            .summaryKey {
              min-height: 20px;
              margin-bottom: 2px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 8.5px;
              line-height: 1.12;
              white-space: normal;
              text-align: center;
            }

            .summaryMetric strong {
              font-size: 15.5px;
              line-height: 1.02;
              white-space: normal;
              text-align: center;
            }

            .dayTableHead {
              min-height: 44px;
              justify-content: center;
            }

            .downloadCsvDesktop {
              display: none;
            }

            .tableWrap {
              margin-top: 8px;
            }
          }

          @media (max-width: 390px) {
            .summaryRow,
            .summaryHalf {
              padding: 8px;
            }

            .summaryMetric {
              min-height: 68px;
              padding: 7px 4px;
            }

            .summaryKey {
              font-size: 8px;
            }

            .summaryMetric strong {
              font-size: 14px;
            }
          }

        `}</style>
      </div>
    </SiteLayout>
  );
}