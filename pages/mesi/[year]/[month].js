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

  const ymSet = new Set(rows.map((r) => String(r.date).slice(0, 7)));
  const paths = Array.from(ymSet)
    .sort()
    .map((ym) => {
      const [year, month] = ym.split("-");
      return { params: { year, month } };
    });

  return { paths, fallback: false };
}

export async function getStaticProps({ params }) {
  const rows = readDaily();

  const year = String(params.year);
  const month = String(params.month).padStart(2, "0");
  const ym = `${year}-${month}`;

  const days = rows
    .filter((r) => String(r.date).startsWith(ym + "-"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const monthsInYear = Array.from(
    new Set(
      rows
        .filter((r) => String(r.date).startsWith(year + "-"))
        .map((r) => String(r.date).slice(0, 7))
    )
  ).sort();

  return {
    props: {
      year,
      month,
      ym,
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

// media circolare gradi
function circMeanDeg(arr) {
  let sx = 0;
  let sy = 0;
  let c = 0;
  for (const x of arr) {
    const v = n(x);
    if (!Number.isFinite(v)) continue;
    const rad = (v * Math.PI) / 180;
    sx += Math.cos(rad);
    sy += Math.sin(rad);
    c++;
  }
  if (!c) return NaN;
  const ang = Math.atan2(sy / c, sx / c);
  const deg = (ang * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
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
function monthFullFromMm(mm) {
  const m = Number(mm);
  return MONTHS_IT_FULL[m - 1] || mm;
}
function monthFullFromYm(ym) {
  const mm = Number(String(ym).slice(5, 7));
  return MONTHS_IT_FULL[mm - 1] || String(ym).slice(5, 7);
}
function dayOfMonthLabel(dateStr) {
  if (!dateStr || String(dateStr).length < 10) return "—";
  const dd = Number(String(dateStr).slice(8, 10));
  return Number.isFinite(dd) ? String(dd) : "—";
}
function degToCardinal16(v) {
  const n0 = Number(v);
  if (!Number.isFinite(n0)) return "—";
  const d = ((n0 % 360) + 360) % 360;
  const ix = Math.round(d / 22.5) % 16;
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][ix];
}

// umidità
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

// serie con null per buchi
function seriesLine(arr) {
  return arr.map((v) => (Number.isFinite(n(v)) ? n(v) : null));
}

// progressivo
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
export default function MonthPage(props) {
  const year = props.year ?? "";
  const month = props.month ?? "";
  const ym = props.ym ?? "";
  const days = Array.isArray(props.days) ? props.days : [];
  const monthsInYear = Array.isArray(props.monthsInYear) ? props.monthsInYear : [];

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("asc");

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return days;
    return days.filter((d) => String(d.date).toLowerCase().includes(qq));
  }, [days, q]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      if (sortKey === "date") return dir * String(a.date).localeCompare(String(b.date));
      const av = n(a[sortKey]);
      const bv = n(b[sortKey]);
      if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
      if (!Number.isFinite(av)) return 1;
      if (!Number.isFinite(bv)) return -1;
      return dir * (av - bv);
    });

    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(k) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "date" ? "asc" : "desc");
    }
  }

  const chrono = useMemo(() => {
    return [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [days]);

  const summary = useMemo(() => {
    const minT = minFinite(days.map((d) => d.tmin));
    const maxT = maxFinite(days.map((d) => d.tmax));
    const meanT = avgFinite(days.map((d) => d.tmean));

    const rainSum = sumFinite(days.map((d) => d.rain_total));
    const rainyDays = days.map((d) => n(d.rain_total)).filter((x) => Number.isFinite(x) && x >= 1).length;

    const gustMax = maxFinite(days.map((d) => d.gust_max));
    const pressMean = avgFinite(days.map((d) => d.press_avg));
    const rhMean = avgFinite(days.map((d) => getRhMean(d)));

    return { ndays: days.length, minT, maxT, meanT, rainSum, rainyDays, gustMax, pressMean, rhMean };
  }, [days]);

  // ---- riga riepilogo: medie mensili
  const monthAvgRow = useMemo(() => {
    const tmin = avgFinite(days.map((d) => d.tmin));
    const tmean = avgFinite(days.map((d) => d.tmean));
    const tmax = avgFinite(days.map((d) => d.tmax));

    const rain_total = avgFinite(days.map((d) => d.rain_total));
    const rainrate_max = avgFinite(days.map((d) => d.rainrate_max));

    const rh_min = avgFinite(days.map((d) => getRhMin(d)));
    const rh_mean = avgFinite(days.map((d) => getRhMean(d)));
    const rh_max = avgFinite(days.map((d) => getRhMax(d)));

    const wind_avg = avgFinite(days.map((d) => d.wind_avg));
    const gust_max = avgFinite(days.map((d) => d.gust_max));
    const wind_dir_mean_deg = circMeanDeg(days.map((d) => d.wind_dir_mean_deg));

    const press_min = avgFinite(days.map((d) => d.press_min));
    const press_avg = avgFinite(days.map((d) => d.press_avg));
    const press_max = avgFinite(days.map((d) => d.press_max));

    const uv_mean_pos = avgFinite(days.map((d) => d.uv_mean_pos));
    const uv_max = avgFinite(days.map((d) => d.uv_max));
    const solar_mean_pos = avgFinite(days.map((d) => d.solar_mean_pos));
    const solar_max = avgFinite(days.map((d) => d.solar_max));

    return {
      tmin,
      tmean,
      tmax,
      rain_total,
      rainrate_max,
      rh_min,
      rh_mean,
      rh_max,
      wind_avg,
      gust_max,
      wind_dir_mean_deg,
      press_min,
      press_avg,
      press_max,
      uv_mean_pos,
      uv_max,
      solar_mean_pos,
      solar_max,
    };
  }, [days]);

  // -------------------- charts --------------------
  const xLabels = chrono.map((d) => dayOfMonthLabel(d.date));

  const baseChart = {
    animation: false,
    grid: { left: 52, right: 40, top: 72, bottom: 38 },
    xAxis: { type: "category", data: xLabels, boundaryGap: true, axisLabel: { hideOverlap: true } },
    toolbox: { feature: { restore: {} }, right: 10, top: 8 },
    title: { left: "center", top: 6 },
    legend: { top: 34, left: "center" },
    tooltip: { trigger: "axis" },
  };

  const optTemp = {
    ...baseChart,
    title: { ...baseChart.title, text: "Temperature giornaliere" },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`) },
    yAxis: { type: "value", name: "°C", scale: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) } },
    series: [
      { name: "Tmin", type: "line", data: seriesLine(chrono.map((d) => d.tmin)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Tmedia", type: "line", data: seriesLine(chrono.map((d) => d.tmean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Tmax", type: "line", data: seriesLine(chrono.map((d) => d.tmax)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
    ],
  };

  const rainDaily = chrono.map((d) => d.rain_total);
  const rainCum = cumulative(rainDaily);

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
        const day = xLabels[i] ?? "—";
        const acc = n(chrono[i]?.rain_total);
        const cum = n(rainCum[i]);
        const rr = n(chrono[i]?.rainrate_max);
        return [
          `<b>Giorno ${day}</b>`,
          `Accumulo: ${Number.isFinite(acc) ? acc.toFixed(1) + " mm" : "—"}`,
          `Progressivo: ${Number.isFinite(cum) ? cum.toFixed(1) + " mm" : "—"}`,
          `Rain rate max: ${Number.isFinite(rr) ? rr.toFixed(1) + " mm/h" : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "Accumulo", type: "bar", data: seriesLine(rainDaily), yAxisIndex: 0 },
      { name: "Progressivo", type: "line", data: seriesLine(rainCum), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rain rate max", type: "scatter", data: seriesLine(chrono.map((d) => d.rainrate_max)), yAxisIndex: 1, symbolSize: 7 },
    ],
  };

  const optRh = {
    ...baseChart,
    title: { ...baseChart.title, text: "Umidità" },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`) },
    yAxis: { type: "value", name: "%", min: 0, max: 100, splitNumber: 5, axisLabel: { formatter: (v) => `${Math.round(Number(v))}` } },
    series: [
      { name: "UR min", type: "line", data: seriesLine(chrono.map((d) => getRhMin(d))), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "UR media", type: "line", data: seriesLine(chrono.map((d) => getRhMean(d))), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "UR max", type: "line", data: seriesLine(chrono.map((d) => getRhMax(d))), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
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
        const day = xLabels[i] ?? "—";
        const wAvg = n(chrono[i]?.wind_avg);
        const gust = n(chrono[i]?.gust_max);
        const dir = n(chrono[i]?.wind_dir_mean_deg);
        return [
          `<b>Giorno ${day}</b>`,
          `Vento medio: ${Number.isFinite(wAvg) ? wAvg.toFixed(1) + " km/h" : "—"}`,
          `Raffica: ${Number.isFinite(gust) ? gust.toFixed(1) + " km/h" : "—"}`,
          `Direzione media: ${Number.isFinite(dir) ? `${degToCardinal16(dir)} (${Math.round(dir)}°)` : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "Vento medio", type: "line", data: seriesLine(chrono.map((d) => d.wind_avg)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Raffica", type: "line", data: seriesLine(chrono.map((d) => d.gust_max)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Direzione media", type: "scatter", data: seriesLine(chrono.map((d) => d.wind_dir_mean_deg)), yAxisIndex: 1, symbolSize: 7 },
    ],
  };

  const optPress = {
    ...baseChart,
    title: { ...baseChart.title, text: "Pressione" },
    tooltip: { trigger: "axis", valueFormatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`) },
    yAxis: { type: "value", name: "hPa", scale: true, splitNumber: 5, axisLabel: { formatter: (v) => Number(v).toFixed(0) } },
    series: [
      { name: "P min", type: "line", data: seriesLine(chrono.map((d) => d.press_min)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "P media", type: "line", data: seriesLine(chrono.map((d) => d.press_avg)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "P max", type: "line", data: seriesLine(chrono.map((d) => d.press_max)), showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
    ],
  };

  const optUvRad = {
    ...baseChart,
    title: { ...baseChart.title, text: "UV e Radiazione" },
    yAxis: [
      { type: "value", name: "UV", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => Number(v).toFixed(1) } },
      { type: "value", name: "W/m²", scale: true, splitNumber: 5, alignTicks: true, axisLabel: { formatter: (v) => String(Math.round(Number(v))) } },
    ],
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const i = params?.[0]?.dataIndex ?? 0;
        const day = xLabels[i] ?? "—";
        const uvM = n(chrono[i]?.uv_mean_pos);
        const uvX = n(chrono[i]?.uv_max);
        const solM = n(chrono[i]?.solar_mean_pos);
        const solX = n(chrono[i]?.solar_max);
        return [
          `<b>Giorno ${day}</b>`,
          `UV medio (>0): ${Number.isFinite(uvM) ? uvM.toFixed(1) : "—"}`,
          `UV max: ${Number.isFinite(uvX) ? uvX.toFixed(1) : "—"}`,
          `Rad media (>0): ${Number.isFinite(solM) ? Math.round(solM) + " W/m²" : "—"}`,
          `Rad max: ${Number.isFinite(solX) ? Math.round(solX) + " W/m²" : "—"}`,
        ].join("<br/>");
      },
    },
    series: [
      { name: "UV medio", type: "line", data: seriesLine(chrono.map((d) => d.uv_mean_pos)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "UV max", type: "line", data: seriesLine(chrono.map((d) => d.uv_max)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rad media", type: "line", data: seriesLine(chrono.map((d) => d.solar_mean_pos)), yAxisIndex: 1, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
      { name: "Rad max", type: "line", data: seriesLine(chrono.map((d) => d.solar_max)), yAxisIndex: 1, showSymbol: false, connectNulls: false, lineStyle: { width: 2 } },
    ],
  };

  // -------------------- download --------------------
  function downloadCsv() {
    const cols = [
      "date",
      "tmin",
      "tmean",
      "tmax",
      "rain_total",
      "rainrate_max",
      "rh_min",
      "rh_mean",
      "rh_max",
      "wind_avg",
      "gust_max",
      "wind_dir_mean_deg",
      "press_min",
      "press_avg",
      "press_max",
      "uv_mean_pos",
      "uv_max",
      "solar_mean_pos",
      "solar_max",
    ];

    const header = cols.join(",");
    const lines = sorted.map((d) =>
      cols
        .map((c) => {
          let v = d[c];

          if (c === "rh_min") v = Number.isFinite(getRhMin(d)) ? getRhMin(d) : v;
          if (c === "rh_mean") v = Number.isFinite(getRhMean(d)) ? getRhMean(d) : v;
          if (c === "rh_max") v = Number.isFinite(getRhMax(d)) ? getRhMax(d) : v;

          if (v === null || v === undefined) return "";
          const s = String(v).replaceAll('"', '""');
          return /[",\n]/.test(s) ? `"${s}"` : s;
        })
        .join(",")
    );

    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${ym || "mese"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ====== NAV MESI: replicata IDENTICA allo stile pagina ANNO ======
  const monthNav = (
    <nav className="monthNav" aria-label="Vai al mese">
      {monthsInYear.map((m) => {
        const mm = String(m).slice(5, 7);
        const isActive = String(m) === String(ym);
        return (
          <Link
            key={m}
            href={`/mesi/${year}/${mm}`}
            className={isActive ? "monthLink active" : "monthLink"}
            title={`Apri ${monthFullFromYm(m)}`}
            aria-label={`Apri ${monthFullFromYm(m)}`}
          >
            <span className="ext" aria-hidden="true">
              ↗
            </span>
            <span className="monthText">{monthFullFromYm(m)}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="wrap">
      <div className="topbar">
        <Link className="back" href={`/anni/${year}`}>
          ← Anno {year}
        </Link>
        <div className="brand">
          <div className="brandTitle">Archivio Meteo</div>
          <div className="brandSub">Collinas • mese • {ym}</div>
        </div>
      </div>

      <header className="hero">
        <div className="heroRow">
          <div className="heroLeft">
            <div className="kicker">Mese</div>

            <h1>
              {monthFullFromMm(month)} {year}
            </h1>

            <div className="sub">
              {summary.ndays} giorni • Pioggia: <b>{fmt(summary.rainSum, 1)} mm</b> • Giorni piovosi: <b>{summary.rainyDays}</b>
            </div>
          </div>

          <div className="cards">
            <div className="card">
              <div className="label">Tmin mese</div>
              <div className="value">{fmt(summary.minT, 1)} °C</div>
            </div>
            <div className="card">
              <div className="label">Tmax mese</div>
              <div className="value">{fmt(summary.maxT, 1)} °C</div>
            </div>
            <div className="card">
              <div className="label">Tmedia mese</div>
              <div className="value">{fmt(summary.meanT, 1)} °C</div>
            </div>
            <div className="card">
              <div className="label">UR media mese</div>
              <div className="value">{fmtInt(summary.rhMean)} %</div>
            </div>
            <div className="card">
              <div className="label">Raffica max mese</div>
              <div className="value">{fmt(summary.gustMax, 1)} km/h</div>
            </div>
            <div className="card">
              <div className="label">Press. media mese</div>
              <div className="value">{fmt(summary.pressMean, 1)} hPa</div>
            </div>
          </div>
        </div>

        {/* MESI (stesso identico concetto della pagina ANNO: centrati, gap, bold, icona) */}
        <div className="monthNavWrap">{monthNav}</div>
      </header>

      {mounted && (
        <section className="charts">
          <div className="chartBox">
            <ReactECharts option={optTemp} style={{ height: 250, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optRain} style={{ height: 250, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optRh} style={{ height: 250, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optWind} style={{ height: 250, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optPress} style={{ height: 250, width: "100%" }} />
          </div>
          <div className="chartBox">
            <ReactECharts option={optUvRad} style={{ height: 250, width: "100%" }} />
          </div>
        </section>
      )}

      <section className="toolbar">
        <div className="search">
          <span className="hint">Filtra per data</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="es. 2021-02-21" />
        </div>

        <div className="tools">
          <div className="callout" title="Suggerimento">
            <span className="dot" />
            Clicca sul <b>giorno</b> per il dettaglio giornaliero →
          </div>

          <button
            className="btn"
            onClick={() => {
              setSortKey("date");
              setSortDir("asc");
            }}
          >
            Reset ordine (giorni)
          </button>
          <button className="btn primary" onClick={downloadCsv}>
            Scarica CSV (mese)
          </button>
        </div>
      </section>

      <section className="tableWrap">
        <table>
          <thead>
            <tr className="groupRow">
              <th className="group stickyHead bR" colSpan={1}>
                Giorno
              </th>
              <th className="group temp bR" colSpan={3}>
                Temperature
              </th>
              <th className="group rain bR" colSpan={2}>
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
              <Th onClick={() => toggleSort("date")} active={sortKey === "date"} dir={sortDir} className="bR stickyHead" title="Ordina per giorno">
                {"\u00A0"}
              </Th>

              <Th onClick={() => toggleSort("tmin")} active={sortKey === "tmin"} dir={sortDir}>
                Min
              </Th>
              <Th onClick={() => toggleSort("tmean")} active={sortKey === "tmean"} dir={sortDir}>
                Media
              </Th>
              <Th onClick={() => toggleSort("tmax")} active={sortKey === "tmax"} dir={sortDir} className="bR">
                Max
              </Th>

              <Th onClick={() => toggleSort("rain_total")} active={sortKey === "rain_total"} dir={sortDir}>
                Pioggia
              </Th>
              <Th onClick={() => toggleSort("rainrate_max")} active={sortKey === "rainrate_max"} dir={sortDir} className="bR">
                Rate max
              </Th>

              <Th onClick={() => toggleSort("rh_min")} active={sortKey === "rh_min"} dir={sortDir}>
                Min
              </Th>
              <Th onClick={() => toggleSort("rh_mean")} active={sortKey === "rh_mean"} dir={sortDir}>
                Media
              </Th>
              <Th onClick={() => toggleSort("rh_max")} active={sortKey === "rh_max"} dir={sortDir} className="bR">
                Max
              </Th>

              <Th onClick={() => toggleSort("wind_avg")} active={sortKey === "wind_avg"} dir={sortDir}>
                Medio
              </Th>
              <Th onClick={() => toggleSort("gust_max")} active={sortKey === "gust_max"} dir={sortDir}>
                Raffica
              </Th>
              <Th onClick={() => toggleSort("wind_dir_mean_deg")} active={sortKey === "wind_dir_mean_deg"} dir={sortDir} className="bR">
                Dir media
              </Th>

              <Th onClick={() => toggleSort("press_min")} active={sortKey === "press_min"} dir={sortDir}>
                Min
              </Th>
              <Th onClick={() => toggleSort("press_avg")} active={sortKey === "press_avg"} dir={sortDir}>
                Media
              </Th>
              <Th onClick={() => toggleSort("press_max")} active={sortKey === "press_max"} dir={sortDir} className="bR">
                Max
              </Th>

              <Th onClick={() => toggleSort("uv_mean_pos")} active={sortKey === "uv_mean_pos"} dir={sortDir}>
                UV medio
              </Th>
              <Th onClick={() => toggleSort("uv_max")} active={sortKey === "uv_max"} dir={sortDir}>
                UV max
              </Th>
              <Th onClick={() => toggleSort("solar_mean_pos")} active={sortKey === "solar_mean_pos"} dir={sortDir}>
                Rad media
              </Th>
              <Th onClick={() => toggleSort("solar_max")} active={sortKey === "solar_max"} dir={sortDir}>
                Rad max
              </Th>
            </tr>
          </thead>

          <tbody>
            {sorted.map((d) => {
              const rhMin = getRhMin(d);
              const rhMean = getRhMean(d);
              const rhMax = getRhMax(d);

              const hasRain = Number.isFinite(n(d.rain_total)) && n(d.rain_total) > 0;
              const hasRR = Number.isFinite(n(d.rainrate_max)) && n(d.rainrate_max) > 0;

              const dirDeg = n(d.wind_dir_mean_deg);
              const dirTxt = Number.isFinite(dirDeg) ? degToCardinal16(dirDeg) : "—";

              return (
                <tr key={d.date}>
                  <td className="date sticky bR">
                    <Link className="dayLink" href={`/giorni/${d.date}`} title={`Apri dettaglio del ${d.date}`}>
                      <span className="dayNum">{dayOfMonthLabel(d.date)}</span>
                      <span className="dayIcon">↗</span>
                    </Link>
                  </td>

                  <td>{fmt(d.tmin, 1)} °C</td>
                  <td className="strong">{fmt(d.tmean, 1)} °C</td>
                  <td className="bR">{fmt(d.tmax, 1)} °C</td>

                  <td className={hasRain ? "rainy" : ""}>{fmt(d.rain_total, 1)} mm</td>
                  <td className={`bR ${hasRR ? "rainy" : ""}`}>{fmt(d.rainrate_max, 1)} mm/h</td>

                  <td>{Number.isFinite(rhMin) ? `${Math.round(rhMin)} %` : "—"}</td>
                  <td className="strong">{Number.isFinite(rhMean) ? `${Math.round(rhMean)} %` : "—"}</td>
                  <td className="bR">{Number.isFinite(rhMax) ? `${Math.round(rhMax)} %` : "—"}</td>

                  <td>{fmt(d.wind_avg, 1)} km/h</td>
                  <td>{fmt(d.gust_max, 1)} km/h</td>
                  <td className="bR">
                    {dirTxt}
                    {Number.isFinite(dirDeg) ? <span style={{ opacity: 0.65 }}> ({Math.round(dirDeg)}°)</span> : null}
                  </td>

                  <td>{fmt(d.press_min, 1)} hPa</td>
                  <td>{fmt(d.press_avg, 1)} hPa</td>
                  <td className="bR">{fmt(d.press_max, 1)} hPa</td>

                  <td>{fmt(d.uv_mean_pos, 1)}</td>
                  <td>{fmt(d.uv_max, 1)}</td>
                  <td>{Number.isFinite(n(d.solar_mean_pos)) ? `${Math.round(n(d.solar_mean_pos))} W/m²` : "—"}</td>
                  <td>{Number.isFinite(n(d.solar_max)) ? `${Math.round(n(d.solar_max))} W/m²` : "—"}</td>
                </tr>
              );
            })}

            {!sorted.length && (
              <tr>
                <td colSpan={18} className="empty">
                  Nessun dato per il filtro corrente.
                </td>
              </tr>
            )}
          </tbody>

          <tfoot>
            <tr className="summaryRow">
              <td className="sticky bR summaryLabel">
                <span className="sumTag">MEDIA MENSILE</span>
              </td>

              <td>{fmt(monthAvgRow.tmin, 1)} °C</td>
              <td className="strong">{fmt(monthAvgRow.tmean, 1)} °C</td>
              <td className="bR">{fmt(monthAvgRow.tmax, 1)} °C</td>

              <td>{fmt(monthAvgRow.rain_total, 1)} mm</td>
              <td className="bR">{fmt(monthAvgRow.rainrate_max, 1)} mm/h</td>

              <td>{Number.isFinite(n(monthAvgRow.rh_min)) ? `${Math.round(n(monthAvgRow.rh_min))} %` : "—"}</td>
              <td className="strong">{Number.isFinite(n(monthAvgRow.rh_mean)) ? `${Math.round(n(monthAvgRow.rh_mean))} %` : "—"}</td>
              <td className="bR">{Number.isFinite(n(monthAvgRow.rh_max)) ? `${Math.round(n(monthAvgRow.rh_max))} %` : "—"}</td>

              <td>{fmt(monthAvgRow.wind_avg, 1)} km/h</td>
              <td>{fmt(monthAvgRow.gust_max, 1)} km/h</td>
              <td className="bR">
                {Number.isFinite(n(monthAvgRow.wind_dir_mean_deg)) ? degToCardinal16(monthAvgRow.wind_dir_mean_deg) : "—"}
                {Number.isFinite(n(monthAvgRow.wind_dir_mean_deg)) ? (
                  <span style={{ opacity: 0.65 }}> ({Math.round(n(monthAvgRow.wind_dir_mean_deg))}°)</span>
                ) : null}
              </td>

              <td>{fmt(monthAvgRow.press_min, 1)} hPa</td>
              <td>{fmt(monthAvgRow.press_avg, 1)} hPa</td>
              <td className="bR">{fmt(monthAvgRow.press_max, 1)} hPa</td>

              <td>{fmt(monthAvgRow.uv_mean_pos, 1)}</td>
              <td>{fmt(monthAvgRow.uv_max, 1)}</td>
              <td>{Number.isFinite(n(monthAvgRow.solar_mean_pos)) ? `${Math.round(n(monthAvgRow.solar_mean_pos))} W/m²` : "—"}</td>
              <td>{Number.isFinite(n(monthAvgRow.solar_max)) ? `${Math.round(n(monthAvgRow.solar_max))} W/m²` : "—"}</td>
            </tr>
          </tfoot>
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

        .hero {
          border: 1px solid #ececec;
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02), 0 12px 34px rgba(0, 0, 0, 0.04);
          padding: 18px;
        }

        .heroRow {
          display: grid;
          grid-template-columns: 1.1fr 1fr;
          gap: 14px;
        }

        .kicker {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          opacity: 0.6;
          margin-bottom: 8px;
        }
        h1 {
          margin: 0;
          font-size: 40px;
          line-height: 1.05;
          letter-spacing: -0.02em;
        }
        .sub {
          margin-top: 8px;
          opacity: 0.75;
        }

        /* ====== MESI: COPIA DELLA PAGINA ANNO ====== */
        .monthNavWrap {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid #efefef;
        }
        .monthNav {
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
        .monthLink.active {
          background: #111;
          color: #fff;
        }
        .monthLink.active .ext {
          opacity: 0.9;
        }
        .ext {
          font-size: 14px;
          opacity: 0.65;
          transform: translateY(-1px);
        }

        .cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .card {
          border: 1px solid #ededed;
          border-radius: 14px;
          padding: 12px;
          background: #fff;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
        }
        .label {
          font-size: 12px;
          opacity: 0.7;
        }
        .value {
          font-size: 22px;
          margin-top: 6px;
          font-weight: 800;
        }

        .charts {
          margin-top: 12px;
          display: grid;
          gap: 12px;
        }
        .chartBox {
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          padding: 8px;
          background: #fff;
        }

        .toolbar {
          margin-top: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 12px;
          border: 1px solid #e7e7e7;
          border-radius: 14px;
          background: #fff;
        }
        .search {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 240px;
        }
        .hint {
          font-size: 12px;
          opacity: 0.7;
        }
        input {
          border: 1px solid #e2e2e2;
          border-radius: 10px;
          padding: 10px 12px;
          outline: none;
        }
        input:focus {
          border-color: #111;
        }
        .tools {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
          align-items: center;
        }

        .callout {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid #e7e7e7;
          background: linear-gradient(180deg, #fff, #fbfbfb);
          font-size: 13px;
          white-space: nowrap;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
        }
        .dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #111;
          display: inline-block;
        }

        .btn {
          border: 1px solid #e2e2e2;
          background: #fff;
          padding: 10px 12px;
          border-radius: 10px;
          cursor: pointer;
          white-space: nowrap;
        }
        .btn:hover {
          border-color: #bdbdbd;
        }
        .btn.primary {
          border-color: #111;
          background: #111;
          color: #fff;
        }
        .btn.primary:hover {
          opacity: 0.9;
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

        tbody td,
        tfoot td {
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

        .dayLink {
          color: #111;
          text-decoration: none;
          font-weight: 900;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          text-align: center;
          border: 1px solid #e7e7e7;
          border-radius: 10px;
          padding: 8px 10px;
          background: #fff;
          transition: transform 0.08s ease, box-shadow 0.12s ease, border-color 0.12s ease;
        }
        .dayLink:hover {
          border-color: #111;
          box-shadow: 0 0 0 3px rgba(17, 17, 17, 0.06);
          transform: translateY(-1px);
        }
        .dayNum {
          font-weight: 950;
        }
        .dayIcon {
          opacity: 0.7;
          font-size: 12px;
        }

        .strong {
          font-weight: 900;
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

        tfoot td {
          border-top: 2px solid #e7e7e7;
          border-bottom: 0;
          background: #fbfbfb;
          font-weight: 900;
        }
        .summaryRow td {
          padding-top: 12px;
          padding-bottom: 12px;
        }
        .summaryLabel {
          text-align: left;
          padding-left: 12px;
        }
        .sumTag {
          display: inline-block;
          font-weight: 950;
          letter-spacing: 0.08em;
          font-size: 11px;
          text-transform: uppercase;
        }

        @media (max-width: 980px) {
          .heroRow {
            grid-template-columns: 1fr;
          }
          .callout {
            display: none;
          }
        }

        @media (max-width: 520px) {
          .monthLink {
            font-size: 14px;
            padding: 6px 8px;
          }
        }
      `}</style>
    </div>
  );
}

function Th({ children, onClick, active, dir, className, title }) {
  return (
    <th onClick={onClick} className={className} style={{ cursor: "pointer" }} title={title}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {children}
        {active ? <span style={{ opacity: 0.6 }}>{dir === "asc" ? "▲" : "▼"}</span> : <span style={{ opacity: 0.25 }}>↕</span>}
      </span>
    </th>
  );
}