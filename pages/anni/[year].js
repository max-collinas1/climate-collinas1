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
  const overrides = readMonthlyOverrides();
  const year = String(params?.year ?? "");

  const allYears = Array.from(
    new Set(
      rows
        .map((r) => String(r?.date ?? "").trim())
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .map((d) => d.slice(0, 4))
    )
  ).sort();

  const yearIndex = allYears.indexOf(year);
  const prevYear = yearIndex > 0 ? allYears[yearIndex - 1] : null;
  const nextYear = yearIndex >= 0 && yearIndex < allYears.length - 1 ? allYears[yearIndex + 1] : null;

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

  const rainOverrides = (overrides || [])
    .filter(
      (o) =>
        String(o?.scope ?? "") === "month" &&
        String(o?.field ?? "") === "rainSum" &&
        String(o?.ym ?? "").startsWith(`${year}-`)
    )
    .map((o) => ({
      scope: String(o?.scope ?? ""),
      ym: String(o?.ym ?? ""),
      field: String(o?.field ?? ""),
      value: o?.value ?? null,
      source: String(o?.source ?? ""),
      label: String(o?.label ?? ""),
      note: String(o?.note ?? ""),
    }));

  return {
    props: {
      year,
      days,
      monthsInYear,
      allYears,
      prevYear,
      nextYear,
      rainOverrides,
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

function getMaxMonthRecord(rows, keyOrGetter) {
  let best = null;
  for (const row of rows || []) {
    const value = typeof keyOrGetter === "function" ? n(keyOrGetter(row)) : n(row?.[keyOrGetter]);
    if (!Number.isFinite(value)) continue;
    if (!best || value > best.value) {
      best = { value, ym: String(row?.ym ?? "") };
    }
  }
  return best;
}

function getMinMonthRecord(rows, keyOrGetter) {
  let best = null;
  for (const row of rows || []) {
    const value = typeof keyOrGetter === "function" ? n(keyOrGetter(row)) : n(row?.[keyOrGetter]);
    if (!Number.isFinite(value)) continue;
    if (!best || value < best.value) {
      best = { value, ym: String(row?.ym ?? "") };
    }
  }
  return best;
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

function degToCardinal16(v) {
  const n0 = Number(v);
  if (!Number.isFinite(n0)) return "—";
  const d = ((n0 % 360) + 360) % 360;
  const ix = Math.round(d / 22.5) % 16;
  return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][ix];
}

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

function formatMonthIt(ym) {
  const s = String(ym ?? "");
  if (!/^\d{4}-\d{2}$/.test(s)) return "—";
  return `${monthFull(s)} ${String(s).slice(0, 4)}`;
}

function dayHref(dateStr) {
  return `/giorni/${String(dateStr ?? "")}`;
}

function monthHref(ym) {
  const y = String(ym ?? "").slice(0, 4);
  const m = String(ym ?? "").slice(5, 7);
  return `/mesi/${y}/${m}`;
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

export default function YearOverviewPage(props) {
  const router = useRouter();

  const year = props.year ?? "";
  const days = Array.isArray(props.days) ? props.days : [];
  const monthsInYear = Array.isArray(props.monthsInYear) ? props.monthsInYear : [];
  const allYears = Array.isArray(props.allYears) ? props.allYears : [];
  const prevYear = props.prevYear ?? null;
  const nextYear = props.nextYear ?? null;
  const rainOverrides = Array.isArray(props.rainOverrides) ? props.rainOverrides : [];

  const [mounted, setMounted] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [pickYear, setPickYear] = useState("");

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

      const rawRainSum = sumFinite(arr.map((d) => d.rain_total));
      const rainOverride = findMonthlyOverride(rainOverrides, ym, "rainSum");
      const resolvedRain = applyRainMonthOverride(rawRainSum, rainOverride);

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

        rainSumRaw: rawRainSum,
        rainSum: resolvedRain.value,
        rainIsOverride: resolvedRain.isOverride,
        rainLabel: resolvedRain.label,
        rainSource: resolvedRain.source,
        rainNote: resolvedRain.note,

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
  }, [months, byMonth, rainOverrides]);

  const annual = useMemo(() => {
    const tmin_mean = avgFinite(days.map((d) => d.tmin));
    const tmean = avgFinite(days.map((d) => d.tmean));
    const tmax_mean = avgFinite(days.map((d) => d.tmax));

    const rainSum = sumFinite(monthly.map((m) => m.rainSum));
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

    const overrideMonths = monthly.filter((m) => m.rainIsOverride);
    const hasRainOverride = overrideMonths.length > 0;
    const overrideMonthsText = overrideMonths.map((m) => monthFull(m.ym)).join(", ");
    const overrideNotes = overrideMonths
      .map((m) => {
        const note = String(m.rainNote ?? "").trim();
        return note ? `${monthFull(m.ym)}: ${note}` : `${monthFull(m.ym)}: dato mensile ARPAS`;
      })
      .join(" • ");

    return {
      tmin_mean,
      tmean,
      tmax_mean,

      rainSum,
      rainDailyMax,
      rainyDays,
      rainrate_max,
      rainHasOverride: hasRainOverride,
      rainOverrideMonthsText: overrideMonthsText,
      rainOverrideNote: overrideNotes,

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
  }, [days, monthly]);

  const annualRecords = useMemo(() => {
    return [
      {
        label: "Temperatura massima giornaliera",
        min: getMinRecord(days, "tmax"),
        max: getMaxRecord(days, "tmax"),
        unit: "°C",
        linkType: "day",
      },
      {
        label: "Temperatura minima giornaliera",
        min: getMinRecord(days, "tmin"),
        max: getMaxRecord(days, "tmin"),
        unit: "°C",
        linkType: "day",
      },
      {
        label: "Totale mensile precipitazioni",
        min: getMinMonthRecord(monthly, "rainSum"),
        max: getMaxMonthRecord(monthly, "rainSum"),
        unit: "mm",
        linkType: "month",
        minLabel: "Mese meno piovoso",
        maxLabel: "Mese più piovoso",
      },
      {
        label: "Pioggia giornaliera",
        min: null,
        max: getMaxRecord(days, "rain_total"),
        unit: "mm",
        linkType: "day",
      },
      {
        label: "Rain rate",
        min: null,
        max: getMaxRecord(days, "rainrate_max"),
        unit: "mm/h",
        linkType: "day",
      },
      {
        label: "Umidità minima giornaliera",
        min: getMinRecord(days, (d) => getRhMin(d)),
        max: getMaxRecord(days, (d) => getRhMin(d)),
        unit: "%",
        linkType: "day",
      },
      {
        label: "Umidità massima giornaliera",
        min: getMinRecord(days, (d) => getRhMax(d)),
        max: getMaxRecord(days, (d) => getRhMax(d)),
        unit: "%",
        linkType: "day",
      },
      {
        label: "Vento medio",
        min: getMinRecord(days, "wind_avg"),
        max: getMaxRecord(days, "wind_avg"),
        unit: "km/h",
        linkType: "day",
      },
      {
        label: "Raffica massima",
        min: getMinRecord(days, "gust_max"),
        max: getMaxRecord(days, "gust_max"),
        unit: "km/h",
        linkType: "day",
      },
      {
        label: "Pressione minima giornaliera",
        min: getMinRecord(days, "press_min"),
        max: getMaxRecord(days, "press_min"),
        unit: "hPa",
        linkType: "day",
      },
      {
        label: "Pressione massima giornaliera",
        min: getMinRecord(days, "press_max"),
        max: getMaxRecord(days, "press_max"),
        unit: "hPa",
        linkType: "day",
      },
      {
        label: "UV",
        min: getMaxRecord(days, "uv_mean_pos"),
        max: getMaxRecord(days, "uv_max"),
        unit: "",
        minLabel: "Media giornaliera più alta",
        maxLabel: "Massimo assoluto",
        linkType: "day",
      },
      {
        label: "Radiazione",
        min: getMaxRecord(days, "solar_mean_pos"),
        max: getMaxRecord(days, "solar_max"),
        unit: "W/m²",
        minLabel: "Media giornaliera più alta",
        maxLabel: "Massimo assoluto",
        linkType: "day",
      },
    ];
  }, [days, monthly]);

  const x = monthly.map((m) => monthShort(m.ym));
  const dirTxt = Number.isFinite(n(annual.wind_dir_mean_deg)) ? degToCardinal16(annual.wind_dir_mean_deg) : "—";

  const yearCompareAvailable = allYears.filter((y) => y !== year);

  const COLORS = {
    red: "#ff2d20",
    orange: "#f28c28",
    orangeDry: "#b96a2f",
    grayDark: "#4b5563",
    blueLight: "#60a5fa",
    blue: "#2563eb",
    indigo: "#312e81",
    greenStrong: "#2f9e44",
    windDir: "#7c3aed",
    rainBar: "#4f6fd5",
    rainBarOverride: "#dc2626",
  };

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
    tooltip: { trigger: "axis", order: "seriesAsc" },
  };

  const optTemp = {
    ...baseChart,
    title: { ...baseChart.title, text: "Temperature mensili" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) =>
        axisTooltipFormatter(params, [
          { name: "Max assoluta", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`) },
          { name: "Max media", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`) },
          { name: "Media", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`) },
          { name: "Min media", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`) },
          { name: "Min assoluta", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`) },
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
      { name: "Max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.tmax_abs)), symbolSize: 7, itemStyle: { color: COLORS.red }, z: 5 },
      { name: "Max media", type: "line", data: seriesLine(monthly.map((m) => m.tmax_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: COLORS.orange }, itemStyle: { color: COLORS.orange } },
      { name: "Media", type: "line", data: seriesLine(monthly.map((m) => m.tmean)), showSymbol: false, connectNulls: false, lineStyle: { width: 3, color: COLORS.grayDark }, itemStyle: { color: COLORS.grayDark }, z: 4 },
      { name: "Min media", type: "line", data: seriesLine(monthly.map((m) => m.tmin_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: COLORS.blueLight }, itemStyle: { color: COLORS.blueLight } },
      { name: "Min assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.tmin_abs)), symbolSize: 7, itemStyle: { color: COLORS.indigo } },
    ],
  };

  const rainMonthly = monthly.map((m) => m.rainSum);
  const rainCum = cumulative(rainMonthly);

  const optRain = {
    ...baseChart,
    title: { ...baseChart.title, text: "Precipitazioni" },
    tooltip: {
      trigger: "axis",
      order: "seriesAsc",
      formatter: (params) => {
        const title = params?.[0]?.axisValueLabel ?? params?.[0]?.name ?? "—";
        const monthIx = x.findIndex((v) => v === title);
        const monthObj = monthIx >= 0 ? monthly[monthIx] : null;
        const lines = [`<b>${title}</b>`];

        const pRate = params.find((p) => p.seriesName === "Rate max");
        const pCum = params.find((p) => p.seriesName === "Totale progressivo");
        const pRain = params.find((p) => p.seriesName === "Pioggia");

        if (pRate) {
          const v = Array.isArray(pRate.value) ? pRate.value[1] : pRate.value;
          lines.push(`${pRate.marker}Rate max: <b>${v == null ? "—" : `${Number(v).toFixed(1)} mm/h`}</b>`);
        }

        if (pCum) {
          const v = Array.isArray(pCum.value) ? pCum.value[1] : pCum.value;
          lines.push(`${pCum.marker}Totale progressivo: <b>${v == null ? "—" : `${Number(v).toFixed(1)} mm`}</b>`);
        }

        if (pRain) {
          const v = Array.isArray(pRain.value) ? pRain.value[1] : pRain.value;
          lines.push(`${pRain.marker}Pioggia: <b>${v == null ? "—" : `${Number(v).toFixed(1)} mm`}</b>`);
        }

        if (monthObj?.rainIsOverride) {
          lines.push(`<span style="color:#dc2626;font-weight:700;">● ${monthObj.rainLabel || "Dato ARPAS"}</span>`);
        }

        return lines.join("<br/>");
      },
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
      { name: "Rate max", type: "scatter", data: seriesLine(monthly.map((m) => m.rainrate_max)), yAxisIndex: 1, symbolSize: 7, itemStyle: { color: COLORS.red }, z: 5 },
      { name: "Totale progressivo", type: "line", data: seriesLine(rainCum), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 4, color: COLORS.greenStrong }, itemStyle: { color: COLORS.greenStrong }, z: 6 },
      {
        name: "Pioggia",
        type: "bar",
        data: monthly.map((m) => ({
          value: Number.isFinite(n(m.rainSum)) ? n(m.rainSum) : null,
          itemStyle: { color: m.rainIsOverride ? COLORS.rainBarOverride : COLORS.rainBar },
        })),
        yAxisIndex: 0,
        z: 2,
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
          { name: "Max assoluta", formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`) },
          { name: "Max media", formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`) },
          { name: "Media", formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`) },
          { name: "Min media", formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`) },
          { name: "Min assoluta", formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`) },
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
      { name: "Max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.rh_max_abs)), symbolSize: 7, itemStyle: { color: COLORS.blue }, z: 5 },
      { name: "Max media", type: "line", data: seriesLine(monthly.map((m) => m.rh_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: COLORS.blueLight }, itemStyle: { color: COLORS.blueLight } },
      { name: "Media", type: "line", data: seriesLine(monthly.map((m) => m.rh_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 3, color: COLORS.grayDark }, itemStyle: { color: COLORS.grayDark }, z: 4 },
      { name: "Min media", type: "line", data: seriesLine(monthly.map((m) => m.rh_min_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: COLORS.orange }, itemStyle: { color: COLORS.orange } },
      { name: "Min assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.rh_min_abs)), symbolSize: 7, itemStyle: { color: COLORS.orangeDry } },
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
          { name: "Raffica max", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} km/h`) },
          { name: "Raffica media", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} km/h`) },
          { name: "Vento medio", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} km/h`) },
          { name: "Dir media", formatter: (v) => (v == null ? "—" : `${degToCardinal16(v)} (${Math.round(Number(v))}°)`) },
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
      { name: "Raffica max", type: "scatter", data: seriesLine(monthly.map((m) => m.gust_max)), yAxisIndex: 0, symbolSize: 7, itemStyle: { color: COLORS.red }, z: 5 },
      { name: "Raffica media", type: "line", data: seriesLine(monthly.map((m) => m.gust_mean)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: "#a3c614" }, itemStyle: { color: "#a3c614" } },
      { name: "Vento medio", type: "line", data: seriesLine(monthly.map((m) => m.wind_mean)), yAxisIndex: 0, showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: "#4f6fd5" }, itemStyle: { color: "#4f6fd5" } },
      {
        name: "Dir media",
        type: "scatter",
        data: seriesLine(monthly.map((m) => m.wind_dir_mean_deg)),
        yAxisIndex: 1,
        symbol: "diamond",
        symbolSize: 10,
        itemStyle: { color: COLORS.windDir },
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
          { name: "Max assoluta", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`) },
          { name: "Max media", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`) },
          { name: "Media", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`) },
          { name: "Min media", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`) },
          { name: "Min assoluta", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`) },
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
      { name: "Max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.press_max_abs)), symbolSize: 7, itemStyle: { color: COLORS.red }, z: 5 },
      { name: "Max media", type: "line", data: seriesLine(monthly.map((m) => m.press_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: COLORS.orange }, itemStyle: { color: COLORS.orange } },
      { name: "Media", type: "line", data: seriesLine(monthly.map((m) => m.press_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 3, color: COLORS.grayDark }, itemStyle: { color: COLORS.grayDark }, z: 4 },
      { name: "Min media", type: "line", data: seriesLine(monthly.map((m) => m.press_min_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: COLORS.blueLight }, itemStyle: { color: COLORS.blueLight } },
      { name: "Min assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.press_min_abs)), symbolSize: 7, itemStyle: { color: COLORS.indigo } },
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
          { name: "UV max assoluto", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)}`) },
          { name: "UV max medio", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)}`) },
          { name: "UV medio", formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)}`) },
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
      { name: "UV max assoluto", type: "scatter", data: seriesLine(monthly.map((m) => m.uv_max)), symbolSize: 7, itemStyle: { color: COLORS.red }, z: 5 },
      { name: "UV max medio", type: "line", data: seriesLine(monthly.map((m) => m.uv_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: COLORS.orange }, itemStyle: { color: COLORS.orange } },
      { name: "UV medio", type: "line", data: seriesLine(monthly.map((m) => m.uv_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 3, color: COLORS.grayDark }, itemStyle: { color: COLORS.grayDark } },
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
          { name: "Rad max assoluta", formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} W/m²`) },
          { name: "Rad max media", formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} W/m²`) },
          { name: "Rad media", formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} W/m²`) },
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
      { name: "Rad max assoluta", type: "scatter", data: seriesLine(monthly.map((m) => m.solar_max)), symbolSize: 7, itemStyle: { color: COLORS.red }, z: 5 },
      { name: "Rad max media", type: "line", data: seriesLine(monthly.map((m) => m.solar_max_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 2, color: COLORS.orange }, itemStyle: { color: COLORS.orange } },
      { name: "Rad media", type: "line", data: seriesLine(monthly.map((m) => m.solar_mean)), showSymbol: false, connectNulls: false, lineStyle: { width: 3, color: COLORS.grayDark }, itemStyle: { color: COLORS.grayDark } },
    ],
  };

  const LARGE_CHART_HEIGHT = 365;
  const NORMAL_CHART_HEIGHT = 340;

  function renderRecordLink(entry, type) {
    if (!entry) return "—";

    if (type === "month" && entry.ym) {
      return (
        <Link href={monthHref(entry.ym)} className="dateLink">
          {formatMonthIt(entry.ym)}
        </Link>
      );
    }

    if (type === "day" && entry.date) {
      return (
        <Link href={dayHref(entry.date)} className="dateLink">
          {formatDateIt(entry.date)}
        </Link>
      );
    }

    return "—";
  }

  return (
    <SiteLayout headerProps={{}}>
      <div className="wrap">
        <header className="hero">
          <div className="yearTopRow">
            <div className="yearBlock">
              <div className="kicker">Anno</div>
              <div className="yearAndNav">
                <div className="titleMain">
                  <h1 className="year">{year}</h1>

                  <div className="titleActions">
                    {prevYear ? (
                      <Link href={`/anni/${prevYear}`} className="arrowCircle" aria-label="Anno precedente" title="Precedente">
                        <svg viewBox="0 0 32 32" aria-hidden="true" className="arrowSvg">
                          <path
                            d="M19 9.5L12.5 16L19 22.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </Link>
                    ) : (
                      <span className="arrowCircle disabled" aria-hidden="true">
                        <svg viewBox="0 0 32 32" aria-hidden="true" className="arrowSvg">
                          <path
                            d="M19 9.5L12.5 16L19 22.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    )}

                    {nextYear ? (
                      <Link href={`/anni/${nextYear}`} className="arrowCircle" aria-label="Anno successivo" title="Successivo">
                        <svg viewBox="0 0 32 32" aria-hidden="true" className="arrowSvg">
                          <path
                            d="M13 9.5L19.5 16L13 22.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </Link>
                    ) : (
                      <span className="arrowCircle disabled" aria-hidden="true">
                        <svg viewBox="0 0 32 32" aria-hidden="true" className="arrowSvg">
                          <path
                            d="M13 9.5L19.5 16L13 22.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    )}
                  </div>
                </div>

                <div className="inlineCompareWrap">
                  <span className="inlineCompareLabel">Seleziona anno</span>

                  <select
                    id="year-select"
                    className="compareSelectMini"
                    value={pickYear}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      setPickYear(nextValue);
                      if (nextValue && nextValue !== year) {
                        router.push(`/anni/${nextValue}`);
                      }
                    }}
                  >
                    <option value="">Anno</option>
                    {yearCompareAvailable.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
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

            <div className="summaryRows">
              <div className="summaryRow">
                <div className="summaryLabel">Temperature</div>
                <div className="summaryMetrics three">
                  <div className="summaryMetric">
                    <span className="summaryKey">Max media</span>
                    <strong>{fmt(annual.tmax_mean, 1)} °C</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Media</span>
                    <strong>{fmt(annual.tmean, 1)} °C</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Min media</span>
                    <strong>{fmt(annual.tmin_mean, 1)} °C</strong>
                  </div>
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Precipitazioni</div>
                <div className="summaryMetrics two">
                  <div className="summaryMetric">
                    <span className="summaryKey">Totale</span>
                    <strong
                      className={annual.rainHasOverride ? "rainOverrideValue" : ""}
                      title={annual.rainHasOverride ? `Totale annuale con priorità ARPAS nei mesi: ${annual.rainOverrideMonthsText}` : ""}
                    >
                      {fmt(annual.rainSum, 1)} mm
                    </strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Giorni &gt; 1 mm</span>
                    <strong>{fmtInt(annual.rainyDays)}</strong>
                  </div>
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Umidità</div>
                <div className="summaryMetrics three">
                  <div className="summaryMetric">
                    <span className="summaryKey">Max media</span>
                    <strong>{fmtInt(annual.rh_max_mean)} %</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Media</span>
                    <strong>{fmtInt(annual.rh_mean)} %</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Min media</span>
                    <strong>{fmtInt(annual.rh_min_mean)} %</strong>
                  </div>
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Vento</div>
                <div className="summaryMetrics three">
                  <div className="summaryMetric">
                    <span className="summaryKey">Medio</span>
                    <strong>{fmt(annual.wind_mean, 1)} km/h</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Raffica media</span>
                    <strong>{fmt(annual.gust_mean, 1)} km/h</strong>
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
                    <span className="summaryKey">Max media</span>
                    <strong>{fmt(annual.press_max_mean, 1)} hPa</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Media</span>
                    <strong>{fmt(annual.press_mean, 1)} hPa</strong>
                  </div>
                  <div className="summaryMetric">
                    <span className="summaryKey">Min media</span>
                    <strong>{fmt(annual.press_min_mean, 1)} hPa</strong>
                  </div>
                </div>
              </div>

              <div className="summaryRow dual">
                <div className="summaryHalf">
                  <div className="summaryLabel">UV</div>
                  <div className="summaryMetrics two">
                    <div className="summaryMetric">
                      <span className="summaryKey">UV medio</span>
                      <strong>{fmt(annual.uv_mean, 1)}</strong>
                    </div>
                    <div className="summaryMetric">
                      <span className="summaryKey">UV max medio</span>
                      <strong>{fmt(annual.uv_max_mean, 1)}</strong>
                    </div>
                  </div>
                </div>

                <div className="summaryHalf">
                  <div className="summaryLabel">Radiazione</div>
                  <div className="summaryMetrics two">
                    <div className="summaryMetric">
                      <span className="summaryKey">Rad media</span>
                      <strong>{Number.isFinite(n(annual.solar_mean)) ? `${Math.round(n(annual.solar_mean))} W/m²` : "—"}</strong>
                    </div>
                    <div className="summaryMetric">
                      <span className="summaryKey">Rad max media</span>
                      <strong>{Number.isFinite(n(annual.solar_max_mean)) ? `${Math.round(n(annual.solar_max_mean))} W/m²` : "—"}</strong>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {annual.rainHasOverride ? (
              <div className="overrideNote">
                Totale annuale calcolato sommando i totali mensili finali. Nei mesi <strong>{annual.rainOverrideMonthsText}</strong> è stato usato il dato ARPAS al posto del totale grezzo della stazione.
                {annual.rainOverrideNote ? <span className="overrideNoteExtra"> {annual.rainOverrideNote}</span> : null}
              </div>
            ) : null}

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
                <div className="recordsTop">
                  <div className="recordsHead">Record anno {year}</div>
                  <div className="recordsSub">Estremi e picchi principali dell&apos;anno con collegamento diretto al giorno o al mese.</div>
                </div>

                <div className="recordsTableWrap">
                  <table className="recordsTable">
                    <thead>
                      <tr>
                        <th>Parametro</th>
                        <th>Minimo</th>
                        <th>Riferimento</th>
                        <th>Massimo</th>
                        <th>Riferimento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {annualRecords.map((r) => (
                        <tr key={r.label}>
                          <td className="recordName">{r.label}</td>

                          <td className={r.label === "Totale mensile precipitazioni" ? "recordRainCell" : ""}>
                            {r.min ? `${fmt(r.min.value, 1)}${r.unit ? ` ${r.unit}` : ""}` : "—"}
                            {r.minLabel ? <span className="recordNote">{r.minLabel}</span> : null}
                          </td>
                          <td>{renderRecordLink(r.min, r.linkType)}</td>

                          <td className={r.label === "Totale mensile precipitazioni" ? "recordRainCell" : ""}>
                            {r.max ? `${fmt(r.max.value, 1)}${r.unit ? ` ${r.unit}` : ""}` : "—"}
                            {r.maxLabel ? <span className="recordNote">{r.maxLabel}</span> : null}
                          </td>
                          <td>{renderRecordLink(r.max, r.linkType)}</td>
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
            <div className="chartBox chartBoxWide">
              <ReactECharts option={optTemp} style={{ height: LARGE_CHART_HEIGHT, width: "100%" }} />
            </div>

            <div className="chartBox chartBoxWide">
              <ReactECharts option={optRain} style={{ height: LARGE_CHART_HEIGHT, width: "100%" }} />
            </div>

            <div className="chartBox chartBoxWide">
              <ReactECharts option={optWind} style={{ height: LARGE_CHART_HEIGHT, width: "100%" }} />
            </div>

            <div className="chartBox">
              <ReactECharts option={optRh} style={{ height: NORMAL_CHART_HEIGHT, width: "100%" }} />
            </div>
            <div className="chartBox">
              <ReactECharts option={optPress} style={{ height: NORMAL_CHART_HEIGHT, width: "100%" }} />
            </div>

            <div className="chartBox">
              <ReactECharts option={optUv} style={{ height: NORMAL_CHART_HEIGHT, width: "100%" }} />
            </div>
            <div className="chartBox">
              <ReactECharts option={optSolar} style={{ height: NORMAL_CHART_HEIGHT, width: "100%" }} />
            </div>
          </section>
        )}

        <section className="monthsTableHead">
          <div className="monthsTableTitle">Seleziona mese</div>
        </section>

        <section className="tableWrap">
          <table>
            <thead>
              <tr className="groupRow">
                <th className="group groupMonth stickyHead bR" colSpan={1}>
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
                <th className="bR stickyHead stickyHeadMonth"> </th>

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
                const monthUrl = `/mesi/${year}/${mm}`;

                return (
                  <tr
                    key={m.ym}
                    className="monthRowClickable"
                    onClick={() => router.push(monthUrl)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(monthUrl);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                    aria-label={`Apri ${monthFull(m.ym)}`}
                  >
                    <td className="date sticky bR">
                      <Link href={monthUrl} className="cellLink">
                        <span className="extCell" aria-hidden="true">
                          ↗
                        </span>
                        <span className="cellText">{monthFull(m.ym)}</span>
                      </Link>
                    </td>

                    <td>{fmt(m.tmin_mean, 1)} °C</td>
                    <td className="strong">{fmt(m.tmean, 1)} °C</td>
                    <td className="bR">{fmt(m.tmax_mean, 1)} °C</td>

                    <td
                      className={`${Number.isFinite(n(m.rainSum)) && n(m.rainSum) > 0 ? "rainy" : ""} ${m.rainIsOverride ? "rainOverrideCell" : ""}`}
                      title={m.rainIsOverride ? "Dato mensile ARPAS prioritario" : ""}
                    >
                      {fmt(m.rainSum, 1)} mm
                    </td>
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

                <td
                  className={`${Number.isFinite(n(annual.rainSum)) && n(annual.rainSum) > 0 ? "rainy" : ""} ${annual.rainHasOverride ? "rainOverrideCell" : ""}`}
                  title={annual.rainHasOverride ? `Totale annuale con priorità ARPAS nei mesi: ${annual.rainOverrideMonthsText}` : ""}
                >
                  {fmt(annual.rainSum, 1)} mm
                </td>
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

          .yearAndNav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 24px;
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

          .monthsBar {
            margin-top: 18px;
            border: 1px solid #ececec;
            border-radius: 16px;
            background: #fcfcfc;
            padding: 16px 16px 14px;
          }

          .monthsBarHead {
            font-size: 13px;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: #374151;
            font-weight: 900;
            margin-bottom: 14px;
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

          .rainOverrideValue {
            position: relative;
            color: #111827;
            text-decoration: underline;
            text-decoration-color: #dc2626;
            text-decoration-thickness: 2px;
            text-underline-offset: 3px;
            cursor: help;
            padding-left: 16px;
          }

          .rainOverrideValue::before {
            content: "";
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: #dc2626;
            box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.16);
          }

          .overrideNote {
            margin-top: 10px;
            font-size: 12px;
            line-height: 1.55;
            color: #64748b;
            font-weight: 700;
          }

          .overrideNote strong {
            color: #0f172a;
          }

          .overrideNoteExtra {
            display: block;
            margin-top: 6px;
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
            border-radius: 20px;
            background: linear-gradient(180deg, #ffffff, #fbfdff);
            overflow: hidden;
            box-shadow: 0 12px 28px rgba(15, 23, 42, 0.05);
          }

          .recordsTop {
            padding: 16px 18px 12px;
            background: linear-gradient(180deg, #f8fbff, #f4f7fb);
            border-bottom: 1px solid #e8eef5;
          }

          .recordsHead {
            font-weight: 950;
            letter-spacing: -0.02em;
            font-size: 18px;
            color: #0f172a;
          }

          .recordsSub {
            margin-top: 4px;
            font-size: 12px;
            color: #64748b;
            font-weight: 600;
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
            padding: 13px 16px;
            border-bottom: 1px solid #edf2f7;
            text-align: left;
            font-size: 13px;
            white-space: nowrap;
            vertical-align: top;
          }

          .recordsTable th {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.1em;
            color: #7c879b;
            background: #ffffff;
          }

          .recordsTable tbody tr:nth-child(even) td {
            background: #fcfdff;
          }

          .recordsTable tbody tr:hover td {
            background: #f8fbff;
          }

          .recordName {
            font-weight: 850;
            color: #0f172a;
          }

          .recordNote {
            display: block;
            margin-top: 5px;
            font-size: 11px;
            line-height: 1.2;
            color: #64748b;
            font-weight: 700;
          }

          .recordRainCell {
            position: relative;
            padding-left: 28px !important;
          }

          .recordRainCell::before {
            content: "";
            position: absolute;
            left: 14px;
            top: 18px;
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: #dc2626;
            box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.16);
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

          .monthsTableHead {
            margin-top: 16px;
            display: flex;
            justify-content: center;
          }

          .monthsTableTitle {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 11px 22px;
            min-width: 180px;
            border-radius: 999px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            border: 1px solid #e5e7eb;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
            font-weight: 900;
            font-size: 15px;
            color: #0f172a;
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

          .groupRow th.groupMonth {
            font-size: 15px;
            letter-spacing: 0.14em;
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

          .monthRowClickable {
            cursor: pointer;
          }

          .monthRowClickable:focus {
            outline: none;
          }

          .monthRowClickable:focus td {
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

          .stickyHeadMonth {
            min-width: 150px;
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
            font-size: 16px;
            line-height: 1.15;
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

            .yearAndNav {
              align-items: flex-start;
            }
          }

          @media (max-width: 980px) {
            .arrowCircle {
              width: 56px !important;
              height: 56px !important;
              min-width: 56px !important;
              min-height: 56px !important;
            }
          }

          @media (max-width: 720px) {
            .summaryMetrics.three,
            .summaryMetrics.two {
              grid-template-columns: 1fr;
            }

            .monthNav {
              gap: 8px;
            }

            .inlineCompareWrap {
              width: 100%;
              justify-content: flex-start;
            }

            .compareSelectMini {
              width: 100%;
              min-width: 100%;
              max-width: 100%;
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

            .summaryMetric strong {
              font-size: 20px;
            }

            .cellText {
              font-size: 16px;
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
          }
        `}</style>
      </div>
    </SiteLayout>
  );
}