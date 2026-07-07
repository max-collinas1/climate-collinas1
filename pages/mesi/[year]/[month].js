import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import SiteLayout from "../../../components/SiteLayout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// -------------------- data load --------------------
function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(raw) ? raw : [];
}

function readMonthlyOverrides() {
  const filePath = path.join(process.cwd(), "data", "monthly_overrides.json");
  if (!fs.existsSync(filePath)) return [];
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Array.isArray(raw) ? raw : [];
}

function findMonthlyOverride(overrides, ym, field) {
  return (
    (overrides || []).find(
      (o) =>
        String(o?.scope ?? "") === "month" &&
        String(o?.ym ?? "") === String(ym) &&
        String(o?.field ?? "") === String(field)
    ) || null
  );
}

export async function getStaticPaths() {
  const rows = readDaily();

  const ymSet = new Set(
    rows
      .map((r) => String(r?.date ?? "").trim())
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .map((d) => d.slice(0, 7))
  );

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
  const overrides = readMonthlyOverrides();

  const year = String(params?.year ?? "");
  const month = String(params?.month ?? "").padStart(2, "0");
  const ym = `${year}-${month}`;

  const days = rows
    .filter((r) => String(r?.date ?? "").startsWith(ym + "-"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const monthsInYear = Array.from(
    new Set(
      rows
        .filter((r) => String(r?.date ?? "").startsWith(year + "-"))
        .map((r) => String(r.date).slice(0, 7))
    )
  ).sort();

  const allMonths = Array.from(
    new Set(
      rows
        .map((r) => String(r?.date ?? "").trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .map((d) => d.slice(0, 7))
    )
  ).sort();

  const mix = allMonths.indexOf(ym);
  const prevMonth = mix > 0 ? allMonths[mix - 1] : null;
  const nextMonth =
    mix >= 0 && mix < allMonths.length - 1 ? allMonths[mix + 1] : null;

  const compareOptions = allMonths
    .filter((itemYm) => String(itemYm).slice(5, 7) === month)
    .map((itemYm) => ({
      year: String(itemYm).slice(0, 4),
      ym: itemYm,
    }));

  const rainOverride = findMonthlyOverride(overrides, ym, "rainSum");

  return {
    props: {
      year,
      month,
      ym,
      days,
      monthsInYear,
      prevMonth,
      nextMonth,
      compareOptions,
      rainOverride: rainOverride
        ? {
            value: rainOverride.value ?? null,
            source: rainOverride.source ?? "",
            label: rainOverride.label ?? "",
            note: rainOverride.note ?? "",
          }
        : null,
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

function applyRainMonthOverride(rawValue, override) {
  const ov = n(override?.value);

  if (Number.isFinite(ov)) {
    return {
      value: ov,
      isOverride: true,
      source: String(override?.source ?? ""),
      label: String(override?.label ?? "Dato ARPAS"),
      note: String(override?.note ?? ""),
    };
  }

  return {
    value: rawValue,
    isOverride: false,
    source: "",
    label: "",
    note: "",
  };
}

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

  return [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ][ix];
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

function buildMonthStats(days, rainOverride) {
  const rawRainMonthSum = sumFinite(days.map((d) => d.rain_total));
  const resolvedRainMonth = applyRainMonthOverride(rawRainMonthSum, rainOverride);

  return {
    tmaxMean: avgFinite(days.map((d) => d.tmax)),
    tmean: avgFinite(days.map((d) => d.tmean)),
    tminMean: avgFinite(days.map((d) => d.tmin)),
    tmaxAbs: maxFinite(days.map((d) => d.tmax)),
    tmeanMax: maxFinite(days.map((d) => d.tmean)),
    tminAbs: minFinite(days.map((d) => d.tmin)),

    rainSum: resolvedRainMonth.value,
    rainIsOverride: resolvedRainMonth.isOverride,
    rainLabel: resolvedRainMonth.label,
    rainSource: resolvedRainMonth.source,
    rainNote: resolvedRainMonth.note,
    rainyDays: days
      .map((d) => n(d.rain_total))
      .filter((x) => Number.isFinite(x) && x > 1).length,
    rainDayMax: maxFinite(days.map((d) => d.rain_total)),
    rainrateMax: maxFinite(days.map((d) => d.rainrate_max)),

    rhMaxMean: avgFinite(days.map((d) => getRhMax(d))),
    rhMean: avgFinite(days.map((d) => getRhMean(d))),
    rhMinMean: avgFinite(days.map((d) => getRhMin(d))),
    rhMaxAbs: maxFinite(days.map((d) => getRhMax(d))),
    rhMeanMax: maxFinite(days.map((d) => getRhMean(d))),
    rhMinAbs: minFinite(days.map((d) => getRhMin(d))),

    windMean: avgFinite(days.map((d) => d.wind_avg)),
    gustMean: avgFinite(days.map((d) => d.gust_max)),
    windMaxMean: maxFinite(days.map((d) => d.wind_avg)),
    gustMax: maxFinite(days.map((d) => d.gust_max)),
    windDirMean: circMeanDeg(days.map((d) => d.wind_dir_mean_deg)),

    pressMaxMean: avgFinite(days.map((d) => d.press_max)),
    pressMean: avgFinite(days.map((d) => d.press_avg)),
    pressMinMean: avgFinite(days.map((d) => d.press_min)),
    pressMaxAbs: maxFinite(days.map((d) => d.press_max)),
    pressMeanMax: maxFinite(days.map((d) => d.press_avg)),
    pressMinAbs: minFinite(days.map((d) => d.press_min)),

    uvMean: avgFinite(days.map((d) => d.uv_mean_pos)),
    uvMax: maxFinite(days.map((d) => d.uv_max)),
    uvMaxMean: avgFinite(days.map((d) => d.uv_max)),

    solarMean: avgFinite(days.map((d) => d.solar_mean_pos)),
    solarMax: maxFinite(days.map((d) => d.solar_max)),
    solarMaxMean: avgFinite(days.map((d) => d.solar_max)),
  };
}

function SummaryMetric({
  label,
  value,
  tone = "neutral",
  extremeLabel = "",
  extremeValue = "",
  extremeTone = "neutral",
}) {
  return (
    <div className={`summaryMetric summaryMetric-${tone}`}>
      <span className="summaryKey">{label}</span>

      <div className="summaryValueLine">
        <strong className={`summaryValue summaryValue-${tone}`}>{value}</strong>
      </div>

      {extremeLabel ? (
        <div className={`summaryExtreme summaryExtreme-${extremeTone}`}>
          <span>{extremeLabel}</span>
          <b>{extremeValue}</b>
        </div>
      ) : null}
    </div>
  );
}

function MonthArrow({ href, direction, label, title, disabled = false }) {
  const d =
    direction === "prev"
      ? "M21 6.5L9.5 16L21 25.5"
      : "M11 6.5L22.5 16L11 25.5";

  const content = (
    <svg className="monthArrowSvg" viewBox="0 0 32 32" aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="4.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  if (disabled || !href) {
    return (
      <span className="monthArrowButton disabled" aria-hidden="true">
        {content}
      </span>
    );
  }

  return (
    <Link href={href} className="monthArrowButton" aria-label={label} title={title}>
      {content}
    </Link>
  );
}

// -------------------- page --------------------
export default function MonthPage(props) {
  const router = useRouter();

  const year = props.year ?? "";
  const month = props.month ?? "";
  const ym = props.ym ?? "";
  const prevMonth = props.prevMonth ?? null;
  const nextMonth = props.nextMonth ?? null;
  const days = Array.isArray(props.days) ? props.days : [];
  const monthsInYear = Array.isArray(props.monthsInYear)
    ? props.monthsInYear
    : [];
  const rainOverride = props.rainOverride ?? null;
  const compareOptions = Array.isArray(props.compareOptions)
    ? props.compareOptions
    : [];

  const [mounted, setMounted] = useState(false);
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("asc");

  const compareAvailable = compareOptions.filter(
    (x) => x?.ym && x?.year && x.ym !== ym
  );

  const [comparePick, setComparePick] = useState(
    compareAvailable?.[0]?.year ?? ""
  );

  useEffect(() => setMounted(true), []);

  function ymToHref(ymStr) {
    if (!ymStr) return "#";
    const yy = String(ymStr).slice(0, 4);
    const mm = String(ymStr).slice(5, 7);
    return `/mesi/${yy}/${mm}`;
  }

  function yearMonthToHref(targetYear, targetMonth) {
    if (!targetYear || !targetMonth) return "#";
    return `/mesi/${targetYear}/${String(targetMonth).padStart(2, "0")}`;
  }

  function onCompareChange(e) {
    const targetYear = String(e.target.value || "");
    setComparePick(targetYear);

    if (targetYear) {
      router.push(yearMonthToHref(targetYear, month));
    }
  }

  function onMonthSelect(e) {
    const itemYm = e.target.value;
    if (!itemYm) return;

    const yy = String(itemYm).slice(0, 4);
    const mm = String(itemYm).slice(5, 7);

    router.push(`/mesi/${yy}/${mm}`);
  }

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return days;

    return days.filter((d) => String(d.date).toLowerCase().includes(qq));
  }, [days, q]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      if (sortKey === "date") {
        return dir * String(a.date).localeCompare(String(b.date));
      }

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
    if (sortKey === k) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(k);
      setSortDir(k === "date" ? "asc" : "desc");
    }
  }

  const chrono = useMemo(() => {
    return [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [days]);

  const summary = useMemo(() => buildMonthStats(days, rainOverride), [days, rainOverride]);

  const monthAvgRow = useMemo(() => {
    return {
      tmin: avgFinite(days.map((d) => d.tmin)),
      tmean: avgFinite(days.map((d) => d.tmean)),
      tmax: avgFinite(days.map((d) => d.tmax)),

      rain_total: summary.rainSum,
      rain_is_override: summary.rainIsOverride,
      rain_note: summary.rainNote,
      rainrate_max: avgFinite(days.map((d) => d.rainrate_max)),

      rh_min: avgFinite(days.map((d) => getRhMin(d))),
      rh_mean: avgFinite(days.map((d) => getRhMean(d))),
      rh_max: avgFinite(days.map((d) => getRhMax(d))),

      wind_avg: avgFinite(days.map((d) => d.wind_avg)),
      gust_max: avgFinite(days.map((d) => d.gust_max)),
      wind_dir_mean_deg: circMeanDeg(days.map((d) => d.wind_dir_mean_deg)),

      press_min: avgFinite(days.map((d) => d.press_min)),
      press_avg: avgFinite(days.map((d) => d.press_avg)),
      press_max: avgFinite(days.map((d) => d.press_max)),

      uv_mean_pos: avgFinite(days.map((d) => d.uv_mean_pos)),
      uv_max: avgFinite(days.map((d) => d.uv_max)),

      solar_mean_pos: avgFinite(days.map((d) => d.solar_mean_pos)),
      solar_max: avgFinite(days.map((d) => d.solar_max)),
    };
  }, [days, summary]);

  const x = chrono.map((d) => dayOfMonthLabel(d.date));
  const rainDaily = chrono.map((d) => d.rain_total);
  const rainCum = cumulative(rainDaily);

  const currentDirTxt = Number.isFinite(n(summary.windDirMean))
    ? degToCardinal16(summary.windDirMean)
    : "—";

  const COLORS = {
    red: "#ff2d20",
    orange: "#f28c28",
    grayDark: "#4b5563",
    blueLight: "#60a5fa",
    greenStrong: "#2f9e44",
    windDir: "#7c3aed",
  };

  const baseChart = {
    animation: false,
    grid: { left: 64, right: 34, top: 92, bottom: 110 },
    xAxis: {
      type: "category",
      data: x,
      axisLabel: { rotate: 0, margin: 14, hideOverlap: true },
    },
    title: {
      left: "center",
      top: 10,
      textStyle: {
        fontSize: 17,
        fontWeight: 900,
        width: 300,
        overflow: "break",
      },
    },
    legend: {
      bottom: 10,
      left: "center",
      type: "scroll",
      itemGap: 12,
      padding: [6, 10, 6, 10],
      textStyle: {
        fontSize: 11,
        fontWeight: 700,
      },
    },
    toolbox: {
      feature: { restore: {} },
      right: 4,
      top: 8,
      itemSize: 14,
    },
    tooltip: { trigger: "axis", order: "seriesAsc" },
  };

  const optTemp = {
    ...baseChart,
    title: { ...baseChart.title, text: "Temperature giornaliere" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(params, [
          {
            name: "Tmax",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} °C`,
          },
          {
            name: "Tmedia",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} °C`,
          },
          {
            name: "Tmin",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} °C`,
          },
        ]),
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
      {
        name: "Tmax",
        type: "line",
        data: seriesLine(chrono.map((d) => d.tmax)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "Tmedia",
        type: "line",
        data: seriesLine(chrono.map((d) => d.tmean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
      {
        name: "Tmin",
        type: "line",
        data: seriesLine(chrono.map((d) => d.tmin)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.blueLight },
        itemStyle: { color: COLORS.blueLight },
      },
    ],
  };

  const optRain = {
    ...baseChart,
    title: { ...baseChart.title, text: "Precipitazioni" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(params, [
          {
            name: "Rate max",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} mm/h`,
          },
          {
            name: "Totale progressivo",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} mm`,
          },
          {
            name: "Pioggia",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} mm`,
          },
        ]),
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
    series: [
      {
        name: "Rate max",
        type: "scatter",
        data: seriesLine(chrono.map((d) => d.rainrate_max)),
        yAxisIndex: 1,
        symbolSize: 7,
        itemStyle: { color: COLORS.red },
        z: 5,
      },
      {
        name: "Totale progressivo",
        type: "line",
        data: seriesLine(rainCum),
        yAxisIndex: 0,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 4, color: COLORS.greenStrong },
        itemStyle: { color: COLORS.greenStrong },
        z: 6,
      },
      {
        name: "Pioggia",
        type: "bar",
        data: seriesLine(rainDaily),
        yAxisIndex: 0,
        itemStyle: { color: "#4f6fd5" },
        z: 2,
      },
    ],
  };

  const optWind = {
    ...baseChart,
    title: { ...baseChart.title, text: "Vento" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(params, [
          {
            name: "Raffica max",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} km/h`,
          },
          {
            name: "Raffica media",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} km/h`,
          },
          {
            name: "Vento medio",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} km/h`,
          },
          {
            name: "Dir media",
            formatter: (v) =>
              v == null
                ? "—"
                : `${degToCardinal16(v)} (${Math.round(Number(v))}°)`,
          },
        ]),
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
        axisLabel: {
          formatter: (v) => degToCardinal16(v),
        },
      },
    ],
    series: [
      {
        name: "Raffica max",
        type: "scatter",
        data: seriesLine(chrono.map((d) => d.gust_max)),
        yAxisIndex: 0,
        symbolSize: 7,
        itemStyle: { color: COLORS.red },
        z: 5,
      },
      {
        name: "Raffica media",
        type: "line",
        data: seriesLine(chrono.map((d) => d.gust_max)),
        yAxisIndex: 0,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: "#a3c614" },
        itemStyle: { color: "#a3c614" },
      },
      {
        name: "Vento medio",
        type: "line",
        data: seriesLine(chrono.map((d) => d.wind_avg)),
        yAxisIndex: 0,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: "#4f6fd5" },
        itemStyle: { color: "#4f6fd5" },
      },
      {
        name: "Dir media",
        type: "scatter",
        data: seriesLine(chrono.map((d) => d.wind_dir_mean_deg)),
        yAxisIndex: 1,
        symbol: "diamond",
        symbolSize: 10,
        itemStyle: { color: COLORS.windDir },
      },
    ],
  };

  const optRh = {
    ...baseChart,
    title: { ...baseChart.title, text: "Umidità" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(params, [
          {
            name: "Max",
            formatter: (v) =>
              v == null ? "—" : `${Math.round(Number(v))} %`,
          },
          {
            name: "Media",
            formatter: (v) =>
              v == null ? "—" : `${Math.round(Number(v))} %`,
          },
          {
            name: "Min",
            formatter: (v) =>
              v == null ? "—" : `${Math.round(Number(v))} %`,
          },
        ]),
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
        name: "Max",
        type: "line",
        data: seriesLine(chrono.map((d) => getRhMax(d))),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.blueLight },
        itemStyle: { color: COLORS.blueLight },
      },
      {
        name: "Media",
        type: "line",
        data: seriesLine(chrono.map((d) => getRhMean(d))),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
      {
        name: "Min",
        type: "line",
        data: seriesLine(chrono.map((d) => getRhMin(d))),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
    ],
  };

  const optPress = {
    ...baseChart,
    title: { ...baseChart.title, text: "Pressione" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(params, [
          {
            name: "Max",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} hPa`,
          },
          {
            name: "Media",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} hPa`,
          },
          {
            name: "Min",
            formatter: (v) =>
              v == null ? "—" : `${Number(v).toFixed(1)} hPa`,
          },
        ]),
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
        name: "Max",
        type: "line",
        data: seriesLine(chrono.map((d) => d.press_max)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "Media",
        type: "line",
        data: seriesLine(chrono.map((d) => d.press_avg)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
      {
        name: "Min",
        type: "line",
        data: seriesLine(chrono.map((d) => d.press_min)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.blueLight },
        itemStyle: { color: COLORS.blueLight },
      },
    ],
  };

  const optUv = {
    ...baseChart,
    title: { ...baseChart.title, text: "UV" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(params, [
          {
            name: "UV max",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)}`),
          },
          {
            name: "UV medio",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)}`),
          },
        ]),
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
        name: "UV max",
        type: "line",
        data: seriesLine(chrono.map((d) => d.uv_max)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "UV medio",
        type: "line",
        data: seriesLine(chrono.map((d) => d.uv_mean_pos)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
    ],
  };

  const optSolar = {
    ...baseChart,
    title: { ...baseChart.title, text: "Radiazione" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(params, [
          {
            name: "Rad max",
            formatter: (v) =>
              v == null ? "—" : `${Math.round(Number(v))} W/m²`,
          },
          {
            name: "Rad media",
            formatter: (v) =>
              v == null ? "—" : `${Math.round(Number(v))} W/m²`,
          },
        ]),
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
        name: "Rad max",
        type: "line",
        data: seriesLine(chrono.map((d) => d.solar_max)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "Rad media",
        type: "line",
        data: seriesLine(chrono.map((d) => d.solar_mean_pos)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
    ],
  };

  const LARGE_CHART_HEIGHT = 390;
  const NORMAL_CHART_HEIGHT = 370;

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
          if (c === "rh_mean")
            v = Number.isFinite(getRhMean(d)) ? getRhMean(d) : v;
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

  return (
    <SiteLayout headerProps={{}}>
      <div className="wrap">
        <header className="hero">
          <div className="yearTopRow">
            <div className="yearBlock">
              <div className="yearAndNav">
                <div className="topMonthSelectWrap">
                  <span className="selectorLabel">Seleziona mese</span>

                  <select
                    className="selectorPill monthTopSelect"
                    value={ym}
                    onChange={onMonthSelect}
                    aria-label={`Seleziona mese ${year}`}
                  >
                    {monthsInYear.map((itemYm) => (
                      <option key={itemYm} value={itemYm}>
                        {monthFullFromYm(itemYm)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="titleMain">
                  <div className="kicker">Mese</div>

                  <div className="yearLine">
                    <MonthArrow
                      href={prevMonth ? ymToHref(prevMonth) : ""}
                      direction="prev"
                      label="Mese precedente"
                      title="Precedente"
                      disabled={!prevMonth}
                    />

                    <h1 className="year">{monthFullFromMm(month)}</h1>

                    <MonthArrow
                      href={nextMonth ? ymToHref(nextMonth) : ""}
                      direction="next"
                      label="Mese successivo"
                      title="Successivo"
                      disabled={!nextMonth}
                    />
                  </div>

                  <Link
                    href={`/anni/${year}`}
                    className="yearInlineLink"
                    aria-label={`Torna all'anno ${year}`}
                    title={`Torna all'anno ${year}`}
                  >
                    <span>Anno</span>
                    <b>{year}</b>
                  </Link>
                </div>

                {compareAvailable.length > 0 && (
                  <div className="inlineCompareWrap">
                    <span className="selectorLabel">Seleziona anno</span>

                    <select
                      id="compare-month-select"
                      className="selectorPill"
                      value={comparePick}
                      onChange={onCompareChange}
                    >
                      <option value="">Anno</option>
                      {compareAvailable.map((o) => (
                        <option key={o.ym} value={o.year}>
                          {o.year}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>

          <section className="summaryCompact">
            <div className="summaryHead">
              <div>
                <h2>Sintesi mensile</h2>
                <p>Lettura rapida dei dati principali del mese.</p>
              </div>
            </div>

            <div className="summaryRows">
              <div className="summaryRow">
                <div className="summaryLabel">Temperature</div>

                <div className="summaryMetrics three">
                  <SummaryMetric
                    label="Massima media"
                    value={`${fmt(summary.tmaxMean, 1)} °C`}
                    tone="high"
                    extremeLabel="Massima assoluta"
                    extremeValue={`${fmt(summary.tmaxAbs, 1)} °C`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Media assoluta"
                    value={`${fmt(summary.tmean, 1)} °C`}
                    tone="neutral"
                    extremeLabel="Media giornaliera max"
                    extremeValue={`${fmt(summary.tmeanMax, 1)} °C`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Minima media"
                    value={`${fmt(summary.tminMean, 1)} °C`}
                    tone="low"
                    extremeLabel="Minima assoluta"
                    extremeValue={`${fmt(summary.tminAbs, 1)} °C`}
                    extremeTone="low"
                  />
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Precipitazioni</div>

                <div className="summaryMetrics four">
                  <SummaryMetric
                    label="Totale mensile"
                    value={`${fmt(summary.rainSum, 1)} mm`}
                    tone="high"
                  />

                  <SummaryMetric
                    label="Giorni > 1 mm"
                    value={fmtInt(summary.rainyDays)}
                    tone="high"
                  />

                  <SummaryMetric
                    label="Giorno più piovoso"
                    value={`${fmt(summary.rainDayMax, 1)} mm`}
                    tone="high"
                  />

                  <SummaryMetric
                    label="Rain rate più alto"
                    value={`${fmt(summary.rainrateMax, 1)} mm/h`}
                    tone="high"
                  />
                </div>

                {summary.rainIsOverride && summary.rainNote ? (
                  <div className="overrideNote">{summary.rainNote}</div>
                ) : null}
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Umidità</div>

                <div className="summaryMetrics three">
                  <SummaryMetric
                    label="Massima media"
                    value={`${fmtInt(summary.rhMaxMean)} %`}
                    tone="high"
                    extremeLabel="Massima assoluta"
                    extremeValue={`${fmtInt(summary.rhMaxAbs)} %`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Media assoluta"
                    value={`${fmtInt(summary.rhMean)} %`}
                    tone="neutral"
                    extremeLabel="Media giornaliera max"
                    extremeValue={`${fmtInt(summary.rhMeanMax)} %`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Minima media"
                    value={`${fmtInt(summary.rhMinMean)} %`}
                    tone="low"
                    extremeLabel="Minima assoluta"
                    extremeValue={`${fmtInt(summary.rhMinAbs)} %`}
                    extremeTone="low"
                  />
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Vento</div>

                <div className="summaryMetrics four">
                  <SummaryMetric
                    label="Media assoluta"
                    value={`${fmt(summary.windMean, 1)} km/h`}
                    tone="neutral"
                  />

                  <SummaryMetric
                    label="Media raffiche"
                    value={`${fmt(summary.gustMean, 1)} km/h`}
                    tone="high"
                  />

                  <SummaryMetric
                    label="Media massima"
                    value={`${fmt(summary.windMaxMean, 1)} km/h`}
                    tone="high"
                  />

                  <SummaryMetric
                    label="Raffica massima"
                    value={`${fmt(summary.gustMax, 1)} km/h`}
                    tone="high"
                  />
                </div>

                <div className="summarySmallNote">
                  Direzione media: <b>{currentDirTxt}</b>
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Pressione</div>

                <div className="summaryMetrics three">
                  <SummaryMetric
                    label="Massima media"
                    value={`${fmt(summary.pressMaxMean, 1)} hPa`}
                    tone="high"
                    extremeLabel="Massima assoluta"
                    extremeValue={`${fmt(summary.pressMaxAbs, 1)} hPa`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Media assoluta"
                    value={`${fmt(summary.pressMean, 1)} hPa`}
                    tone="neutral"
                    extremeLabel="Media giornaliera max"
                    extremeValue={`${fmt(summary.pressMeanMax, 1)} hPa`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Minima media"
                    value={`${fmt(summary.pressMinMean, 1)} hPa`}
                    tone="low"
                    extremeLabel="Minima assoluta"
                    extremeValue={`${fmt(summary.pressMinAbs, 1)} hPa`}
                    extremeTone="low"
                  />
                </div>
              </div>

              <div className="summaryRow dual">
                <div className="summaryHalf">
                  <div className="summaryLabel">UV</div>

                  <div className="summaryMetrics two">
                    <SummaryMetric
                      label="UV medio"
                      value={fmt(summary.uvMean, 1)}
                      tone="neutral"
                    />

                    <SummaryMetric
                      label="UV max medio"
                      value={fmt(summary.uvMaxMean, 1)}
                      tone="high"
                    />
                  </div>
                </div>

                <div className="summaryHalf">
                  <div className="summaryLabel">Radiazione</div>

                  <div className="summaryMetrics two">
                    <SummaryMetric
                      label="Rad media"
                      value={
                        Number.isFinite(n(summary.solarMean))
                          ? `${Math.round(n(summary.solarMean))} W/m²`
                          : "—"
                      }
                      tone="neutral"
                    />

                    <SummaryMetric
                      label="Rad max media"
                      value={
                        Number.isFinite(n(summary.solarMaxMean))
                          ? `${Math.round(n(summary.solarMaxMean))} W/m²`
                          : "—"
                      }
                      tone="high"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </header>

        {mounted && (
          <section className="charts2">
            <div className="chartBox chartBoxWide">
              <ReactECharts
                option={optTemp}
                style={{ height: LARGE_CHART_HEIGHT, width: "100%" }}
              />
            </div>

            <div className="chartBox chartBoxWide">
              <ReactECharts
                option={optRain}
                style={{ height: LARGE_CHART_HEIGHT, width: "100%" }}
              />
            </div>

            <div className="chartBox chartBoxWide">
              <ReactECharts
                option={optWind}
                style={{ height: LARGE_CHART_HEIGHT, width: "100%" }}
              />
            </div>

            <div className="chartBox">
              <ReactECharts
                option={optRh}
                style={{ height: NORMAL_CHART_HEIGHT, width: "100%" }}
              />
            </div>

            <div className="chartBox">
              <ReactECharts
                option={optPress}
                style={{ height: NORMAL_CHART_HEIGHT, width: "100%" }}
              />
            </div>

            <div className="chartBox">
              <ReactECharts
                option={optUv}
                style={{ height: NORMAL_CHART_HEIGHT, width: "100%" }}
              />
            </div>

            <div className="chartBox">
              <ReactECharts
                option={optSolar}
                style={{ height: NORMAL_CHART_HEIGHT, width: "100%" }}
              />
            </div>
          </section>
        )}

        <section className="tableTitleWrap">
          <div className="tableTitle">Riepilogo giornaliero</div>
        </section>

        <section className="toolbar">
          <div className="search">
            <span className="hint">Filtra per data</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="es. 2026-02-21"
            />
          </div>

          <div className="tools">
            <div className="callout" title="Suggerimento">
              <span className="dotMini" />
              <span>
                <span className="calloutFocus">Clicca sulla riga</span> per il
                dettaglio giornaliero →
              </span>
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
                <th className="group bR" colSpan={3}>
                  Temperature
                </th>
                <th className="group bR" colSpan={2}>
                  Precipitazioni
                </th>
                <th className="group bR" colSpan={3}>
                  Umidità
                </th>
                <th className="group bR" colSpan={3}>
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
                <Th
                  onClick={() => toggleSort("date")}
                  active={sortKey === "date"}
                  dir={sortDir}
                  className="bR stickyHead"
                  title="Ordina per giorno"
                >
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
                <Th onClick={() => toggleSort("uv_max")} active={sortKey === "uv_max"} dir={sortDir} className="bR">
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

                const hasRain =
                  Number.isFinite(n(d.rain_total)) && n(d.rain_total) > 0;
                const hasRR =
                  Number.isFinite(n(d.rainrate_max)) && n(d.rainrate_max) > 0;

                const dirDeg = n(d.wind_dir_mean_deg);
                const dirTxt = Number.isFinite(dirDeg)
                  ? degToCardinal16(dirDeg)
                  : "—";

                const href = `/giorni/${d.date}`;

                return (
                  <tr
                    key={d.date}
                    className="dayRowClickable"
                    onClick={() => router.push(href)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(href);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Apri dettaglio del giorno ${d.date}`}
                  >
                    <td className="date sticky bR">
                      <div className="dayCell">
                        <span className="dayNum">{dayOfMonthLabel(d.date)}</span>
                        <span className="dayIcon">↗</span>
                      </div>
                    </td>

                    <td>{fmt(d.tmin, 1)} °C</td>
                    <td className="strong">{fmt(d.tmean, 1)} °C</td>
                    <td className="bR">{fmt(d.tmax, 1)} °C</td>

                    <td className={hasRain ? "rainy" : ""}>
                      {fmt(d.rain_total, 1)} mm
                    </td>
                    <td className={`bR ${hasRR ? "rainy" : ""}`}>
                      {fmt(d.rainrate_max, 1)} mm/h
                    </td>

                    <td>{Number.isFinite(rhMin) ? `${Math.round(rhMin)} %` : "—"}</td>
                    <td className="strong">
                      {Number.isFinite(rhMean) ? `${Math.round(rhMean)} %` : "—"}
                    </td>
                    <td className="bR">
                      {Number.isFinite(rhMax) ? `${Math.round(rhMax)} %` : "—"}
                    </td>

                    <td>{fmt(d.wind_avg, 1)} km/h</td>
                    <td>{fmt(d.gust_max, 1)} km/h</td>
                    <td className="bR">
                      {dirTxt}
                      {Number.isFinite(dirDeg) ? (
                        <span style={{ opacity: 0.65 }}>
                          {" "}
                          ({Math.round(dirDeg)}°)
                        </span>
                      ) : null}
                    </td>

                    <td>{fmt(d.press_min, 1)} hPa</td>
                    <td>{fmt(d.press_avg, 1)} hPa</td>
                    <td className="bR">{fmt(d.press_max, 1)} hPa</td>

                    <td>{fmt(d.uv_mean_pos, 1)}</td>
                    <td className="bR">{fmt(d.uv_max, 1)}</td>

                    <td>
                      {Number.isFinite(n(d.solar_mean_pos))
                        ? `${Math.round(n(d.solar_mean_pos))} W/m²`
                        : "—"}
                    </td>
                    <td>
                      {Number.isFinite(n(d.solar_max))
                        ? `${Math.round(n(d.solar_max))} W/m²`
                        : "—"}
                    </td>
                  </tr>
                );
              })}

              {!sorted.length && (
                <tr>
                  <td colSpan={20} className="empty">
                    Nessun dato per il filtro corrente.
                  </td>
                </tr>
              )}
            </tbody>

            <tfoot>
              <tr className="summaryRowTable">
                <td className="sticky bR summaryLabelTable">
                  <span className="sumTag">Riepilogo mese</span>
                </td>

                <td>{fmt(monthAvgRow.tmin, 1)} °C</td>
                <td className="strong">{fmt(monthAvgRow.tmean, 1)} °C</td>
                <td className="bR">{fmt(monthAvgRow.tmax, 1)} °C</td>

                <td
                  title={monthAvgRow.rain_is_override ? "Dato rivisto ARPAS" : ""}
                  className={monthAvgRow.rain_is_override ? "rainOverrideCell" : ""}
                >
                  {fmt(monthAvgRow.rain_total, 1)} mm
                </td>
                <td className="bR">{fmt(monthAvgRow.rainrate_max, 1)} mm/h</td>

                <td>
                  {Number.isFinite(n(monthAvgRow.rh_min))
                    ? `${Math.round(n(monthAvgRow.rh_min))} %`
                    : "—"}
                </td>
                <td className="strong">
                  {Number.isFinite(n(monthAvgRow.rh_mean))
                    ? `${Math.round(n(monthAvgRow.rh_mean))} %`
                    : "—"}
                </td>
                <td className="bR">
                  {Number.isFinite(n(monthAvgRow.rh_max))
                    ? `${Math.round(n(monthAvgRow.rh_max))} %`
                    : "—"}
                </td>

                <td>{fmt(monthAvgRow.wind_avg, 1)} km/h</td>
                <td>{fmt(monthAvgRow.gust_max, 1)} km/h</td>
                <td className="bR">
                  {Number.isFinite(n(monthAvgRow.wind_dir_mean_deg))
                    ? degToCardinal16(monthAvgRow.wind_dir_mean_deg)
                    : "—"}
                  {Number.isFinite(n(monthAvgRow.wind_dir_mean_deg)) ? (
                    <span style={{ opacity: 0.65 }}>
                      {" "}
                      ({Math.round(n(monthAvgRow.wind_dir_mean_deg))}°)
                    </span>
                  ) : null}
                </td>

                <td>{fmt(monthAvgRow.press_min, 1)} hPa</td>
                <td>{fmt(monthAvgRow.press_avg, 1)} hPa</td>
                <td className="bR">{fmt(monthAvgRow.press_max, 1)} hPa</td>

                <td>{fmt(monthAvgRow.uv_mean_pos, 1)}</td>
                <td className="bR">{fmt(monthAvgRow.uv_max, 1)}</td>

                <td>
                  {Number.isFinite(n(monthAvgRow.solar_mean_pos))
                    ? `${Math.round(n(monthAvgRow.solar_mean_pos))} W/m²`
                    : "—"}
                </td>
                <td>
                  {Number.isFinite(n(monthAvgRow.solar_max))
                    ? `${Math.round(n(monthAvgRow.solar_max))} W/m²`
                    : "—"}
                </td>
              </tr>
            </tfoot>
          </table>
        </section>

        <style jsx>{`
          .wrap {
            background: transparent;
          }

          .hero {
            border: 1px solid #ececec;
            border-radius: 18px;
            background: rgba(255, 255, 255, 0.94);
            box-shadow:
              0 1px 0 rgba(0, 0, 0, 0.02),
              0 12px 34px rgba(0, 0, 0, 0.04);
            padding: 22px;
          }

          .yearTopRow,
          .yearBlock {
            width: 100%;
          }

          .yearAndNav {
            display: grid;
            grid-template-columns: minmax(190px, 260px) minmax(360px, 1fr) minmax(190px, 260px);
            gap: 22px;
            align-items: center;
            width: 100%;
            min-height: 160px;
          }

          .topMonthSelectWrap,
          .inlineCompareWrap {
            display: grid;
            justify-items: center;
            align-items: center;
            gap: 10px;
            min-width: 0;
          }

          .topMonthSelectWrap {
            justify-self: start;
          }

          .inlineCompareWrap {
            justify-self: end;
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

          .monthTopSelect {
            width: 160px;
            min-width: 160px;
            max-width: 160px;
          }

          .selectorPill:focus {
            outline: none;
            box-shadow:
              0 0 0 2px rgba(37, 99, 235, 0.12),
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 4px 14px rgba(15, 23, 42, 0.05);
            border-color: #b9c5d6;
          }

          .selectorPill option {
            color: #111111;
            background: #ffffff;
          }

          .titleMain {
            display: grid;
            justify-items: center;
            align-items: center;
            text-align: center;
            min-width: 0;
          }

          .kicker {
            font-size: 12px;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            opacity: 0.6;
            margin-bottom: 8px;
            text-align: center;
          }

          .yearLine {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 14px;
            width: max-content;
            max-width: 100%;
          }

          .year {
            margin: 0;
            font-size: 68px;
            line-height: 1;
            letter-spacing: -0.04em;
            text-align: center;
            white-space: nowrap;
            color: #111111;
          }

          .yearInlineLink {
            margin-top: 12px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 8px 16px;
            border-radius: 999px;
            border: 1px solid #d8dee7;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            text-decoration: none;
            color: #475569;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 4px 14px rgba(15, 23, 42, 0.035);
            transition:
              background 120ms ease,
              transform 120ms ease,
              box-shadow 120ms ease;
          }

          .yearInlineLink:hover {
            background: rgba(248, 250, 252, 0.95);
            transform: translateY(-1px);
            box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06);
          }

          .yearInlineLink span {
            font-size: 11px;
            font-weight: 950;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            opacity: 0.75;
          }

          .yearInlineLink b {
            font-size: 18px;
            line-height: 1;
            font-weight: 950;
            color: #5f7897;
            letter-spacing: -0.02em;
          }

          :global(.monthArrowButton) {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 48px !important;
            height: 48px !important;
            min-width: 48px !important;
            min-height: 48px !important;
            border-radius: 999px !important;
            color: #475569 !important;
            text-decoration: none !important;
            user-select: none !important;
            flex: 0 0 auto !important;
            opacity: 0.82 !important;
            visibility: visible !important;
            transition:
              background 120ms ease,
              transform 120ms ease,
              opacity 120ms ease;
          }

          :global(.monthArrowButton:hover) {
            background: rgba(15, 23, 42, 0.05) !important;
            transform: translateY(-1px);
            opacity: 1 !important;
          }

          :global(.monthArrowButton.disabled) {
            opacity: 0.28 !important;
            pointer-events: none !important;
          }

          :global(.monthArrowSvg) {
            width: 32px !important;
            height: 32px !important;
            min-width: 32px !important;
            min-height: 32px !important;
            display: block !important;
            overflow: visible !important;
            color: #475569 !important;
            stroke: currentColor !important;
          }

          .summaryCompact {
            margin-top: 18px;
            border-top: 1px solid #efefef;
            padding-top: 22px;
          }

          .summaryHead {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 14px;
            margin-bottom: 18px;
            text-align: center;
          }

          .summaryHead > div {
            width: 100%;
            max-width: 900px;
            margin-left: auto;
            margin-right: auto;
            text-align: center;
          }

          .summaryHead h2 {
            margin: 0;
            font-size: 24px;
            line-height: 1.15;
            font-weight: 950;
            letter-spacing: -0.02em;
            text-align: center;
          }

          .summaryHead p {
            margin: 6px auto 0;
            font-size: 13px;
            line-height: 1.45;
            color: #64748b;
            font-weight: 800;
            text-align: center;
          }

          .summaryRows {
            display: grid;
            gap: 12px;
          }

          .summaryRow {
            display: grid;
            grid-template-columns: 190px 1fr;
            gap: 14px;
            align-items: stretch;
            border: 1px solid #e7e7e7;
            border-radius: 18px;
            background: linear-gradient(180deg, #ffffff, #fcfcfc);
            padding: 14px 16px;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.025);
          }

          .summaryRow.dual {
            grid-template-columns: 1fr 1fr;
            padding: 0;
            border: 0;
            background: transparent;
            box-shadow: none;
          }

          .summaryHalf {
            display: grid;
            grid-template-columns: 170px 1fr;
            gap: 14px;
            align-items: stretch;
            border: 1px solid #e7e7e7;
            border-radius: 18px;
            background: linear-gradient(180deg, #ffffff, #fcfcfc);
            padding: 14px 16px;
            box-shadow: 0 8px 24px rgba(15, 23, 42, 0.025);
          }

          .summaryLabel {
            display: flex;
            align-items: center;
            font-size: 16px;
            letter-spacing: 0.13em;
            text-transform: uppercase;
            color: #41546d;
            font-weight: 950;
            padding-right: 12px;
            border-right: 1px solid #e7e7e7;
          }

          .summaryMetrics {
            display: grid;
            gap: 10px;
            align-items: stretch;
          }

          .summaryMetrics.four {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

          .summaryMetrics.three {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .summaryMetrics.two {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          :global(.summaryMetric) {
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

          :global(.summaryMetric-high) {
            border-color: rgba(242, 140, 40, 0.25);
            background: linear-gradient(180deg, #fff, rgba(255, 247, 237, 0.72));
          }

          :global(.summaryMetric-low) {
            border-color: rgba(79, 70, 229, 0.22);
            background: linear-gradient(180deg, #fff, rgba(238, 242, 255, 0.74));
          }

          :global(.summaryKey) {
            display: block;
            font-size: 10px;
            line-height: 1.2;
            color: #64748b;
            font-weight: 950;
            text-transform: uppercase;
            letter-spacing: 0.07em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          :global(.summaryValueLine) {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 9px;
            min-width: 0;
          }

          :global(.summaryValue) {
            display: block;
            min-width: 0;
            font-size: 21px;
            line-height: 1.05;
            font-weight: 950;
            letter-spacing: -0.035em;
            color: #0f172a;
            white-space: nowrap;
          }

          :global(.summaryValue-high) {
            color: #c2410c !important;
          }

          :global(.summaryValue-low) {
            color: #3730a3 !important;
          }

          :global(.summaryExtreme) {
            margin-top: 4px;
            padding-top: 7px;
            border-top: 1px solid rgba(226, 232, 240, 0.95);
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px;
            color: #64748b;
            font-weight: 850;
            min-width: 0;
          }

          :global(.summaryExtreme span) {
            font-size: 10px;
            line-height: 1.2;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          :global(.summaryExtreme b) {
            font-size: 13px;
            line-height: 1.1;
            font-weight: 950;
            color: #0f172a;
            white-space: nowrap;
          }

          :global(.summaryExtreme-high b) {
            color: #c2410c;
          }

          :global(.summaryExtreme-low b) {
            color: #3730a3;
          }

          .summarySmallNote {
            grid-column: 2 / -1;
            margin-top: 2px;
            font-size: 12px;
            color: #64748b;
            font-weight: 850;
          }

          .overrideNote {
            grid-column: 2 / -1;
            margin-top: 2px;
            font-size: 12px;
            line-height: 1.55;
            color: #64748b;
            font-weight: 750;
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

          .tableTitleWrap {
            margin-top: 16px;
            display: flex;
            justify-content: center;
          }

          .tableTitle {
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

          .toolbar {
            margin-top: 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 12px;
            border: 1px solid #e7e7e7;
            border-radius: 14px;
            background: rgba(255, 255, 255, 0.94);
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

          th.stickyHead,
          td.date.sticky {
            width: 70px;
            min-width: 70px;
            max-width: 70px;
          }

          input {
            border: 1px solid #e2e2e2;
            border-radius: 10px;
            padding: 10px 12px;
            outline: none;
            background: #fff;
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

          .calloutFocus {
            color: #0f172a;
            font-weight: 900;
            text-decoration: underline;
            text-decoration-color: #2563eb;
            text-decoration-thickness: 2px;
            text-underline-offset: 2px;
          }

          .dotMini {
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
            margin-top: 10px;
            border: 1px solid #e7e7e7;
            border-radius: 16px;
            overflow: auto;
            background: rgba(255, 255, 255, 0.94);
          }

          table {
            width: 100%;
            border-collapse: collapse;
            min-width: 1700px;
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

          .dayRowClickable {
            cursor: pointer;
          }

          .dayRowClickable:hover td {
            background: #fafafa;
          }

          .dayRowClickable:nth-child(even) td {
            background: #fcfcfc;
          }

          .dayRowClickable:focus {
            outline: none;
          }

          .dayRowClickable:focus td {
            background: #f6f9ff !important;
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

          td.date {
            padding: 6px 6px;
          }

          .dayCell {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
          }

          .dayNum {
            font-weight: 900;
            font-size: 14px;
          }

          .dayIcon {
            font-size: 10px;
            opacity: 0.6;
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

          .summaryRowTable td {
            padding-top: 11px;
            padding-bottom: 11px;
          }

          .summaryLabelTable {
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

          .rainOverrideCell {
            position: relative;
            color: #111827;
            text-decoration: underline;
            text-decoration-color: #dc2626;
            text-decoration-thickness: 2px;
            text-underline-offset: 3px;
            cursor: help;
            padding-left: 22px !important;
          }

          .rainOverrideCell::before {
            content: "";
            position: absolute;
            left: 10px;
            top: 50%;
            transform: translateY(-50%);
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: #dc2626;
            box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.16);
          }

          @media (max-width: 1280px) {
            .yearAndNav {
              grid-template-columns: minmax(170px, 220px) minmax(300px, 1fr) minmax(170px, 220px);
              gap: 18px;
            }

            .year {
              font-size: 60px;
            }

            .monthTopSelect {
              width: 145px;
              min-width: 145px;
              max-width: 145px;
            }

            .selectorPill {
              width: 118px;
              min-width: 118px;
              max-width: 118px;
            }

            .selectorLabel {
              font-size: 12px;
            }
          }

          @media (max-width: 1100px) {
            .yearAndNav {
              grid-template-columns: 1fr 1fr;
              grid-template-areas:
                "monthSelect compareYear"
                "title title";
              row-gap: 18px;
            }

            .topMonthSelectWrap {
              grid-area: monthSelect;
              justify-self: center;
            }

            .inlineCompareWrap {
              grid-area: compareYear;
              justify-self: center;
            }

            .titleMain {
              grid-area: title;
            }

            .summaryMetrics.four {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }

            .summaryRow.dual {
              grid-template-columns: 1fr;
              gap: 12px;
            }

            .charts2 {
              grid-template-columns: 1fr;
            }

            .chartBoxWide {
              grid-column: auto;
            }
          }

          @media (max-width: 760px) {
            .yearAndNav {
              grid-template-columns: 1fr;
              grid-template-areas:
                "monthSelect"
                "title"
                "compareYear";
              row-gap: 16px;
            }

            .yearLine {
              gap: 10px;
            }

            .year {
              font-size: 52px;
            }

            :global(.monthArrowButton) {
              width: 42px !important;
              height: 42px !important;
              min-width: 42px !important;
              min-height: 42px !important;
            }

            :global(.monthArrowSvg) {
              width: 28px !important;
              height: 28px !important;
              min-width: 28px !important;
              min-height: 28px !important;
            }

            .summaryRow,
            .summaryHalf {
              display: block;
              padding: 14px;
            }

            .summaryLabel {
              border-right: 0;
              border-bottom: 1px solid #ececec;
              padding-right: 0;
              padding-bottom: 10px;
              margin-bottom: 12px;
              font-size: 14px;
            }

            .summaryMetrics.three,
            .summaryMetrics.two,
            .summaryMetrics.four {
              grid-template-columns: 1fr;
              gap: 10px;
            }

            .summarySmallNote,
            .overrideNote {
              grid-column: auto;
              margin-top: 10px;
            }

            .toolbar {
              flex-direction: column;
              align-items: stretch;
            }

            .search {
              min-width: 100%;
            }

            .tools {
              justify-content: stretch;
            }

            .callout {
              display: none;
            }
          }

          @media (max-width: 520px) {
            .hero {
              padding: 14px;
              border-radius: 16px;
            }

            .selectorPill,
            .monthTopSelect {
              width: 100%;
              min-width: 0;
              max-width: none;
            }

            .yearLine {
              gap: 6px;
            }

            .year {
              font-size: 44px;
            }

            .yearInlineLink {
              padding: 7px 14px;
            }

            .yearInlineLink b {
              font-size: 17px;
            }

            :global(.monthArrowButton) {
              width: 34px !important;
              height: 38px !important;
              min-width: 34px !important;
              min-height: 38px !important;
            }

            :global(.monthArrowSvg) {
              width: 24px !important;
              height: 24px !important;
              min-width: 24px !important;
              min-height: 24px !important;
            }

            .summaryHead h2 {
              font-size: 22px;
            }

            .summaryRows {
              gap: 12px;
            }

            :global(.summaryMetric) {
              padding: 11px;
            }

            :global(.summaryValueLine) {
              justify-content: space-between;
              width: 100%;
            }

            :global(.summaryKey) {
              font-size: 10px;
              margin-bottom: 2px;
            }

            :global(.summaryValue) {
              font-size: 19px;
            }

            .dayNum {
              font-size: 15px;
            }

            .charts2 {
              gap: 14px;
            }

            .chartBox {
              padding: 6px;
              border-radius: 14px;
              overflow: hidden;
            }
          }

          @media (max-width: 390px) {
            .year {
              font-size: 38px;
            }

            .yearLine {
              gap: 4px;
            }

            :global(.monthArrowButton) {
              width: 30px !important;
              min-width: 30px !important;
            }

            :global(.monthArrowSvg) {
              width: 22px !important;
              height: 22px !important;
              min-width: 22px !important;
              min-height: 22px !important;
            }
          }
        `}</style>
      </div>
    </SiteLayout>
  );
}

function Th({ children, onClick, active, dir, className, title }) {
  return (
    <th
      onClick={onClick}
      className={className}
      style={{ cursor: "pointer" }}
      title={title}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {children}
        {active ? (
          <span style={{ opacity: 0.6 }}>{dir === "asc" ? "▲" : "▼"}</span>
        ) : (
          <span style={{ opacity: 0.25 }}>↕</span>
        )}
      </span>
    </th>
  );
}