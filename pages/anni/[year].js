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
  const nextYear =
    yearIndex >= 0 && yearIndex < allYears.length - 1
      ? allYears[yearIndex + 1]
      : null;

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
    const value =
      typeof keyOrGetter === "function"
        ? n(keyOrGetter(row))
        : n(row?.[keyOrGetter]);
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
    const value =
      typeof keyOrGetter === "function"
        ? n(keyOrGetter(row))
        : n(row?.[keyOrGetter]);
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
    const value =
      typeof keyOrGetter === "function"
        ? n(keyOrGetter(row))
        : n(row?.[keyOrGetter]);
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
    const value =
      typeof keyOrGetter === "function"
        ? n(keyOrGetter(row))
        : n(row?.[keyOrGetter]);
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

const MONTHS_IT_SHORT = [
  "Gen",
  "Feb",
  "Mar",
  "Apr",
  "Mag",
  "Giu",
  "Lug",
  "Ago",
  "Set",
  "Ott",
  "Nov",
  "Dic",
];

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

function YearArrow({ href, direction, label, title, disabled = false }) {
  const d =
    direction === "prev"
      ? "M21 6.5L9.5 16L21 25.5"
      : "M11 6.5L22.5 16L11 25.5";

  const content = (
    <svg className="yearArrowSvg" viewBox="0 0 32 32" aria-hidden="true">
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
      <span className="yearArrowButton disabled" aria-hidden="true">
        {content}
      </span>
    );
  }

  return (
    <Link href={href} className="yearArrowButton" aria-label={label} title={title}>
      {content}
    </Link>
  );
}

export default function YearOverviewPage(props) {
  const router = useRouter();

  const year = props.year ?? "";
  const days = Array.isArray(props.days) ? props.days : [];
  const monthsInYear = Array.isArray(props.monthsInYear)
    ? props.monthsInYear
    : [];
  const allYears = Array.isArray(props.allYears) ? props.allYears : [];
  const prevYear = props.prevYear ?? null;
  const nextYear = props.nextYear ?? null;
  const rainOverrides = Array.isArray(props.rainOverrides)
    ? props.rainOverrides
    : [];

  const [mounted, setMounted] = useState(false);
  const [showRecords, setShowRecords] = useState(false);
  const [pickYear, setPickYear] = useState("");
  const [pickMonth, setPickMonth] = useState("");

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
      const rainyDays = arr
        .map((d) => n(d.rain_total))
        .filter((x) => Number.isFinite(x) && x > 1).length;
      const rainrate_max = maxFinite(arr.map((d) => d.rainrate_max));

      const rh_min_mean = avgFinite(arr.map((d) => getRhMin(d)));
      const rh_mean = avgFinite(arr.map((d) => getRhMean(d)));
      const rh_max_mean = avgFinite(arr.map((d) => getRhMax(d)));
      const rh_min_abs = minFinite(arr.map((d) => getRhMin(d)));
      const rh_max_abs = maxFinite(arr.map((d) => getRhMax(d)));

      const wind_mean = avgFinite(arr.map((d) => d.wind_avg));
      const gust_mean = avgFinite(arr.map((d) => d.gust_max));
      const gust_max = maxFinite(arr.map((d) => d.gust_max));
      const wind_dir_mean_deg = circularMeanDeg(
        arr.map((d) => d.wind_dir_mean_deg)
      );

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
    const tmin_abs = minFinite(days.map((d) => d.tmin));
    const tmean_max = maxFinite(days.map((d) => d.tmean));
    const tmax_abs = maxFinite(days.map((d) => d.tmax));

    const rainSum = sumFinite(monthly.map((m) => m.rainSum));
    const rainDailyMax = maxFinite(days.map((d) => d.rain_total));
    const rainyDays = days
      .map((d) => n(d.rain_total))
      .filter((x) => Number.isFinite(x) && x > 1).length;
    const rainrate_max = maxFinite(days.map((d) => d.rainrate_max));

    const rh_min_mean = avgFinite(days.map((d) => getRhMin(d)));
    const rh_mean = avgFinite(days.map((d) => getRhMean(d)));
    const rh_max_mean = avgFinite(days.map((d) => getRhMax(d)));
    const rh_min_abs = minFinite(days.map((d) => getRhMin(d)));
    const rh_mean_max = maxFinite(days.map((d) => getRhMean(d)));
    const rh_max_abs = maxFinite(days.map((d) => getRhMax(d)));

    const wind_mean = avgFinite(days.map((d) => d.wind_avg));
    const gust_mean = avgFinite(days.map((d) => d.gust_max));
    const wind_max_mean = maxFinite(days.map((d) => d.wind_avg));
    const gust_max = maxFinite(days.map((d) => d.gust_max));
    const wind_dir_mean_deg = circularMeanDeg(
      days.map((d) => d.wind_dir_mean_deg)
    );

    const press_min_mean = avgFinite(days.map((d) => d.press_min));
    const press_mean = avgFinite(days.map((d) => d.press_avg));
    const press_max_mean = avgFinite(days.map((d) => d.press_max));
    const press_min_abs = minFinite(days.map((d) => d.press_min));
    const press_mean_max = maxFinite(days.map((d) => d.press_avg));
    const press_max_abs = maxFinite(days.map((d) => d.press_max));

    const uv_mean = avgFinite(days.map((d) => d.uv_mean_pos));
    const uv_max = maxFinite(days.map((d) => d.uv_max));
    const uv_max_mean = avgFinite(days.map((d) => d.uv_max));

    const solar_mean = avgFinite(days.map((d) => d.solar_mean_pos));
    const solar_max = maxFinite(days.map((d) => d.solar_max));
    const solar_max_mean = avgFinite(days.map((d) => d.solar_max));

    const overrideMonths = monthly.filter((m) => m.rainIsOverride);
    const hasRainOverride = overrideMonths.length > 0;
    const overrideMonthsText = overrideMonths
      .map((m) => monthFull(m.ym))
      .join(", ");
    const overrideNotes = overrideMonths
      .map((m) => {
        const note = String(m.rainNote ?? "").trim();
        return note
          ? `${monthFull(m.ym)}: ${note}`
          : `${monthFull(m.ym)}: dato mensile ARPAS`;
      })
      .join(" • ");

    return {
      tmin_mean,
      tmean,
      tmax_mean,
      tmin_abs,
      tmean_max,
      tmax_abs,

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
      rh_min_abs,
      rh_mean_max,
      rh_max_abs,

      wind_mean,
      gust_mean,
      wind_max_mean,
      gust_max,
      wind_dir_mean_deg,

      press_min_mean,
      press_mean,
      press_max_mean,
      press_min_abs,
      press_mean_max,
      press_max_abs,

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
  const dirTxt = Number.isFinite(n(annual.wind_dir_mean_deg))
    ? degToCardinal16(annual.wind_dir_mean_deg)
    : "—";

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
    grid: { left: 64, right: 34, top: 92, bottom: 88 },
    xAxis: {
      type: "category",
      data: x,
      axisLabel: { rotate: 0, margin: 14 },
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
      top: 42,
      itemSize: 14,
    },
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
          {
            name: "Max assoluta",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`),
          },
          {
            name: "Max media",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`),
          },
          {
            name: "Media",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`),
          },
          {
            name: "Min media",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`),
          },
          {
            name: "Min assoluta",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} °C`),
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
        name: "Max assoluta",
        type: "scatter",
        data: seriesLine(monthly.map((m) => m.tmax_abs)),
        symbolSize: 7,
        itemStyle: { color: COLORS.red },
        z: 5,
      },
      {
        name: "Max media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.tmax_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "Media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.tmean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
        z: 4,
      },
      {
        name: "Min media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.tmin_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.blueLight },
        itemStyle: { color: COLORS.blueLight },
      },
      {
        name: "Min assoluta",
        type: "scatter",
        data: seriesLine(monthly.map((m) => m.tmin_abs)),
        symbolSize: 7,
        itemStyle: { color: COLORS.indigo },
      },
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
          lines.push(
            `${pRate.marker}Rate max: <b>${
              v == null ? "—" : `${Number(v).toFixed(1)} mm/h`
            }</b>`
          );
        }

        if (pCum) {
          const v = Array.isArray(pCum.value) ? pCum.value[1] : pCum.value;
          lines.push(
            `${pCum.marker}Totale progressivo: <b>${
              v == null ? "—" : `${Number(v).toFixed(1)} mm`
            }</b>`
          );
        }

        if (pRain) {
          const v = Array.isArray(pRain.value) ? pRain.value[1] : pRain.value;
          lines.push(
            `${pRain.marker}Pioggia: <b>${
              v == null ? "—" : `${Number(v).toFixed(1)} mm`
            }</b>`
          );
        }

        if (monthObj?.rainIsOverride) {
          lines.push(
            `<span style="color:#dc2626;font-weight:700;">● ${
              monthObj.rainLabel || "Dato ARPAS"
            }</span>`
          );
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
      {
        name: "Rate max",
        type: "scatter",
        data: seriesLine(monthly.map((m) => m.rainrate_max)),
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
        data: monthly.map((m) => ({
          value: Number.isFinite(n(m.rainSum)) ? n(m.rainSum) : null,
          itemStyle: {
            color: m.rainIsOverride ? COLORS.rainBarOverride : COLORS.rainBar,
          },
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
          {
            name: "Max assoluta",
            formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`),
          },
          {
            name: "Max media",
            formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`),
          },
          {
            name: "Media",
            formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`),
          },
          {
            name: "Min media",
            formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`),
          },
          {
            name: "Min assoluta",
            formatter: (v) => (v == null ? "—" : `${Math.round(Number(v))} %`),
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
        name: "Max assoluta",
        type: "scatter",
        data: seriesLine(monthly.map((m) => m.rh_max_abs)),
        symbolSize: 7,
        itemStyle: { color: COLORS.blue },
        z: 5,
      },
      {
        name: "Max media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.rh_max_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.blueLight },
        itemStyle: { color: COLORS.blueLight },
      },
      {
        name: "Media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.rh_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
        z: 4,
      },
      {
        name: "Min media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.rh_min_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "Min assoluta",
        type: "scatter",
        data: seriesLine(monthly.map((m) => m.rh_min_abs)),
        symbolSize: 7,
        itemStyle: { color: COLORS.orangeDry },
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
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} km/h`),
          },
          {
            name: "Raffica media",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} km/h`),
          },
          {
            name: "Vento medio",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} km/h`),
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
        data: seriesLine(monthly.map((m) => m.gust_max)),
        yAxisIndex: 0,
        symbolSize: 7,
        itemStyle: { color: COLORS.red },
        z: 5,
      },
      {
        name: "Raffica media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.gust_mean)),
        yAxisIndex: 0,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: "#a3c614" },
        itemStyle: { color: "#a3c614" },
      },
      {
        name: "Vento medio",
        type: "line",
        data: seriesLine(monthly.map((m) => m.wind_mean)),
        yAxisIndex: 0,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: "#4f6fd5" },
        itemStyle: { color: "#4f6fd5" },
      },
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
          {
            name: "Max assoluta",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`),
          },
          {
            name: "Max media",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`),
          },
          {
            name: "Media",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`),
          },
          {
            name: "Min media",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`),
          },
          {
            name: "Min assoluta",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)} hPa`),
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
        name: "Max assoluta",
        type: "scatter",
        data: seriesLine(monthly.map((m) => m.press_max_abs)),
        symbolSize: 7,
        itemStyle: { color: COLORS.red },
        z: 5,
      },
      {
        name: "Max media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.press_max_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "Media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.press_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
        z: 4,
      },
      {
        name: "Min media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.press_min_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.blueLight },
        itemStyle: { color: COLORS.blueLight },
      },
      {
        name: "Min assoluta",
        type: "scatter",
        data: seriesLine(monthly.map((m) => m.press_min_abs)),
        symbolSize: 7,
        itemStyle: { color: COLORS.indigo },
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
            name: "UV max assoluto",
            formatter: (v) => (v == null ? "—" : `${Number(v).toFixed(1)}`),
          },
          {
            name: "UV max medio",
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
        name: "UV max assoluto",
        type: "scatter",
        data: seriesLine(monthly.map((m) => m.uv_max)),
        symbolSize: 7,
        itemStyle: { color: COLORS.red },
        z: 5,
      },
      {
        name: "UV max medio",
        type: "line",
        data: seriesLine(monthly.map((m) => m.uv_max_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "UV medio",
        type: "line",
        data: seriesLine(monthly.map((m) => m.uv_mean)),
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
            name: "Rad max assoluta",
            formatter: (v) =>
              v == null ? "—" : `${Math.round(Number(v))} W/m²`,
          },
          {
            name: "Rad max media",
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
        name: "Rad max assoluta",
        type: "scatter",
        data: seriesLine(monthly.map((m) => m.solar_max)),
        symbolSize: 7,
        itemStyle: { color: COLORS.red },
        z: 5,
      },
      {
        name: "Rad max media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.solar_max_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 2, color: COLORS.orange },
        itemStyle: { color: COLORS.orange },
      },
      {
        name: "Rad media",
        type: "line",
        data: seriesLine(monthly.map((m) => m.solar_mean)),
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 3, color: COLORS.grayDark },
        itemStyle: { color: COLORS.grayDark },
      },
    ],
  };

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
        <section
          className="pageDescription"
          aria-label="Descrizione pagina annuale"
        >
          <div className="descriptionCard">
            <p>
              Questa pagina riassume l’andamento meteorologico dell’anno
              selezionato, mostrando sintesi annuale, riepilogo mensile,
              grafici e tabella completa dei principali parametri osservati.
              Puoi cambiare anno con le frecce o dal menu dedicato, aprire il
              dettaglio dei singoli mesi e consultare temperature,
              precipitazioni, umidità, vento, pressione, UV e radiazione.
            </p>
          </div>
        </section>

        <header className="hero">
          <div className="yearTopRow">
            <div className="yearBlock">
              <div className="yearAndNav">
                <div className="monthSelectHeaderWrap">
                  <span className="headerSelectLabel">Seleziona mese</span>

                  <select
                    className="headerSelectPill monthHeaderSelect"
                    value={pickMonth}
                    onChange={(e) => {
                      const nextMonth = e.target.value;
                      setPickMonth(nextMonth);

                      if (nextMonth) {
                        const mm = monthNum(nextMonth);
                        router.push(`/mesi/${year}/${mm}`);
                      }
                    }}
                  >
                    <option value="">Mese</option>
                    {monthsInYear.map((ym) => (
                      <option key={ym} value={ym}>
                        {monthFull(ym)}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="titleMain">
                  <div className="kicker">Anno</div>

                  <div className="yearLine">
                    <YearArrow
                      href={prevYear ? `/anni/${prevYear}` : ""}
                      direction="prev"
                      label="Anno precedente"
                      title="Precedente"
                      disabled={!prevYear}
                    />

                    <h1 className="year">{year}</h1>

                    <YearArrow
                      href={nextYear ? `/anni/${nextYear}` : ""}
                      direction="next"
                      label="Anno successivo"
                      title="Successivo"
                      disabled={!nextYear}
                    />
                  </div>
                </div>

                <div className="inlineCompareWrap">
                  <span className="headerSelectLabel">Seleziona anno</span>

                  <select
                    id="year-select"
                    className="headerSelectPill yearHeaderSelect"
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
                  <SummaryMetric
                    label="Massima media"
                    value={`${fmt(annual.tmax_mean, 1)} °C`}
                    tone="high"
                    extremeLabel="Massima assoluta"
                    extremeValue={`${fmt(annual.tmax_abs, 1)} °C`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Media assoluta"
                    value={`${fmt(annual.tmean, 1)} °C`}
                    tone="neutral"
                    extremeLabel="Media giornaliera max"
                    extremeValue={`${fmt(annual.tmean_max, 1)} °C`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Minima media"
                    value={`${fmt(annual.tmin_mean, 1)} °C`}
                    tone="low"
                    extremeLabel="Minima assoluta"
                    extremeValue={`${fmt(annual.tmin_abs, 1)} °C`}
                    extremeTone="low"
                  />
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Precipitazioni</div>

                <div className="summaryMetrics four">
                  <SummaryMetric
                    label="Totale annuale"
                    value={`${fmt(annual.rainSum, 1)} mm`}
                    tone="high"
                  />

                  <SummaryMetric
                    label="Giorni > 1 mm"
                    value={fmtInt(annual.rainyDays)}
                    tone="high"
                  />

                  <SummaryMetric
                    label="Giorno più piovoso"
                    value={`${fmt(annual.rainDailyMax, 1)} mm`}
                    tone="high"
                  />

                  <SummaryMetric
                    label="Rain rate più alto"
                    value={`${fmt(annual.rainrate_max, 1)} mm/h`}
                    tone="high"
                  />
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Umidità</div>

                <div className="summaryMetrics three">
                  <SummaryMetric
                    label="Massima media"
                    value={`${fmtInt(annual.rh_max_mean)} %`}
                    tone="high"
                    extremeLabel="Massima assoluta"
                    extremeValue={`${fmtInt(annual.rh_max_abs)} %`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Media assoluta"
                    value={`${fmtInt(annual.rh_mean)} %`}
                    tone="neutral"
                    extremeLabel="Media giornaliera max"
                    extremeValue={`${fmtInt(annual.rh_mean_max)} %`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Minima media"
                    value={`${fmtInt(annual.rh_min_mean)} %`}
                    tone="low"
                    extremeLabel="Minima assoluta"
                    extremeValue={`${fmtInt(annual.rh_min_abs)} %`}
                    extremeTone="low"
                  />
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Vento</div>

                <div className="summaryMetrics four">
                  <SummaryMetric
                    label="Media assoluta"
                    value={`${fmt(annual.wind_mean, 1)} km/h`}
                    tone="neutral"
                  />

                  <SummaryMetric
                    label="Media raffiche"
                    value={`${fmt(annual.gust_mean, 1)} km/h`}
                    tone="high"
                  />

                  <SummaryMetric
                    label="Media massima"
                    value={`${fmt(annual.wind_max_mean, 1)} km/h`}
                    tone="high"
                  />

                  <SummaryMetric
                    label="Raffica massima"
                    value={`${fmt(annual.gust_max, 1)} km/h`}
                    tone="high"
                  />
                </div>

                <div className="summarySmallNote">
                  Direzione media: <b>{dirTxt}</b>
                </div>
              </div>

              <div className="summaryRow">
                <div className="summaryLabel">Pressione</div>

                <div className="summaryMetrics three">
                  <SummaryMetric
                    label="Massima media"
                    value={`${fmt(annual.press_max_mean, 1)} hPa`}
                    tone="high"
                    extremeLabel="Massima assoluta"
                    extremeValue={`${fmt(annual.press_max_abs, 1)} hPa`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Media assoluta"
                    value={`${fmt(annual.press_mean, 1)} hPa`}
                    tone="neutral"
                    extremeLabel="Media giornaliera max"
                    extremeValue={`${fmt(annual.press_mean_max, 1)} hPa`}
                    extremeTone="high"
                  />

                  <SummaryMetric
                    label="Minima media"
                    value={`${fmt(annual.press_min_mean, 1)} hPa`}
                    tone="low"
                    extremeLabel="Minima assoluta"
                    extremeValue={`${fmt(annual.press_min_abs, 1)} hPa`}
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
                      value={fmt(annual.uv_mean, 1)}
                      tone="neutral"
                    />

                    <SummaryMetric
                      label="UV max medio"
                      value={fmt(annual.uv_max_mean, 1)}
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
                        Number.isFinite(n(annual.solar_mean))
                          ? `${Math.round(n(annual.solar_mean))} W/m²`
                          : "—"
                      }
                      tone="neutral"
                    />

                    <SummaryMetric
                      label="Rad max media"
                      value={
                        Number.isFinite(n(annual.solar_max_mean))
                          ? `${Math.round(n(annual.solar_max_mean))} W/m²`
                          : "—"
                      }
                      tone="high"
                    />
                  </div>
                </div>
              </div>
            </div>

            {annual.rainHasOverride ? (
              <div className="overrideNote">
                Totale annuale calcolato sommando i totali mensili finali. Nei mesi{" "}
                <strong>{annual.rainOverrideMonthsText}</strong> è stato usato il dato
                ARPAS al posto del totale grezzo della stazione.
                {annual.rainOverrideNote ? (
                  <span className="overrideNoteExtra"> {annual.rainOverrideNote}</span>
                ) : null}
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
                  <div className="recordsSub">
                    Estremi e picchi principali dell&apos;anno con collegamento diretto
                    al giorno o al mese.
                  </div>
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

                          <td
                            className={
                              r.label === "Totale mensile precipitazioni"
                                ? "recordRainCell"
                                : ""
                            }
                          >
                            {r.min
                              ? `${fmt(r.min.value, 1)}${r.unit ? ` ${r.unit}` : ""}`
                              : "—"}
                            {r.minLabel ? (
                              <span className="recordNote">{r.minLabel}</span>
                            ) : null}
                          </td>
                          <td>{renderRecordLink(r.min, r.linkType)}</td>

                          <td
                            className={
                              r.label === "Totale mensile precipitazioni"
                                ? "recordRainCell"
                                : ""
                            }
                          >
                            {r.max
                              ? `${fmt(r.max.value, 1)}${r.unit ? ` ${r.unit}` : ""}`
                              : "—"}
                            {r.maxLabel ? (
                              <span className="recordNote">{r.maxLabel}</span>
                            ) : null}
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
              <ReactECharts
                option={optTemp}
                style={{ height: 390, width: "100%" }}
              />
            </div>

            <div className="chartBox chartBoxWide">
              <ReactECharts
                option={optRain}
                style={{ height: 390, width: "100%" }}
              />
            </div>

            <div className="chartBox chartBoxWide">
              <ReactECharts
                option={optWind}
                style={{ height: 390, width: "100%" }}
              />
            </div>

            <div className="chartBox">
              <ReactECharts
                option={optRh}
                style={{ height: 370, width: "100%" }}
              />
            </div>

            <div className="chartBox">
              <ReactECharts
                option={optPress}
                style={{ height: 370, width: "100%" }}
              />
            </div>

            <div className="chartBox">
              <ReactECharts
                option={optUv}
                style={{ height: 370, width: "100%" }}
              />
            </div>

            <div className="chartBox">
              <ReactECharts
                option={optSolar}
                style={{ height: 370, width: "100%" }}
              />
            </div>
          </section>
        )}

        <section className="monthsTableHead">
          <div className="monthsTableTitle">Riepilogo mensile</div>
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
                      className={`${
                        Number.isFinite(n(m.rainSum)) && n(m.rainSum) > 0
                          ? "rainy"
                          : ""
                      } ${m.rainIsOverride ? "rainOverrideCell" : ""}`}
                      title={m.rainIsOverride ? "Dato mensile ARPAS prioritario" : ""}
                    >
                      {fmt(m.rainSum, 1)} mm
                    </td>
                    <td
                      className={
                        Number.isFinite(n(m.rainDailyMax)) && n(m.rainDailyMax) > 0
                          ? "rainy"
                          : ""
                      }
                    >
                      {fmt(m.rainDailyMax, 1)} mm
                    </td>
                    <td
                      className={
                        Number.isFinite(n(m.rainrate_max)) && n(m.rainrate_max) > 0
                          ? "rainy"
                          : ""
                      }
                    >
                      {fmt(m.rainrate_max, 1)} mm/h
                    </td>
                    <td className="bR">{fmtInt(m.rainyDays)}</td>

                    <td>{fmtInt(m.rh_min_mean)} %</td>
                    <td className="strong">{fmtInt(m.rh_mean)} %</td>
                    <td className="bR">{fmtInt(m.rh_max_mean)} %</td>

                    <td>{fmt(m.wind_mean, 1)} km/h</td>
                    <td>{fmt(m.gust_mean, 1)} km/h</td>
                    <td>{fmt(m.gust_max, 1)} km/h</td>
                    <td className="bR">
                      {Number.isFinite(dir) ? degToCardinal16(dir) : "—"}
                      {Number.isFinite(dir) ? (
                        <span style={{ opacity: 0.65 }}> ({Math.round(dir)}°)</span>
                      ) : null}
                    </td>

                    <td>{fmt(m.press_min_mean, 1)} hPa</td>
                    <td className="strong">{fmt(m.press_mean, 1)} hPa</td>
                    <td className="bR">{fmt(m.press_max_mean, 1)} hPa</td>

                    <td>{fmt(m.uv_mean, 1)}</td>
                    <td className="bR">{fmt(m.uv_max, 1)}</td>

                    <td>
                      {Number.isFinite(n(m.solar_mean))
                        ? `${Math.round(n(m.solar_mean))} W/m²`
                        : "—"}
                    </td>
                    <td>
                      {Number.isFinite(n(m.solar_max))
                        ? `${Math.round(n(m.solar_max))} W/m²`
                        : "—"}
                    </td>
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
                  className={`${
                    Number.isFinite(n(annual.rainSum)) && n(annual.rainSum) > 0
                      ? "rainy"
                      : ""
                  } ${annual.rainHasOverride ? "rainOverrideCell" : ""}`}
                  title={
                    annual.rainHasOverride
                      ? `Totale annuale con priorità ARPAS nei mesi: ${annual.rainOverrideMonthsText}`
                      : ""
                  }
                >
                  {fmt(annual.rainSum, 1)} mm
                </td>
                <td
                  className={
                    Number.isFinite(n(annual.rainDailyMax)) &&
                    n(annual.rainDailyMax) > 0
                      ? "rainy"
                      : ""
                  }
                >
                  {fmt(annual.rainDailyMax, 1)} mm
                </td>
                <td
                  className={
                    Number.isFinite(n(annual.rainrate_max)) &&
                    n(annual.rainrate_max) > 0
                      ? "rainy"
                      : ""
                  }
                >
                  {fmt(annual.rainrate_max, 1)} mm/h
                </td>
                <td className="bR">{fmtInt(annual.rainyDays)}</td>

                <td>{fmtInt(annual.rh_min_mean)} %</td>
                <td className="strong">{fmtInt(annual.rh_mean)} %</td>
                <td className="bR">{fmtInt(annual.rh_max_mean)} %</td>

                <td>{fmt(annual.wind_mean, 1)} km/h</td>
                <td>{fmt(annual.gust_mean, 1)} km/h</td>
                <td>{fmt(annual.gust_max, 1)} km/h</td>
                <td className="bR">
                  {Number.isFinite(n(annual.wind_dir_mean_deg))
                    ? degToCardinal16(annual.wind_dir_mean_deg)
                    : "—"}
                  {Number.isFinite(n(annual.wind_dir_mean_deg)) ? (
                    <span style={{ opacity: 0.65 }}>
                      {" "}
                      ({Math.round(n(annual.wind_dir_mean_deg))}°)
                    </span>
                  ) : null}
                </td>

                <td>{fmt(annual.press_min_mean, 1)} hPa</td>
                <td className="strong">{fmt(annual.press_mean, 1)} hPa</td>
                <td className="bR">{fmt(annual.press_max_mean, 1)} hPa</td>

                <td>{fmt(annual.uv_mean, 1)}</td>
                <td className="bR">{fmt(annual.uv_max, 1)}</td>

                <td>
                  {Number.isFinite(n(annual.solar_mean))
                    ? `${Math.round(n(annual.solar_mean))} W/m²`
                    : "—"}
                </td>
                <td>
                  {Number.isFinite(n(annual.solar_max))
                    ? `${Math.round(n(annual.solar_max))} W/m²`
                    : "—"}
                </td>
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
            position: relative;
            min-height: 132px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
          }

          .monthSelectHeaderWrap {
            position: absolute;
            left: 0;
            top: 50%;
            transform: translateY(-50%);
            z-index: 2;
            display: grid;
            justify-items: center;
            align-items: center;
            gap: 10px;
            min-width: 170px;
          }

          .inlineCompareWrap {
            position: absolute;
            right: 0;
            top: 50%;
            transform: translateY(-50%);
            z-index: 2;
            display: grid;
            justify-items: center;
            align-items: center;
            gap: 10px;
            min-width: 170px;
          }

          .headerSelectLabel {
            display: block;
            font-size: 13px;
            letter-spacing: 0.13em;
            text-transform: uppercase;
            color: #475569;
            font-weight: 850;
            line-height: 1.1;
            text-align: center;
            white-space: nowrap;
          }

          .headerSelectPill {
            appearance: none;
            -webkit-appearance: none;
            -moz-appearance: none;
            height: 54px;
            padding: 0 16px;
            border-radius: 999px;
            background: linear-gradient(180deg, #ffffff, #f8fafc);
            border: 1px solid #d8dee7;
            box-shadow:
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 4px 14px rgba(15, 23, 42, 0.04);
            font-weight: 900;
            font-size: 16px;
            color: #0f172a;
            cursor: pointer;
            color-scheme: light;
            text-align: center;
          }

          .headerSelectPill:focus {
            outline: none;
            border-color: #b9c5d6;
            box-shadow:
              0 0 0 2px rgba(37, 99, 235, 0.12),
              inset 0 1px 0 rgba(255, 255, 255, 0.9),
              0 4px 14px rgba(15, 23, 42, 0.05);
          }

          .headerSelectPill option {
            color: #111111;
            background: #ffffff;
          }

          .monthHeaderSelect {
            width: 132px;
            min-width: 132px;
            max-width: 132px;
          }

          .yearHeaderSelect {
            width: 104px;
            min-width: 104px;
            max-width: 104px;
          }

          .titleMain {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            display: grid;
            justify-items: center;
            align-items: center;
            text-align: center;
            z-index: 1;
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
          }

          .year {
            margin: 0;
            font-size: 68px;
            line-height: 1;
            letter-spacing: -0.04em;
            text-align: center;
            color: #111111;
          }

          :global(.yearArrowButton) {
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

          :global(.yearArrowButton:hover) {
            background: rgba(15, 23, 42, 0.05) !important;
            transform: translateY(-1px);
            opacity: 1 !important;
          }

          :global(.yearArrowButton.disabled) {
            opacity: 0.28 !important;
            pointer-events: none !important;
          }

          :global(.yearArrowSvg) {
            width: 32px !important;
            height: 32px !important;
            min-width: 32px !important;
            min-height: 32px !important;
            display: block !important;
            overflow: visible !important;
            color: #475569 !important;
            stroke: currentColor !important;
          }

          .pageDescription {
            width: 100%;
            margin: 0 0 14px;
          }

          .descriptionCard {
            width: 100%;
            box-sizing: border-box;
            margin: 0 auto;
            padding: 16px 20px;
            border: 1px solid #dfe5ec;
            border-radius: 18px;
            background: rgba(248, 250, 252, 0.92);
            box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
          }

          .descriptionCard p {
            margin: 0;
            font-size: 14px;
            line-height: 1.75;
            font-weight: 800;
            color: #334155;
            text-align: left;
            hyphens: none;
            -webkit-hyphens: none;
            overflow-wrap: break-word;
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
            transition:
              transform 120ms ease,
              box-shadow 120ms ease,
              background 120ms ease;
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

          @media (max-width: 1180px) {
            .monthSelectHeaderWrap,
            .inlineCompareWrap {
              min-width: 145px;
            }

            .headerSelectLabel {
              font-size: 12px;
            }

            .monthHeaderSelect {
              width: 122px;
              min-width: 122px;
              max-width: 122px;
            }

            .yearHeaderSelect {
              width: 94px;
              min-width: 94px;
              max-width: 94px;
            }

            .year {
              font-size: 62px;
            }
          }

          @media (max-width: 1100px) {
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

          @media (max-width: 980px) {
            .yearAndNav {
              min-height: 0;
              display: grid;
              grid-template-columns: 1fr;
              justify-content: center;
              align-items: center;
              row-gap: 18px;
            }

            .titleMain {
              position: static;
              transform: none;
              width: auto;
              grid-column: 1;
              grid-row: 1;
            }

            .monthSelectHeaderWrap {
              position: static;
              transform: none;
              grid-column: 1;
              grid-row: 2;
              justify-self: center;
            }

            .inlineCompareWrap {
              position: static;
              transform: none;
              grid-column: 1;
              grid-row: 3;
              justify-self: center;
            }

            .yearLine {
              gap: 12px;
            }

            :global(.yearArrowButton) {
              width: 44px !important;
              height: 44px !important;
              min-width: 44px !important;
              min-height: 44px !important;
            }

            :global(.yearArrowSvg) {
              width: 30px !important;
              height: 30px !important;
              min-width: 30px !important;
              min-height: 30px !important;
            }
          }

          @media (max-width: 720px) {
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

            .headerSelectPill {
              height: 42px;
              padding: 0 12px;
              font-size: 13px;
            }

            .monthHeaderSelect {
              width: 112px;
              min-width: 112px;
              max-width: 112px;
            }

            .yearHeaderSelect {
              width: 88px;
              min-width: 88px;
              max-width: 88px;
            }
          }

          /* Sintesi annuale compatta su mobile, coerente con la pagina giornaliera */
          @media (max-width: 720px) {
            .descriptionCard {
              padding: 14px 16px;
            }

            .descriptionCard p {
              font-size: 13px;
              line-height: 1.65;
              text-align: left;
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

            .summaryMetrics.four {
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 6px;
            }

            :global(.summaryMetric) {
              min-height: 76px;
              padding: 8px 5px;
              align-content: center;
              justify-items: center;
              text-align: center;
              border-radius: 12px;
              gap: 3px;
            }

            .summaryMetrics.three :global(.summaryMetric) {
              min-height: 112px;
            }

            :global(.summaryKey) {
              min-height: 20px;
              margin-bottom: 1px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 8px;
              line-height: 1.12;
              white-space: normal;
              text-align: center;
            }

            :global(.summaryValueLine) {
              justify-content: center;
              width: 100%;
            }

            :global(.summaryValue) {
              font-size: 15px;
              line-height: 1.02;
              white-space: normal;
              text-align: center;
            }

            :global(.summaryExtreme) {
              width: 100%;
              margin-top: 3px;
              padding-top: 5px;
              display: grid;
              justify-items: center;
              gap: 2px;
              text-align: center;
            }

            :global(.summaryExtreme span) {
              min-height: 18px;
              font-size: 7px;
              line-height: 1.12;
              white-space: normal;
              text-align: center;
            }

            :global(.summaryExtreme b) {
              font-size: 11px;
              white-space: normal;
              text-align: center;
            }

            .summarySmallNote,
            .overrideNote {
              margin-top: 8px;
              text-align: center;
            }
          }

          @media (max-width: 520px) {
            .hero {
              padding: 14px;
              border-radius: 16px;
            }

            .yearAndNav {
              row-gap: 16px;
              justify-content: center;
              align-items: center;
            }

            .yearLine {
              gap: 6px;
            }

            .year {
              font-size: 52px;
            }

            :global(.yearArrowButton) {
              width: 36px !important;
              height: 40px !important;
              min-width: 36px !important;
              min-height: 40px !important;
            }

            :global(.yearArrowSvg) {
              width: 25px !important;
              height: 25px !important;
              min-width: 25px !important;
              min-height: 25px !important;
            }

            .pageDescription {
              margin-bottom: 12px;
            }

            .descriptionCard {
              padding: 14px 16px;
              border-radius: 18px;
            }

            .descriptionCard p {
              font-size: 13px;
              line-height: 1.65;
              font-weight: 800;
              text-align: left;
            }

            .summaryHead h2 {
              font-size: 22px;
            }

            .summaryRows {
              gap: 9px;
            }

            :global(.summaryMetric) {
              padding: 8px 5px;
            }

            :global(.summaryValueLine) {
              justify-content: center;
              width: 100%;
            }

            :global(.summaryKey) {
              font-size: 8px;
              margin-bottom: 1px;
            }

            :global(.summaryValue) {
              font-size: 15px;
            }

            .cellText {
              font-size: 16px;
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
              font-size: 46px;
            }

            :global(.summaryMetric) {
              padding: 7px 4px;
            }

            :global(.summaryKey) {
              font-size: 7.5px;
            }

            :global(.summaryValue) {
              font-size: 14px;
            }

            :global(.summaryExtreme span) {
              font-size: 6.6px;
            }

            :global(.summaryExtreme b) {
              font-size: 10.5px;
            }

            .yearLine {
              gap: 4px;
            }

            :global(.yearArrowButton) {
              width: 30px !important;
              min-width: 30px !important;
            }

            :global(.yearArrowSvg) {
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