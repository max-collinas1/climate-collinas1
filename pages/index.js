import dynamic from "next/dynamic";
import fs from "fs/promises";
import path from "path";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import SiteLayout from "../components/SiteLayout";
import { readDailyLive, readMonthlyOverridesLive } from "../lib/liveData";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function findMonthlyOverride(overrides, ym, field) {
  return (
    (overrides || []).find(
      (o) =>
        String(o?.scope ?? "") === "month" &&
        String(o?.ym ?? "") === String(ym) &&
        String(o?.field ?? "") === String(field),
    ) || null
  );
}

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

function round1(x) {
  const v = n(x);
  if (!Number.isFinite(v)) return null;
  return Math.round((v + Number.EPSILON) * 10) / 10;
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
      c += 1;
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

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
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

const MONTHS_IT_LOWER = MONTHS_IT_FULL.map((x) => x.toLowerCase());

const WEEKDAYS_IT = [
  "domenica",
  "lunedì",
  "martedì",
  "mercoledì",
  "giovedì",
  "venerdì",
  "sabato",
];

function monthFull(ym) {
  const mm = Number(String(ym).slice(5, 7));
  return MONTHS_IT_FULL[mm - 1] || String(ym);
}

function pad2(x) {
  return String(x).padStart(2, "0");
}

function dateToISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function isoToLocalDate(iso, hour = 12) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, 0, 0, 0);
}

function addDaysISO(iso, amount) {
  const d = isoToLocalDate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + amount);
  return dateToISO(d);
}

function dateRangeISO(startISO, endISO) {
  const start = isoToLocalDate(startISO);
  const end = isoToLocalDate(endISO);
  if (!start || !end || start > end) return [];

  const out = [];
  const cursor = new Date(start);

  while (cursor <= end) {
    out.push(dateToISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return out;
}

function getPeriodBounds(mode, selectedDate) {
  if (!selectedDate) return { startISO: null, endISO: null };

  if (mode === "day") {
    return { startISO: selectedDate, endISO: selectedDate };
  }

  if (mode === "week") {
    return {
      startISO: addDaysISO(selectedDate, -7),
      endISO: selectedDate,
    };
  }

  if (mode === "month") {
    return {
      startISO: addDaysISO(selectedDate, -30),
      endISO: selectedDate,
    };
  }

  return { startISO: selectedDate, endISO: selectedDate };
}

function formatLongDate(iso) {
  const d = isoToLocalDate(iso);
  if (!d) return iso || "—";

  return `${WEEKDAYS_IT[d.getDay()]} ${d.getDate()} ${MONTHS_IT_LOWER[d.getMonth()]} ${d.getFullYear()}`;
}

function formatPeriodLabel(mode, selectedDate) {
  if (!selectedDate) return "—";

  if (mode === "day") return formatLongDate(selectedDate);
  if (mode === "week" || mode === "month") {
    return `Fino a ${formatLongDate(selectedDate)}`;
  }

  return formatLongDate(selectedDate);
}

function degToCardinal8(v) {
  const nn = Number(v);
  if (!Number.isFinite(nn)) return "";

  const d = ((nn % 360) + 360) % 360;
  const ix = Math.round(d / 45) % 8;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][ix];
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

function pointAtOrBeforeTimestamp(pairs, timestamp) {
  if (!Array.isArray(pairs) || !Number.isFinite(Number(timestamp))) return null;

  const limit = Number(timestamp);

  for (let i = pairs.length - 1; i >= 0; i -= 1) {
    const point = pairs[i];
    const x = Number(point?.[0]);
    const y = n(point?.[1]);

    if (Number.isFinite(x) && x <= limit && Number.isFinite(y)) {
      return [x, y];
    }
  }

  return null;
}

function makeRealtimePulseSeries(
  dataPairs,
  timestamp,
  yAxisIndex = 0,
  seriesName = "Dato live",
) {
  const point = pointAtOrBeforeTimestamp(dataPairs, timestamp);
  if (!point) return null;

  return {
    name: seriesName,
    type: "effectScatter",
    data: [point],
    yAxisIndex,
    coordinateSystem: "cartesian2d",
    symbol: "circle",
    symbolSize: 9,
    showEffectOn: "render",
    animation: true,
    rippleEffect: {
      brushType: "stroke",
      scale: 4,
      period: 1.8,
      number: 3,
    },
    itemStyle: {
      color: "#ef4444",
      borderColor: "#ffffff",
      borderWidth: 2,
      shadowBlur: 10,
      shadowColor: "rgba(239, 68, 68, 0.65)",
    },
    emphasis: { scale: false },
    tooltip: { show: false },
    silent: true,
    zlevel: 10,
    z: 100,
  };
}

function trimTrailingNullPoints(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return [];

  let lastValidIndex = -1;

  for (let index = pairs.length - 1; index >= 0; index -= 1) {
    const timestamp = Number(pairs[index]?.[0]);
    const value = n(pairs[index]?.[1]);

    if (Number.isFinite(timestamp) && Number.isFinite(value)) {
      lastValidIndex = index;
      break;
    }
  }

  return lastValidIndex >= 0 ? pairs.slice(0, lastValidIndex + 1) : [];
}

function makeChartToolbox({ filename, isMobile }) {
  return {
    feature: {
      restore: { title: "Ripristina" },
      saveAsImage: {
        type: "png",
        name: filename,
        backgroundColor: "#ffffff",
        pixelRatio: 2,
        title: "Salva grafico",
      },
    },
    left: isMobile ? 10 : 14,
    top: isMobile ? 25 : 13,
    itemSize: isMobile ? 14 : 17,
    itemGap: isMobile ? 7 : 9,
    iconStyle: {
      borderColor: "#64748b",
      borderWidth: 1.3,
    },
    emphasis: {
      iconStyle: {
        borderColor: "#2563eb",
      },
    },
  };
}

function makePeriodDataZoom() {
  return [
    {
      type: "inside",
      xAxisIndex: 0,
      filterMode: "none",
      zoomOnMouseWheel: true,
      moveOnMouseWheel: true,
      moveOnMouseMove: true,
    },
  ];
}

function formatChartDateReference(mode, startTimestamp, endTimestamp, selectedDate) {
  if (mode === "day") {
    const date = isoToLocalDate(selectedDate);
    if (!date) return "";
    return `${date.getDate()} ${MONTHS_IT_LOWER[date.getMonth()]} ${date.getFullYear()}`;
  }

  const start = Number.isFinite(Number(startTimestamp))
    ? new Date(Number(startTimestamp))
    : null;
  const end = Number.isFinite(Number(endTimestamp))
    ? new Date(Number(endTimestamp))
    : null;

  if (!start || !end) return "";

  const startDay = start.getDate();
  const endDay = end.getDate();
  const startMonth = MONTHS_IT_LOWER[start.getMonth()];
  const endMonth = MONTHS_IT_LOWER[end.getMonth()];
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();

  if (startYear === endYear && start.getMonth() === end.getMonth()) {
    return `Dal ${startDay} al ${endDay} ${endMonth} ${endYear}`;
  }

  if (startYear === endYear) {
    return `Dal ${startDay} ${startMonth} al ${endDay} ${endMonth} ${endYear}`;
  }

  return `Dal ${startDay} ${startMonth} ${startYear} al ${endDay} ${endMonth} ${endYear}`;
}

function makeDailyBoundaryMarkLine(mode, startTimestamp, endTimestamp) {
  if (mode === "day") return null;

  const start = Number(startTimestamp);
  const end = Number(endTimestamp);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return null;
  }

  const first = new Date(start);
  first.setHours(0, 0, 0, 0);
  if (first.getTime() <= start) first.setDate(first.getDate() + 1);

  const data = [];
  const cursor = new Date(first);
  let guard = 0;

  while (cursor.getTime() < end && guard < 40) {
    data.push({ xAxis: cursor.getTime() });
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  if (!data.length) return null;

  return {
    silent: true,
    symbol: "none",
    label: { show: false },
    lineStyle: {
      color: "rgba(148, 163, 184, 0.18)",
      width: 1,
      type: "solid",
    },
    data,
  };
}

function makePeriodTimeline(startISO, endISO, stepMinutes = 60) {
  const start = isoToLocalDate(startISO, 0);
  const endExclusive = isoToLocalDate(addDaysISO(endISO, 1), 0);

  if (!start || !endExclusive || start >= endExclusive) return [];

  const out = [];
  let cursor = new Date(start);
  let safety = 0;
  const maxSteps = Math.max(1, Math.ceil(((endExclusive - start) / 60000) / Math.max(1, stepMinutes)) + 4);

  while (cursor < endExclusive && safety < maxSteps) {
    out.push(cursor.getTime());
    const next = new Date(cursor);
    next.setMinutes(next.getMinutes() + stepMinutes, 0, 0);

    if (next.getTime() <= cursor.getTime()) break;

    cursor = next;
    safety += 1;
  }

  return out;
}

function dailyTempField(row, field) {
  const value = n(row?.[field]);
  return Number.isFinite(value) ? value : NaN;
}

function dailyTmin(row) {
  return dailyTempField(row, "tmin");
}

function dailyTmax(row) {
  return dailyTempField(row, "tmax");
}

function dailyTmean(row) {
  const raw = n(row?.tmean);
  const tmin = dailyTmin(row);
  const tmax = dailyTmax(row);
  const mid =
    Number.isFinite(tmin) && Number.isFinite(tmax) ? (tmin + tmax) / 2 : NaN;

  if (Number.isFinite(raw)) {
    return raw;
  }

  if (Number.isFinite(mid)) return mid;
  return NaN;
}

function dailyRain(row) {
  const v = n(row?.rain_total);
  return Number.isFinite(v) ? v : NaN;
}

function dailyGust(row) {
  const v = n(row?.gust_max);
  return Number.isFinite(v) ? v : NaN;
}

function firstFiniteField(row, keys = []) {
  for (const key of keys) {
    const value = n(row?.[key]);
    if (Number.isFinite(value)) return value;
  }

  return NaN;
}

function longestDrySpellDays(rows, threshold = 1) {
  let longest = 0;
  let current = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const rain = dailyRain(row);

    if (Number.isFinite(rain) && rain < threshold) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}

function yearlyExpectedDays(year) {
  const y = Number(year);
  if (!Number.isFinite(y)) return 365;

  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return leap ? 366 : 365;
}


function longestWetSpellDays(rows, threshold = 1) {
  let longest = 0;
  let current = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const rain = dailyRain(row);

    if (Number.isFinite(rain) && rain >= threshold) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }

  return longest;
}


async function readPublicJson(relativeParts = []) {
  try {
    const filePath = path.join(
      process.cwd(),
      "public",
      ...relativeParts.map((part) => String(part)),
    );

    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadCivilProtectionStatus() {
  const fallback = {
    zoneCode: "SARD-C",
    zoneName: "Bacini Montevecchio-Pischilappiu",
    updatedAt: null,
    sourceUrl: "https://www.sardegnaambiente.it/protezionecivile/",
    current: {
      level: "unknown",
      label: "Stato da verificare",
      validFrom: null,
      validTo: null,
      risks: [],
      note: "Consulta il bollettino ufficiale della Protezione Civile regionale.",
    },
    next: {
      level: "unknown",
      label: "Prossimo stato da verificare",
      validFrom: null,
      validTo: null,
      risks: [],
      note: "Il prossimo livello verrà mostrato quando disponibile.",
    },
  };

  try {
    const payload = await readPublicJson([
      "data",
      "protezione-civile.json",
    ]);

    if (!payload || typeof payload !== "object") {
      return fallback;
    }

    const normalizePeriod = (period, fallbackLabel) => {
      const source = period && typeof period === "object" ? period : {};

      return {
        level: String(source.level || "unknown").toLowerCase(),
        label: String(source.label || fallbackLabel),
        validFrom: source.validFrom || null,
        validTo: source.validTo || null,
        risks: Array.isArray(source.risks)
          ? source.risks.map((item) => String(item)).filter(Boolean)
          : [],
        note: source.note ? String(source.note) : "",
      };
    };

    return {
      zoneCode: String(payload.zoneCode || fallback.zoneCode),
      zoneName: String(payload.zoneName || fallback.zoneName),
      updatedAt: payload.updatedAt || null,
      sourceUrl: String(payload.sourceUrl || fallback.sourceUrl),
      current: normalizePeriod(
        payload.current,
        "Stato attuale da verificare",
      ),
      next: normalizePeriod(
        payload.next,
        "Prossimo stato da verificare",
      ),
    };
  } catch {
    return fallback;
  }
}

export async function getStaticProps() {
  const rows = (await readDailyLive())
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date || "")))
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));

  const overrides = await readMonthlyOverridesLive();

  const years = Array.from(
    new Set(rows.map((r) => String(r?.date || "").slice(0, 4)).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));

  const start = rows.length ? rows[0].date : null;
  const end = rows.length ? rows[rows.length - 1].date : null;

  const byYear = new Map();
  for (const r of rows) {
    const y = String(r?.date || "").slice(0, 4);
    if (!y) continue;
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(r);
  }

  const yearStats = years.map((y) => {
    const d = byYear.get(y) || [];

    const byMonth = new Map();
    for (const row of d) {
      const ym = String(row?.date || "").slice(0, 7);
      if (!ym) continue;
      if (!byMonth.has(ym)) byMonth.set(ym, []);
      byMonth.get(ym).push(row);
    }

    const monthly = Array.from(byMonth.keys())
      .sort()
      .map((ym) => {
        const arr = byMonth.get(ym) || [];
        const rawRainSum = sumFinite(arr.map((x) => x.rain_total));
        const rainOverride = findMonthlyOverride(overrides, ym, "rainSum");
        const resolvedRain = applyRainMonthOverride(rawRainSum, rainOverride);

        return {
          ym,
          rainSum: resolvedRain.value,
          rainIsOverride: resolvedRain.isOverride,
          rainLabel: resolvedRain.label,
          rainSource: resolvedRain.source,
          rainNote: resolvedRain.note,
        };
      });

    const overrideMonths = monthly.filter((m) => m.rainIsOverride);

    const tminValues = d.map((x) => dailyTmin(x)).filter(Number.isFinite);
    const tmeanValues = d.map((x) => dailyTmean(x)).filter(Number.isFinite);
    const tmaxValues = d.map((x) => dailyTmax(x)).filter(Number.isFinite);
    const rainValues = d.map((x) => dailyRain(x)).filter(Number.isFinite);

    const humidityMeanValues = d
      .map((row) =>
        firstFiniteField(row, [
          "rh_mean",
          "rh_avg",
          "humidity_mean",
          "humidity_avg",
          "rh_pct_mean",
          "rh_pct_avg",
        ]),
      )
      .filter(Number.isFinite);

    const humidityMinValues = d
      .map((row) =>
        firstFiniteField(row, [
          "rh_min",
          "humidity_min",
          "rh_pct_min",
        ]),
      )
      .filter(Number.isFinite);

    const humidityMaxValues = d
      .map((row) =>
        firstFiniteField(row, [
          "rh_max",
          "humidity_max",
          "rh_pct_max",
        ]),
      )
      .filter(Number.isFinite);

    const windMeanValues = d
      .map((row) =>
        firstFiniteField(row, [
          "wind_mean",
          "wind_avg",
          "wind_kmh_mean",
          "wind_kmh_avg",
          "wind_speed_mean",
          "wind_speed_avg",
        ]),
      )
      .filter(Number.isFinite);

    const windMaxMeanValues = d
      .map((row) =>
        firstFiniteField(row, [
          "wind_max",
          "wind_kmh_max",
          "wind_speed_max",
        ]),
      )
      .filter(Number.isFinite);

    const gustMeanValues = d
      .map((row) =>
        firstFiniteField(row, [
          "gust_mean",
          "gust_avg",
          "gust_kmh_mean",
          "gust_kmh_avg",
          "wind_gust_mean",
          "wind_gust_avg",
        ]),
      )
      .filter(Number.isFinite);

    const gustMaxValues = d
      .map((row) =>
        firstFiniteField(row, [
          "gust_max",
          "gust_kmh",
          "gust_kmh_max",
          "wind_gust_max",
          "wind_gust_kmh",
        ]),
      )
      .filter(Number.isFinite);

    const pressureMeanValues = d
      .map((row) =>
        firstFiniteField(row, [
          "press_mean",
          "press_avg",
          "pressure_mean",
          "pressure_avg",
          "press_hpa_mean",
          "press_hpa_avg",
        ]),
      )
      .filter(Number.isFinite);

    const pressureMinValues = d
      .map((row) =>
        firstFiniteField(row, [
          "press_min",
          "pressure_min",
          "press_hpa_min",
        ]),
      )
      .filter(Number.isFinite);

    const pressureMaxValues = d
      .map((row) =>
        firstFiniteField(row, [
          "press_max",
          "pressure_max",
          "press_hpa_max",
        ]),
      )
      .filter(Number.isFinite);

    const rainSum = sumFinite(monthly.map((m) => m.rainSum));
    const expectedDays = yearlyExpectedDays(y);
    const lastDate = d.length ? String(d[d.length - 1]?.date || "") : "";
    const yearEnded = lastDate === `${y}-12-31`;
    const coverage = expectedDays > 0 ? d.length / expectedDays : 0;
    const complete = yearEnded && coverage >= 0.99;

    return {
      year: y,
      ndays: d.length,
      expectedDays,
      complete,

      tmin: tminValues.length ? Math.min(...tminValues) : null,
      tmax: tmaxValues.length ? Math.max(...tmaxValues) : null,
      tmean: tmeanValues.length ? avgFinite(tmeanValues) : null,
      tminMean: tminValues.length ? avgFinite(tminValues) : null,
      tmaxMean: tmaxValues.length ? avgFinite(tmaxValues) : null,

      summerDays25: tmaxValues.filter((value) => value >= 25).length,
      hotDays30: tmaxValues.filter((value) => value >= 30).length,
      hotDays35: tmaxValues.filter((value) => value >= 35).length,
      hotDays40: tmaxValues.filter((value) => value >= 40).length,
      tropicalNights20: tminValues.filter((value) => value >= 20).length,
      veryWarmNights25: tminValues.filter((value) => value >= 25).length,
      frostDays0: tminValues.filter((value) => value <= 0).length,

      rain: Number.isFinite(rainSum) ? rainSum : null,
      rainyDays: rainValues.filter((value) => value >= 1).length,
      rainDays5: rainValues.filter((value) => value >= 5).length,
      rainDays10: rainValues.filter((value) => value >= 10).length,
      rainDays20: rainValues.filter((value) => value >= 20).length,
      rainDays30: rainValues.filter((value) => value >= 30).length,
      rainDays50: rainValues.filter((value) => value >= 50).length,
      rainDays100: rainValues.filter((value) => value >= 100).length,
      dryDays1: rainValues.filter((value) => value < 1).length,
      rainMax24h: rainValues.length ? Math.max(...rainValues) : null,
      drySpellMax: rainValues.length ? longestDrySpellDays(d, 1) : null,
      wetSpellMax: rainValues.length ? longestWetSpellDays(d, 1) : null,

      humidityMean: humidityMeanValues.length
        ? avgFinite(humidityMeanValues)
        : null,
      humidityMinMean: humidityMinValues.length
        ? avgFinite(humidityMinValues)
        : null,
      humidityMaxMean: humidityMaxValues.length
        ? avgFinite(humidityMaxValues)
        : null,
      humidityMin: humidityMinValues.length
        ? Math.min(...humidityMinValues)
        : null,
      humidityMax: humidityMaxValues.length
        ? Math.max(...humidityMaxValues)
        : null,

      windMean: windMeanValues.length ? avgFinite(windMeanValues) : null,
      windMaxMean: windMaxMeanValues.length
        ? Math.max(...windMaxMeanValues)
        : null,
      gustMean: gustMeanValues.length ? avgFinite(gustMeanValues) : null,
      gustMax: gustMaxValues.length ? Math.max(...gustMaxValues) : null,

      pressureMean: pressureMeanValues.length
        ? avgFinite(pressureMeanValues)
        : null,
      pressureMin: pressureMinValues.length
        ? Math.min(...pressureMinValues)
        : null,
      pressureMax: pressureMaxValues.length
        ? Math.max(...pressureMaxValues)
        : null,

      rainHasOverride: overrideMonths.length > 0,
      rainOverrideMonthsText: overrideMonths
        .map((m) => monthFull(m.ym))
        .join(", "),
    };
  });

  const dailyDates = rows
    .map((r) => String(r?.date || "").slice(0, 10))
    .filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso));

  const intradayDates = Array.from(new Set(dailyDates)).sort();

  const dailyRainByDate = {};
  for (const row of rows) {
    const iso = String(row?.date || "").slice(0, 10);
    const rain = dailyRain(row);

    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      dailyRainByDate[iso] = Number.isFinite(rain) ? round1(rain) : null;
    }
  }


  const civilProtectionStatus = await loadCivilProtectionStatus();

  return {
    props: {
      start,
      end,
      yearStats,
      civilProtectionStatus,
      intradayDates,
      dailyRainByDate,
    },
    revalidate: 60,
  };
}

export default function Home({
  yearStats = [],
  civilProtectionStatus = null,
  start = null,
  end = null,
  intradayDates = [],
  dailyRainByDate = {},
}) {
  return (
    <SiteLayout
      headerProps={{
        title: "Meteo Collinas",
        kicker: "ARCHIVIO METEO",
        start,
        end,
        showPeriod: false,
        currentPath: "/",
      }}
    >
      <CivilProtectionSection status={civilProtectionStatus} />

      <ForecastSection />

      <div className="chartWrap">
        <PeriodChart
          intradayDates={intradayDates}
          dailyRainByDate={dailyRainByDate}
        />
      </div>

      <HomeLowerSection
        yearStats={yearStats}
      />

      <style jsx>{`
        .chartWrap {
          margin-top: 18px;
        }
      `}</style>
    </SiteLayout>
  );
}

function civilLevelMeta(level) {
  const key = String(level || "unknown").toLowerCase();

  const map = {
    green: {
      label: "Verde",
      color: "#16a34a",
      soft: "#effcf4",
      border: "#c9efd5",
      icon: "✓",
    },
    yellow: {
      label: "Gialla",
      color: "#d99a00",
      soft: "#fffaf0",
      border: "#f6df9d",
      icon: "!",
    },
    orange: {
      label: "Arancione",
      color: "#ea580c",
      soft: "#fff7ed",
      border: "#fed7aa",
      icon: "!",
    },
    red: {
      label: "Rossa",
      color: "#dc2626",
      soft: "#fef2f2",
      border: "#fecaca",
      icon: "!",
    },
    unknown: {
      label: "Da verificare",
      color: "#64748b",
      soft: "#f8fafc",
      border: "#dbe3ec",
      icon: "?",
    },
  };

  return map[key] || map.unknown;
}

function formatCivilDateTime(value) {
  if (!value) return "—";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCivilTime(value) {
  if (!value) return "";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";

  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function civilAlertHeadline(period) {
  const data = period && typeof period === "object" ? period : {};
  const meta = civilLevelMeta(data.level);

  if (data.label && !/da verificare/i.test(String(data.label))) {
    return String(data.label);
  }

  if (String(data.level || "").toLowerCase() === "unknown") {
    return "Stato da verificare";
  }

  return `Allerta ${meta.label.toLowerCase()}`;
}

function CivilProtectionStatusCard({ title, period, next = false }) {
  const data = period && typeof period === "object" ? period : {};
  const meta = civilLevelMeta(data.level);
  const risks = Array.isArray(data.risks) ? data.risks : [];
  const startTime = next ? formatCivilTime(data.validFrom) : "";
  const isUnknown = String(data.level || "unknown").toLowerCase() === "unknown";

  const badge = next
    ? startTime
      ? `DALLE ${startTime}`
      : "DA VERIFICARE"
    : isUnknown
      ? "DA VERIFICARE"
      : "IN CORSO";

  const defaultNote = next
    ? risks.length
      ? `Prevista criticità per ${risks.join(", ").toLowerCase()}.`
      : "Nessuna nuova criticità indicata per la prossima fase."
    : isUnknown
      ? "Consulta gli avvisi ufficiali per conoscere lo stato in vigore."
      : "Situazione attuale riferita alla zona di allerta di Collinas.";

  return (
    <article
      className={`civilStatusCard ${next ? "next" : "current"}`}
      style={{
        "--civil-level": meta.color,
        "--civil-soft": meta.soft,
        "--civil-border": meta.border,
      }}
    >
      <div className="civilStatusTop">
        <div>
          <h3>{title}</h3>
          <span>{formatCivilDateTime(data.validFrom)}</span>
        </div>

        <b className="civilStatusBadge">{badge}</b>
      </div>

      <div className="civilStatusHero">
        <span className="civilHeroIcon" aria-hidden="true">{meta.icon}</span>
        <div>
          <strong>{civilAlertHeadline(data)}</strong>
          {next && startTime ? <span>Dalle {startTime}</span> : null}
        </div>
      </div>

      <div className="civilStatusDivider" />

      <p className="civilStatusNote">{data.note || defaultNote}</p>

      {next ? (
        <div className="civilNextRisks">
          <span>Rischi previsti</span>
          {risks.length ? (
            <div className="civilRiskChips">
              {risks.map((risk) => (
                <b key={risk}>{risk}</b>
              ))}
            </div>
          ) : (
            <small>Nessun rischio specificato</small>
          )}
        </div>
      ) : null}
    </article>
  );
}

function CivilProtectionInfoCard({ icon, title, children }) {
  return (
    <div className="civilInfoCard">
      <span className="civilInfoIcon" aria-hidden="true">{icon}</span>
      <div>
        <strong>{title}</strong>
        {children}
      </div>
    </div>
  );
}

function CivilProtectionSection({ status = null }) {
  const resolvedStatus = status || {
    zoneCode: "SARD-C",
    zoneName: "Bacini Montevecchio-Pischilappiu",
    sourceUrl: "https://www.sardegnaambiente.it/protezionecivile/",
    updatedAt: null,
    current: {
      levelLabel: "Dati non disponibili",
      statusLabel: "Da verificare",
      summary: "L’aggiornamento automatico non ha ancora prodotto un dato valido.",
      validFrom: null,
      validTo: null,
      risks: [],
    },
    next: {
      levelLabel: "Dati non disponibili",
      statusLabel: "Da verificare",
      summary: "Il prossimo stato verrà mostrato automaticamente quando pubblicato dalla Protezione Civile.",
      validFrom: null,
      validTo: null,
      risks: [],
    },
  };

  const zoneCode = resolvedStatus?.zoneCode || "SARD-C";
  const zoneName = resolvedStatus?.zoneName || "Bacini Montevecchio-Pischilappiu";
  const sourceUrl =
    resolvedStatus?.sourceUrl ||
    "https://www.sardegnaambiente.it/protezionecivile/";
  const current = resolvedStatus?.current || {};
  const next = resolvedStatus?.next || {};

  const pickText = (...values) =>
    values.find((value) => typeof value === "string" && value.trim()) || "";

  const normalizeRisks = (entry) =>
    Array.isArray(entry?.risks)
      ? entry.risks.filter((value) => typeof value === "string" && value.trim())
      : [];

  const formatDateTime = (value) => {
    if (!value) return "Da verificare";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return String(value);
    return parsed.toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const toneFromText = (entry) => {
    const textPool = [
      pickText(entry?.levelLabel, entry?.statusLabel, entry?.title, entry?.summary),
      ...normalizeRisks(entry),
    ]
      .join(" ")
      .toLowerCase();

    if (!textPool || textPool.includes("da verificare")) {
      return {
        chipClass: "tone-neutral",
        cardClass: "tone-neutral-card",
        dot: "○",
      };
    }

    if (
      textPool.includes("ross") ||
      textPool.includes("allarme") ||
      textPool.includes("elevata")
    ) {
      return {
        chipClass: "tone-red",
        cardClass: "tone-red-card",
        dot: "●",
      };
    }

    if (
      textPool.includes("aranc") ||
      textPool.includes("moderata") ||
      textPool.includes("attenzione")
    ) {
      return {
        chipClass: "tone-orange",
        cardClass: "tone-orange-card",
        dot: "●",
      };
    }

    if (
      textPool.includes("giall") ||
      textPool.includes("ordinaria") ||
      textPool.includes("criticità")
    ) {
      return {
        chipClass: "tone-yellow",
        cardClass: "tone-yellow-card",
        dot: "●",
      };
    }

    if (
      textPool.includes("verde") ||
      textPool.includes("nessuna") ||
      textPool.includes("assenza")
    ) {
      return {
        chipClass: "tone-green",
        cardClass: "tone-green-card",
        dot: "●",
      };
    }

    return {
      chipClass: "tone-neutral",
      cardClass: "tone-neutral-card",
      dot: "○",
    };
  };

  const currentLabel = pickText(
    current?.levelLabel,
    current?.statusLabel,
    current?.title,
    "Da verificare",
  );
  const nextLabel = pickText(
    next?.levelLabel,
    next?.statusLabel,
    next?.title,
    "Da verificare",
  );

  const currentSummary = pickText(
    current?.summary,
    current?.message,
    "Consulta gli avvisi ufficiali per conoscere lo stato in vigore.",
  );
  const nextSummary = pickText(
    next?.summary,
    next?.message,
    "Nessuna nuova criticità indicata per la prossima fase.",
  );

  const currentRisks = normalizeRisks(current);
  const nextRisks = normalizeRisks(next);

  const currentTone = toneFromText(current);
  const nextTone = toneFromText(next);

  const updatedAt = formatDateTime(resolvedStatus?.updatedAt);
  const validityText = next?.validFrom
    ? `Dal ${formatDateTime(next.validFrom)}`
    : current?.validFrom
      ? `Dal ${formatDateTime(current.validFrom)}`
      : "Da verificare";
  const expiryText = next?.validTo
    ? `Fino al ${formatDateTime(next.validTo)}`
    : current?.validTo
      ? `Fino al ${formatDateTime(current.validTo)}`
      : "Fino a nuova comunicazione";

  const renderRiskPills = (risks, emptyText) =>
    risks.length ? (
      <div className="civilRiskPills">
        {risks.map((risk) => (
          <span className="civilRiskPill" key={risk}>
            {risk}
          </span>
        ))}
      </div>
    ) : (
      <p className="civilMuted">{emptyText}</p>
    );

  return (
    <article className="lowerPanel civilSection">
      <div className="civilHeader">
        <div className="civilHeading">
          <span className="civilHeadingIcon" aria-hidden="true">◇</span>
          <div className="civilHeadingCopy">
            <h2>Protezione Civile e avvisi</h2>
            <p>
              Stato attuale e successivo per Collinas · zona di allerta{" "}
              <strong>{zoneCode}</strong> · {zoneName}.
            </p>
          </div>
        </div>
      </div>

      <div className="civilGrid">
        <section className={`civilStatusCard ${currentTone.cardClass}`}>
          <div className="civilStatusTop">
            <span className={`civilToneChip ${currentTone.chipClass}`}>
              {currentTone.dot} Stato attuale
            </span>
            <h3>{currentLabel}</h3>
          </div>
          <p className="civilStatusText">{currentSummary}</p>
          <div className="civilStatusMeta">
            <div>
              <span>In vigore da</span>
              <b>{formatDateTime(current?.validFrom)}</b>
            </div>
            <div>
              <span>Valida fino a</span>
              <b>{formatDateTime(current?.validTo)}</b>
            </div>
          </div>
          <div className="civilRiskBlock">
            <span className="civilBlockLabel">Rischi / fenomeni</span>
            {renderRiskPills(currentRisks, "Nessun rischio specificato")}
          </div>
        </section>

        <section className={`civilStatusCard ${nextTone.cardClass}`}>
          <div className="civilStatusTop">
            <span className={`civilToneChip ${nextTone.chipClass}`}>
              {nextTone.dot} Stato successivo
            </span>
            <h3>{nextLabel}</h3>
          </div>
          <p className="civilStatusText">{nextSummary}</p>
          <div className="civilStatusMeta">
            <div>
              <span>Entrerà in vigore</span>
              <b>{formatDateTime(next?.validFrom)}</b>
            </div>
            <div>
              <span>Valida fino a</span>
              <b>{formatDateTime(next?.validTo)}</b>
            </div>
          </div>
          <div className="civilRiskBlock">
            <span className="civilBlockLabel">Rischi / fenomeni</span>
            {renderRiskPills(nextRisks, "Nessun rischio specificato")}
          </div>
        </section>

        <aside className="civilSideColumn">
          <div className="civilInfoCard">
            <span className="civilInfoIcon" aria-hidden="true">◫</span>
            <div>
              <strong>Validità</strong>
              <p>{validityText}</p>
              <p>{expiryText}</p>
            </div>
          </div>

          <div className="civilInfoCard">
            <span className="civilInfoIcon" aria-hidden="true">△</span>
            <div>
              <strong>Rischi previsti</strong>
              {renderRiskPills(
                nextRisks.length ? nextRisks : currentRisks,
                "Nessun rischio specificato",
              )}
            </div>
          </div>

          <div className="civilInfoCard">
            <span className="civilInfoIcon" aria-hidden="true">◷</span>
            <div>
              <strong>Aggiornato</strong>
              <p>{updatedAt}</p>
              <p>Fonte: Protezione Civile Regione Sardegna</p>
            </div>
          </div>
        </aside>
      </div>

      <div className="civilActionRow">
        <a
          className="civilActionButton"
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          Bollettini e avvisi ↗
        </a>
        <a
          className="civilActionButton"
          href="https://www.regione.sardegna.it/"
          target="_blank"
          rel="noreferrer"
        >
          Portale ufficiale ↗
        </a>
      </div>

      <p className="civilFootnote">
        Dati informativi: fanno sempre fede gli avvisi ufficiali della Protezione
        Civile della Regione Sardegna.
      </p>

      <style jsx>{`
        .civilSection {
          padding: 20px;
        }

        .civilHeader {
          margin-bottom: 16px;
        }

        .civilHeading {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }

        .civilHeadingIcon {
          width: 60px;
          height: 60px;
          border-radius: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 30px;
          color: #1f6fff;
          background: #eef5ff;
          flex: 0 0 auto;
        }

        .civilHeadingCopy h2 {
          margin: 0;
          font-size: 28px;
          line-height: 1.05;
          color: #0f172a;
        }

        .civilHeadingCopy p {
          margin: 7px 0 0;
          color: #52637d;
          font-size: 12px;
          line-height: 1.5;
        }

        .civilGrid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 320px;
          gap: 14px;
          align-items: stretch;
        }

        .civilStatusCard {
          border: 1px solid #dce5ef;
          border-radius: 20px;
          padding: 16px;
          background: #ffffff;
          min-width: 0;
        }

        .tone-green-card {
          background: linear-gradient(180deg, #f4fbf6 0%, #ffffff 100%);
          border-color: #cfe8d8;
        }

        .tone-yellow-card {
          background: linear-gradient(180deg, #fffcf1 0%, #ffffff 100%);
          border-color: #f1e2a9;
        }

        .tone-orange-card {
          background: linear-gradient(180deg, #fff7ef 0%, #ffffff 100%);
          border-color: #f4c99a;
        }

        .tone-red-card {
          background: linear-gradient(180deg, #fff3f3 0%, #ffffff 100%);
          border-color: #f2b9b9;
        }

        .tone-neutral-card {
          background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);
          border-color: #dce5ef;
        }

        .civilStatusTop {
          display: grid;
          gap: 8px;
          margin-bottom: 10px;
        }

        .civilToneChip {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          border-radius: 999px;
          width: fit-content;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .tone-green {
          background: #eaf8ee;
          color: #15803d;
        }

        .tone-yellow {
          background: #fff8da;
          color: #a16207;
        }

        .tone-orange {
          background: #ffeddc;
          color: #c2410c;
        }

        .tone-red {
          background: #ffe4e6;
          color: #be123c;
        }

        .tone-neutral {
          background: #eef2f7;
          color: #52637d;
        }

        .civilStatusTop h3 {
          margin: 0;
          font-size: 23px;
          line-height: 1.1;
          color: #0f172a;
        }

        .civilStatusText {
          margin: 0 0 12px;
          color: #334155;
          font-size: 12px;
          line-height: 1.55;
        }

        .civilStatusMeta {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
          margin-bottom: 12px;
        }

        .civilStatusMeta span,
        .civilBlockLabel,
        .civilInfoCard strong {
          display: block;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #64748b;
          margin-bottom: 4px;
        }

        .civilStatusMeta b {
          display: block;
          font-size: 13px;
          color: #0f172a;
        }

        .civilRiskBlock {
          display: grid;
          gap: 8px;
        }

        .civilRiskPills {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
        }

        .civilRiskPill {
          padding: 7px 10px;
          border-radius: 999px;
          background: #f3f7fb;
          border: 1px solid #d9e4ef;
          color: #334155;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.2;
        }

        .civilMuted {
          margin: 0;
          font-size: 11px;
          color: #64748b;
        }

        .civilSideColumn {
          display: grid;
          gap: 12px;
        }

        .civilInfoCard {
          display: grid;
          grid-template-columns: 36px minmax(0, 1fr);
          gap: 10px;
          align-items: flex-start;
          padding: 13px;
          border-radius: 18px;
          background: #f8fbff;
          border: 1px solid #dce5ef;
        }

        .civilInfoIcon {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          background: #eef5ff;
          color: #1f6fff;
        }

        .civilInfoCard p {
          margin: 0;
          font-size: 11.5px;
          color: #334155;
          line-height: 1.45;
        }

        .civilActionRow {
          display: flex;
          flex-wrap: wrap;
          justify-content: flex-end;
          gap: 10px;
          margin-top: 14px;
        }

        .civilActionButton {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 44px;
          padding: 0 16px;
          border-radius: 14px;
          border: 1px solid #b9d0f0;
          background: #ffffff;
          color: #1f6fff;
          font-size: 11px;
          font-weight: 800;
          text-decoration: none;
          white-space: nowrap;
          transition:
            background-color 0.16s ease,
            border-color 0.16s ease,
            color 0.16s ease;
        }

        .civilActionButton:hover {
          background: #f5f9ff;
          border-color: #8fb4ec;
        }

        .civilFootnote {
          margin: 16px 0 0;
          padding-top: 14px;
          border-top: 1px solid #e6edf5;
          font-size: 11px;
          color: #64748b;
          line-height: 1.45;
        }


        .archiveSection {
          display: none;
        }

        .annualHeaderCentered {
          display: grid;
          justify-items: center;
          text-align: center;
          gap: 8px;
          margin-bottom: 14px;
        }

        .annualHeaderCentered h2 {
          margin: 0;
          font-size: 34px;
          line-height: 1.02;
          color: #0f172a;
        }

        .annualHeaderCentered p {
          margin: 0;
          max-width: 620px;
          color: #64748b;
          font-size: 12px;
          line-height: 1.5;
        }

        .annualToolbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(280px, 340px);
          gap: 14px;
          align-items: start;
        }

        .parameterMobileControl {
          display: grid;
          gap: 6px;
          width: 100%;
        }

        .parameterMobileControl > span,
        .indicatorControl > span {
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #64748b;
        }

        .annualChartCardMerged {
          overflow: hidden;
        }

        .annualYearRail {
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 12px;
          padding: 14px 14px 14px;
          border-top: 1px solid #e6edf5;
          background: linear-gradient(180deg, rgba(248,250,252,.45) 0%, rgba(255,255,255,1) 100%);
        }

        .annualYearMiniCard {
          appearance: none;
          -webkit-appearance: none;
          width: 100%;
          min-width: 0;
          display: grid;
          gap: 8px;
          padding: 12px;
          border-radius: 18px;
          border: 1px solid #dce5ef;
          background: #ffffff;
          text-align: left;
          cursor: pointer;
          transition:
            transform 0.16s ease,
            box-shadow 0.16s ease,
            border-color 0.16s ease,
            background-color 0.16s ease;
        }

        .annualYearMiniCard:hover {
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06);
          border-color: #bfd1e8;
          background: #fbfdff;
        }

        .annualYearMiniTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }

        .annualYearMiniTop strong {
          font-size: 24px;
          line-height: 1;
          color: #0f172a;
          font-weight: 800;
        }

        .annualYearMiniArrow {
          color: #1f6fff;
          font-size: 22px;
          line-height: 1;
          font-weight: 700;
        }

        .annualYearMiniBadge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 26px;
          width: fit-content;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid #dce5ef;
          background: #f8fbff;
          color: #64748b;
          font-size: 10px;
          font-weight: 800;
          white-space: nowrap;
        }

        .annualYearMiniStats {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .annualYearMiniStat {
          display: grid;
          gap: 3px;
          min-width: 0;
        }

        .annualYearMiniStat small {
          font-size: 9px;
          line-height: 1.15;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #64748b;
          font-weight: 800;
        }

        .annualYearMiniStat b {
          font-size: 12px;
          line-height: 1.15;
          color: #0f172a;
          font-weight: 800;
          white-space: nowrap;
        }

        @media (max-width: 1180px) {
          .civilGrid {
            grid-template-columns: 1fr;
          }

          .civilSideColumn {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .civilSection {
            padding: 16px;
          }

          .civilHeadingIcon {
            width: 48px;
            height: 48px;
            border-radius: 15px;
            font-size: 24px;
          }

          .civilHeadingCopy h2 {
            font-size: 22px;
          }

          .civilHeadingCopy p {
            font-size: 11px;
          }

          .civilStatusTop h3 {
            font-size: 18px;
          }

          .civilStatusMeta {
            grid-template-columns: 1fr;
          }

          .civilActionRow {
            justify-content: stretch;
          }

          .civilActionButton {
            flex: 1 1 210px;
          }

          .civilSideColumn {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 430px) {
          .civilHeading {
            gap: 10px;
          }

          .civilHeadingCopy h2 {
            font-size: 18px;
          }

          .civilHeadingCopy p {
            font-size: 10px;
            line-height: 1.4;
          }

          .civilStatusCard {
            padding: 13px;
          }

          .civilToneChip {
            font-size: 9px;
          }

          .civilStatusTop h3 {
            font-size: 16px;
          }

          .civilStatusText,
          .civilInfoCard p,
          .civilFootnote {
            font-size: 10px;
          }

          .civilRiskPill {
            font-size: 10px;
            padding: 6px 8px;
          }

          .civilActionButton {
            width: 100%;
            min-height: 42px;
          }
        }
      `}</style>
    </article>
  );
}

function HomeLowerSection({
  yearStats = [],
}) {
  const router = useRouter();
  const [annualViewportWidth, setAnnualViewportWidth] = useState(1280);

  useEffect(() => {
    const updateWidth = () => setAnnualViewportWidth(window.innerWidth);

    updateWidth();
    window.addEventListener("resize", updateWidth, { passive: true });

    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  const annualIsMobile = annualViewportWidth <= 720;
  const annualIsVeryNarrow = annualViewportWidth <= 430;
  const annualChartHeight = annualIsMobile
    ? annualIsVeryNarrow
      ? 318
      : 326
    : 370;

  const years = Array.isArray(yearStats) ? yearStats.slice(0, 6) : [];

  // Solo dati realmente registrati dalla stazione.
  // Gli anni incompleti restano nelle card ma non entrano nei confronti annuali.
  const comparisonYears = Array.isArray(yearStats)
    ? yearStats
        .filter((row) => row?.complete)
        .sort((a, b) => Number(a?.year) - Number(b?.year))
    : [];

  const parameterConfigs = [
    {
      key: "temperature",
      label: "Temperature",
      icon: "temperature",
      accent: "#f97316",
      indicators: [
        {
          key: "tmaxMean",
          field: "tmaxMean",
          label: "Media delle massime (°C)",
          title: "Temperatura massima media annua",
          description: "Media delle temperature massime giornaliere di ciascun anno.",
          unit: "°C",
          decimals: 1,
          percentDelta: false,
        },
        {
          key: "tmean",
          field: "tmean",
          label: "Temperatura media (°C)",
          title: "Temperatura media annua",
          description: "Media delle temperature medie giornaliere di ciascun anno.",
          unit: "°C",
          decimals: 1,
          percentDelta: false,
        },
        {
          key: "tminMean",
          field: "tminMean",
          label: "Media delle minime (°C)",
          title: "Temperatura minima media annua",
          description: "Media delle temperature minime giornaliere di ciascun anno.",
          unit: "°C",
          decimals: 1,
          percentDelta: false,
        },
        {
          key: "tmax",
          field: "tmax",
          label: "Massima assoluta (°C)",
          title: "Temperatura massima assoluta per anno",
          description: "Temperatura più elevata registrata dalla stazione in ciascun anno.",
          unit: "°C",
          decimals: 1,
          percentDelta: false,
        },
        {
          key: "tmin",
          field: "tmin",
          label: "Minima assoluta (°C)",
          title: "Temperatura minima assoluta per anno",
          description: "Temperatura più bassa registrata dalla stazione in ciascun anno.",
          unit: "°C",
          decimals: 1,
          percentDelta: false,
        },
        {
          key: "summerDays25",
          field: "summerDays25",
          label: "Giorni con Tmax ≥ 25 °C",
          title: "Giorni annui con Tmax ≥ 25 °C",
          description: "Numero di giorni con temperatura massima almeno pari a 25 °C.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "hotDays30",
          field: "hotDays30",
          label: "Giorni con Tmax ≥ 30 °C",
          title: "Giorni annui con Tmax ≥ 30 °C",
          description: "Numero di giorni con temperatura massima almeno pari a 30 °C.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "hotDays35",
          field: "hotDays35",
          label: "Giorni con Tmax ≥ 35 °C",
          title: "Giorni annui con Tmax ≥ 35 °C",
          description: "Numero di giorni con temperatura massima almeno pari a 35 °C.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "hotDays40",
          field: "hotDays40",
          label: "Giorni con Tmax ≥ 40 °C",
          title: "Giorni annui con Tmax ≥ 40 °C",
          description: "Numero di giorni con temperatura massima almeno pari a 40 °C.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "tropicalNights20",
          field: "tropicalNights20",
          label: "Notti tropicali · Tmin ≥ 20 °C",
          title: "Notti tropicali per anno",
          description: "Numero di giorni con temperatura minima almeno pari a 20 °C.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "veryWarmNights25",
          field: "veryWarmNights25",
          label: "Notti molto calde · Tmin ≥ 25 °C",
          title: "Notti molto calde per anno",
          description: "Numero di giorni con temperatura minima almeno pari a 25 °C.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "frostDays0",
          field: "frostDays0",
          label: "Giorni di gelo · Tmin ≤ 0 °C",
          title: "Giorni di gelo per anno",
          description: "Numero di giorni con temperatura minima pari o inferiore a 0 °C.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
      ],
    },
    {
      key: "rain",
      label: "Precipitazioni",
      icon: "rain",
      accent: "#1677ff",
      indicators: [
        {
          key: "rain",
          field: "rain",
          label: "Precipitazione totale (mm)",
          title: "Precipitazioni totali annue",
          description: "Totale di precipitazione accumulato in ciascun anno.",
          unit: "mm",
          decimals: 1,
          percentDelta: true,
        },
        {
          key: "rainyDays",
          field: "rainyDays",
          label: "Giorni piovosi ≥ 1 mm",
          title: "Giorni piovosi annui",
          description: "Numero di giorni dell’anno con almeno 1 mm di precipitazione.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "rainDays5",
          field: "rainDays5",
          label: "Giorni ≥ 5 mm",
          title: "Giorni annui con precipitazione ≥ 5 mm",
          description: "Numero di giorni dell’anno con almeno 5 mm di precipitazione.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "rainDays10",
          field: "rainDays10",
          label: "Giorni ≥ 10 mm",
          title: "Giorni annui con precipitazione ≥ 10 mm",
          description: "Numero di giorni dell’anno con almeno 10 mm di precipitazione.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "rainDays20",
          field: "rainDays20",
          label: "Giorni ≥ 20 mm",
          title: "Giorni annui con precipitazione ≥ 20 mm",
          description: "Numero di giorni dell’anno con almeno 20 mm di precipitazione.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "rainDays30",
          field: "rainDays30",
          label: "Giorni ≥ 30 mm",
          title: "Giorni annui con precipitazione ≥ 30 mm",
          description: "Numero di giorni dell’anno con almeno 30 mm di precipitazione.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "rainDays50",
          field: "rainDays50",
          label: "Giorni ≥ 50 mm",
          title: "Giorni annui con precipitazione ≥ 50 mm",
          description: "Numero di giorni dell’anno con almeno 50 mm di precipitazione.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "rainDays100",
          field: "rainDays100",
          label: "Giorni ≥ 100 mm",
          title: "Giorni annui con precipitazione ≥ 100 mm",
          description: "Numero di giorni dell’anno con almeno 100 mm di precipitazione.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "rainMax24h",
          field: "rainMax24h",
          label: "Massimo giornaliero (mm)",
          title: "Massima precipitazione giornaliera per anno",
          description: "Massimo accumulo registrato dalla stazione in un singolo giorno.",
          unit: "mm",
          decimals: 1,
          percentDelta: true,
        },
        {
          key: "dryDays1",
          field: "dryDays1",
          label: "Giorni secchi · < 1 mm",
          title: "Numero di giorni secchi per anno",
          description: "Numero di giorni con precipitazione inferiore a 1 mm.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "drySpellMax",
          field: "drySpellMax",
          label: "Periodo secco più lungo",
          title: "Massima durata del periodo secco",
          description: "Numero massimo di giorni consecutivi con precipitazione inferiore a 1 mm.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
        {
          key: "wetSpellMax",
          field: "wetSpellMax",
          label: "Periodo piovoso più lungo",
          title: "Massima durata del periodo piovoso",
          description: "Numero massimo di giorni consecutivi con precipitazione almeno pari a 1 mm.",
          unit: "giorni",
          decimals: 0,
          percentDelta: true,
        },
      ],
    },
    {
      key: "humidity",
      label: "Umidità",
      icon: "humidity",
      accent: "#0891b2",
      indicators: [
        {
          key: "humidityMean",
          field: "humidityMean",
          label: "Umidità media annua (%)",
          title: "Umidità relativa media annua",
          description: "Media annuale dell’umidità relativa.",
          unit: "%",
          decimals: 1,
          percentDelta: true,
        },
        {
          key: "humidityMinMean",
          field: "humidityMinMean",
          label: "Umidità minima media (%)",
          title: "Umidità minima media annua",
          description: "Media annuale dei valori minimi giornalieri di umidità relativa.",
          unit: "%",
          decimals: 1,
          percentDelta: true,
        },
        {
          key: "humidityMaxMean",
          field: "humidityMaxMean",
          label: "Umidità massima media (%)",
          title: "Umidità massima media annua",
          description: "Media annuale dei valori massimi giornalieri di umidità relativa.",
          unit: "%",
          decimals: 1,
          percentDelta: true,
        },
      ],
    },
    {
      key: "wind",
      label: "Vento",
      icon: "wind",
      accent: "#7c3aed",
      indicators: [
        {
          key: "windMean",
          field: "windMean",
          label: "Velocità media annua (km/h)",
          title: "Velocità media annua del vento",
          description: "Media annuale della velocità del vento. Le raffiche non sono incluse.",
          unit: "km/h",
          decimals: 1,
          percentDelta: true,
        },
        {
          key: "windMaxMean",
          field: "windMaxMean",
          label: "Massimo vento medio (km/h)",
          title: "Massimo vento medio per anno",
          description: "Massimo valore disponibile della velocità media del vento, senza raffiche.",
          unit: "km/h",
          decimals: 1,
          percentDelta: true,
        },
        {
          key: "gustMean",
          field: "gustMean",
          label: "Media delle raffiche (km/h)",
          title: "Raffica media annua",
          description: "Media annuale delle raffiche disponibili nella serie della stazione.",
          unit: "km/h",
          decimals: 1,
          percentDelta: true,
        },
        {
          key: "gustMax",
          field: "gustMax",
          label: "Raffica massima (km/h)",
          title: "Raffica massima assoluta per anno",
          description: "Raffica più intensa registrata dalla stazione in ciascun anno.",
          unit: "km/h",
          decimals: 1,
          percentDelta: true,
        },
      ],
    },
    {
      key: "pressure",
      label: "Pressione",
      icon: "pressure",
      accent: "#2563eb",
      indicators: [
        {
          key: "pressureMean",
          field: "pressureMean",
          label: "Pressione media annua (hPa)",
          title: "Pressione media annua al livello del mare",
          description: "Media annuale della pressione ridotta al livello del mare.",
          unit: "hPa",
          decimals: 1,
          percentDelta: false,
        },
        {
          key: "pressureMax",
          field: "pressureMax",
          label: "Pressione massima (hPa)",
          title: "Pressione massima annuale al livello del mare",
          description: "Massimo valore annuale della pressione ridotta al livello del mare.",
          unit: "hPa",
          decimals: 1,
          percentDelta: false,
        },
        {
          key: "pressureMin",
          field: "pressureMin",
          label: "Pressione minima (hPa)",
          title: "Pressione minima annuale al livello del mare",
          description: "Minimo valore annuale della pressione ridotta al livello del mare.",
          unit: "hPa",
          decimals: 1,
          percentDelta: false,
        },
      ],
    },
  ];

  const parameterHasData = (parameter) =>
    parameter.indicators.some((indicator) =>
      comparisonYears.some((row) => Number.isFinite(n(row?.[indicator.field]))),
    );

  const firstAvailableParameter =
    parameterConfigs.find(parameterHasData)?.key || "temperature";

  const [annualParameter, setAnnualParameter] = useState(firstAvailableParameter);
  const selectedParameter =
    parameterConfigs.find((parameter) => parameter.key === annualParameter) ||
    parameterConfigs[0];

  const firstAvailableIndicator =
    selectedParameter.indicators.find((indicator) =>
      comparisonYears.some((row) => Number.isFinite(n(row?.[indicator.field]))),
    ) || selectedParameter.indicators[0];

  const [annualIndicator, setAnnualIndicator] = useState(firstAvailableIndicator.key);

  useEffect(() => {
    const parameter =
      parameterConfigs.find((entry) => entry.key === annualParameter) ||
      parameterConfigs[0];

    const indicatorAvailable = parameter.indicators.some(
      (indicator) =>
        indicator.key === annualIndicator &&
        comparisonYears.some((row) =>
          Number.isFinite(n(row?.[indicator.field])),
        ),
    );

    if (indicatorAvailable) return;

    const nextIndicator =
      parameter.indicators.find((indicator) =>
        comparisonYears.some((row) =>
          Number.isFinite(n(row?.[indicator.field])),
        ),
      ) || parameter.indicators[0];

    setAnnualIndicator(nextIndicator.key);
  }, [annualParameter, annualIndicator, yearStats]);

  const selectedIndicator =
    selectedParameter.indicators.find(
      (indicator) => indicator.key === annualIndicator,
    ) || firstAvailableIndicator;

  const indicatorOptions = selectedParameter.indicators
    .filter((indicator) =>
      comparisonYears.some((row) => Number.isFinite(n(row?.[indicator.field]))),
    )
    .map((indicator) => ({
      key: indicator.key,
      label: indicator.label,
    }));

  const parameterSelectOptions = parameterConfigs
    .filter((parameter) => parameterHasData(parameter))
    .map((parameter) => ({
      key: parameter.key,
      label: parameter.label,
    }));

  const formatAnnualValue = (value, indicator = selectedIndicator) => {
    const numeric = n(value);
    if (!Number.isFinite(numeric)) return "—";

    const formatted = numeric.toFixed(indicator.decimals ?? 1);
    return indicator.unit ? `${formatted} ${indicator.unit}` : formatted;
  };

  const annualSeriesRows = comparisonYears.map((row) => ({
    ...row,
    value: n(row?.[selectedIndicator.field]),
  }));

  const validRows = annualSeriesRows.filter((row) =>
    Number.isFinite(row.value),
  );

  const periodMean = validRows.length
    ? avgFinite(validRows.map((row) => row.value))
    : NaN;

  const periodStart = validRows[0]?.year || "—";
  const periodEnd = validRows[validRows.length - 1]?.year || "—";
  const periodLabel =
    periodStart === periodEnd
      ? String(periodStart)
      : `${periodStart}–${periodEnd}`;

  const lineAnnualParameter = [
    "temperature",
    "humidity",
    "wind",
    "pressure",
  ].includes(selectedParameter.key);

  const annualChartOption = validRows.length
    ? {
        animation: true,
        animationDuration: 250,
        animationDurationUpdate: 250,
        title: {
          text: `${selectedIndicator.title} (${periodLabel})`,
          subtext: selectedIndicator.description,
          left: "center",
          top: annualIsMobile ? 5 : 10,
          itemGap: annualIsMobile ? 3 : 4,
          textStyle: {
            fontSize: annualIsMobile ? 13 : 17,
            fontWeight: 800,
            lineHeight: annualIsMobile ? 15 : 21,
            color: "#0f172a",
          },
          subtextStyle: {
            fontSize: annualIsMobile ? 7.5 : 10,
            fontWeight: 650,
            color: "#64748b",
          },
        },
        toolbox: makeChartToolbox({
          filename: `meteo-collinas-dati-annuali-${annualParameter}-${annualIndicator}`,
          isMobile: annualIsMobile,
        }),
        dataZoom: makePeriodDataZoom(),
        grid: annualIsMobile
          ? {
              left: annualIsVeryNarrow ? 46 : 50,
              right: 12,
              top: 82,
              bottom: 86,
              containLabel: false,
              show: true,
              borderWidth: 0,
              backgroundColor: "rgba(248, 250, 252, 0.52)",
            }
          : {
              left: 68,
              right: 30,
              top: 82,
              bottom: 70,
              containLabel: false,
              show: true,
              borderWidth: 0,
              backgroundColor: "rgba(248, 250, 252, 0.52)",
            },
        tooltip: {
          trigger: "axis",
          triggerOn: "mousemove|click",
          confine: true,
          backgroundColor: "rgba(255,255,255,.98)",
          borderColor: "#dbe3ec",
          borderWidth: 1,
          padding: [9, 11],
          axisPointer: {
            type: "line",
            snap: true,
            lineStyle: {
              color: "rgba(59, 130, 246, 0.35)",
              width: 1,
            },
          },
          textStyle: {
            color: "#0f172a",
            fontSize: annualIsMobile ? 9 : 11,
            fontWeight: 650,
          },
          extraCssText:
            "border-radius:10px;box-shadow:0 10px 28px rgba(15,23,42,.12);",
          formatter: (params) => {
            const allParams = Array.isArray(params) ? params : [];
            const year = String(allParams[0]?.axisValue || "");
            const row = annualSeriesRows.find(
              (candidate) => String(candidate.year) === year,
            );
            const value = n(row?.value);

            if (!row || !Number.isFinite(value)) return year;

            return `<strong>${year}</strong><br/>${selectedIndicator.label}: <b>${formatAnnualValue(
              value,
            )}</b><br/><span style="color:#64748b;font-weight:700;">Dato registrato dalla stazione</span>`;
          },
        },
        legend: {
          show: Number.isFinite(periodMean),
          left: "center",
          bottom: annualIsMobile ? 8 : 13,
          itemWidth: annualIsMobile ? 16 : 18,
          itemHeight: annualIsMobile ? 9 : 9,
          itemGap: annualIsMobile ? 12 : 18,
          textStyle: {
            color: "#52637d",
            fontSize: annualIsMobile ? 9 : 10.5,
            fontWeight: 750,
          },
          data: [
            selectedIndicator.label,
            `Media ${periodLabel}`,
          ],
        },
        xAxis: {
          type: "category",
          boundaryGap: !lineAnnualParameter,
          data: annualSeriesRows.map((row) => String(row.year)),
          axisTick: { show: false },
          axisLine: {
            lineStyle: {
              color: "#cbd5e1",
              width: 1,
            },
          },
          axisLabel: {
            color: "#64748b",
            fontSize: annualIsMobile ? 9 : 10,
            interval: 0,
            formatter: (value, index) => {
              if (annualIsMobile && comparisonYears.length > 8) {
                const year = Number(value);
                const isLast = index === comparisonYears.length - 1;
                return isLast || year % 2 === 0 ? value : "";
              }

              if (!annualIsMobile && comparisonYears.length > 18) {
                const year = Number(value);
                const isLast = index === comparisonYears.length - 1;
                return isLast || year % 2 === 0 ? value : "";
              }

              return value;
            },
          },
          splitLine: {
            show: true,
            lineStyle: {
              color: "rgba(148,163,184,.10)",
              type: "solid",
            },
          },
        },
        yAxis: {
          type: "value",
          name: selectedIndicator.unit || "",
          nameLocation: "middle",
          nameGap: annualIsMobile ? 34 : 44,
          nameTextStyle: {
            color: "#64748b",
            fontSize: annualIsMobile ? 9 : 10,
          },
          scale:
            selectedParameter.key === "temperature" ||
            selectedParameter.key === "pressure",
          min:
            ["giorni", "mm", "km/h", "%"].includes(selectedIndicator.unit)
              ? 0
              : undefined,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: {
            lineStyle: {
              color: "rgba(148,163,184,.18)",
              type: "dashed",
            },
          },
          axisLabel: {
            color: "#64748b",
            fontSize: annualIsMobile ? 9 : 10,
          },
        },
        series: [
          lineAnnualParameter
            ? {
                name: selectedIndicator.label,
                type: "line",
                data: annualSeriesRows.map((row) =>
                  Number.isFinite(row.value) ? row.value : null,
                ),
                showSymbol: true,
                symbol: "circle",
                symbolSize: annualIsMobile ? 6 : 7,
                connectNulls: false,
                smooth: false,
                lineStyle: {
                  width: 2.5,
                  color: selectedParameter.accent,
                },
                itemStyle: {
                  color: "#ffffff",
                  borderColor: selectedParameter.accent,
                  borderWidth: 2.2,
                },
                emphasis: {
                  focus: "series",
                  scale: 1.2,
                },
                z: 4,
              }
            : {
                name: selectedIndicator.label,
                type: "bar",
                data: annualSeriesRows.map((row) =>
                  Number.isFinite(row.value) ? row.value : null,
                ),
                barMaxWidth: annualIsMobile ? 28 : 42,
                itemStyle: {
                  color: selectedParameter.accent,
                  opacity: 0.78,
                  borderRadius: [5, 5, 0, 0],
                },
                emphasis: {
                  focus: "series",
                  itemStyle: {
                    opacity: 1,
                  },
                },
                z: 4,
              },
          ...(Number.isFinite(periodMean)
            ? [
                {
                  name: `Media ${periodLabel}`,
                  type: "line",
                  data: annualSeriesRows.map((row) =>
                    Number.isFinite(row.value) ? periodMean : null,
                  ),
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  silent: true,
                  lineStyle: {
                    width: 1.6,
                    color: "#64748b",
                    type: "dashed",
                    opacity: 0.95,
                  },
                  itemStyle: { color: "#64748b" },
                  z: 3,
                },
              ]
            : []),
        ],
      }
    : null;

  const chooseParameter = (key) => {
    const next =
      parameterConfigs.find((parameter) => parameter.key === key) ||
      parameterConfigs[0];

    if (!parameterHasData(next)) return;

    setAnnualParameter(next.key);

    const nextIndicator =
      next.indicators.find((indicator) =>
        comparisonYears.some((row) =>
          Number.isFinite(n(row?.[indicator.field])),
        ),
      ) || next.indicators[0];

    setAnnualIndicator(nextIndicator.key);
  };



  return (
    <section
      className="homeLower"
      aria-label="Dati annuali e stazione meteorologica"
    >
      <article className="lowerPanel annualSection">
        <div className="annualHeader annualHeaderCentered">
          <h2>Dati Annuali</h2>
          <p>
            Consulta e confronta i dati meteorologici degli anni passati.
          </p>
        </div>

        <div className="annualToolbar">
          {annualIsMobile ? (
            <div className="parameterMobileControl">
              <span>Parametro</span>
              <CustomSelect
                value={annualParameter}
                options={parameterSelectOptions}
                onChange={setAnnualParameter}
                ariaLabel="Seleziona parametro annuale"
              />
            </div>
          ) : (
            <div
              className="parameterTabs"
              role="tablist"
              aria-label="Parametro dei dati annuali"
            >
              {parameterConfigs.map((parameter) => {
                const available = parameterHasData(parameter);
                const active = parameter.key === annualParameter;

                return (
                  <button
                    key={parameter.key}
                    type="button"
                    className={`parameterTab ${active ? "active" : ""}`}
                    onClick={() => available && setAnnualParameter(parameter.key)}
                    disabled={!available}
                    aria-pressed={active}
                    title={
                      available
                        ? parameter.label
                        : `${parameter.label}: dati annuali non ancora disponibili`
                    }
                  >
                    <span className="parameterTabIcon">
                      <SummaryParameterIcon type={parameter.icon} />
                    </span>
                    <span>{parameter.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="indicatorControl">
            <span>Indicatore</span>
            <CustomSelect
              value={annualIndicator}
              options={indicatorOptions}
              onChange={setAnnualIndicator}
              ariaLabel="Seleziona indicatore annuale"
            />
          </div>
        </div>

        <div className="annualChartCard annualChartCardMerged">
          <div className="annualChartWrap">
            {annualChartOption ? (
              <ResponsivePeriodEChart
                option={annualChartOption}
                height={annualChartHeight}
                chartKey={`annual-${annualParameter}-${annualIndicator}-${annualIsMobile ? "mobile" : "desktop"}`}
              />
            ) : (
              <div className="annualChartMessage">
                Dati annuali non ancora disponibili per questo indicatore.
              </div>
            )}
          </div>

          <div className="yearCards annualYearCardsEmbedded" aria-label="Anni disponibili">
            {years.map((item) => (
              <div className="yearCard" key={item.year}>
                <div className="yearCardTop">
                  <div className="yearTitleRow">
                    <strong>{item.year}</strong>
                    <button
                      type="button"
                      className="yearPageLink"
                      onClick={() => router.push(`/anni/${item.year}`)}
                      aria-label={`Apri i dati annuali del ${item.year}`}
                      title={`Vai alla pagina annuale ${item.year}`}
                    >
                      →
                    </button>
                  </div>

                  <span>
                    {Number.isFinite(n(item.ndays))
                      ? `${item.ndays} giorni`
                      : "—"}
                  </span>
                </div>

                <div className="yearMetric temperatureMetric">
                  <i aria-hidden="true">↕</i>
                  <span>
                    <b>{fmt(item.tmean, 1)} °C</b>
                    <small>Temp. media</small>
                  </span>
                </div>

                <div className="yearMetric rainMetric">
                  <i aria-hidden="true">◆</i>
                  <span>
                    <b>{fmt(item.rain, 1)} mm</b>
                    <small>Prec. totale</small>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </article>

      <article className="lowerPanel stationSection">
        <div className="stationIntro">
          <span className="stationBigIcon" aria-hidden="true">⌖</span>
          <div>
            <h2>La stazione meteo</h2>
            <h3>Collinas (SU) · stazione meteorologica automatica</h3>
            <p>
              La stazione meteorologica di Collinas raccoglie dati meteo in modo
              continuo dal 2021. Le osservazioni vengono utilizzate per il monitoraggio
              locale, l&apos;archivio meteorologico e l&apos;analisi climatica del territorio.
            </p>
            <div className="stationBadges">
              <span><i className="onlineDot" /> Attiva dal 2021</span>
              <span>⌖ Collinas (SU)</span>
              <span>290 m s.l.m.</span>
              <span>WeatherLink Live</span>
            </div>
          </div>
        </div>

        <div className="stationSensors">
          <h3>Sensori della stazione</h3>
          <div className="stationSensorGrid">
            <div><i>↕</i><span>Temperatura aria</span></div>
            <div><i>P</i><span>Pressione atmosferica</span></div>
            <div><i>◆</i><span>Umidità relativa</span></div>
            <div><i>☼</i><span>Radiazione solare</span></div>
            <div><i>☂</i><span>Precipitazioni</span></div>
            <div><i>➤</i><span>Velocità e direzione vento</span></div>
            <div><i>UV</i><span>Indice UV</span></div>
          </div>
        </div>
      </article>

      <style jsx>{`
        .homeLower {
          margin: 26px auto 0;
          display: grid;
          gap: 16px;
        }

        .lowerPanel {
          min-width: 0;
          border: 1px solid #e1e8f0;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 8px 28px rgba(15, 23, 42, 0.045);
        }

        .archiveSection,
        .annualSection {
          padding: 18px;
        }

        .lowerPanelHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .annualHeaderCentered {
          display: grid;
          justify-items: center;
          gap: 4px;
          text-align: center;
        }

        .annualHeaderCentered h2,
        .annualHeaderCentered p {
          margin: 0;
        }

        .annualHeaderCentered h2 {
          color: #0b1f45;
          font-size: 25px;
          line-height: 1.05;
          font-weight: 950;
          letter-spacing: -0.03em;
        }

        .annualHeaderCentered p {
          max-width: 760px;
          color: #64748b;
          font-size: 9.5px;
          line-height: 1.35;
          font-weight: 650;
        }

        .lowerTitle {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 13px;
        }

        .lowerIcon {
          flex: 0 0 auto;
          width: 50px;
          height: 50px;
          display: grid;
          place-items: center;
          border-radius: 16px;
          background: #eaf3ff;
          color: #126be8;
          font-size: 23px;
          font-weight: 950;
        }

        .trendIcon {
          font-size: 27px;
        }

        .lowerTitle h2,
        .lowerTitle p,
        .annualChartHead h3,
        .annualChartHead p,
        .stationIntro h2,
        .stationIntro h3,
        .stationIntro p,
        .stationSensors h3 {
          margin: 0;
        }

        .lowerTitle h2,
        .stationIntro h2 {
          font-size: 24px;
          line-height: 1.05;
          font-weight: 950;
          letter-spacing: -0.03em;
          color: #0f172a;
        }

        .lowerTitle p {
          margin-top: 3px;
          font-size: 10.5px;
          color: #64748b;
        }

        .yearCards {
          margin-top: 15px;
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 10px;
        }

        .annualYearCardsEmbedded {
          margin-top: 0;
          padding: 14px;
          border-top: 1px solid #e6edf5;
          background: linear-gradient(
            180deg,
            rgba(248, 250, 252, 0.45) 0%,
            #ffffff 100%
          );
        }

        .yearCard {
          position: relative;
          min-width: 0;
          min-height: 116px;
          padding: 12px 13px;
          border: 1px solid #dce6f1;
          border-radius: 15px;
          background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
          color: #0f172a;
          transition:
            transform 120ms ease,
            border-color 120ms ease,
            box-shadow 120ms ease;
        }

        .yearCard:first-child {
          border-color: #82b6ff;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.05);
        }

        .yearCard:hover {
          transform: translateY(-2px);
          border-color: #b5cce9;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.055);
        }

        .yearCardTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 10px;
        }

        .yearTitleRow {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .yearTitleRow strong {
          font-size: 21px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -0.025em;
        }

        .yearPageLink {
          width: 28px;
          height: 28px;
          padding: 0;
          display: inline-grid;
          place-items: center;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: #1677ff;
          font: inherit;
          font-size: 20px;
          font-weight: 950;
          line-height: 1;
          cursor: pointer;
          transition: background 120ms ease, transform 120ms ease;
        }

        .yearPageLink:hover {
          background: #edf5ff;
          transform: translateX(2px);
        }

        .yearPageLink:focus-visible {
          outline: 2px solid rgba(22, 119, 255, 0.28);
          outline-offset: 2px;
        }

        .yearCardTop > span {
          padding: 4px 7px;
          border: 1px solid #e5eaf0;
          border-radius: 999px;
          background: #f8fafc;
          color: #64748b;
          font-size: 8px;
          font-weight: 850;
          white-space: nowrap;
        }

        .yearMetric {
          display: grid;
          grid-template-columns: 20px minmax(0, 1fr);
          align-items: center;
          gap: 7px;
          margin-top: 5px;
        }

        .yearMetric i {
          font-size: 12px;
          font-style: normal;
          font-weight: 950;
          text-align: center;
        }

        .temperatureMetric i {
          color: #2563eb;
        }

        .rainMetric i {
          color: #0b77df;
        }

        .yearMetric > span {
          min-width: 0;
          display: grid;
          gap: 1px;
        }

        .yearMetric b {
          overflow: hidden;
          font-size: 10px;
          font-weight: 950;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .yearMetric small {
          font-size: 8.5px;
          color: #64748b;
        }

        .annualSection {
          overflow: visible;
        }

        .annualToolbar {
          margin-top: 16px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 330px;
          align-items: center;
          gap: 18px;
        }

        .parameterTabs {
          min-width: 0;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px;
        }

        .parameterTab {
          min-height: 40px;
          padding: 0 20px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          border: 1px solid #e1e8f0;
          border-radius: 999px;
          background: #f8fafc;
          color: #334155;
          font-family: inherit;
          font-size: 10.5px;
          font-weight: 850;
          cursor: pointer;
          transition:
            border-color 120ms ease,
            background 120ms ease,
            color 120ms ease,
            transform 120ms ease;
        }

        .parameterTab:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: #bfd2e8;
          background: #f3f8ff;
        }

        .parameterTab.active {
          border-color: #1677ff;
          background: #1677ff;
          color: #ffffff;
          box-shadow: 0 6px 15px rgba(22, 119, 255, 0.18);
        }

        .parameterTab:disabled {
          opacity: 0.42;
          cursor: not-allowed;
        }

        .parameterTabIcon {
          width: 18px;
          height: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .parameterTabIcon :global(svg) {
          width: 17px;
          height: 17px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.8;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .indicatorControl {
          min-width: 0;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 10px;
        }

        .indicatorControl > span {
          font-size: 9.5px;
          font-weight: 900;
          color: #64748b;
        }

        .indicatorControl :global(.customSelect .selectButton) {
          min-height: 40px;
          border-radius: 11px;
          padding: 8px 34px 8px 12px;
          justify-content: flex-start;
          font-size: 10.5px;
          text-align: left;
        }

        .indicatorControl :global(.customSelect .selectedValue) {
          text-align: left;
        }

        .annualChartCard {
          position: relative;
          margin-top: 14px;
          overflow: hidden;
          border: 1px solid #dce5ef;
          border-radius: 18px;
          background: #ffffff;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.045);
        }

        .annualChartWrap {
          position: relative;
          z-index: 1;
          width: 100%;
          min-width: 0;
          min-height: 0;
          padding: 0;
          box-sizing: border-box;
          overflow: hidden;
          background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
        }

        .annualChartMessage {
          min-height: 300px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          color: #64748b;
          font-size: 11px;
          font-weight: 800;
          text-align: center;
        }

        .stationSection {
          padding: 18px;
          display: grid;
          grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
          gap: 22px;
        }

        .stationIntro {
          min-width: 0;
          display: grid;
          grid-template-columns: 86px minmax(0, 1fr);
          align-items: center;
          gap: 14px;
          padding-right: 22px;
          border-right: 1px solid #e8edf3;
        }

        .stationBigIcon {
          width: 78px;
          height: 78px;
          display: grid;
          place-items: center;
          border-radius: 22px;
          background: #eaf3ff;
          color: #126be8;
          font-size: 37px;
          font-weight: 950;
        }

        .stationIntro h3 {
          margin-top: 3px;
          font-size: 11px;
          font-weight: 800;
          color: #64748b;
        }

        .stationIntro p {
          margin-top: 7px;
          max-width: 680px;
          font-size: 10px;
          line-height: 1.45;
          color: #526276;
        }

        .stationBadges {
          margin-top: 9px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .stationBadges span {
          min-height: 27px;
          padding: 0 9px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid #e4eaf1;
          border-radius: 999px;
          background: #f8fafc;
          color: #526276;
          font-size: 8.5px;
          font-weight: 800;
        }

        .onlineDot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #16a34a;
          box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.1);
        }

        .stationSensors {
          min-width: 0;
        }

        .stationSensors h3 {
          margin-bottom: 9px;
          font-size: 11px;
          font-weight: 900;
          color: #334155;
        }

        .stationSensorGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 7px;
        }

        .stationSensorGrid div {
          min-width: 0;
          min-height: 34px;
          padding: 0 10px;
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #e6ebf1;
          border-radius: 10px;
          background: #fbfcfe;
        }

        .stationSensorGrid i {
          min-width: 20px;
          color: #126be8;
          font-size: 10px;
          font-style: normal;
          font-weight: 950;
          text-align: center;
        }

        .stationSensorGrid span {
          min-width: 0;
          overflow: hidden;
          color: #475569;
          font-size: 9.5px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 1180px) {
          .yearCards {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .annualYearCardsEmbedded {
            padding: 12px;
          }

          .annualToolbar {
            grid-template-columns: 1fr;
          }

          .annualYearRail {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 10px;
          }

          .indicatorControl {
            width: min(430px, 100%);
            justify-self: end;
          }

          .stationSection {
            grid-template-columns: 1fr;
          }

          .stationIntro {
            padding-right: 0;
            padding-bottom: 16px;
            border-right: 0;
            border-bottom: 1px solid #e8edf3;
          }
        }

        @media (max-width: 760px) {
          .homeLower {
            margin-top: 18px;
            gap: 12px;
          }

          .archiveSection,
          .annualSection,
          .stationSection {
            padding: 14px;
            border-radius: 18px;
          }

          .lowerTitle {
            align-items: flex-start;
          }

          .lowerTitle h2,
          .stationIntro h2 {
            font-size: 19px;
          }

          .annualHeaderCentered h2 {
            font-size: 24px;
          }

          .annualHeaderCentered p {
            max-width: 360px;
            font-size: 9px;
          }

          .annualHeaderCentered p {
            max-width: 330px;
            font-size: 8.5px;
          }

          .lowerIcon {
            width: 42px;
            height: 42px;
            border-radius: 13px;
            font-size: 20px;
          }

          .annualToolbar {
            margin-top: 14px;
            gap: 12px;
          }

          .parameterTabs {
            width: 100%;
            display: flex;
            flex-wrap: nowrap;
            gap: 7px;
            overflow-x: auto;
            padding-bottom: 3px;
            scrollbar-width: none;
          }

          .parameterTabs::-webkit-scrollbar {
            display: none;
          }

          .parameterTab {
            flex: 0 0 auto;
            min-width: max-content;
            padding: 0 13px;
          }

          .indicatorControl {
            width: 100%;
            grid-template-columns: 1fr;
            justify-self: stretch;
            gap: 4px;
          }

          .annualChartCard {
            width: auto;
            max-width: 100%;
            margin-top: 12px;
            border-radius: 13px;
          }

          .annualChartWrap {
            min-height: 0;
            padding: 0;
            overflow: hidden;
          }
        }

        @media (max-width: 560px) {
          .annualYearCardsEmbedded {
            padding: 10px;
          }

          .annualYearRail {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
            padding: 10px;
          }

          .annualYearMiniCard {
            padding: 10px;
            border-radius: 14px;
            gap: 7px;
          }

          .annualYearMiniTop strong {
            font-size: 18px;
          }

          .annualYearMiniArrow {
            font-size: 18px;
          }

          .annualYearMiniBadge {
            min-height: 22px;
            padding: 0 8px;
            font-size: 9px;
          }

          .annualYearMiniStats {
            grid-template-columns: 1fr;
            gap: 6px;
          }

          .annualYearMiniStat b {
            font-size: 11px;
          }

          .yearCard {
            min-height: 108px;
            padding: 10px;
          }

          .yearTitleRow strong {
            font-size: 18px;
          }

          .yearPageLink {
            width: 24px;
            height: 24px;
            font-size: 18px;
          }

          .yearCardTop > span {
            font-size: 7px;
          }

          .stationIntro {
            grid-template-columns: 1fr;
            justify-items: center;
            text-align: center;
          }

          .stationIntro p {
            text-align: left;
          }

          .stationBadges {
            justify-content: center;
          }

          .stationSensorGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}


const FORECAST_LATITUDE = 39.6413;
const FORECAST_LONGITUDE = 8.8399;
const FORECAST_TIMEZONE = "Europe/Rome";
const FORECAST_REFRESH_MS = 60 * 60 * 1000;
const FORECAST_CACHE_KEY = "meteo-collinas:forecast-cache-v20";

const FORECAST_BANDS = [
  { key: "night", label: "Notte", timeLabel: "00–06", start: 0, end: 6, night: true },
  { key: "morning", label: "Mattino", timeLabel: "06–12", start: 6, end: 12, night: false },
  { key: "afternoon", label: "Pomeriggio", timeLabel: "12–18", start: 12, end: 18, night: false },
  { key: "evening", label: "Sera", timeLabel: "18–24", start: 18, end: 24, night: true },
];

function percentileFinite(values, percentile) {
  const sorted = (Array.isArray(values) ? values : [])
    .map((value) => n(value))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];

  const position = clamp01(percentile) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const fraction = position - lowerIndex;

  if (lowerIndex === upperIndex) return sorted[lowerIndex];

  return (
    sorted[lowerIndex] +
    (sorted[upperIndex] - sorted[lowerIndex]) * fraction
  );
}

function integerForecastRange(values, fallbackValue = null) {
  const low = percentileFinite(values, 0.4);
  const high = percentileFinite(values, 0.6);
  const reliabilityLow = percentileFinite(values, 0.2);
  const reliabilityHigh = percentileFinite(values, 0.8);

  if (Number.isFinite(low) && Number.isFinite(high)) {
    return {
      low: Math.floor(low),
      high: Math.ceil(high),
      reliabilityLow: Number.isFinite(reliabilityLow)
        ? reliabilityLow
        : low,
      reliabilityHigh: Number.isFinite(reliabilityHigh)
        ? reliabilityHigh
        : high,
      ensemble: true,
    };
  }

  const fallback = n(fallbackValue);
  if (!Number.isFinite(fallback)) return null;

  return {
    low: Math.floor(fallback),
    high: Math.ceil(fallback),
    reliabilityLow: fallback,
    reliabilityHigh: fallback,
    ensemble: false,
  };
}

function consensusForecastRange(
  ensembleValues,
  deterministicValues = [],
  fallbackValue = null,
) {
  const ensemble = (Array.isArray(ensembleValues) ? ensembleValues : [])
    .map((value) => n(value))
    .filter(Number.isFinite);
  const deterministic = (Array.isArray(deterministicValues)
    ? deterministicValues
    : []
  )
    .map((value) => n(value))
    .filter(Number.isFinite);

  if (ensemble.length) {
    const combined = [...ensemble, ...deterministic];
    const low = percentileFinite(combined, 0.4);
    const high = percentileFinite(combined, 0.6);
    const reliabilityLow = percentileFinite(combined, 0.2);
    const reliabilityHigh = percentileFinite(combined, 0.8);

    if (Number.isFinite(low) && Number.isFinite(high)) {
      return {
        low: Math.floor(low),
        high: Math.ceil(high),
        reliabilityLow: Number.isFinite(reliabilityLow)
          ? reliabilityLow
          : low,
        reliabilityHigh: Number.isFinite(reliabilityHigh)
          ? reliabilityHigh
          : high,
        ensemble: true,
      };
    }
  }

  if (deterministic.length) {
    const minimum = Math.min(...deterministic);
    const maximum = Math.max(...deterministic);
    return {
      low: Math.floor(minimum),
      high: Math.ceil(maximum),
      reliabilityLow: minimum,
      reliabilityHigh: maximum,
      ensemble: false,
    };
  }

  return integerForecastRange([], fallbackValue);
}

function consensusPeriodTemperatureRange(
  ensembleMinimums,
  ensembleMaximums,
  deterministicMinimums = [],
  deterministicMaximums = [],
) {
  const memberMinimums = (Array.isArray(ensembleMinimums)
    ? ensembleMinimums
    : []
  )
    .map((value) => n(value))
    .filter(Number.isFinite);

  const memberMaximums = (Array.isArray(ensembleMaximums)
    ? ensembleMaximums
    : []
  )
    .map((value) => n(value))
    .filter(Number.isFinite);

  const modelMinimums = (Array.isArray(deterministicMinimums)
    ? deterministicMinimums
    : []
  )
    .map((value) => n(value))
    .filter(Number.isFinite);

  const modelMaximums = (Array.isArray(deterministicMaximums)
    ? deterministicMaximums
    : []
  )
    .map((value) => n(value))
    .filter(Number.isFinite);

  if (memberMinimums.length && memberMaximums.length) {
    const minimumDistribution = [...memberMinimums, ...modelMinimums];
    const maximumDistribution = [...memberMaximums, ...modelMaximums];
    const low = percentileFinite(minimumDistribution, 0.4);
    const high = percentileFinite(maximumDistribution, 0.6);
    const reliabilityLow = percentileFinite(minimumDistribution, 0.2);
    const reliabilityHigh = percentileFinite(maximumDistribution, 0.8);

    if (Number.isFinite(low) && Number.isFinite(high)) {
      return {
        low: Math.floor(Math.min(low, high)),
        high: Math.ceil(Math.max(low, high)),
        reliabilityLow: Number.isFinite(reliabilityLow)
          ? reliabilityLow
          : low,
        reliabilityHigh: Number.isFinite(reliabilityHigh)
          ? reliabilityHigh
          : high,
        ensemble: true,
      };
    }
  }

  if (modelMinimums.length && modelMaximums.length) {
    const minimum = Math.min(...modelMinimums);
    const maximum = Math.max(...modelMaximums);
    return {
      low: Math.floor(minimum),
      high: Math.ceil(maximum),
      reliabilityLow: minimum,
      reliabilityHigh: maximum,
      ensemble: false,
    };
  }

  return null;
}

function formatForecastRange(range) {
  if (!range) return "—";
  if (range.low === range.high) return `${range.low} °C`;
  return `${range.low}–${range.high} °C`;
}

function humidexFromTemperatureAndDewPoint(temperatureC, dewPointC) {
  const temperature = n(temperatureC);
  const dewPoint = n(dewPointC);
  if (!Number.isFinite(temperature) || !Number.isFinite(dewPoint)) return null;

  const vapourPressure =
    6.11 *
    Math.exp(
      5417.753 *
        (1 / 273.16 - 1 / (273.15 + dewPoint)),
    );
  const humidex = temperature + 0.5555 * (vapourPressure - 10);

  return Number.isFinite(humidex) ? humidex : null;
}

function humidexAttention(value) {
  const humidex = n(value);
  if (!Number.isFinite(humidex) || humidex < 35) return null;

  if (humidex >= 46) {
    return {
      tone: "danger",
      label: "⚠",
      title: "Humidex molto elevato: condizioni di caldo potenzialmente pericolose.",
    };
  }

  if (humidex >= 40) {
    return {
      tone: "high",
      label: "⚠",
      title: "Humidex elevato: forte disagio da caldo.",
    };
  }

  return {
    tone: "attention",
    label: "⚠",
    title: "Humidex alto: possibile disagio da caldo.",
  };
}

function temperatureTone(value) {
  const t = n(value);
  if (!Number.isFinite(t)) return "#0f172a";

  if (t >= 41) return "#ec4899";
  if (t >= 38) return "#d946ef";
  if (t >= 35) return "#9f1239";
  if (t >= 32) return "#dc2626";
  if (t >= 28) return "#ef4444";
  if (t >= 24) return "#f97316";
  if (t >= 20) return "#d97706";
  if (t >= 16) return "#ca8a04";
  if (t >= 12) return "#16a34a";
  if (t >= 8) return "#06b6d4";
  if (t >= 4) return "#0ea5e9";
  if (t >= 0) return "#2563eb";
  if (t >= -5) return "#1e3a8a";
  if (t >= -10) return "#7c3aed";
  if (t >= -15) return "#5b21b6";
  return "#3b0764";
}

function temperatureRangeTone(range) {
  if (!range) return "#0f172a";

  const high = n(range?.high);
  const low = n(range?.low);

  if (Number.isFinite(low) && Number.isFinite(high)) {
    return temperatureTone((low + high) / 2);
  }

  if (Number.isFinite(high)) return temperatureTone(high);
  if (Number.isFinite(low)) return temperatureTone(low);
  return "#0f172a";
}

const FORECAST_MIN_TEMP_COLOR = "#4f46e5";

function overviewWeatherForDay(day) {
  const periods = Array.isArray(day?.periods) ? day.periods : [];
  const byKey = Object.fromEntries(
    periods.map((period) => [period.key, period]),
  );

  const wettestPeriod = periods.reduce((best, period) => {
    if (!best) return period;
    return n(period?.rainProbability) > n(best?.rainProbability)
      ? period
      : best;
  }, null);

  const representative =
    (n(day?.rainProbability) >= 35 ? wettestPeriod : null) ||
    byKey.afternoon ||
    byKey.morning ||
    byKey.evening ||
    periods[0] ||
    null;

  return representative
    ? {
        kind: representative.weather?.kind || "sun",
        label: representative.weather?.label || "Sereno",
        night: Boolean(representative.night),
      }
    : {
        kind: "sun",
        label: "Sereno",
        night: false,
      };
}

function formatRainRange(values, fallbackValue = null) {
  const low = percentileFinite(values, 0.2);
  const high = percentileFinite(values, 0.8);

  if (Number.isFinite(low) && Number.isFinite(high)) {
    if (high < 0.2) return "0 mm";
    if (high < 1) return "<1 mm";

    const lowRounded = Math.max(0, Math.floor(low));
    const highRounded = Math.max(lowRounded, Math.ceil(high));
    return lowRounded === highRounded
      ? `${highRounded} mm`
      : `${lowRounded}–${highRounded} mm`;
  }

  const fallback = n(fallbackValue);
  if (!Number.isFinite(fallback) || fallback < 0.2) return "0 mm";
  if (fallback < 1) return "<1 mm";
  return `${Math.round(fallback)} mm`;
}

function ensembleMemberKeys(hourly, variable) {
  if (!hourly || typeof hourly !== "object") return [];

  const escaped = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}(?:_member_?\\d+)?$`);

  return Object.keys(hourly).filter(
    (key) => pattern.test(key) && Array.isArray(hourly[key]),
  );
}

function forecastDateLabel(iso, index) {
  if (index === 0) return "Oggi";
  if (index === 1) return "Domani";
  if (index === 2) return "Dopodomani";

  const date = isoToLocalDate(iso);
  if (!date) return iso;
  return WEEKDAYS_IT[date.getDay()];
}

function forecastCompactDate(iso) {
  const date = isoToLocalDate(iso);
  if (!date) return iso;

  return `${date.getDate()} ${MONTHS_IT_LOWER[date.getMonth()]}`;
}

function windCardinal16(value) {
  const direction = n(value);
  if (!Number.isFinite(direction)) return "—";

  const labels = [
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
  ];

  const normalized = ((direction % 360) + 360) % 360;
  return labels[Math.round(normalized / 22.5) % 16];
}

function windArrowRotation(value) {
  const direction = n(value);
  if (!Number.isFinite(direction)) return 0;

  const normalized = ((direction % 360) + 360) % 360;
  return normalized + 90;
}

function weatherMetaFromHourly({
  codes = [],
  cloudCover = [],
  rainProbability = 0,
  precipitation = 0,
}) {
  const validCodes = codes.map((value) => n(value)).filter(Number.isFinite);
  const validCloud = cloudCover
    .map((value) => n(value))
    .filter(Number.isFinite);

  const countCodes = (accepted) =>
    validCodes.filter((value) => accepted.includes(value)).length;

  const stormCount = countCodes([95, 96, 99]);
  const snowCount = countCodes([71, 73, 75, 77, 85, 86]);
  const rainCount = countCodes([
    51,
    53,
    55,
    56,
    57,
    61,
    63,
    65,
    66,
    67,
    80,
    81,
    82,
  ]);
  const fogCount = countCodes([45, 48]);

  if (stormCount > 0 && (rainProbability >= 25 || precipitation >= 0.1)) {
    return { kind: "storm", label: "Possibili temporali" };
  }

  if (snowCount > 0) {
    return { kind: "snow", label: "Possibili nevicate" };
  }

  const rainCodeThreshold = Math.max(1, Math.ceil(validCodes.length * 0.25));
  if (
    (rainCount >= rainCodeThreshold &&
      (rainProbability >= 25 || precipitation >= 0.1)) ||
    (rainProbability >= 50 && precipitation >= 0.1)
  ) {
    return {
      kind: rainProbability >= 60 ? "rain" : "showers",
      label: rainProbability >= 60 ? "Pioggia probabile" : "Possibili rovesci",
    };
  }

  if (fogCount >= Math.max(1, Math.ceil(validCodes.length / 3))) {
    return { kind: "fog", label: "Nebbia o foschia" };
  }

  const cloudMean = avgFinite(validCloud);
  const cloudHighFraction = validCloud.length
    ? validCloud.filter((value) => value >= 70).length / validCloud.length
    : 0;

  if (Number.isFinite(cloudMean)) {
    if (cloudMean < 20) return { kind: "sun", label: "Sereno" };
    if (cloudMean < 42) return { kind: "partly", label: "Poco nuvoloso" };
    if (cloudMean < 68 || cloudHighFraction < 0.5) {
      return { kind: "partly", label: "Parzialmente nuvoloso" };
    }
    return { kind: "cloud", label: "Nuvoloso" };
  }

  const cloudCodeCount = countCodes([3]);
  const partlyCodeCount = countCodes([1, 2]);

  if (cloudCodeCount > validCodes.length / 2) {
    return { kind: "cloud", label: "Nuvoloso" };
  }

  if (partlyCodeCount > 0) {
    return { kind: "partly", label: "Poco nuvoloso" };
  }

  return { kind: "sun", label: "Sereno" };
}

function WeatherForecastIcon({ kind, night = false }) {
  const moon = (
    <path
      d="M60 8c-13 4-21 17-18 31 3 15 17 25 32 22 4-1 8-2 11-5-6 12-19 20-33 20-20 0-36-16-36-36C16 22 29 7 47 4c5-1 9 0 13 1Z"
      fill="#f8fafc"
      stroke="#64748b"
      strokeWidth="3"
      strokeLinejoin="round"
    />
  );

  const sun = (
    <g>
      <g stroke="#f59e0b" strokeWidth="4" strokeLinecap="round">
        <path d="M48 3v10" />
        <path d="M48 69v10" />
        <path d="M9 41h10" />
        <path d="M77 41h10" />
        <path d="m20 13 7 7" />
        <path d="m69 62 7 7" />
        <path d="m20 69 7-7" />
        <path d="m69 20 7-7" />
      </g>
      <circle
        cx="48"
        cy="41"
        r="21"
        fill="#fbbf24"
        stroke="#f59e0b"
        strokeWidth="3"
      />
    </g>
  );

  const cloud = (
    <path
      d="M27 62h40c10 0 18-7 18-16s-7-16-17-16h-1C64 19 55 12 44 12c-13 0-24 10-25 23C10 36 4 42 4 50c0 7 6 12 13 12h10Z"
      fill="#dbe5ef"
      stroke="#64748b"
      strokeWidth="3"
      strokeLinejoin="round"
    />
  );

  const skyBody = night ? moon : sun;

  if (kind === "sun") {
    return (
      <svg viewBox="0 0 96 82" aria-hidden="true">
        {skyBody}
      </svg>
    );
  }

  if (kind === "cloud") {
    return (
      <svg viewBox="0 0 96 82" aria-hidden="true">
        {night && <g transform="translate(-8 -8) scale(.72)">{moon}</g>}
        {cloud}
      </svg>
    );
  }

  if (kind === "fog") {
    return (
      <svg viewBox="0 0 96 92" aria-hidden="true">
        {night && <g transform="translate(-8 -8) scale(.72)">{moon}</g>}
        {cloud}
        <g stroke="#94a3b8" strokeWidth="4" strokeLinecap="round">
          <path d="M18 70h55" />
          <path d="M27 81h49" />
        </g>
      </svg>
    );
  }

  if (kind === "snow") {
    return (
      <svg viewBox="0 0 96 100" aria-hidden="true">
        {night && <g transform="translate(-8 -8) scale(.72)">{moon}</g>}
        {cloud}
        <g fill="#38bdf8" fontSize="23" fontWeight="900">
          <text x="20" y="94">✣</text>
          <text x="48" y="94">✣</text>
        </g>
      </svg>
    );
  }

  if (kind === "storm") {
    return (
      <svg viewBox="0 0 96 100" aria-hidden="true">
        {night && <g transform="translate(-8 -8) scale(.72)">{moon}</g>}
        {cloud}
        <path
          d="M48 61 35 82h13l-4 13 19-25H51l5-9Z"
          fill="#facc15"
          stroke="#d97706"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M24 69 20 82" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" />
        <path d="M72 69 68 82" stroke="#38bdf8" strokeWidth="4" strokeLinecap="round" />
      </svg>
    );
  }

  if (kind === "rain" || kind === "showers") {
    return (
      <svg viewBox="0 0 96 100" aria-hidden="true">
        {night ? (
          <g transform="translate(-8 -8) scale(.72)">{moon}</g>
        ) : (
          kind === "showers" && (
            <circle
              cx="27"
              cy="25"
              r="16"
              fill="#fbbf24"
              stroke="#f59e0b"
              strokeWidth="3"
            />
          )
        )}
        {cloud}
        <g stroke="#0ea5e9" strokeWidth="4" strokeLinecap="round">
          <path d="M25 69 20 84" />
          <path d="M49 69 44 84" />
          <path d="M73 69 68 84" />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 96 82" aria-hidden="true">
      <g transform="translate(-5 -5) scale(.76)">{skyBody}</g>
      {cloud}
    </svg>
  );
}

function hourlyIndexesForDate(times, iso) {
  const out = [];

  for (let index = 0; index < times.length; index += 1) {
    if (String(times[index]).slice(0, 10) === iso) out.push(index);
  }

  return out;
}

function bandIndexesFromTimes(times, iso, band) {
  return hourlyIndexesForDate(times, iso).filter((index) => {
    const hour = Number(String(times[index]).slice(11, 13));
    return Number.isFinite(hour) && hour >= band.start && hour < band.end;
  });
}

function ensembleRainStats(hourlyEnsemble, precipitationKeys, indexes) {
  if (!precipitationKeys.length || !indexes.length) {
    return { probability: null, totals: [] };
  }

  let maximumProbability = 0;

  for (const index of indexes) {
    let validMembers = 0;
    let wetMembers = 0;

    for (const key of precipitationKeys) {
      const value = n(hourlyEnsemble?.[key]?.[index]);
      if (!Number.isFinite(value)) continue;
      validMembers += 1;
      if (value >= 0.1) wetMembers += 1;
    }

    if (validMembers) {
      maximumProbability = Math.max(
        maximumProbability,
        Math.round((wetMembers / validMembers) * 100),
      );
    }
  }

  const totals = [];

  for (const key of precipitationKeys) {
    const values = indexes
      .map((index) => n(hourlyEnsemble?.[key]?.[index]))
      .filter(Number.isFinite);

    if (values.length) {
      totals.push(values.reduce((sum, value) => sum + value, 0));
    }
  }

  return {
    probability: totals.length ? maximumProbability : null,
    totals,
  };
}

function deterministicHourlySeries(hourly, variable) {
  if (!hourly || typeof hourly !== "object") return [];

  if (Array.isArray(hourly?.[variable])) {
    return hourly[variable];
  }

  const prefixedKey = Object.keys(hourly).find(
    (key) => key.startsWith(`${variable}_`) && Array.isArray(hourly[key]),
  );

  return prefixedKey ? hourly[prefixedKey] : [];
}

function summarizeDeterministicIndexes(hourly, indexes) {
  const temperatureValues = [];
  const codes = [];
  const cloudCover = [];
  const pressureValues = [];
  const radiationValues = [];
  const dewPointValues = [];
  const humidexValues = [];
  const precipitationValues = [];
  const windSpeedValues = [];
  const gustValues = [];

  let directionSin = 0;
  let directionCos = 0;
  let directionWeight = 0;
  let availableHourCount = 0;

  const temperatureSeries = deterministicHourlySeries(hourly, "temperature_2m");
  const dewPointSeries = deterministicHourlySeries(hourly, "dew_point_2m");

  for (const index of Array.isArray(indexes) ? indexes : []) {
    const temperature = n(temperatureSeries[index]);
    const dewPoint = n(dewPointSeries[index]);
    const code = n(hourly?.weather_code?.[index]);
    const cloud = n(hourly?.cloud_cover?.[index]);
    const pressure = n(hourly?.pressure_msl?.[index]);
    const radiation = n(hourly?.shortwave_radiation?.[index]);
    const precipitation = n(hourly?.precipitation?.[index]);
    const windSpeed = n(hourly?.wind_speed_10m?.[index]);
    const gust = n(hourly?.wind_gusts_10m?.[index]);
    const direction = n(hourly?.wind_direction_10m?.[index]);

    const hourAvailable = [
      temperature,
      code,
      cloud,
      pressure,
      radiation,
      dewPoint,
      precipitation,
      windSpeed,
      gust,
      direction,
    ].some(Number.isFinite);

    if (hourAvailable) availableHourCount += 1;
    if (Number.isFinite(temperature)) temperatureValues.push(temperature);
    if (Number.isFinite(code)) codes.push(code);
    if (Number.isFinite(cloud)) cloudCover.push(cloud);
    if (Number.isFinite(pressure)) pressureValues.push(pressure);
    if (Number.isFinite(radiation)) radiationValues.push(Math.max(0, radiation));
    if (Number.isFinite(dewPoint)) dewPointValues.push(dewPoint);

    const humidex = humidexFromTemperatureAndDewPoint(temperature, dewPoint);
    if (Number.isFinite(n(humidex))) humidexValues.push(n(humidex));

    if (Number.isFinite(precipitation)) {
      precipitationValues.push(Math.max(0, precipitation));
    }
    if (Number.isFinite(windSpeed)) windSpeedValues.push(windSpeed);
    if (Number.isFinite(gust)) gustValues.push(gust);

    if (Number.isFinite(direction)) {
      const radians = (direction * Math.PI) / 180;
      const weight = Number.isFinite(windSpeed) && windSpeed > 0 ? windSpeed : 1;
      directionSin += Math.sin(radians) * weight;
      directionCos += Math.cos(radians) * weight;
      directionWeight += weight;
    }
  }

  const countCodes = (accepted) =>
    codes.filter((value) => accepted.includes(value)).length;

  const stormCount = countCodes([95, 96, 99]);
  const snowCount = countCodes([71, 73, 75, 77, 85, 86]);
  const rainCount = countCodes([
    51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82,
  ]);
  const fogCount = countCodes([45, 48]);
  const precipitationTotal = precipitationValues.reduce(
    (sum, value) => sum + value,
    0,
  );
  const rainCodeThreshold = Math.max(1, Math.ceil(codes.length * 0.25));

  return {
    available: availableHourCount > 0,
    availableHourCount,
    temperatureValues,
    codes,
    cloudCover,
    pressureValues,
    radiationValues,
    dewPointValues,
    humidexValues,
    precipitationValues,
    precipitationTotal,
    windSpeedValues,
    gustValues,
    temperatureMin: temperatureValues.length
      ? Math.min(...temperatureValues)
      : null,
    temperatureMax: temperatureValues.length
      ? Math.max(...temperatureValues)
      : null,
    windSpeedMean: windSpeedValues.length ? avgFinite(windSpeedValues) : null,
    windSpeedMax: windSpeedValues.length ? Math.max(...windSpeedValues) : null,
    gustMax: gustValues.length ? Math.max(...gustValues) : null,
    cloudMean: avgFinite(cloudCover),
    pressureMean: avgFinite(pressureValues),
    radiationMean: avgFinite(radiationValues),
    humidexMax: humidexValues.length ? Math.max(...humidexValues) : null,
    cloudHighFraction: cloudCover.length
      ? cloudCover.filter((value) => value >= 70).length / cloudCover.length
      : null,
    stormVote: stormCount > 0,
    snowVote: snowCount > 0,
    rainVote:
      rainCount >= rainCodeThreshold || precipitationTotal >= 0.1,
    fogVote: fogCount >= Math.max(1, Math.ceil(codes.length / 3)),
    directionSin,
    directionCos,
    directionWeight,
  };
}

function summarizeDeterministicBand(hourly, times, iso, band) {
  const indexes = bandIndexesFromTimes(times, iso, band);
  return summarizeDeterministicIndexes(hourly, indexes);
}

function summarizeDeterministicDay(hourly, times, iso) {
  const indexes = hourlyIndexesForDate(times, iso);
  return summarizeDeterministicIndexes(hourly, indexes);
}

function cloudCategoryFromSummary(summary) {
  if (Number.isFinite(summary?.cloudMean)) {
    if (summary.cloudMean < 20) return 0;
    if (summary.cloudMean < 42) return 1;
    if (summary.cloudMean < 68 || summary.cloudHighFraction < 0.5) return 2;
    return 3;
  }

  const fallback = weatherMetaFromHourly({
    codes: summary?.codes || [],
    cloudCover: summary?.cloudCover || [],
    rainProbability: 0,
    precipitation: 0,
  });

  if (fallback.kind === "sun") return 0;
  if (fallback.kind === "partly") return 1;
  return 3;
}

function consensusWeatherMeta(modelSummaries, rainProbability) {
  const models = (Array.isArray(modelSummaries) ? modelSummaries : []).filter(
    (summary) => summary?.available,
  );

  if (!models.length) return { kind: "sun", label: "Sereno" };

  if (models.length === 1) {
    const only = models[0];
    return weatherMetaFromHourly({
      codes: only.codes,
      cloudCover: only.cloudCover,
      rainProbability,
      precipitation: only.precipitationTotal,
    });
  }

  const stormVotes = models.filter((summary) => summary.stormVote).length;
  const snowVotes = models.filter((summary) => summary.snowVote).length;
  const rainVotes = models.filter((summary) => summary.rainVote).length;
  const fogVotes = models.filter((summary) => summary.fogVote).length;
  const maximumPrecipitation = Math.max(
    ...models.map((summary) => summary.precipitationTotal || 0),
  );

  if (
    stormVotes === models.length ||
    (stormVotes >= 1 && rainProbability >= 45 && maximumPrecipitation >= 0.1)
  ) {
    return { kind: "storm", label: "Possibili temporali" };
  }

  if (snowVotes === models.length || (snowVotes >= 1 && rainProbability >= 50)) {
    return { kind: "snow", label: "Possibili nevicate" };
  }

  if (
    (rainVotes === models.length && rainProbability >= 20) ||
    (rainVotes >= 1 && rainProbability >= 45) ||
    (rainProbability >= 70 && maximumPrecipitation >= 0.1)
  ) {
    return {
      kind: rainProbability >= 65 ? "rain" : "showers",
      label: rainProbability >= 65 ? "Pioggia probabile" : "Possibili rovesci",
    };
  }

  if (fogVotes === models.length) {
    return { kind: "fog", label: "Nebbia o foschia" };
  }

  const categories = models.map(cloudCategoryFromSummary);
  const cloudMeans = models
    .map((summary) => summary.cloudMean)
    .filter(Number.isFinite);
  const categorySpread = Math.max(...categories) - Math.min(...categories);
  const cloudSpread = cloudMeans.length > 1
    ? Math.max(...cloudMeans) - Math.min(...cloudMeans)
    : 0;

  if (categorySpread >= 2 || cloudSpread >= 45) {
    return { kind: "partly", label: "Variabile" };
  }

  const categoryMean = avgFinite(categories);

  if (categoryMean < 0.5) return { kind: "sun", label: "Sereno" };
  if (categoryMean < 1.5) {
    return { kind: "partly", label: "Poco nuvoloso" };
  }
  if (categoryMean < 2.5) {
    return { kind: "partly", label: "Parzialmente nuvoloso" };
  }

  return { kind: "cloud", label: "Nuvoloso" };
}

function consensusDirectionFromSummaries(modelSummaries) {
  const summaries = (Array.isArray(modelSummaries) ? modelSummaries : []).filter(
    (summary) => summary?.available && summary.directionWeight > 0,
  );

  if (!summaries.length) return null;

  const sin = summaries.reduce(
    (sum, summary) => sum + summary.directionSin,
    0,
  );
  const cos = summaries.reduce(
    (sum, summary) => sum + summary.directionCos,
    0,
  );

  if (Math.abs(sin) < 1e-9 && Math.abs(cos) < 1e-9) return null;

  let degrees = (Math.atan2(sin, cos) * 180) / Math.PI;
  if (degrees < 0) degrees += 360;
  return degrees;
}

function consensusAverage(values) {
  const valid = (Array.isArray(values) ? values : [])
    .map((value) => n(value))
    .filter(Number.isFinite);
  return valid.length ? avgFinite(valid) : null;
}

function isForecastBandPast(iso, band) {
  const now = new Date();
  const todayISO = dateToISO(now);

  if (iso < todayISO) return true;
  if (iso > todayISO) return false;

  return now.getHours() >= band.end;
}

function buildShortForecast(iconDeterministic, aromeDeterministic, ensemble) {
  const daily = iconDeterministic?.daily;
  const iconHourly = iconDeterministic?.hourly;
  const iconTimes = Array.isArray(iconHourly?.time) ? iconHourly.time : [];

  const aromeHourly = aromeDeterministic?.hourly;
  const aromeTimes = Array.isArray(aromeHourly?.time) ? aromeHourly.time : [];

  const hourlyEnsemble = ensemble?.hourly;
  const ensembleTimes = Array.isArray(hourlyEnsemble?.time)
    ? hourlyEnsemble.time
    : [];

  if (!daily || !Array.isArray(daily.time) || !iconTimes.length) {
    return [];
  }

  const temperatureKeys = ensembleMemberKeys(hourlyEnsemble, "temperature_2m");
  const precipitationKeys = ensembleMemberKeys(hourlyEnsemble, "precipitation");
  return daily.time.slice(0, 3).map((iso, dayIndex) => {
    const ensembleDayIndexes = hourlyIndexesForDate(ensembleTimes, iso);
    const iconDay = summarizeDeterministicDay(iconHourly, iconTimes, iso);
    const aromeDay = summarizeDeterministicDay(aromeHourly, aromeTimes, iso);
    const deterministicDays = [iconDay, aromeDay].filter(
      (summary) => summary.available,
    );

    const memberMaximums = [];
    const memberMinimums = [];
    const memberRainTotals = [];

    for (const key of temperatureKeys) {
      const values = ensembleDayIndexes
        .map((index) => n(hourlyEnsemble?.[key]?.[index]))
        .filter(Number.isFinite);

      if (values.length) {
        memberMaximums.push(Math.max(...values));
        memberMinimums.push(Math.min(...values));
      }
    }

    for (const key of precipitationKeys) {
      const values = ensembleDayIndexes
        .map((index) => n(hourlyEnsemble?.[key]?.[index]))
        .filter(Number.isFinite);

      if (values.length) {
        memberRainTotals.push(values.reduce((sum, value) => sum + value, 0));
      }
    }

    const periods = FORECAST_BANDS.map((band) => {
      const ensembleIndexes = bandIndexesFromTimes(ensembleTimes, iso, band);
      const iconBand = summarizeDeterministicBand(iconHourly, iconTimes, iso, band);
      const aromeBand = summarizeDeterministicBand(aromeHourly, aromeTimes, iso, band);
      const modelBands = [iconBand, aromeBand].filter(
        (summary) => summary.available,
      );

      const iconProbabilityValues = bandIndexesFromTimes(iconTimes, iso, band)
        .map((index) => n(iconHourly?.precipitation_probability?.[index]))
        .filter(Number.isFinite);
      const deterministicProbability = iconProbabilityValues.length
        ? Math.max(...iconProbabilityValues)
        : null;

      const ensembleRain = ensembleRainStats(
        hourlyEnsemble,
        precipitationKeys,
        ensembleIndexes,
      );
      const reliabilityRainProbability = Number.isFinite(ensembleRain.probability)
        ? ensembleRain.probability
        : Number.isFinite(deterministicProbability)
          ? Math.round(deterministicProbability)
          : null;
      const rainProbability = Number.isFinite(reliabilityRainProbability)
        ? reliabilityRainProbability
        : 0;
      const consensusPrecipitation = consensusAverage(
        modelBands.map((summary) => summary.precipitationTotal),
      );

      const memberBandMinimums = [];
      const memberBandMaximums = [];

      for (const key of temperatureKeys) {
        const values = ensembleIndexes
          .map((index) => n(hourlyEnsemble?.[key]?.[index]))
          .filter(Number.isFinite);

        if (values.length) {
          memberBandMinimums.push(Math.min(...values));
          memberBandMaximums.push(Math.max(...values));
        }
      }

      const deterministicBandMinimums = modelBands
        .map((summary) => summary.temperatureMin)
        .filter(Number.isFinite);
      const deterministicBandMaximums = modelBands
        .map((summary) => summary.temperatureMax)
        .filter(Number.isFinite);

      const temperatureRange = consensusPeriodTemperatureRange(
        memberBandMinimums,
        memberBandMaximums,
        deterministicBandMinimums,
        deterministicBandMaximums,
      );
      const periodWindDirection = consensusDirectionFromSummaries(modelBands);
      const periodWindSpeed = consensusAverage(
        modelBands.map((summary) => summary.windSpeedMean),
      );
      const periodWindGust = consensusAverage(
        modelBands.map((summary) => summary.gustMax),
      );
      const weather = consensusWeatherMeta(modelBands, rainProbability);
      const periodCloudCover = consensusAverage(
        modelBands.map((summary) => summary.cloudMean),
      );
      const periodPressure = consensusAverage(
        modelBands.map((summary) => summary.pressureMean),
      );
      const periodRadiation = consensusAverage(
        modelBands.map((summary) => summary.radiationMean),
      );
      const periodHumidex = consensusAverage(
        modelBands.map((summary) => summary.humidexMax),
      );

      return {
        ...band,
        weather,
        temperatureRange,
        rainProbability,
        rainRange: formatRainRange(
          ensembleRain.totals,
          consensusPrecipitation,
        ),
        windDirection: windCardinal16(periodWindDirection),
        windDirectionDegrees: Number.isFinite(n(periodWindDirection))
          ? n(periodWindDirection)
          : null,
        windSpeed: periodWindSpeed,
        windGust: periodWindGust,
        cloudCover: Number.isFinite(n(periodCloudCover))
          ? Math.round(n(periodCloudCover))
          : null,
        pressureMsl: Number.isFinite(n(periodPressure))
          ? Math.round(n(periodPressure))
          : null,
        shortwaveRadiation: Number.isFinite(n(periodRadiation))
          ? Math.round(n(periodRadiation))
          : null,
        humidex: Number.isFinite(n(periodHumidex))
          ? Math.round(n(periodHumidex))
          : null,
        past: isForecastBandPast(iso, band),
      };
    });

    const rainProbabilityFromMembers = memberRainTotals.length
      ? Math.round(
          (memberRainTotals.filter((value) => value >= 0.2).length /
            memberRainTotals.length) *
            100,
        )
      : null;
    const deterministicProbability = n(
      daily?.precipitation_probability_max?.[dayIndex],
    );
    const rainProbability = Number.isFinite(rainProbabilityFromMembers)
      ? rainProbabilityFromMembers
      : Number.isFinite(deterministicProbability)
        ? Math.round(deterministicProbability)
        : Math.max(...periods.map((period) => period.rainProbability), 0);

    const deterministicMaximums = deterministicDays
      .map((summary) => summary.temperatureMax)
      .filter(Number.isFinite);
    const deterministicMinimums = deterministicDays
      .map((summary) => summary.temperatureMin)
      .filter(Number.isFinite);
    const deterministicRainTotal = consensusAverage(
      deterministicDays.map((summary) => summary.precipitationTotal),
    );

    let maxRange = consensusForecastRange(
      memberMaximums,
      deterministicMaximums,
      daily?.temperature_2m_max?.[dayIndex],
    );
    let minRange = consensusForecastRange(
      memberMinimums,
      deterministicMinimums,
      daily?.temperature_2m_min?.[dayIndex],
    );

    const highestPeriodTemperature = maxFinite(
      periods.map((period) => period.temperatureRange?.high),
    );
    const lowestPeriodTemperature = minFinite(
      periods.map((period) => period.temperatureRange?.low),
    );

    if (Number.isFinite(highestPeriodTemperature)) {
      if (maxRange) {
        maxRange = {
          ...maxRange,
          high: Math.max(maxRange.high, highestPeriodTemperature),
        };
      } else {
        maxRange = {
          low: highestPeriodTemperature,
          high: highestPeriodTemperature,
          ensemble: false,
        };
      }
    }

    if (Number.isFinite(lowestPeriodTemperature)) {
      if (minRange) {
        minRange = {
          ...minRange,
          low: Math.min(minRange.low, lowestPeriodTemperature),
        };
      } else {
        minRange = {
          low: lowestPeriodTemperature,
          high: lowestPeriodTemperature,
          ensemble: false,
        };
      }
    }

    return {
      iso,
      dayIndex,
      title: forecastDateLabel(iso, dayIndex),
      dateLabel: forecastCompactDate(iso),
      maxRange,
      minRange,
      rainProbability,
      rainRange: formatRainRange(memberRainTotals, deterministicRainTotal),
      periods,
    };
  });
}

const FORECAST_ICON_MODEL = "italia_meteo_arpae_icon_2i";
const FORECAST_AROME_MODEL = "meteofrance_arome_france_hd";

const DETERMINISTIC_HOURLY_FIELDS = [
  "temperature_2m",
  "precipitation",
  "weather_code",
  "cloud_cover",
  "pressure_msl",
  "shortwave_radiation",
  "dew_point_2m",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
];

const DETERMINISTIC_DAILY_FIELDS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "wind_direction_10m_dominant",
];

function modelSpecificSeries(container, variable, modelSlug) {
  if (!container || typeof container !== "object") return [];

  const modelKey = `${variable}_${modelSlug}`;
  if (Array.isArray(container[modelKey])) return container[modelKey];

  if (Array.isArray(container[variable])) return container[variable];

  const candidates = Object.keys(container).filter(
    (key) =>
      key.startsWith(`${variable}_`) &&
      Array.isArray(container[key]),
  );

  const modelCandidate = candidates.find((key) => key.endsWith(modelSlug));
  if (modelCandidate) return container[modelCandidate];

  return candidates.length === 1 ? container[candidates[0]] : [];
}

function extractModelForecast(payload, modelSlug) {
  if (!payload) return null;

  if (Array.isArray(payload)) {
    const named = payload.find(
      (entry) => String(entry?.model || "") === modelSlug,
    );
    if (named) return named;

    const expectedIndex =
      modelSlug === FORECAST_ICON_MODEL ? 0 : 1;
    return payload[expectedIndex] || null;
  }

  const hourlySource = payload?.hourly || {};
  const dailySource = payload?.daily || {};
  const hourly = {
    time: Array.isArray(hourlySource.time) ? hourlySource.time : [],
  };
  const daily = {
    time: Array.isArray(dailySource.time) ? dailySource.time : [],
  };

  for (const field of DETERMINISTIC_HOURLY_FIELDS) {
    const values = modelSpecificSeries(hourlySource, field, modelSlug);
    if (values.length) hourly[field] = values;
  }

  for (const field of DETERMINISTIC_DAILY_FIELDS) {
    const values = modelSpecificSeries(dailySource, field, modelSlug);
    if (values.length) daily[field] = values;
  }

  return {
    ...payload,
    hourly,
    daily,
  };
}

function attachIconProbabilityForecast(iconForecast, probabilityPayload) {
  if (!iconForecast || !probabilityPayload) return iconForecast;

  const hourly = { ...(iconForecast.hourly || {}) };
  const daily = { ...(iconForecast.daily || {}) };

  const hourlyProbability = deterministicHourlySeries(
    probabilityPayload?.hourly,
    "precipitation_probability",
  );
  const dailyProbability = deterministicHourlySeries(
    probabilityPayload?.daily,
    "precipitation_probability_max",
  );

  if (hourlyProbability.length) {
    hourly.precipitation_probability = hourlyProbability;
  }

  if (dailyProbability.length) {
    daily.precipitation_probability_max = dailyProbability;
  }

  return {
    ...iconForecast,
    hourly,
    daily,
  };
}

function readForecastCache() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(FORECAST_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const forecast = Array.isArray(parsed?.forecast) ? parsed.forecast : [];
    const updatedAt = Number(parsed?.updatedAt);

    if (!forecast.length || !Number.isFinite(updatedAt)) return null;

    return {
      forecast,
      updatedAt,
    };
  } catch {
    return null;
  }
}

function writeForecastCache(forecast, updatedAt) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      FORECAST_CACHE_KEY,
      JSON.stringify({
        forecast,
        updatedAt,
      }),
    );
  } catch {
  }
}

function ForecastSection() {
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer = null;
    let requestInFlight = false;
    let lastConsultationAt = null;

    setForecast([]);
    setLoading(true);
    setError("");

    const scheduleNextUpdate = (lastConsultation = lastConsultationAt) => {
      if (!alive) return;

      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }

      const last = Number(lastConsultation);
      const elapsed = Number.isFinite(last)
        ? Math.max(0, Date.now() - last)
        : FORECAST_REFRESH_MS;
      const delay = Math.max(1000, FORECAST_REFRESH_MS - elapsed);

      timer = window.setTimeout(async () => {
        const nextConsultation = await loadForecast();
        scheduleNextUpdate(
          Number.isFinite(nextConsultation) ? nextConsultation : Date.now(),
        );
      }, delay);
    };

    const loadForecast = async () => {
      if (requestInFlight) return lastConsultationAt;

      requestInFlight = true;

      try {
        setError("");

        const deterministicUrl = new URL(
          "https://api.open-meteo.com/v1/forecast",
        );
        deterministicUrl.search = new URLSearchParams({
          latitude: String(FORECAST_LATITUDE),
          longitude: String(FORECAST_LONGITUDE),
          models: `${FORECAST_ICON_MODEL},${FORECAST_AROME_MODEL}`,
          timezone: FORECAST_TIMEZONE,
          forecast_days: "3",
          cell_selection: "land",
          hourly: DETERMINISTIC_HOURLY_FIELDS.join(","),
          daily: DETERMINISTIC_DAILY_FIELDS.join(","),
        }).toString();

        const iconProbabilityUrl = new URL(
          "https://api.open-meteo.com/v1/forecast",
        );
        iconProbabilityUrl.search = new URLSearchParams({
          latitude: String(FORECAST_LATITUDE),
          longitude: String(FORECAST_LONGITUDE),
          models: FORECAST_ICON_MODEL,
          timezone: FORECAST_TIMEZONE,
          forecast_days: "3",
          cell_selection: "land",
          hourly: "precipitation_probability",
          daily: "precipitation_probability_max",
        }).toString();

        const ensembleUrl = new URL(
          "https://ensemble-api.open-meteo.com/v1/ensemble",
        );
        ensembleUrl.search = new URLSearchParams({
          latitude: String(FORECAST_LATITUDE),
          longitude: String(FORECAST_LONGITUDE),
          models: "icon_eu",
          timezone: FORECAST_TIMEZONE,
          forecast_days: "3",
          hourly: "temperature_2m,precipitation",
        }).toString();

        const [
          deterministicResponse,
          iconProbabilityResponse,
          ensembleResponse,
        ] = await Promise.all([
          fetch(deterministicUrl.toString(), { cache: "no-store" }),
          fetch(iconProbabilityUrl.toString(), { cache: "no-store" }).catch(
            () => null,
          ),
          fetch(ensembleUrl.toString(), { cache: "no-store" }).catch(
            () => null,
          ),
        ]);

        if (!deterministicResponse.ok) {
          throw new Error(
            "Le previsioni deterministiche non sono momentaneamente disponibili.",
          );
        }

        const deterministicPayload = await deterministicResponse.json();
        let iconDeterministic = extractModelForecast(
          deterministicPayload,
          FORECAST_ICON_MODEL,
        );
        let aromeDeterministic = extractModelForecast(
          deterministicPayload,
          FORECAST_AROME_MODEL,
        );
        let ensemble = null;
        let iconProbabilityPayload = null;

        if (iconProbabilityResponse?.ok) {
          iconProbabilityPayload = await iconProbabilityResponse.json();
        }

        if (ensembleResponse?.ok) {
          ensemble = await ensembleResponse.json();
        }

        iconDeterministic = attachIconProbabilityForecast(
          iconDeterministic,
          iconProbabilityPayload,
        );

        const built = buildShortForecast(
          iconDeterministic,
          aromeDeterministic,
          ensemble,
        );

        if (!built.length) {
          throw new Error("La previsione non contiene giorni utilizzabili.");
        }

        const consultationTime = Date.now();
        lastConsultationAt = consultationTime;

        if (alive) {
          setForecast(built);
          setUpdatedAt(new Date(consultationTime));
          setLoading(false);
          writeForecastCache(built, consultationTime);
        }

        return consultationTime;
      } catch (loadError) {
        if (alive) {
          setError(
            loadError?.message ||
              "Non è stato possibile caricare le previsioni a breve termine.",
          );
          setLoading(false);
        }

        return null;
      } finally {
        requestInFlight = false;
      }
    };

    const refreshIfDue = async () => {
      if (!alive) return;

      const last = Number(lastConsultationAt);
      const refreshDue =
        !Number.isFinite(last) || Date.now() - last >= FORECAST_REFRESH_MS;

      if (!refreshDue) {
        scheduleNextUpdate(last);
        return;
      }

      const consultationTime = await loadForecast();

      if (!alive) return;

      scheduleNextUpdate(
        Number.isFinite(consultationTime) ? consultationTime : Date.now(),
      );
    };

    const cached = readForecastCache();

    if (cached) {
      lastConsultationAt = cached.updatedAt;
      setForecast(cached.forecast);
      setUpdatedAt(new Date(cached.updatedAt));
      setLoading(false);
      refreshIfDue();
    } else {
      refreshIfDue();
    }

    const handleFocus = () => {
      refreshIfDue();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshIfDue();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, []);

  const updatedLabel = updatedAt
    ? `Dati aggiornati alle ${updatedAt.toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : "Aggiornamento in corso";

  const safeActiveDayIndex = Math.min(
    Math.max(0, activeDayIndex),
    Math.max(0, forecast.length - 1),
  );
  const selectedDay = forecast[safeActiveDayIndex] || null;
  const selectedWeather = selectedDay
    ? overviewWeatherForDay(selectedDay)
    : null;

  return (
    <section className="forecastSection" aria-label="Previsioni per Collinas">
      <div className="forecastHeader">
        <h2>Previsioni meteo Collinas</h2>
        <p>
          Dati basati sui modelli <strong>ICON-2I, AROME HD e ICON-EU EPS.</strong>
        </p>
        <div className="forecastUpdate">{updatedLabel}</div>
      </div>

      {loading && !forecast.length && (
        <div className="forecastMessage">Caricamento delle previsioni…</div>
      )}

      {!loading && error && !forecast.length && (
        <div className="forecastMessage">{error}</div>
      )}

      {forecast.length > 0 && selectedDay && selectedWeather && (
        <div className="forecastContent">
          <div
            className="dayTabs"
            role="tablist"
            aria-label="Seleziona il giorno della previsione"
          >
            {forecast.map((day, index) => {
              const overview = overviewWeatherForDay(day);
              const isActive = index === safeActiveDayIndex;

              return (
                <button
                  key={day.iso}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`dayTab ${isActive ? "active" : ""}`}
                  onClick={() => setActiveDayIndex(index)}
                >
                  <div className="dayTabDate">{day.dateLabel}</div>

                  <div className="dayTabTemps">
                    <strong style={{ color: temperatureRangeTone(day.maxRange) }}>
                      {formatForecastRange(day.maxRange)}
                    </strong>
                    <span>/</span>
                    <strong style={{ color: FORECAST_MIN_TEMP_COLOR }}>
                      {formatForecastRange(day.minRange)}
                    </strong>
                    <span className="dayTabRain">· {day.rainRange}</span>
                  </div>

                  <div className="dayTabIcon">
                    <WeatherForecastIcon
                      kind={overview.kind}
                      night={overview.night}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          <article className="meteogramCard" role="tabpanel">
            <div className="meteogramGrid">
              <aside className="overviewLegend" aria-label="Dettaglio della previsione e legenda dei parametri">
                <div className="legendTitle">
                  <span className="legendEyebrow">Dettaglio previsione</span>
                  <span className="legendClock" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="8.5" />
                      <path d="M12 7.5v5l3.2 1.9" />
                    </svg>
                  </span>
                  <strong>4 fasce · 6 ore</strong>
                  <small>00 → 24</small>
                </div>

                <div className="legendList" aria-hidden="true">
                  <div className="legendRow">
                    <span className="legendGlyph tempGlyph">↕</span>
                    <strong>Temperatura</strong>
                  </div>
                  <div className="legendRow">
                    <span className="legendGlyph rainGlyph">♦</span>
                    <strong>Pioggia</strong>
                  </div>
                  <div className="legendRow">
                    <span className="legendGlyph windGlyph">➤</span>
                    <strong>Vento <small>(medio / raffica)</small></strong>
                  </div>
                  <div className="legendRow">
                    <span className="legendGlyph cloudGlyph">☁</span>
                    <strong>Nuvolosità</strong>
                  </div>
                  <div className="legendRow">
                    <span className="legendGlyph pressureGlyph">P</span>
                    <strong>Pressione</strong>
                  </div>
                  <div className="legendRow">
                    <span className="legendGlyph radiationGlyph">☀</span>
                    <strong>Radiazione <small>(media)</small></strong>
                  </div>
                  <div className="legendRow">
                    <span className="legendGlyph humidexGlyph">H</span>
                    <strong className="humidexLegendLabel">
                      Humidex <small>(max)</small>
                      <span
                        className="humidexInfo"
                        tabIndex={0}
                        aria-label="Informazioni sull'indice Humidex"
                      >
                        !
                        <span className="humidexInfoTooltip">
                          Indice di disagio da caldo basato su temperatura e umidità.
                        </span>
                      </span>
                    </strong>
                  </div>
                </div>
              </aside>

              <div className="periodColumns">
                {selectedDay.periods.map((period) => {
                  return (
                  <section
                    className={`periodColumn ${period.past ? "isPast" : ""}`}
                    key={period.key}
                    aria-label={`${period.label} ${period.timeLabel}`}
                  >
                    <div className="periodTopZone">
                      <span className="periodTimeCorner">{period.timeLabel}</span>

                      <div className="periodSummaryCenter">
                        <div className="periodColumnHead">
                          <strong>{period.label}</strong>
                        </div>

                        <div className="periodWeather">
                          <div className="periodWeatherIcon">
                            <WeatherForecastIcon
                              kind={period.weather.kind}
                              night={period.night}
                            />
                          </div>
                          <span>{period.weather.label}</span>
                          <strong
                            className="mobilePeriodTemperature"
                            style={{ color: temperatureRangeTone(period.temperatureRange) }}
                          >
                            {formatForecastRange(period.temperatureRange)}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="periodMetricGrid">
                      <div className="periodMetricRow temperatureMetricRow">
                        <span
                          className="tempLine"
                          style={{ background: temperatureRangeTone(period.temperatureRange) }}
                        />
                        <strong
                          style={{ color: temperatureRangeTone(period.temperatureRange) }}
                        >
                          {formatForecastRange(period.temperatureRange)}
                        </strong>
                        <span
                          className="tempLine"
                          style={{ background: temperatureRangeTone(period.temperatureRange) }}
                        />
                      </div>

                      <div className="periodMetricRow">
                        <span className="rowGlyph rainGlyph">♦</span>
                        <span className="mobileMetricLabel">Pioggia</span>
                        <strong>{period.rainProbability}% · {period.rainRange}</strong>
                      </div>

                      <div className="periodMetricRow">
                        <span
                          className="rowGlyph windGlyph windDirectionGlyph"
                          style={{
                            transform: `rotate(${windArrowRotation(period.windDirectionDegrees)}deg)`,
                          }}
                          aria-hidden="true"
                        >
                          ➤
                        </span>
                        <span className="mobileMetricLabel">Vento</span>
                        <strong className="windMetricValue">
                          {period.windDirection || "—"} {fmt(period.windSpeed, 0)} / {fmt(period.windGust, 0)} km/h
                        </strong>
                      </div>

                      <div className="periodMetricRow">
                        <span className="rowGlyph cloudGlyph">☁</span>
                        <span className="mobileMetricLabel">Nuvolosità</span>
                        <strong>
                          {Number.isFinite(n(period.cloudCover))
                            ? `${Math.round(n(period.cloudCover))}%`
                            : "—"}
                        </strong>
                      </div>

                      <div className="periodMetricRow">
                        <span className="rowGlyph pressureGlyph">P</span>
                        <span className="mobileMetricLabel">Pressione</span>
                        <strong>
                          {Number.isFinite(n(period.pressureMsl))
                            ? `${Math.round(n(period.pressureMsl))} hPa`
                            : "—"}
                        </strong>
                      </div>

                      <div className="periodMetricRow">
                        <span className="rowGlyph radiationGlyph">☀</span>
                        <span className="mobileMetricLabel">Radiazione</span>
                        <strong>
                          {Number.isFinite(n(period.shortwaveRadiation))
                            ? `${Math.round(n(period.shortwaveRadiation))} W/m²`
                            : "—"}
                        </strong>
                      </div>

                      <div className="periodMetricRow humidexMetricRow">
                        <span className="rowGlyph humidexGlyph">H</span>
                        <span className="mobileMetricLabel mobileHumidexLabel">
                          Humidex
                          <span
                            className="mobileHumidexInfo"
                            tabIndex={0}
                            aria-label="Informazioni sull'indice Humidex"
                          >
                            !
                            <span className="mobileHumidexTooltip">
                              Indice di disagio da caldo basato su temperatura e umidità.
                            </span>
                          </span>
                        </span>
                        <strong className={humidexAttention(period.humidex)?.tone || ""}>
                          {Number.isFinite(n(period.humidex))
                            ? Math.round(n(period.humidex))
                            : "—"}
                          {humidexAttention(period.humidex) ? (
                            <span
                              className="humidexAlert"
                              title={humidexAttention(period.humidex).title}
                              aria-label={humidexAttention(period.humidex).title}
                            >
                              {humidexAttention(period.humidex).label}
                            </span>
                          ) : null}
                        </strong>
                      </div>
                    </div>
                  </section>
                  );
                })}
              </div>
            </div>

          </article>
        </div>
      )}

      <a className="forecastFooterLink" href="/grafici-previsione">
        <span>Previsioni grafiche oltre 3 giorni</span>
        <span aria-hidden="true">→</span>
      </a>

      <style jsx>{`
        .forecastSection {
          margin: 18px auto 0;
          border: 1px solid #e5e7eb;
          border-radius: 22px;
          overflow: hidden;
          background: #ffffff;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.045);
        }

        .forecastHeader {
          padding: 18px 18px 14px;
          display: grid;
          justify-items: center;
          gap: 4px;
          border-bottom: 1px solid #eef2f6;
          background: linear-gradient(180deg, #ffffff, #fbfdff);
          text-align: center;
        }

        .forecastHeader h2 {
          margin: 0;
          font-size: 27px;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.035em;
        }

        .forecastHeader p {
          margin: 0;
          font-size: 11px;
          font-weight: 700;
          color: rgba(15, 23, 42, 0.58);
        }

        .forecastHeader p strong {
          color: #0f172a;
          font-weight: 900;
        }

        .forecastUpdate {
          margin-top: 3px;
          font-size: 9px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.48);
          text-transform: uppercase;
          letter-spacing: 0.045em;
        }

        .forecastMessage {
          min-height: 160px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          font-size: 12px;
          font-weight: 800;
          color: rgba(15, 23, 42, 0.62);
          text-align: center;
        }

        .forecastContent {
          padding: 8px 8px 10px;
        }

        .dayTabs {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 8px;
        }

        .dayTab {
          min-width: 0;
          min-height: 46px;
          padding: 6px 14px;
          display: grid;
          grid-template-columns: minmax(90px, 1fr) auto 34px;
          align-items: center;
          gap: 14px;
          border: 1px solid #e2e7ed;
          border-radius: 10px;
          background: #ffffff;
          color: #0f172a;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          transition:
            border-color 120ms ease,
            box-shadow 120ms ease,
            background 120ms ease;
        }

        .dayTab:hover {
          border-color: #c8d3df;
          background: #fbfdff;
        }

        .dayTab.active {
          border-color: #60a5fa;
          background: linear-gradient(180deg, #f8fbff, #ffffff);
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.08);
        }

        .dayTab:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
        }

        .dayTabDate {
          min-width: 0;
          overflow: hidden;
          font-size: 14px;
          font-weight: 950;
          color: #0f172a;
          text-transform: capitalize;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .dayTabTemps {
          display: flex;
          align-items: center;
          gap: 6px;
          white-space: nowrap;
        }

        .dayTabRain {
          margin-left: 2px;
          font-size: 9.5px !important;
          font-weight: 900 !important;
          color: #0284c7 !important;
        }

        .dayTabTemps strong {
          font-size: 11px;
          font-weight: 950;
        }

        .dayTabTemps > span {
          font-size: 10px;
          font-weight: 800;
          color: rgba(15, 23, 42, 0.42);
        }

        .dayTabIcon {
          width: 28px;
          height: 26px;
          justify-self: end;
          margin-left: 4px;
        }

        .dayTabIcon :global(svg) {
          width: 100%;
          height: 100%;
          display: block;
          overflow: visible;
        }

        .meteogramCard {
          margin-top: 6px;
          border: 1px solid #e2e8f0;
          border-radius: 13px;
          overflow: visible;
          background: #ffffff;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.025);
        }

        .meteogramGrid {
          display: grid;
          grid-template-columns: 205px minmax(0, 1fr);
          min-width: 0;
          overflow: visible;
          border-radius: 13px 13px 0 0;
        }

        .overviewLegend {
          position: relative;
          z-index: 4;
          min-width: 0;
          padding: 8px 10px 0;
          display: grid;
          grid-template-rows: 108px auto;
          gap: 0;
          border-right: 1px solid #e5ebf1;
          background: linear-gradient(180deg, #ffffff, #fbfdff);
        }

        .legendTitle {
          min-width: 0;
          height: 108px;
          display: grid;
          align-content: center;
          justify-items: center;
          gap: 3px;
          padding: 7px 6px 9px;
          box-sizing: border-box;
          text-align: center;
        }

        .legendEyebrow {
          font-size: 8px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.48);
          text-transform: uppercase;
          letter-spacing: 0.075em;
        }

        .legendClock {
          width: 25px;
          height: 25px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #0284c7;
        }

        .legendClock :global(svg) {
          width: 100%;
          height: 100%;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.7;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .legendTitle > strong {
          font-size: 10.5px;
          font-weight: 950;
          line-height: 1.1;
          color: #0f172a;
          letter-spacing: -0.01em;
        }

        .legendTitle > small {
          font-size: 8.5px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.48);
          letter-spacing: 0.035em;
        }

        .legendList {
          display: grid;
          grid-template-rows: repeat(7, 30px);
          align-content: start;
          gap: 0;
          padding: 0 18px;
        }

        .legendRow {
          min-width: 0;
          min-height: 0;
          display: grid;
          grid-template-columns: 18px minmax(0, 1fr);
          align-items: center;
          justify-content: stretch;
          gap: 8px;
          border-top: 1px solid #edf1f5;
          text-align: left;
        }

        .legendRow:last-child {
          border-bottom: 1px solid #edf1f5;
        }

        .legendRow:last-child {
          border-bottom: 0;
        }

        .legendRow:has(.humidexInfo) {
          position: relative;
          z-index: 220;
          overflow: visible;
        }

        .legendGlyph,
        .rowGlyph {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 950;
          color: #0284c7;
        }

        .legendRow > strong {
          min-width: 0;
          overflow: visible;
          font-size: 8.5px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.62);
          text-transform: uppercase;
          letter-spacing: 0.025em;
          text-align: left;
          white-space: nowrap;
        }

        .legendRow small {
          font-size: 7.5px;
          font-weight: 700;
          color: rgba(15, 23, 42, 0.42);
          text-transform: none;
          letter-spacing: 0;
        }

        .windGlyph {
          color: #2563eb;
        }

        .windDirectionGlyph {
          transform-origin: center;
          transition: transform 140ms ease;
        }

        .cloudGlyph {
          color: #0284c7;
          font-size: 11px;
        }

        .pressureGlyph {
          color: #64748b;
          font-size: 9px;
          font-weight: 950;
        }

        .radiationGlyph {
          color: #d97706;
          font-size: 11px;
        }

        .humidexGlyph {
          color: #db2777;
          font-size: 11px;
          font-weight: 950;
        }

        .humidexLegendLabel {
          position: relative;
          z-index: 210;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          overflow: visible !important;
          white-space: nowrap;
        }

        .humidexInfo {
          position: relative;
          width: 15px;
          height: 15px;
          flex: 0 0 15px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #cbd5e1;
          border-radius: 999px;
          background: #ffffff;
          color: #64748b;
          font-size: 9px;
          font-weight: 950;
          line-height: 1;
          cursor: help;
          outline: none;
        }

        .humidexInfoTooltip {
          position: absolute;
          z-index: 200;
          left: 50%;
          bottom: calc(100% + 9px);
          width: 235px;
          max-width: min(235px, calc(100vw - 36px));
          padding: 8px 10px;
          border-radius: 9px;
          background: #0f172a;
          color: #ffffff;
          font-size: 9.5px;
          font-weight: 700;
          line-height: 1.35;
          text-align: left;
          text-transform: none;
          letter-spacing: 0;
          white-space: normal;
          overflow-wrap: anywhere;
          word-break: normal;
          box-shadow: 0 9px 22px rgba(15, 23, 42, 0.22);
          opacity: 0;
          visibility: hidden;
          transform: translateX(-50%) translateY(4px);
          transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
          pointer-events: none;
        }

        .humidexInfoTooltip::after {
          content: "";
          position: absolute;
          left: 50%;
          top: 100%;
          width: 7px;
          height: 7px;
          background: #0f172a;
          transform: translateX(-50%) rotate(45deg);
        }

        .humidexInfo:hover .humidexInfoTooltip,
        .humidexInfo:focus .humidexInfoTooltip {
          opacity: 1;
          visibility: visible;
          transform: translateX(-50%) translateY(0);
        }

        .periodColumns {
          position: relative;
          z-index: 1;
          min-width: 0;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .periodColumn {
          min-width: 0;
          padding: 8px 8px 0;
          display: grid;
          align-content: start;
          gap: 0;
          border-right: 1px solid #e7ecf1;
          background: #ffffff;
          transition: background 120ms ease;
        }

        .periodColumn:hover {
          background: #fbfdff;
        }

        .periodColumn.isPast {
          opacity: 0.68;
        }

        .periodTopZone {
          position: relative;
          height: 108px;
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto 1fr;
          align-content: start;
          padding-top: 7px;
        }

        .periodSummaryCenter {
          display: contents;
        }

        .periodMetricGrid {
          display: grid;
          grid-template-rows: repeat(7, 30px);
          align-content: start;
        }

        .periodMetricRow {
          min-width: 0;
          display: grid;
          grid-template-columns: 16px minmax(0, 1fr) 16px;
          align-items: center;
          gap: 6px;
          border-top: 1px solid #edf1f5;
          text-align: center;
        }

        .periodMetricRow::after {
          content: "";
          width: 16px;
          height: 1px;
        }

        .periodMetricRow:last-child {
          border-bottom: 1px solid #edf1f5;
        }

        .periodMetricRow strong {
          min-width: 0;
          overflow: hidden;
          font-size: 12.5px;
          font-weight: 900;
          color: #0f172a;
          text-align: center;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .temperatureMetricRow {
          grid-template-columns: minmax(18px, 1fr) auto minmax(18px, 1fr);
          gap: 8px;
          text-align: center;
        }

        .temperatureMetricRow::after {
          display: none;
        }

        .temperatureMetricRow strong {
          font-size: 13.5px;
          font-weight: 950;
          text-align: center;
        }

        .humidexMetricRow strong.attention {
          color: #d97706;
        }

        .humidexMetricRow strong.high {
          color: #ea580c;
        }

        .humidexMetricRow strong.danger {
          color: #dc2626;
        }

        .humidexAlert {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-left: 5px;
          font-size: 13px;
          line-height: 1;
          vertical-align: -1px;
          cursor: help;
        }

        .periodColumnHead {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 18px;
          text-align: center;
        }

        .periodColumnHead strong {
          font-size: 10.5px;
          font-weight: 950;
          color: #0f172a;
          text-transform: uppercase;
          letter-spacing: 0.025em;
        }

        .periodTimeCorner {
          position: absolute;
          top: 6px;
          left: 4px;
          font-size: 7.5px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.42);
          letter-spacing: 0.02em;
          white-space: nowrap;
        }

        .periodWeather {
          min-width: 0;
          margin-top: 16px;
          display: grid;
          justify-items: center;
          gap: 3px;
          text-align: center;
        }

        .periodWeatherIcon {
          width: 27px;
          height: 24px;
        }

        .periodWeatherIcon :global(svg) {
          width: 100%;
          height: 100%;
          display: block;
          overflow: visible;
        }

        .periodWeather > span {
          min-height: 13px;
          overflow: hidden;
          font-size: 8.5px;
          font-weight: 800;
          line-height: 1.1;
          color: #334155;
          text-align: center;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mobilePeriodTemperature,
        .mobileMetricLabel,
        .mobileHumidexInfo {
          display: none;
        }

        .periodTempLine {
          display: grid;
          grid-template-columns: minmax(8px, 1fr) auto minmax(8px, 1fr);
          align-items: center;
          gap: 7px;
          min-width: 0;
        }

        .periodTempLine strong {
          font-size: 11px;
          font-weight: 950;
          white-space: nowrap;
        }

        .tempLine {
          height: 1.5px;
          border-radius: 999px;
          opacity: 0.92;
        }

        .periodCompactData {
          display: grid;
          gap: 0;
        }

        .periodCompactRow {
          min-width: 0;
          min-height: 23px;
          display: grid;
          grid-template-columns: 14px minmax(0, 1fr);
          align-items: center;
          gap: 5px;
          border-bottom: 1px solid #eff3f6;
        }

        .periodCompactRow:last-child {
          border-bottom: 0;
        }

        .periodCompactRow strong {
          min-width: 0;
          overflow: hidden;
          font-size: 9.5px;
          font-weight: 900;
          color: #0f172a;
          text-align: center;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .forecastFooterLink {
          min-height: 42px;
          padding: 0 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          border-top: 1px solid #edf1f5;
          background: #fbfcfd;
          color: #0f172a;
          font-size: 12px;
          font-weight: 900;
          text-decoration: none;
          transition: background 120ms ease;
        }

        .forecastFooterLink:hover {
          background: #f5f8fb;
        }

        .forecastFooterLink span:last-child {
          font-size: 16px;
          line-height: 1;
        }

        @media (max-width: 1260px) {
          .meteogramGrid {
            grid-template-columns: 180px minmax(0, 1fr);
          }

          .legendRow > strong {
            font-size: 8px;
          }

          .periodColumn {
            padding-left: 6px;
            padding-right: 6px;
          }

          .periodCompactRow strong {
            font-size: 9px;
          }
        }

        @media (max-width: 980px) {
          .meteogramGrid {
            grid-template-columns: 165px minmax(0, 1fr);
          }

        }

        @media (max-width: 760px) {
          .forecastHeader {
            padding-left: 12px;
            padding-right: 12px;
          }

          .forecastHeader h2 {
            font-size: 22px;
          }

          .forecastHeader p {
            font-size: 10px;
          }

          .forecastContent {
            padding: 7px;
          }

          .dayTabs {
            grid-template-columns: 1fr;
            gap: 5px;
          }

          .dayTab {
            min-height: 42px;
            grid-template-columns: minmax(90px, 1fr) auto 30px;
            gap: 12px;
          }

          .meteogramGrid {
            grid-template-columns: 1fr;
          }

          .overviewLegend {
            grid-template-columns: 145px minmax(0, 1fr);
            grid-template-rows: auto;
            align-items: center;
            padding-top: 0;
            border-right: 0;
            border-bottom: 1px solid #e5ebf1;
          }

          .legendTitle {
            height: 58px;
            align-content: center;
            gap: 1px;
            padding: 5px 8px;
            border-right: 1px solid #e8edf2;
          }

          .legendEyebrow,
          .legendTitle > small {
            display: none;
          }

          .legendClock {
            width: 19px;
            height: 19px;
          }

          .legendTitle > strong {
            font-size: 9px;
          }

          .legendList {
            grid-template-columns: repeat(7, minmax(0, 1fr));
            grid-template-rows: none;
            padding: 0;
          }

          .legendRow {
            min-height: 34px;
            justify-items: center;
            grid-template-columns: 1fr;
            gap: 2px;
            border-top: 0;
            border-bottom: 0;
            border-right: 1px solid #eef2f5;
            text-align: center;
          }

          .legendRow:last-child {
            border-right: 0;
          }

          .legendRow > strong {
            font-size: 7.5px;
          }

          .legendRow small {
            display: none;
          }

          .periodColumns {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .periodColumn:nth-child(2) {
            border-right: 0;
          }

          .periodColumn:nth-child(-n + 2) {
            border-bottom: 1px solid #e7ecf1;
          }

        }

        @media (max-width: 480px) {
          .forecastContent {
            padding: 6px;
          }

          .dayTabs {
            gap: 5px;
          }

          .dayTab {
            min-height: 44px;
            padding: 6px 10px;
            grid-template-columns: minmax(82px, 1fr) auto 28px;
            gap: 8px;
          }

          .dayTabDate {
            font-size: 13px;
          }

          .dayTabTemps {
            gap: 4px;
          }

          .dayTabTemps strong {
            font-size: 10.5px;
          }

          .dayTabRain {
            display: none;
          }

          .dayTabIcon {
            width: 25px;
            height: 23px;
            margin-left: 0;
          }

          .meteogramCard {
            margin-top: 7px;
            border: 0;
            background: transparent;
            box-shadow: none;
          }

          .meteogramGrid {
            display: block;
            overflow: visible;
            border-radius: 0;
          }

          .overviewLegend {
            display: none;
          }

          .periodColumns {
            display: grid;
            grid-template-columns: 1fr;
            gap: 7px;
          }

          .periodColumn,
          .periodColumn:nth-child(2),
          .periodColumn:nth-child(-n + 2) {
            min-width: 0;
            padding: 8px 10px;
            display: grid;
            grid-template-columns: 112px minmax(0, 1fr);
            align-items: stretch;
            gap: 10px;
            border: 1px solid #e2e8f0;
            border-radius: 15px;
            background: #ffffff;
            box-shadow: 0 3px 10px rgba(15, 23, 42, 0.025);
          }

          .periodColumn:last-child {
            border-bottom: 1px solid #e2e8f0;
          }

          .periodTopZone {
            position: relative;
            height: 164px;
            min-height: 164px;
            padding: 0;
            display: block;
            border-right: 1px solid #e8edf3;
            box-sizing: border-box;
          }

          .periodTimeCorner {
            position: absolute;
            top: 7px;
            left: 50%;
            z-index: 3;
            transform: translateX(-50%);
            padding: 0;
            border: 0;
            border-radius: 0;
            background: transparent;
            font-size: 9px;
            font-weight: 850;
            line-height: 1;
            color: #94a3b8;
            text-align: center;
            white-space: nowrap;
          }

          .periodSummaryCenter {
            position: absolute;
            inset: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 8px;
            padding: 24px 4px 4px;
            box-sizing: border-box;
            text-align: center;
          }

          .periodColumnHead {
            width: 100%;
            min-height: 0;
            margin: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
          }

          .periodColumnHead strong {
            display: block;
            width: 100%;
            font-size: 13px;
            text-align: center;
          }

          .periodWeather {
            margin: 0;
            gap: 5px;
          }

          .periodWeatherIcon {
            width: 39px;
            height: 35px;
          }

          .periodWeather > span {
            min-height: 0;
            max-width: 96px;
            font-size: 10px;
            line-height: 1.15;
            white-space: normal;
          }

          .mobilePeriodTemperature {
            display: block;
            margin-top: 8px;
            font-size: 17px;
            font-weight: 950;
            line-height: 1;
            white-space: nowrap;
          }

          .periodMetricGrid > .temperatureMetricRow,
          .temperatureMetricRow {
            display: none !important;
            height: 0 !important;
            min-height: 0 !important;
            padding: 0 !important;
            margin: 0 !important;
            border: 0 !important;
          }

          .periodMetricGrid {
            min-width: 0;
            display: grid;
            grid-template-rows: repeat(6, 29px);
            grid-auto-rows: 29px;
            align-content: center;
          }

          .periodMetricRow {
            min-width: 0;
            height: 29px;
            min-height: 29px;
            box-sizing: border-box;
            padding: 0;
            margin: 0;
            display: grid;
            grid-template-columns: 15px minmax(0, 1fr) minmax(102px, auto);
            align-items: center;
            gap: 6px;
            border-top: 1px solid #edf1f5;
            text-align: left;
          }

          .periodMetricRow:first-child:not(.temperatureMetricRow) {
            border-top: 0;
          }

          .periodMetricRow::after {
            display: none;
          }

          .periodMetricRow:last-child {
            border-bottom: 0;
          }

          .mobileMetricLabel {
            display: flex;
            align-items: center;
            gap: 4px;
            min-width: 0;
            height: 100%;
            font-size: 9.5px;
            font-weight: 800;
            line-height: 1;
            color: #64748b;
            white-space: nowrap;
          }

          .periodMetricRow strong {
            min-width: 102px;
            overflow: visible;
            font-size: 10.5px;
            font-weight: 900;
            line-height: 1;
            color: #0f172a;
            text-align: right;
            text-overflow: clip;
            white-space: nowrap;
          }

          .windMetricValue {
            min-width: 112px !important;
            font-size: 9.8px !important;
            letter-spacing: -0.02em;
          }

          .rowGlyph {
            font-size: 10px;
          }

          .humidexAlert {
            margin-left: 3px;
            font-size: 11px;
          }

          .mobileHumidexLabel {
            overflow: visible;
          }

          .humidexMetricRow,
          .periodMetricRow:has(.radiationGlyph) {
            height: 29px;
            min-height: 29px;
            padding-top: 0;
            padding-bottom: 0;
            margin-top: 0;
            margin-bottom: 0;
          }

          .mobileHumidexInfo {
            position: relative;
            width: 14px;
            height: 14px;
            flex: 0 0 14px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid #cbd5e1;
            border-radius: 50%;
            background: #fff;
            color: #64748b;
            font-size: 8px;
            font-weight: 950;
            cursor: help;
          }

          .mobileHumidexTooltip {
            position: absolute;
            z-index: 80;
            left: 50%;
            right: auto;
            bottom: calc(100% + 7px);
            width: 185px;
            max-width: min(185px, calc(100vw - 32px));
            padding: 7px 8px;
            border-radius: 9px;
            background: #0f172a;
            color: #fff;
            font-size: 9px;
            font-weight: 700;
            line-height: 1.3;
            white-space: normal;
            box-shadow: 0 8px 20px rgba(15, 23, 42, 0.2);
            opacity: 0;
            visibility: hidden;
            transform: translateX(-50%) translateY(3px);
            transition: opacity 120ms ease, transform 120ms ease, visibility 120ms ease;
            pointer-events: none;
          }

          .mobileHumidexInfo:hover .mobileHumidexTooltip,
          .mobileHumidexInfo:focus .mobileHumidexTooltip {
            opacity: 1;
            visibility: visible;
            transform: translateX(-50%) translateY(0);
          }

          .forecastFooterLink {
            margin-top: 7px;
            min-height: 38px;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            font-size: 10.5px;
          }
        }
      `}</style>
    </section>
  );
}

function CustomSelect({ value, options = [], onChange, ariaLabel, variant = "light" }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const selectedLabel =
    options.find((option) => option.key === value)?.label || "";

  useEffect(() => {
    if (!open) return undefined;

    const closeFromOutside = (event) => {
      if (!wrapperRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const closeWithEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", closeFromOutside);
    document.addEventListener("touchstart", closeFromOutside, {
      passive: true,
    });
    document.addEventListener("keydown", closeWithEscape);

    return () => {
      document.removeEventListener("mousedown", closeFromOutside);
      document.removeEventListener("touchstart", closeFromOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  const choose = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
  };

  return (
    <div
      ref={wrapperRef}
      className={`customSelect ${variant === "dark" ? "dark" : ""} ${open ? "isOpen" : ""}`}
    >
      <button
        type="button"
        className="selectButton"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="selectedValue">{selectedLabel}</span>
        <span className="chevron" aria-hidden="true">
         ⌄
        </span>
      </button>

      {open && (
        <div className="options" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => {
            const active = option.key === value;

            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={active}
                className={`option ${active ? "active" : ""}`}
                onClick={() => choose(option.key)}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      <style jsx>{`
        .customSelect {
          position: relative;
          width: 100%;
        }

        .selectButton {
          position: relative;
          width: 100%;
          min-height: 42px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #dde2e8;
          border-radius: 13px;
          padding: 10px 42px;
          background: #fff;
          color: #0f172a;
          font-size: 12px;
          font-weight: 900;
          line-height: 1.2;
          text-align: center;
          outline: none;
          cursor: pointer;
        }

        .selectButton:hover {
          border-color: #c4ccd6;
        }

        .dark .selectButton {
          min-height: 36px;
          border-color: rgba(255, 255, 255, 0.22);
          border-radius: 10px;
          padding: 7px 12px;
          background: rgba(255, 255, 255, 0.11);
          color: #ffffff;
          font-size: 11px;
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
          backdrop-filter: blur(8px);
        }

        .dark .selectButton:hover {
          border-color: rgba(255, 255, 255, 0.34);
          background: rgba(255, 255, 255, 0.16);
        }

        .dark .selectButton:focus-visible,
        .dark.isOpen .selectButton {
          border-color: rgba(255, 255, 255, 0.48);
          background: rgba(255, 255, 255, 0.18);
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.08);
        }

        .dark .chevron {
          display: none;
        }

        .selectButton:focus-visible,
        .isOpen .selectButton {
          border-color: #aab5c3;
          box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.06);
        }

        .selectedValue {
          width: 100%;
          display: block;
          overflow: hidden;
          text-align: center;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .chevron {
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-54%);
          color: #0f172a;
          font-size: 18px;
          font-weight: 900;
          line-height: 1;
          pointer-events: none;
          transition: transform 140ms ease;
        }

        .isOpen .chevron {
          transform: translateY(-46%) rotate(180deg);
        }

        .options {
          position: absolute;
          z-index: 2000;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          max-height: 270px;
          overflow-y: auto;
          border: 1px solid #b8c0ca;
          border-radius: 10px;
          background: #fff;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.16);
        }

        .option {
          width: 100%;
          min-height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-bottom: 1px solid #eef1f4;
          padding: 8px 12px;
          background: #fff;
          color: #0f172a;
          font-family: inherit;
          font-size: 12px;
          font-weight: 500;
          line-height: 1.25;
          text-align: center;
          cursor: pointer;
        }

        .option:last-child {
          border-bottom: 0;
        }

        .option:hover,
        .option:focus-visible {
          background: #eef4ff;
          outline: none;
        }

        .option.active {
          background: #2563eb;
          color: #fff;
          font-weight: 700;
        }

        @media (max-width: 720px) {
          .selectButton {
            min-height: 40px;
            padding-left: 30px;
            padding-right: 30px;
            font-size: 10.5px;
          }

          .dark .selectButton {
            min-height: 32px;
            padding: 5px 8px;
            border-radius: 9px;
            font-size: 9.5px;
          }

          .selectedValue {
            min-width: 0;
          }

          .chevron {
            right: 10px;
          }

          .options {
            max-height: 220px;
          }

          .option {
            min-height: 34px;
            padding: 8px 9px;
            font-size: 10.5px;
          }
        }
      `}</style>
    </div>
  );
}

function localDayIndex(timestamp, startISO) {
  const d = new Date(timestamp);
  const start = isoToLocalDate(startISO, 0);
  if (!start) return null;

  const dayUTC = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const startUTC = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
  );

  return Math.round((dayUTC - startUTC) / 86400000);
}

function relativeTimeKey(timestamp, startISO, mode) {
  const d = new Date(timestamp);
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());

  if (mode === "day") return `${hh}:${mm}`;

  if (mode === "week") {
    const dayIndex = localDayIndex(timestamp, startISO);
    return Number.isFinite(dayIndex) ? `${dayIndex}|${hh}:${mm}` : null;
  }

  return `${pad2(d.getDate())}|${hh}:${mm}`;
}

function seriesValues(pairs) {
  return (Array.isArray(pairs) ? pairs : [])
    .map((point) => ({
      timestamp: Number(point?.[0]),
      value: n(point?.[1]),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.timestamp) && Number.isFinite(point.value),
    );
}

function seriesStats(pairs) {
  const values = seriesValues(pairs);
  if (!values.length) {
    return {
      min: null,
      minTimestamp: null,
      max: null,
      maxTimestamp: null,
      mean: null,
    };
  }

  let minPoint = values[0];
  let maxPoint = values[0];
  let total = 0;

  for (const point of values) {
    total += point.value;
    if (point.value < minPoint.value) minPoint = point;
    if (point.value > maxPoint.value) maxPoint = point;
  }

  return {
    min: minPoint.value,
    minTimestamp: minPoint.timestamp,
    max: maxPoint.value,
    maxTimestamp: maxPoint.timestamp,
    mean: total / values.length,
  };
}

function formatSummaryTimestamp(timestamp, mode) {
  if (!Number.isFinite(Number(timestamp))) return "—";

  const d = new Date(Number(timestamp));
  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());

  if (mode === "day") return `${hh}:${mm}`;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${hh}:${mm}`;
}

function deltaMetaForGroup(groupKey) {
  if (groupKey === "rain") {
    return {
      field: "rainCum",
      label: "precipitazione cumulata",
      shortLabel: "Precipitazioni",
      differenceTitle: "Differenza di precipitazione cumulata",
      unit: "mm",
      positiveColor: "#0284c7",
      negativeColor: "#d97706",
      positiveText: "Più pioggia",
      negativeText: "Meno pioggia",
    };
  }

  if (groupKey === "rh") {
    return {
      field: "rh",
      label: "umidità",
      shortLabel: "Umidità",
      differenceTitle: "Differenza di umidità",
      unit: "%",
      positiveColor: "#0891b2",
      negativeColor: "#d97706",
      positiveText: "Più umido",
      negativeText: "Meno umido",
    };
  }

  if (groupKey === "wind") {
    return {
      field: "wind",
      label: "vento medio",
      shortLabel: "Vento medio",
      differenceTitle: "Differenza del vento medio",
      unit: "km/h",
      positiveColor: "#7c3aed",
      negativeColor: "#64748b",
      positiveText: "Più vento",
      negativeText: "Meno vento",
    };
  }

  if (groupKey === "press") {
    return {
      field: "press",
      label: "pressione",
      shortLabel: "Pressione",
      differenceTitle: "Differenza di pressione",
      unit: "hPa",
      positiveColor: "#dc2626",
      negativeColor: "#2563eb",
      positiveText: "Pressione più alta",
      negativeText: "Pressione più bassa",
    };
  }

  if (groupKey === "uv") {
    return {
      field: "uv",
      label: "indice UV",
      shortLabel: "Indice UV",
      differenceTitle: "Differenza dell’indice UV",
      unit: "UV",
      positiveColor: "#f59e0b",
      negativeColor: "#64748b",
      positiveText: "UV più alto",
      negativeText: "UV più basso",
    };
  }

  if (groupKey === "solar") {
    return {
      field: "solar",
      label: "radiazione solare",
      shortLabel: "Radiazione solare",
      differenceTitle: "Differenza della radiazione solare",
      unit: "W/m²",
      positiveColor: "#ea580c",
      negativeColor: "#64748b",
      positiveText: "Più radiazione",
      negativeText: "Meno radiazione",
    };
  }

  return {
    field: "temp",
    label: "temperatura",
    shortLabel: "Temperatura",
    differenceTitle: "Differenza di temperatura",
    unit: "°C",
    positiveColor: "#dc2626",
    negativeColor: "#2563eb",
    positiveText: "Più caldo",
    negativeText: "Più freddo",
  };
}

function makeDeltaSeries({
  currentPairs,
  comparisonPairs,
  currentStartISO,
  comparisonStartISO,
  mode,
}) {
  const comparisonMap = new Map();

  for (const point of Array.isArray(comparisonPairs) ? comparisonPairs : []) {
    const timestamp = Number(point?.[0]);
    const value = n(point?.[1]);
    const key = relativeTimeKey(timestamp, comparisonStartISO, mode);

    if (key && Number.isFinite(value)) comparisonMap.set(key, value);
  }

  return (Array.isArray(currentPairs) ? currentPairs : []).map((point) => {
    const timestamp = Number(point?.[0]);
    const currentValue = n(point?.[1]);
    const key = relativeTimeKey(timestamp, currentStartISO, mode);
    const comparisonValue = key ? n(comparisonMap.get(key)) : NaN;

    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(currentValue) ||
      !Number.isFinite(comparisonValue)
    ) {
      return [timestamp, null];
    }

    return [timestamp, round1(currentValue - comparisonValue)];
  });
}

function movingAveragePairs(pairs, windowMinutes) {
  const source = Array.isArray(pairs) ? pairs : [];
  const windowMs = Number(windowMinutes) * 60 * 1000;

  if (!Number.isFinite(windowMs) || windowMs <= 0) return source;

  const halfWindow = windowMs / 2;
  const valid = source
    .map((point) => [Number(point?.[0]), n(point?.[1])])
    .filter(
      (point) =>
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]),
    );

  return source.map((point) => {
    const timestamp = Number(point?.[0]);
    const value = n(point?.[1]);

    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
      return [timestamp, null];
    }

    let sum = 0;
    let count = 0;

    for (const candidate of valid) {
      if (Math.abs(candidate[0] - timestamp) <= halfWindow) {
        sum += candidate[1];
        count += 1;
      }
    }

    return [timestamp, count ? round1(sum / count) : null];
  });
}

function anomalyWindowBounds(currentData, currentBounds, mode) {
  const rollingStart = n(currentData?.windowStartTimestamp);
  const rollingEnd = n(currentData?.latestTimestamp);

  const start =
    mode === "day"
      ? isoToLocalDate(currentBounds?.startISO, 0)?.getTime()
      : Number.isFinite(rollingStart)
        ? rollingStart
        : isoToLocalDate(currentBounds?.startISO, 0)?.getTime();

  const end =
    mode === "day"
      ? (isoToLocalDate(addDaysISO(currentBounds?.endISO, 1), 0)?.getTime() ?? 0) - 1
      : Number.isFinite(rollingEnd)
        ? rollingEnd
        : (isoToLocalDate(addDaysISO(currentBounds?.endISO, 1), 0)?.getTime() ?? 0) - 1;

  return { start, end };
}

function makePeriodAnomalySeries({
  currentData,
  climatologyData,
  currentBounds,
  mode,
  field,
}) {
  if (
    !currentData ||
    !climatologyData ||
    !currentBounds?.startISO ||
    !field
  ) {
    return { series: [], start: null, end: null };
  }

  const raw = makeDeltaSeries({
    currentPairs: currentData?.[field],
    comparisonPairs: climatologyData?.[field],
    currentStartISO: currentBounds.startISO,
    comparisonStartISO: currentBounds.startISO,
    mode,
  });

  const { start, end } = anomalyWindowBounds(
    currentData,
    currentBounds,
    mode,
  );

  const trimmed = trimTrailingNullPoints(raw);
  const filtered =
    Number.isFinite(start) && Number.isFinite(end)
      ? trimmed.filter((point) => {
          const timestamp = Number(point?.[0]);
          return (
            Number.isFinite(timestamp) &&
            timestamp >= start &&
            timestamp <= end
          );
        })
      : trimmed;

  const series =
    mode === "week"
      ? movingAveragePairs(filtered, 60)
      : mode === "month"
        ? movingAveragePairs(filtered, 180)
        : filtered;

  return { series, start, end };
}

function climatologyReferenceLabel(climatologyData) {
  const reference = String(climatologyData?.referencePeriod || "").trim();

  if (reference) {
    return `Climatologia ${reference.replace("-", "–")}`;
  }

  const years = (Array.isArray(climatologyData?.years)
    ? climatologyData.years
    : []
  )
    .map((year) => Number(year))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!years.length) return "Media storica";
  if (years.length === 1) return `Media storica ${years[0]}`;
  return `Media storica ${years[0]}–${years[years.length - 1]}`;
}

function anomalyIconType(groupKey) {
  if (groupKey === "temp") return "temperature";
  if (groupKey === "rh") return "humidity";
  if (groupKey === "press") return "pressure";
  return groupKey;
}

function splitDeltaSeriesBySign(pairs) {
  const positive = [];
  const negative = [];
  let previousValid = null;

  for (const point of Array.isArray(pairs) ? pairs : []) {
    const timestamp = Number(point?.[0]);
    const value = n(point?.[1]);

    if (!Number.isFinite(timestamp) || !Number.isFinite(value)) {
      positive.push([timestamp, null]);
      negative.push([timestamp, null]);
      previousValid = null;
      continue;
    }

    if (
      previousValid &&
      previousValid.value !== 0 &&
      value !== 0 &&
      Math.sign(previousValid.value) !== Math.sign(value)
    ) {
      const fraction =
        (0 - previousValid.value) / (value - previousValid.value);
      const zeroTimestamp =
        previousValid.timestamp +
        fraction * (timestamp - previousValid.timestamp);

      positive.push([zeroTimestamp, 0]);
      negative.push([zeroTimestamp, 0]);
    }

    positive.push([timestamp, value >= 0 ? value : null]);
    negative.push([timestamp, value <= 0 ? value : null]);

    previousValid = { timestamp, value };
  }

  return { positive, negative };
}

function deltaStatsFromSeries(pairs) {
  const values = seriesValues(pairs);

  if (!values.length) {
    return {
      count: 0,
      mean: null,
      max: null,
      maxTimestamp: null,
      min: null,
      minTimestamp: null,
      last: null,
      lastTimestamp: null,
      abovePercent: null,
      belowPercent: null,
    };
  }

  let total = 0;
  let aboveCount = 0;
  let belowCount = 0;
  let maxPoint = values[0];
  let minPoint = values[0];

  for (const point of values) {
    total += point.value;

    if (point.value > 0) aboveCount += 1;
    if (point.value < 0) belowCount += 1;

    if (point.value > maxPoint.value) maxPoint = point;
    if (point.value < minPoint.value) minPoint = point;
  }

  const signedCount = aboveCount + belowCount;
  const lastPoint = values[values.length - 1];

  return {
    count: values.length,
    mean: total / values.length,
    max: maxPoint.value,
    maxTimestamp: maxPoint.timestamp,
    min: minPoint.value,
    minTimestamp: minPoint.timestamp,
    last: lastPoint.value,
    lastTimestamp: lastPoint.timestamp,
    abovePercent: signedCount ? (aboveCount / signedCount) * 100 : 0,
    belowPercent: signedCount ? (belowCount / signedCount) * 100 : 0,
  };
}

function formatSignedDelta(value, unit) {
  const vv = n(value);
  if (!Number.isFinite(vv)) return "—";
  const sign = vv > 0 ? "+" : "";
  return `${sign}${vv.toFixed(1)} ${unit}`;
}

function deltaTone(value) {
  const vv = n(value);
  if (!Number.isFinite(vv) || vv === 0) return "neutral";
  return vv > 0 ? "positive" : "negative";
}

function symmetricAxisFromPairs(pairs) {
  const values = seriesValues(pairs).map((point) => Math.abs(point.value));
  const maxAbs = values.length ? Math.max(...values) : 0;

  if (!Number.isFinite(maxAbs) || maxAbs <= 0) {
    return { min: -1, max: 1, interval: 0.5 };
  }

  const interval = niceStep(maxAbs * 2, 6);
  const limit = Math.max(interval, Math.ceil(maxAbs / interval) * interval);

  return { min: -limit, max: limit, interval };
}

const intradayJsonCache = new Map();

async function fetchIntradayJson(
  dISO,
  forceRefresh = false,
  refreshToken = "",
) {
  if (!forceRefresh && intradayJsonCache.has(dISO)) {
    return intradayJsonCache.get(dISO);
  }

  const cacheBuster = forceRefresh
    ? `?v=${encodeURIComponent(String(refreshToken || Date.now()))}`
    : "";

  const request = fetch(
    `https://raw.githubusercontent.com/max-collinas1/climate-collinas1/main/public/data/intraday/${encodeURIComponent(dISO)}.json${cacheBuster}`,
    {
      cache: "no-store",
    },
  )
    .then(async (res) => {
      if (!res.ok) return null;
      const arr = await res.json();
      return Array.isArray(arr) ? arr : null;
    })
    .catch(() => null);

  if (!forceRefresh) intradayJsonCache.set(dISO, request);

  const result = await request;

  if (!result && !forceRefresh) {
    intradayJsonCache.delete(dISO);
  }

  return result;
}

function latestIntradayTimestamp(rows) {
  let latest = null;

  for (const row of Array.isArray(rows) ? rows : []) {
    const value = String(row?.t || "");
    const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/,
    );

    if (!match) continue;

    const timestamp = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      0,
      0,
    ).getTime();

    if (
      Number.isFinite(timestamp) &&
      (!Number.isFinite(latest) || timestamp > latest)
    ) {
      latest = timestamp;
    }
  }

  return Number.isFinite(latest) ? latest : null;
}

function rollingWindowDurationMs(mode) {
  if (mode === "week") return 7 * 24 * 60 * 60 * 1000;
  if (mode === "month") return 30 * 24 * 60 * 60 * 1000;
  return null;
}

async function loadIntradayPeriod({
  startISO,
  endISO,
  mode,
  availableDates,
  dailyRainByDate,
  refreshToken = "",
  forceRefreshEndDate = false,
}) {
  const datesSet = new Set(availableDates);
  const allPeriodDates = dateRangeISO(startISO, endISO);
  const datesToFetch = allPeriodDates.filter((iso) => datesSet.has(iso));
  const stepMinutes = mode === "month" ? 60 : 15;
  const timeline = makePeriodTimeline(startISO, endISO, stepMinutes);

  if (!timeline.length || !datesToFetch.length) {
    throw new Error("Non sono presenti dati intraday nel periodo selezionato.");
  }

  const buckets = new Map();
  for (const timestamp of timeline) {
    buckets.set(timestamp, {
      temp_sum: 0,
      temp_cnt: 0,
      rh_sum: 0,
      rh_cnt: 0,
      press_sum: 0,
      press_cnt: 0,
      wind_sum: 0,
      wind_cnt: 0,
      uv_sum: 0,
      uv_cnt: 0,
      solar_sum: 0,
      solar_cnt: 0,
      gust_max: -Infinity,
      dir_sin: 0,
      dir_cos: 0,
      dir_cnt: 0,
      observed: false,
    });
  }

  const dailyRainMap = new Map();
  let loadedDays = 0;
  let latestObservedTimestamp = null;
  const latestAvailableDate = availableDates[availableDates.length - 1];
  const futureToleranceMs = 5 * 60 * 1000;

  await Promise.all(
    datesToFetch.map(async (dISO) => {
      try {
        const shouldForceRefresh =
          dISO === latestAvailableDate ||
          (forceRefreshEndDate && dISO === endISO);

        const arr = await fetchIntradayJson(
          dISO,
          shouldForceRefresh,
          refreshToken,
        );

        if (!Array.isArray(arr)) return;

        loadedDays += 1;
        const bucketTotals = new Map();

        for (const r of arr) {
          const tt = r?.t ? String(r.t) : "";
          const match = tt.match(
            /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/,
          );
          if (!match) continue;

          const y = Number(match[1]);
          const mo = Number(match[2]);
          const da = Number(match[3]);
          const hh = Number(match[4]);
          const mi = Number(match[5]);

          const recordDate = new Date(y, mo - 1, da, hh, mi, 0, 0);
          const recordTimestamp = recordDate.getTime();

          if (
            dISO === latestAvailableDate &&
            recordTimestamp > Date.now() + futureToleranceMs
          ) {
            continue;
          }

          const bucketDate = new Date(recordDate);
          if (mode === "day" || mode === "week") {
            bucketDate.setMinutes(Math.floor(mi / 15) * 15, 0, 0);
          } else if (stepMinutes > 60) {
            const minutesFromMidnight = hh * 60 + mi;
            const roundedMinutes =
              Math.floor(minutesFromMidnight / stepMinutes) * stepMinutes;
            bucketDate.setHours(0, 0, 0, 0);
            bucketDate.setMinutes(roundedMinutes, 0, 0);
          } else {
            bucketDate.setMinutes(0, 0, 0);
          }

          const bucketTimestamp = bucketDate.getTime();
          const bucket = buckets.get(bucketTimestamp);
          if (!bucket) continue;

          bucket.observed = true;

          if (
            !Number.isFinite(latestObservedTimestamp) ||
            bucketTimestamp > latestObservedTimestamp
          ) {
            latestObservedTimestamp = bucketTimestamp;
          }

          const addMean = (keyBase, value) => {
            const vv = n(value);
            if (!Number.isFinite(vv)) return;
            bucket[`${keyBase}_sum`] += vv;
            bucket[`${keyBase}_cnt`] += 1;
          };

          addMean("temp", r?.temp_c);
          addMean("rh", r?.rh_pct);
          addMean("press", r?.press_hpa);
          addMean("wind", r?.wind_kmh);
          addMean("uv", r?.uv);
          addMean("solar", r?.solar_wm2);

          const gust = n(r?.gust_kmh);
          if (Number.isFinite(gust)) {
            bucket.gust_max = Math.max(bucket.gust_max, gust);
          }

          const rain = n(r?.rain_15m_mm);
          if (Number.isFinite(rain)) {
            bucketTotals.set(
              bucketTimestamp,
              (bucketTotals.get(bucketTimestamp) || 0) + rain,
            );
          }

          const direction = n(r?.wind_dir_deg);
          if (Number.isFinite(direction)) {
            const radians = (direction * Math.PI) / 180;
            bucket.dir_cos += Math.cos(radians);
            bucket.dir_sin += Math.sin(radians);
            bucket.dir_cnt += 1;
          }
        }

        dailyRainMap.set(dISO, bucketTotals);
      } catch {
      }
    }),
  );

  if (!loadedDays) {
    throw new Error("Non è stato possibile leggere i dati intraday del periodo.");
  }

  const adjustedRain = new Map();

  for (const dISO of datesToFetch) {
    const bucketTotals = dailyRainMap.get(dISO) || new Map();
    const rawTotal = Array.from(bucketTotals.values()).reduce(
      (acc, value) => acc + value,
      0,
    );

    const dailyValue = n(dailyRainByDate?.[dISO]);
    const isLatestDay = dISO === latestAvailableDate;
    const staleZero = isLatestDay && dailyValue === 0 && rawTotal > 0;
    const targetTotal =
      Number.isFinite(dailyValue) && !staleZero ? dailyValue : rawTotal;

    if (rawTotal > 0) {
      const ratio = targetTotal / rawTotal;
      for (const [timestamp, value] of bucketTotals.entries()) {
        adjustedRain.set(timestamp, value * ratio);
      }
    }
  }

  const mean = (sumValue, countValue) =>
    countValue > 0 ? sumValue / countValue : null;

  const temp = [];
  const rh = [];
  const press = [];
  const wind = [];
  const gust = [];
  const dirMean = [];
  const rainH = [];
  const rainCum = [];
  const uv = [];
  const solar = [];

  let cumulativeRain = 0;

  for (const timestamp of timeline) {
    const bucket = buckets.get(timestamp);
    const observed = Boolean(bucket?.observed);

    const tempValue = mean(bucket.temp_sum, bucket.temp_cnt);
    const rhValue = mean(bucket.rh_sum, bucket.rh_cnt);
    const pressValue = mean(bucket.press_sum, bucket.press_cnt);
    const windValue = mean(bucket.wind_sum, bucket.wind_cnt);
    const uvValue = mean(bucket.uv_sum, bucket.uv_cnt);
    const solarValue = mean(bucket.solar_sum, bucket.solar_cnt);
    const gustValue = Number.isFinite(bucket.gust_max)
      ? bucket.gust_max
      : null;

    let directionValue = null;
    if (bucket.dir_cnt > 0) {
      const radians = Math.atan2(
        bucket.dir_sin / bucket.dir_cnt,
        bucket.dir_cos / bucket.dir_cnt,
      );
      directionValue = (radians * 180) / Math.PI;
      if (directionValue < 0) directionValue += 360;
    }

    const rainValue = Number(adjustedRain.get(timestamp) || 0);
    if (observed) cumulativeRain += rainValue;

    temp.push([timestamp, tempValue === null ? null : round1(tempValue)]);
    rh.push([timestamp, rhValue === null ? null : round1(rhValue)]);
    press.push([timestamp, pressValue === null ? null : round1(pressValue)]);
    wind.push([timestamp, windValue === null ? null : round1(windValue)]);
    gust.push([timestamp, gustValue === null ? null : round1(gustValue)]);
    dirMean.push([
      timestamp,
      directionValue === null ? null : round1(directionValue),
    ]);
    rainH.push([timestamp, observed ? round1(rainValue) : null]);
    rainCum.push([timestamp, observed ? round1(cumulativeRain) : null]);
    uv.push([timestamp, uvValue === null ? null : round1(uvValue)]);
    solar.push([timestamp, solarValue === null ? null : round1(solarValue)]);
  }

  const durationMs = rollingWindowDurationMs(mode);
  const exactEndTimestamp = Number.isFinite(latestObservedTimestamp)
    ? latestObservedTimestamp
    : null;
  const exactStartTimestamp =
    Number.isFinite(durationMs) && Number.isFinite(exactEndTimestamp)
      ? exactEndTimestamp - durationMs
      : null;

  const trimPairs = (pairs) => {
    if (!Number.isFinite(exactStartTimestamp) || !Number.isFinite(exactEndTimestamp)) {
      return pairs;
    }

    return pairs.filter((point) => {
      const timestamp = Number(point?.[0]);
      return (
        Number.isFinite(timestamp) &&
        timestamp >= exactStartTimestamp &&
        timestamp <= exactEndTimestamp
      );
    });
  };

  const trimmedRainH = trimPairs(rainH);
  let rollingRainTotal = 0;
  const trimmedRainCum = trimmedRainH.map((point) => {
    const timestamp = Number(point?.[0]);
    const value = n(point?.[1]);

    if (Number.isFinite(value)) rollingRainTotal += value;

    return [
      timestamp,
      Number.isFinite(value) ? round1(rollingRainTotal) : null,
    ];
  });

  return {
    temp: trimPairs(temp),
    rh: trimPairs(rh),
    press: trimPairs(press),
    wind: trimPairs(wind),
    gust: trimPairs(gust),
    dirMean: trimPairs(dirMean),
    rainH: trimmedRainH,
    rainCum: trimmedRainCum,
    rainTotal: round1(rollingRainTotal),
    uv: trimPairs(uv),
    solar: trimPairs(solar),
    loadedDays,
    requestedDays: datesToFetch.length,
    latestTimestamp: exactEndTimestamp,
    windowStartTimestamp: exactStartTimestamp,
  };
}

// -----------------------------------------------------------------------------
// Climatologia pluviometrica 1991–2020 di Collinas.
//
// Per il grafico "Oggi" NON viene mostrato alcun riferimento climatologico,
// perché la ricostruzione storica è giornaliera e non intragiornaliera.
//
// Per "Ultimi 7 giorni" e "Ultimi 30 giorni" vengono invece costruite,
// usando i 30 anni giornalieri ricostruiti:
//   - media climatologica cumulata;
//   - fascia centrale 50% (P25–P75);
//   - fascia centrale 80% (P10–P90).
//
// Il file atteso è:
// /public/climatologia/precipitazioni/daily-history.json
// -----------------------------------------------------------------------------

let precipitationHistoryCache = null;
let precipitationHistoryPromise = null;

async function loadFixedPrecipitationHistory() {
  if (precipitationHistoryCache) {
    return precipitationHistoryCache;
  }

  if (precipitationHistoryPromise) {
    return precipitationHistoryPromise;
  }

  precipitationHistoryPromise = fetch(
    "/climatologia/precipitazioni/daily-history.json",
    { cache: "force-cache" },
  )
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(
          "Serie pluviometrica climatica 1991–2020 non disponibile sul sito.",
        );
      }

      const payload = await response.json();
      const years = payload?.years;

      if (!years || typeof years !== "object" || Array.isArray(years)) {
        throw new Error(
          "Formato non valido della serie pluviometrica climatica.",
        );
      }

      precipitationHistoryCache = payload;
      return payload;
    })
    .finally(() => {
      precipitationHistoryPromise = null;
    });

  return precipitationHistoryPromise;
}

function historicalPrecipitationValue(
  years,
  syntheticYear,
  monthDay,
) {
  const yearData = years?.[String(syntheticYear)];
  if (!yearData) return null;

  const direct = n(yearData?.[monthDay]);
  if (Number.isFinite(direct)) return direct;

  // Gestione del 29 febbraio quando il corrispondente anno storico
  // non è bisestile: media semplice tra 28/02 e 01/03.
  if (monthDay === "02-29") {
    const feb28 = n(yearData?.["02-28"]);
    const mar01 = n(yearData?.["03-01"]);

    if (Number.isFinite(feb28) && Number.isFinite(mar01)) {
      return (feb28 + mar01) / 2;
    }
  }

  return null;
}

function historicalPrecipitationBetween({
  years,
  baseYear,
  actualPeriodStart,
  startTimestamp,
  endTimestamp,
}) {
  let cursor = Number(startTimestamp);
  const end = Number(endTimestamp);
  const periodStart = new Date(Number(actualPeriodStart));

  if (
    !Number.isFinite(cursor) ||
    !Number.isFinite(end) ||
    !Number.isFinite(periodStart.getTime()) ||
    end <= cursor
  ) {
    return null;
  }

  let total = 0;
  let safety = 0;

  while (cursor < end && safety < 64) {
    const d = new Date(cursor);

    const dayStart = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      0,
      0,
      0,
      0,
    );

    const nextDay = new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate() + 1,
      0,
      0,
      0,
      0,
    );

    const segmentEnd = Math.min(end, nextDay.getTime());
    const dayDuration = nextDay.getTime() - dayStart.getTime();

    const yearOffset =
      d.getFullYear() - periodStart.getFullYear();

    const syntheticYear =
      Number(baseYear) + yearOffset;

    const monthDay =
      `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

    const dailyRain = historicalPrecipitationValue(
      years,
      syntheticYear,
      monthDay,
    );

    if (!Number.isFinite(dailyRain) || dayDuration <= 0) {
      return null;
    }

    // La ricostruzione storica è giornaliera.
    // Per il SOLO disegno della cumulata il totale del giorno viene
    // distribuito linearmente nelle 24 ore: così la curva è progressiva
    // e non presenta scalini artificiali.
    const fraction = Math.max(
      0,
      Math.min(
        1,
        (segmentEnd - cursor) / dayDuration,
      ),
    );

    total += dailyRain * fraction;
    cursor = segmentEnd;
    safety += 1;
  }

  return total;
}

function makePrecipitationPeriodClimatology({
  historyPayload,
  currentPairs,
  mode,
}) {
  if (!["week", "month"].includes(mode)) return null;

  const years = historyPayload?.years;
  if (!years || typeof years !== "object") return null;

  const points = (Array.isArray(currentPairs) ? currentPairs : [])
    .map((point) => [Number(point?.[0]), n(point?.[1])])
    .filter((point) => Number.isFinite(point[0]))
    .sort((a, b) => a[0] - b[0]);

  if (points.length < 2) return null;

  const actualPeriodStart = points[0][0];

  const baseYears = Object.keys(years)
    .map((year) => Number(year))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!baseYears.length) return null;

  const trajectories = [];

  for (const baseYear of baseYears) {
    const series = [];
    let cumulative = 0;
    let valid = true;
    let previousTimestamp = points[0][0];

    series.push([previousTimestamp, 0]);

    for (let i = 1; i < points.length; i += 1) {
      const timestamp = points[i][0];

      const increment = historicalPrecipitationBetween({
        years,
        baseYear,
        actualPeriodStart,
        startTimestamp: previousTimestamp,
        endTimestamp: timestamp,
      });

      if (!Number.isFinite(increment)) {
        valid = false;
        break;
      }

      cumulative += increment;
      series.push([timestamp, cumulative]);
      previousTimestamp = timestamp;
    }

    if (valid && series.length === points.length) {
      trajectories.push(series);
    }
  }

  if (!trajectories.length) return null;

  const mean = [];
  const median = [];
  const p10 = [];
  const p25 = [];
  const p75 = [];
  const p90 = [];

  for (let i = 0; i < points.length; i += 1) {
    const timestamp = points[i][0];

    const values = trajectories
      .map((series) => n(series?.[i]?.[1]))
      .filter(Number.isFinite);

    if (!values.length) {
      mean.push([timestamp, null]);
      median.push([timestamp, null]);
      p10.push([timestamp, null]);
      p25.push([timestamp, null]);
      p75.push([timestamp, null]);
      p90.push([timestamp, null]);
      continue;
    }

    mean.push([
      timestamp,
      round1(avgFinite(values)),
    ]);

    median.push([
      timestamp,
      round1(percentileFinite(values, 0.50)),
    ]);

    p10.push([
      timestamp,
      round1(percentileFinite(values, 0.10)),
    ]);

    p25.push([
      timestamp,
      round1(percentileFinite(values, 0.25)),
    ]);

    p75.push([
      timestamp,
      round1(percentileFinite(values, 0.75)),
    ]);

    p90.push([
      timestamp,
      round1(percentileFinite(values, 0.90)),
    ]);
  }

  const finalTotals = trajectories
    .map((series) =>
      n(series?.[series.length - 1]?.[1]),
    )
    .filter(Number.isFinite);

  return {
    // rainCum resta la MEDIA: viene usata dal grafico Anomalia.
    rainCum: mean,

    // Nel grafico principale della pioggia usiamo invece la MEDIANA,
    // coerente con le fasce percentile.
    rainCumMedian: median,

    rainCumP10: p10,
    rainCumP25: p25,
    rainCumP75: p75,
    rainCumP90: p90,
    finalTotals,
    periodCount: trajectories.length,
    years: baseYears,
    referencePeriod:
      String(historyPayload?.referencePeriod || "1991-2020"),
    source: "fixed-precipitation-history",
  };
}

const FIXED_CLIMATOLOGY_CONFIG = {
  temp: {
    folder: "temperatura",
    field: "temp",
    label: "termica",
    source: "fixed-temperature-climatology",
  },
  rh: {
    folder: "umidita",
    field: "rh",
    label: "dell’umidità",
    source: "fixed-humidity-climatology",
  },
  wind: {
    folder: "vento",
    field: "wind",
    label: "del vento",
    source: "fixed-wind-climatology",
  },
};

async function loadFixedScalarClimatologyPeriod(groupKey, currentPairs) {
  const config = FIXED_CLIMATOLOGY_CONFIG[groupKey];
  const points = Array.isArray(currentPairs) ? currentPairs : [];

  if (!config) {
    throw new Error("Parametro climatologico non supportato.");
  }

  if (!points.length) {
    throw new Error(
      `Nessun dato disponibile per il confronto con la climatologia ${config.label}.`,
    );
  }

  const response = await fetch(
    `/climatologia/${config.folder}/intraday-climatology.json`,
    { cache: "force-cache" },
  );

  if (!response.ok) {
    throw new Error(
      `Climatologia ${config.label} 1991–2020 non disponibile sul sito.`,
    );
  }

  const payload = await response.json();

  const valueAt = (timestamp, key) => {
    const d = new Date(Number(timestamp));
    if (!Number.isFinite(d.getTime())) return null;

    const mmdd = `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const slot = d.getHours() * 4 + Math.floor(d.getMinutes() / 15);
    const values = payload?.[mmdd]?.[key];
    const value = n(Array.isArray(values) ? values[slot] : null);

    return Number.isFinite(value) ? value : null;
  };

  const toPairs = (key) =>
    points.map((point) => {
      const timestamp = Number(point?.[0]);
      return [timestamp, valueAt(timestamp, key)];
    });

  return {
    [config.field]: toPairs("n"),
    [`${config.field}P10`]: toPairs("p10"),
    [`${config.field}P25`]: toPairs("p25"),
    [`${config.field}P75`]: toPairs("p75"),
    [`${config.field}P90`]: toPairs("p90"),
    sampleCounts: {
      [config.field]: points.map((point) => [Number(point?.[0]), 30]),
    },
    periodCount: 30,
    years: ["1991–2020"],
    referencePeriod: "1991-2020",
    source: config.source,
  };
}

function fixedClimateSeries(climatologyData, field) {
  const read = (suffix = "") => {
    const values = climatologyData?.[`${field}${suffix}`];
    return Array.isArray(values) ? values : [];
  };

  const mean = read();
  const p10 = read("P10");
  const p25 = read("P25");
  const p75 = read("P75");
  const p90 = read("P90");

  const hasFinite = (pairs) =>
    pairs.some((point) => Number.isFinite(n(point?.[1])));

  const bandDelta = (lowerPairs, upperPairs) =>
    lowerPairs.map((point, index) => {
      const timestamp = Number(point?.[0]);
      const lower = n(point?.[1]);
      const upper = n(upperPairs?.[index]?.[1]);

      if (
        !Number.isFinite(timestamp) ||
        !Number.isFinite(lower) ||
        !Number.isFinite(upper)
      ) {
        return [timestamp, null];
      }

      return [timestamp, Math.max(0, upper - lower)];
    });

  const meanAvailable = hasFinite(mean);
  const band50Available = hasFinite(p25) && hasFinite(p75);
  const band80Available = hasFinite(p10) && hasFinite(p90);

  return {
    mean,
    p10,
    p25,
    p75,
    p90,
    meanAvailable,
    band50Available,
    band80Available,
    band50Delta: band50Available ? bandDelta(p25, p75) : [],
    band80Delta: band80Available ? bandDelta(p10, p90) : [],
  };
}

function fixedClimateBandSeries({
  climate,
  stackPrefix,
  yAxisIndex = 0,
  band50Label = "Fascia 50%",
  band80Label = "Fascia 80%",
}) {
  const series = [];

  if (climate.band80Available) {
    series.push(
      {
        name: `__${stackPrefix}-p10-base`,
        type: "line",
        data: trimTrailingNullPoints(climate.p10),
        yAxisIndex,
        stack: `${stackPrefix}-band-80`,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { width: 0, opacity: 0 },
        areaStyle: { opacity: 0 },
        itemStyle: { opacity: 0 },
        emphasis: { disabled: true },
        z: 0,
      },
      {
        name: band80Label,
        type: "line",
        data: trimTrailingNullPoints(climate.band80Delta),
        yAxisIndex,
        stack: `${stackPrefix}-band-80`,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { width: 0, opacity: 0 },
        areaStyle: {
          color: "rgba(148, 163, 184, 0.16)",
          opacity: 1,
        },
        itemStyle: { color: "rgba(148, 163, 184, 0.20)" },
        emphasis: { disabled: true },
        z: 0,
      },
    );
  }

  if (climate.band50Available) {
    series.push(
      {
        name: `__${stackPrefix}-p25-base`,
        type: "line",
        data: trimTrailingNullPoints(climate.p25),
        yAxisIndex,
        stack: `${stackPrefix}-band-50`,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { width: 0, opacity: 0 },
        areaStyle: { opacity: 0 },
        itemStyle: { opacity: 0 },
        emphasis: { disabled: true },
        z: 1,
      },
      {
        name: band50Label,
        type: "line",
        data: trimTrailingNullPoints(climate.band50Delta),
        yAxisIndex,
        stack: `${stackPrefix}-band-50`,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        silent: true,
        tooltip: { show: false },
        lineStyle: { width: 0, opacity: 0 },
        areaStyle: {
          color: "rgba(71, 85, 105, 0.24)",
          opacity: 1,
        },
        itemStyle: { color: "rgba(71, 85, 105, 0.30)" },
        emphasis: { disabled: true },
        z: 1,
      },
    );
  }

  return series;
}


function SummaryParameterIcon({ type }) {
  if (type === "temperature") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 14.6V5a2 2 0 1 1 4 0v9.6a4.5 4.5 0 1 1-4 0Z" />
        <path d="M12 8v8" />
      </svg>
    );
  }

  if (type === "humidity") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3.2S6.7 9.1 6.7 14a5.3 5.3 0 0 0 10.6 0C17.3 9.1 12 3.2 12 3.2Z" />
      </svg>
    );
  }

  if (type === "rain") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M7.2 15.2h9.3a3.5 3.5 0 0 0 .3-7A5 5 0 0 0 7.3 7a4.1 4.1 0 0 0-.1 8.2Z" />
        <path d="m8.5 18-1 2M12.5 18l-1 2M16.5 18l-1 2" />
      </svg>
    );
  }

  if (type === "wind") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 8h10.5a2.5 2.5 0 1 0-2.3-3.4" />
        <path d="M3 12h15a2.5 2.5 0 1 1-2.3 3.4" />
        <path d="M3 16h7" />
      </svg>
    );
  }

  if (type === "pressure") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 17a7 7 0 1 1 14 0" />
        <path d="m12 12 4-3" />
        <path d="M7 18h10" />
      </svg>
    );
  }

  if (type === "solar") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
      <path d="M9.2 12.2h5.6" />
    </svg>
  );
}

function PeriodSummary({ data, mode }) {
  const items = useMemo(() => {
    if (!data) return [];

    const tempStats = seriesStats(data.temp);
    const rhStats = seriesStats(data.rh);
    const windStats = seriesStats(data.wind);
    const gustStats = seriesStats(data.gust);
    const pressStats = seriesStats(data.press);
    const solarStats = seriesStats(data.solar);
    const uvStats = seriesStats(data.uv);

    const metric = (label, value, detail = "") => ({
      label,
      value,
      detail,
    });

    return [
      {
        key: "temperature",
        label: "Temperatura",
        mainLabel: "Media",
        value: `${fmt(tempStats.mean, 1)} °C`,
        metrics: [
          metric(
            "Min",
            `${fmt(tempStats.min, 1)} °C`,
            formatSummaryTimestamp(tempStats.minTimestamp, mode),
          ),
          metric(
            "Max",
            `${fmt(tempStats.max, 1)} °C`,
            formatSummaryTimestamp(tempStats.maxTimestamp, mode),
          ),
        ],
      },
      {
        key: "humidity",
        label: "Umidità",
        mainLabel: "Media",
        value: `${fmt(rhStats.mean, 1)} %`,
        metrics: [
          metric("Min", `${fmt(rhStats.min, 1)} %`),
          metric("Max", `${fmt(rhStats.max, 1)} %`),
        ],
      },
      {
        key: "rain",
        label: "Precipitazioni",
        mainLabel: "Totale",
        value: `${fmt(data.rainTotal, 1)} mm`,
        description: "Cumulata del periodo",
        metrics: [],
      },
      {
        key: "wind",
        label: "Vento",
        mainLabel: "Media",
        value: `${fmt(windStats.mean, 1)} km/h`,
        metrics: [
          metric(
            "Max",
            `${fmt(windStats.max, 1)} km/h`,
            formatSummaryTimestamp(windStats.maxTimestamp, mode),
          ),
          metric(
            "Raffica",
            `${fmt(gustStats.max, 1)} km/h`,
            formatSummaryTimestamp(gustStats.maxTimestamp, mode),
          ),
        ],
      },
      {
        key: "pressure",
        label: "Pressione",
        mainLabel: "Media",
        value: `${fmt(pressStats.mean, 1)} hPa`,
        metrics: [
          metric("Min", `${fmt(pressStats.min, 1)} hPa`),
          metric("Max", `${fmt(pressStats.max, 1)} hPa`),
        ],
      },
      {
        key: "solar",
        label: "Rad. solare",
        mainLabel: "Media",
        value: `${fmt(solarStats.mean, 0)} W/m²`,
        metrics: [
          metric(
            "Max",
            `${fmt(solarStats.max, 0)} W/m²`,
            formatSummaryTimestamp(solarStats.maxTimestamp, mode),
          ),
        ],
      },
      {
        key: "uv",
        label: "Indice UV",
        mainLabel: "Media",
        value: fmt(uvStats.mean, 1),
        metrics: [
          metric(
            "Max",
            fmt(uvStats.max, 1),
            formatSummaryTimestamp(uvStats.maxTimestamp, mode),
          ),
        ],
      },
    ];
  }, [data, mode]);

  if (!items.length) return null;

  return (
    <section className="summarySection" aria-label="Riepilogo del periodo">
      <div className="summaryGrid">
        {items.map((item) => (
          <div className={`summaryCell ${item.key}`} key={item.key}>
            <span className="summaryLabel">{item.label}</span>

            <div className="summaryCore">
              <span className="summaryIcon">
                <SummaryParameterIcon type={item.key} />
              </span>

              <div className="summaryMain">
                <strong>{item.value}</strong>
                <small>{item.mainLabel}</small>
              </div>
            </div>

            {item.description ? (
              <div className="summaryDescription">{item.description}</div>
            ) : null}

            {item.metrics.length > 0 && (
              <div
                className={`summaryMetrics ${
                  item.metrics.length === 1 ? "oneMetric" : ""
                }`}
              >
                {item.metrics.map((entry) => (
                  <div className="summaryMetric" key={`${item.key}-${entry.label}`}>
                    <span>{entry.label}</span>
                    <b>{entry.value}</b>
                    {entry.detail ? <small>{entry.detail}</small> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <style jsx>{`
        .summarySection {
          padding: 18px 20px 16px;
          background: #fff;
        }

        .summaryGrid {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 10px;
        }

        .summaryCell {
          --card-top: #2563eb;
          --card-bottom: #0f4fa7;
          position: relative;
          min-width: 0;
          min-height: 188px;
          padding: 14px 12px 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 16px;
          background:
            radial-gradient(140px 90px at 76% 5%, rgba(255, 255, 255, 0.16), transparent 66%),
            linear-gradient(160deg, var(--card-top), var(--card-bottom));
          color: #fff;
          text-align: center;
          box-shadow:
            0 9px 18px rgba(15, 23, 42, 0.11),
            inset 0 1px 0 rgba(255, 255, 255, 0.19);
          overflow: hidden;
        }

        .summaryCell.temperature {
          --card-top: #ff6a00;
          --card-bottom: #c93600;
        }

        .summaryCell.humidity {
          --card-top: #2cb9c7;
          --card-bottom: #078493;
        }

        .summaryCell.rain {
          --card-top: #2196ef;
          --card-bottom: #0861b8;
        }

        .summaryCell.wind {
          --card-top: #9a56e8;
          --card-bottom: #6331b8;
        }

        .summaryCell.pressure {
          --card-top: #2b7bc4;
          --card-bottom: #074480;
        }

        .summaryCell.solar {
          --card-top: #ffad0b;
          --card-bottom: #d77700;
        }

        .summaryCell.uv {
          --card-top: #9a4ce2;
          --card-bottom: #5d2da8;
        }

        .summaryLabel {
          width: 100%;
          min-height: 28px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          overflow: hidden;
          font-size: 10px;
          font-weight: 950;
          line-height: 1.15;
          text-transform: uppercase;
          letter-spacing: 0.025em;
          text-overflow: ellipsis;
        }

        .summaryCore {
          width: 100%;
          margin-top: 4px;
          display: grid;
          justify-items: center;
          gap: 7px;
        }

        .summaryIcon {
          width: 43px;
          height: 43px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.11);
          color: #fff;
        }

        .summaryIcon :global(svg) {
          width: 28px;
          height: 28px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.75;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .summaryMain {
          min-width: 0;
          display: grid;
          justify-items: center;
          gap: 1px;
        }

        .summaryMain strong {
          max-width: 100%;
          overflow: hidden;
          font-size: clamp(16px, 1.35vw, 22px);
          font-weight: 950;
          line-height: 1.02;
          letter-spacing: -0.025em;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .summaryMain small {
          font-size: 9px;
          font-weight: 800;
          color: rgba(255, 255, 255, 0.88);
        }

        .summaryDescription {
          min-height: 38px;
          margin-top: auto;
          padding: 10px 4px 2px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-top: 1px solid rgba(255, 255, 255, 0.26);
          font-size: 8.5px;
          font-weight: 750;
          line-height: 1.3;
          color: rgba(255, 255, 255, 0.9);
        }

        .summaryMetrics {
          width: 100%;
          margin-top: auto;
          padding-top: 9px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 4px;
          border-top: 1px solid rgba(255, 255, 255, 0.28);
        }

        .summaryMetrics.oneMetric {
          grid-template-columns: 1fr;
        }

        .summaryMetric {
          min-width: 0;
          display: grid;
          justify-items: center;
          gap: 1px;
        }

        .summaryMetric + .summaryMetric {
          border-left: 1px solid rgba(255, 255, 255, 0.2);
        }

        .summaryMetric span {
          font-size: 7.5px;
          font-weight: 750;
          color: rgba(255, 255, 255, 0.78);
        }

        .summaryMetric b {
          max-width: 100%;
          overflow: hidden;
          font-size: 9.5px;
          font-weight: 950;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .summaryMetric small {
          font-size: 7px;
          font-weight: 750;
          color: rgba(255, 255, 255, 0.72);
        }

        @media (max-width: 1180px) {
          .summaryGrid {
            overflow-x: auto;
            grid-template-columns: repeat(7, minmax(175px, 1fr));
            scrollbar-width: thin;
            padding-bottom: 5px;
          }

          .summaryCell {
            min-height: 180px;
          }
        }

        @media (max-width: 720px) {
          .summarySection {
            padding: 9px 8px 10px;
          }

          .summaryGrid {
            grid-template-columns: repeat(7, 120px);
            gap: 7px;
            padding-bottom: 3px;
            scroll-snap-type: x proximity;
          }

          .summaryCell {
            min-height: 120px;
            padding: 7px 7px 6px;
            border-radius: 12px;
            scroll-snap-align: start;
          }

          .summaryLabel {
            min-height: 17px;
            font-size: 7.5px;
            line-height: 1.05;
          }

          .summaryCore {
            margin-top: 1px;
            gap: 3px;
          }

          .summaryIcon {
            width: 22px;
            height: 22px;
            border-width: 1px;
          }

          .summaryIcon :global(svg) {
            width: 13px;
            height: 13px;
            stroke-width: 1.6;
          }

          .summaryMain strong {
            font-size: 14px;
          }

          .summaryMain small {
            font-size: 7px;
          }

          .summaryDescription {
            min-height: 27px;
            padding: 6px 2px 0;
            font-size: 6.8px;
            line-height: 1.15;
          }

          .summaryMetrics {
            padding-top: 6px;
            gap: 2px;
          }

          .summaryMetric span {
            font-size: 6px;
          }

          .summaryMetric b {
            font-size: 7.5px;
          }

          .summaryMetric small {
            font-size: 5.8px;
          }
        }
      `}</style>
    </section>
  );
}

function ResponsivePeriodEChart({ option, height, chartKey }) {
  const chartRef = useRef(null);
  const shellRef = useRef(null);

  useEffect(() => {
    let frame = null;
    const timers = [];

    const resizeChart = () => {
      if (frame !== null) cancelAnimationFrame(frame);

      frame = requestAnimationFrame(() => {
        const shell = shellRef.current;
        const chart = chartRef.current?.getEchartsInstance?.();

        if (!shell || !chart) return;

        const width = Math.floor(shell.getBoundingClientRect().width);
        if (!Number.isFinite(width) || width <= 0) return;

        chart.resize({
          width,
          height,
          silent: true,
        });
      });
    };

    resizeChart();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(resizeChart);
      if (shellRef.current) observer.observe(shellRef.current);

      timers.push(
        window.setTimeout(resizeChart, 60),
        window.setTimeout(resizeChart, 220),
        window.setTimeout(resizeChart, 600),
      );

      window.addEventListener("resize", resizeChart, { passive: true });
      window.addEventListener("orientationchange", resizeChart, { passive: true });

      return () => {
        observer.disconnect();
        timers.forEach((timer) => window.clearTimeout(timer));
        window.removeEventListener("resize", resizeChart);
        window.removeEventListener("orientationchange", resizeChart);
        if (frame !== null) cancelAnimationFrame(frame);
      };
    }

    timers.push(
      window.setTimeout(resizeChart, 60),
      window.setTimeout(resizeChart, 220),
      window.setTimeout(resizeChart, 600),
    );

    window.addEventListener("resize", resizeChart, { passive: true });
    window.addEventListener("orientationchange", resizeChart, { passive: true });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", resizeChart);
      window.removeEventListener("orientationchange", resizeChart);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [chartKey, height, option]);

  return (
    <div
      ref={shellRef}
      className="responsiveEChartShell"
      style={{ width: "100%", minWidth: 0, overflow: "hidden" }}
    >
      <ReactECharts
        key={chartKey}
        ref={chartRef}
        option={option}
        style={{
          height,
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
        }}
        notMerge={true}
        lazyUpdate={true}
      />
    </div>
  );
}

function ClimatologyChart({
  mode,
  groupKey,
  currentData,
  climatologyData,
  currentBounds,
  loading,
  error,
  isMobile,
  isVeryNarrow,
  chartHeight,
}) {
  const meta = useMemo(() => deltaMetaForGroup(groupKey), [groupKey]);

  const prepared = useMemo(
    () =>
      makePeriodAnomalySeries({
        currentData,
        climatologyData,
        currentBounds,
        mode,
        field: meta.field,
      }),
    [
      climatologyData,
      currentBounds,
      currentData,
      meta.field,
      mode,
    ],
  );

  const plotAnomalySeries = prepared.series;
  const chartReferenceStart = prepared.start;
  const chartReferenceEnd = prepared.end;

  const validAnomalyCount = useMemo(
    () => seriesValues(plotAnomalySeries).length,
    [plotAnomalySeries],
  );

  const splitSeries = useMemo(
    () => splitDeltaSeriesBySign(plotAnomalySeries),
    [plotAnomalySeries],
  );

  const anomalyTitle =
    mode === "week"
      ? "Anomalia ultimi 7 giorni"
      : mode === "month"
        ? "Anomalia ultimi 30 giorni"
        : "Anomalia giornaliera";

  const chartDateReference = formatChartDateReference(
    mode,
    chartReferenceStart,
    chartReferenceEnd,
    currentBounds?.endISO,
  );

  const option = useMemo(() => {
    if (!validAnomalyCount) return null;

    const axis = symmetricAxisFromPairs(plotAnomalySeries);
    const dayBoundaryMarkLine = makeDailyBoundaryMarkLine(
      mode,
      chartReferenceStart,
      chartReferenceEnd,
    );
    const boundaryData = Array.isArray(dayBoundaryMarkLine?.data)
      ? dayBoundaryMarkLine.data
      : [];

    return {
      animation: true,
      animationDuration: 250,
      animationDurationUpdate: 250,
      title: {
        text: anomalyTitle,
        subtext: chartDateReference,
        left: "center",
        top: isMobile ? 5 : 10,
        itemGap: isMobile ? 3 : 4,
        textStyle: {
          fontSize: isMobile ? 17 : 18,
          fontWeight: 800,
          lineHeight: isMobile ? 20 : 22,
          color: "#0f172a",
        },
        subtextStyle: {
          fontSize: isMobile ? 9 : 10,
          fontWeight: 650,
          color: "#64748b",
        },
      },
      toolbox: makeChartToolbox({
        filename: `meteo-collinas-anomalia-${mode}-${groupKey}`,
        isMobile,
      }),
      dataZoom: makePeriodDataZoom(),
      grid: isMobile
        ? {
            // Stesse dimensioni interne del grafico temperatura su mobile.
            left: isVeryNarrow ? 46 : 50,
            right: 12,
            top: 88,
            bottom: 78,
            containLabel: false,
            show: true,
            borderWidth: 0,
            backgroundColor: "rgba(248, 250, 252, 0.52)",
          }
        : {
            left: 68,
            right: 30,
            top: 80,
            bottom: ["temp", "rain", "wind"].includes(groupKey) ? 82 : 42,
            show: true,
            borderWidth: 0,
            backgroundColor: "rgba(248, 250, 252, 0.52)",
          },
      tooltip: {
        trigger: "axis",
        triggerOn: "mousemove|click",
        confine: true,
        backgroundColor: "rgba(255, 255, 255, 0.98)",
        borderColor: "#dbe3ec",
        borderWidth: 1,
        padding: [9, 11],
        extraCssText:
          "border-radius:10px;box-shadow:0 10px 28px rgba(15,23,42,.12);",
        textStyle: {
          color: "#0f172a",
          fontSize: 11,
          fontWeight: 650,
        },
        axisPointer: {
          type: "line",
          snap: true,
          label: { show: false },
          lineStyle: {
            type: "dashed",
            width: 1.2,
            color: "rgba(100, 116, 139, 0.55)",
          },
        },
        formatter: (params) => {
          const axisTimestamp = Number(
            params?.[0]?.axisValue ?? params?.[0]?.data?.[0],
          );
          const validPoints = seriesValues(plotAnomalySeries);

          if (!validPoints.length) return "";

          let selectedPoint = validPoints[0];

          if (Number.isFinite(axisTimestamp)) {
            let bestDistance = Infinity;

            for (const point of validPoints) {
              const distance = Math.abs(point.timestamp - axisTimestamp);

              if (distance < bestDistance) {
                bestDistance = distance;
                selectedPoint = point;
              }
            }
          }

          const value = selectedPoint.value;
          const time = formatSummaryTimestamp(selectedPoint.timestamp, mode);
          const markerColor =
            value > 0
              ? meta.positiveColor
              : value < 0
                ? meta.negativeColor
                : "rgba(15, 23, 42, 0.55)";

          return (
            `${time}<br/>` +
            `<span style="display:inline-block;margin-right:6px;border-radius:50%;width:9px;height:9px;background:${markerColor};"></span>` +
            `Scarto dalla climatologia: ${formatSignedDelta(value, meta.unit)}`
          );
        },
      },
      xAxis: {
        type: "time",
        min: chartReferenceStart,
        max: chartReferenceEnd,
        splitNumber:
          mode === "day"
            ? 8
            : mode === "week"
              ? 7
              : mode === "month"
                ? 10
                : undefined,
        axisLine: {
          show: true,
          lineStyle: {
            color: "#cbd5e1",
            width: 1,
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          hideOverlap: true,
          fontSize: isMobile ? 10 : 11,
          fontWeight: 650,
          color: "#64748b",
          margin: isMobile ? 8 : 10,
          formatter:
            mode === "day"
              ? "{HH}:{mm}"
              : {
                  year: "{dd}/{MM}",
                  month: "{dd}/{MM}",
                  day: "{dd}/{MM}",
                  hour: "{HH}:{mm}",
                  minute: "{HH}:{mm}",
                  second: "{HH}:{mm}",
                  millisecond: "{HH}:{mm}",
                  none: "{dd}/{MM}",
                },
        },
      },
      yAxis: {
        type: "value",
        name: `Δ ${meta.unit}`,
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: isMobile ? 34 : 42,
        min: axis.min,
        max: axis.max,
        interval: axis.interval,
        nameTextStyle: {
          fontSize: isMobile ? 10 : 11,
          fontWeight: 700,
          color: "#64748b",
        },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: isMobile ? 10 : 11,
          fontWeight: 650,
          color: "#64748b",
          formatter: (value) => {
            const vv = Number(value);
            return `${vv > 0 ? "+" : ""}${vv.toFixed(1)}`;
          },
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: "rgba(148, 163, 184, 0.24)",
            type: "dashed",
            width: 1,
          },
        },
        splitNumber: 6,
      },
      series: [
        {
          name: "Sopra climatologia",
          type: "line",
          data: splitSeries.positive,
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          sampling: "lttb",
          lineStyle: {
            width: 2.3,
            color: meta.positiveColor,
          },
          itemStyle: {
            color: meta.positiveColor,
          },
          emphasis: {
            focus: "series",
          },
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            data: [
              {
                yAxis: 0,
                lineStyle: {
                  width: 1.2,
                  type: "dashed",
                  color: "rgba(15, 23, 42, 0.42)",
                },
              },
              ...boundaryData.map((item) => ({
                ...item,
                lineStyle: {
                  color: "rgba(148, 163, 184, 0.18)",
                  width: 1,
                  type: "solid",
                },
              })),
            ],
          },
        },
        {
          name: "Sotto climatologia",
          type: "line",
          data: splitSeries.negative,
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          sampling: "lttb",
          lineStyle: {
            width: 2.3,
            color: meta.negativeColor,
          },
          itemStyle: {
            color: meta.negativeColor,
          },
          emphasis: {
            focus: "series",
          },
        },
      ],
    };
  }, [
    anomalyTitle,
    chartDateReference,
    chartReferenceEnd,
    chartReferenceStart,
    groupKey,
    isMobile,
    isVeryNarrow,
    meta.negativeColor,
    meta.positiveColor,
    meta.unit,
    mode,
    plotAnomalySeries,
    splitSeries.negative,
    splitSeries.positive,
    validAnomalyCount,
  ]);

  return (
    <div className="chartArea">
      {loading && <div className="msg">Calcolo scarto climatologico…</div>}
      {!loading && error && <div className="msg">{error}</div>}
      {!loading && !error && !validAnomalyCount && (
        <div className="msg">
          Non ci sono intervalli sufficienti per calcolare lo scarto.
        </div>
      )}
      {!loading && !error && option && (
        <ResponsivePeriodEChart
          option={option}
          height={chartHeight}
          chartKey={`anomaly-${mode}-${groupKey}-${isMobile ? "mobile" : "desktop"}`}
        />
      )}

      <style jsx>{`
        .chartArea {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 100%;
          min-width: 0;
          min-height: 0;
          padding: 0;
          box-sizing: border-box;
          overflow: hidden;
          background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
        }

        .responsiveEChartShell {
          width: 100%;
          max-width: 100%;
          min-width: 0;
          overflow: hidden;
        }

        .msg {
          min-height: 390px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          text-align: center;
          font-size: 12px;
          color: rgba(15, 23, 42, 0.66);
          font-weight: 850;
        }

        @media (max-width: 720px) {
          .chartArea {
            min-height: 0;
            padding: 0;
            overflow: hidden;
          }

          .msg {
            min-height: 225px;
          }
        }
      `}</style>
    </div>
  );
}

function AnomalySummaryPanel({
  mode,
  groupKey,
  currentData,
  climatologyData,
  currentBounds,
}) {
  const referenceLabel = climatologyReferenceLabel(climatologyData);
  const iconType = anomalyIconType(groupKey);

  if (groupKey === "rain") {
    const lastValue = (pairs) => {
      const values = seriesValues(pairs);
      return values.length ? n(values[values.length - 1]?.value) : NaN;
    };

    const observed = lastValue(currentData?.rainCum);
    const climateMean = lastValue(climatologyData?.rainCum);
    const climateMedian = lastValue(climatologyData?.rainCumMedian);
    const climateP10 = lastValue(climatologyData?.rainCumP10);
    const climateP90 = lastValue(climatologyData?.rainCumP90);

    if (!Number.isFinite(observed) || !Number.isFinite(climateMean)) {
      return null;
    }

    const anomaly = observed - climateMean;
    const anomalyPct =
      climateMean > 0 ? (anomaly / climateMean) * 100 : null;

    const totals = (Array.isArray(climatologyData?.finalTotals)
      ? climatologyData.finalTotals
      : []
    )
      .map(n)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    let percentile = null;

    if (totals.length) {
      const below = totals.filter((value) => value < observed).length;
      const equal = totals.filter((value) => value === observed).length;

      percentile =
        ((below + equal * 0.5) / totals.length) * 100;
    }

    const percentileRounded = Number.isFinite(percentile)
      ? Math.max(0, Math.min(100, Math.round(percentile)))
      : null;

    const markerPosition = Number.isFinite(percentileRounded)
      ? Math.max(2, Math.min(98, percentileRounded))
      : 50;

    const percentileText =
      !Number.isFinite(percentileRounded)
        ? "—"
        : percentileRounded <= 20
          ? "Molto secco"
          : percentileRounded <= 40
            ? "Più secco del normale"
            : percentileRounded < 60
              ? "Nella norma"
              : percentileRounded < 80
                ? "Più piovoso del normale"
                : "Molto piovoso";

    const percentileExplanation =
      !Number.isFinite(percentileRounded)
        ? "—"
        : percentileRounded < 50
          ? `Più secco del ${100 - percentileRounded}% degli anni`
          : percentileRounded > 50
            ? `Più piovoso del ${percentileRounded}% degli anni`
            : "In linea con la climatologia";

    const tone =
      Number.isFinite(percentileRounded) && percentileRounded < 40
        ? "dry"
        : Number.isFinite(percentileRounded) && percentileRounded >= 60
          ? "wet"
          : "normal";

    return (
      <section
        className={`rainClimateSummary ${tone}`}
        aria-label="Riepilogo climatologico precipitazioni"
        style={{ "--rain-position": `${markerPosition}%` }}
      >
        <div className="rainTop">
          <div className="rainTitle">
            <span className="rainIcon" aria-hidden="true">
              <SummaryParameterIcon type={iconType} />
            </span>
            <span>Precipitazioni cumulate</span>
            <i aria-hidden="true">·</i>
            <strong>{referenceLabel}</strong>
          </div>

          <div className="rainPercentile">
            <strong>{percentileText}</strong>
            <span>{percentileExplanation}</span>
            <small>
              {Number.isFinite(percentileRounded)
                ? `${percentileRounded}° percentile`
                : "Percentile —"}
            </small>
          </div>
        </div>

        <div className="rainBody">
          <div className="rainDistribution">
            <div className="rainTrack">
              <span className="tick p10" aria-hidden="true" />
              <span className="tick p50" aria-hidden="true" />
              <span className="tick p90" aria-hidden="true" />
              <span className="current" aria-hidden="true" />
            </div>

            <div className="rainLabels">
              <div>
                <strong>
                  {Number.isFinite(climateP10)
                    ? `${climateP10.toFixed(1)} mm`
                    : "—"}
                </strong>
                <span>P10</span>
              </div>

              <div>
                <strong>
                  {Number.isFinite(climateMedian)
                    ? `${climateMedian.toFixed(1)} mm`
                    : "—"}
                </strong>
                <span>Mediana</span>
              </div>

              <div>
                <strong>
                  {Number.isFinite(climateP90)
                    ? `${climateP90.toFixed(1)} mm`
                    : "—"}
                </strong>
                <span>P90</span>
              </div>
            </div>
          </div>

          <div className="rainMetrics">
            <div>
              <strong>{observed.toFixed(1)} mm</strong>
              <span>Osservata</span>
            </div>

            <div>
              <strong>{climateMean.toFixed(1)} mm</strong>
              <span>Media climatica</span>
            </div>

            <div className={`rainAnomalyMetric ${anomaly < 0 ? "dryMetric" : "wetMetric"}`}>
              <strong>{formatSignedDelta(anomaly, "mm")}</strong>
              <small>
                {Number.isFinite(anomalyPct)
                  ? `${anomalyPct > 0 ? "+" : ""}${anomalyPct.toFixed(0)}%`
                  : "—"}
              </small>
              <span>Rispetto alla media</span>
            </div>
          </div>
        </div>

        <style jsx>{`
          .rainClimateSummary {
            margin: -7px 20px 14px;
            padding: 9px 13px 10px;
            border: 1px solid #dce5ef;
            border-left: 4px solid #64748b;
            border-radius: 15px;
            background: linear-gradient(180deg, #fff, #fbfdff);
            box-shadow: 0 6px 18px rgba(15, 23, 42, 0.035);
          }

          .rainClimateSummary.dry {
            border-left-color: #d97706;
          }

          .rainClimateSummary.wet {
            border-left-color: #0284c7;
          }

          .rainTop {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 14px;
            min-width: 0;
          }

          .rainTitle {
            display: flex;
            align-items: center;
            gap: 6px;
            min-width: 0;
            color: #52637d;
            font-size: 8px;
            font-weight: 950;
            letter-spacing: .04em;
            text-transform: uppercase;
            white-space: nowrap;
          }

          .rainTitle strong {
            color: #0f172a;
            font-size: 10px;
            text-transform: none;
          }

          .rainTitle i {
            color: #94a3b8;
            font-style: normal;
          }

          .rainIcon {
            width: 21px;
            height: 21px;
            flex: 0 0 21px;
            display: grid;
            place-items: center;
            border-radius: 7px;
            background: #eff6ff;
            color: #0284c7;
          }

          .dry .rainIcon {
            background: #fff7ed;
            color: #d97706;
          }

          .rainIcon :global(svg) {
            width: 13px;
            height: 13px;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.8;
            stroke-linecap: round;
            stroke-linejoin: round;
          }

          .rainPercentile {
            min-width: 0;
            display: grid;
            justify-items: end;
            gap: 1px;
            white-space: nowrap;
            text-align: right;
          }

          .rainPercentile strong {
            color: #334155;
            font-size: 14px;
            line-height: 1;
            font-weight: 950;
          }

          .rainPercentile span {
            color: #475569;
            font-size: 8px;
            font-weight: 900;
          }

          .rainPercentile small {
            color: #94a3b8;
            font-size: 6.5px;
            font-weight: 850;
            text-transform: uppercase;
            letter-spacing: .03em;
          }

          .dry .rainPercentile strong {
            color: #d97706;
          }

          .wet .rainPercentile strong {
            color: #0284c7;
          }

          .rainBody {
            margin-top: 8px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) 300px;
            align-items: center;
            gap: 18px;
          }

          .rainDistribution {
            min-width: 0;
          }

          .rainTrack {
            position: relative;
            height: 10px;
            border-radius: 999px;
            background: linear-gradient(
              90deg,
              #f59e0b 0%,
              #f8c471 20%,
              #e2e8f0 50%,
              #93c5fd 80%,
              #0284c7 100%
            );
            box-shadow: inset 0 0 0 1px rgba(148, 163, 184, .2);
          }

          .tick,
          .current {
            position: absolute;
            top: 50%;
            transform: translate(-50%, -50%);
            border-radius: 999px;
          }

          .tick {
            width: 2px;
            height: 16px;
            background: #475569;
            opacity: .62;
          }

          .p10 { left: 10%; }
          .p50 { left: 50%; }
          .p90 { left: 90%; }

          .current {
            left: var(--rain-position);
            width: 15px;
            height: 15px;
            background: #fff;
            border: 4px solid #64748b;
            box-shadow: 0 0 0 2px rgba(255,255,255,.9);
          }

          .dry .current { border-color: #d97706; }
          .wet .current { border-color: #0284c7; }

          .rainLabels {
            margin-top: 5px;
            display: grid;
            grid-template-columns: repeat(3, 1fr);
          }

          .rainLabels div {
            display: grid;
            gap: 0;
            text-align: center;
          }

          .rainLabels div:first-child {
            text-align: left;
          }

          .rainLabels div:last-child {
            text-align: right;
          }

          .rainLabels strong {
            color: #334155;
            font-size: 8px;
            font-weight: 950;
            white-space: nowrap;
          }

          .rainLabels span {
            color: #64748b;
            font-size: 6.5px;
            font-weight: 900;
            text-transform: uppercase;
          }

          .rainMetrics {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 7px;
          }

          .rainMetrics div {
            min-width: 0;
            padding: 6px 8px;
            border: 1px solid #e2e8f0;
            border-radius: 9px;
            background: rgba(255,255,255,.82);
            display: grid;
            gap: 2px;
          }

          .rainMetrics strong {
            color: #0f172a;
            font-size: 13px;
            font-weight: 950;
            white-space: nowrap;
          }

          .rainMetrics span {
            color: #64748b;
            font-size: 6.5px;
            font-weight: 900;
            text-transform: uppercase;
          }

          .rainAnomalyMetric small {
            font-size: 10px;
            line-height: 1;
            font-weight: 950;
          }

          .dryMetric strong,
          .dryMetric small { color: #d97706; }

          .wetMetric strong,
          .wetMetric small { color: #0284c7; }

          @media (max-width: 700px) {
            .rainClimateSummary {
              margin: -5px 8px 10px;
              padding: 8px;
              border-radius: 12px;
            }

            .rainTop {
              align-items: flex-start;
              gap: 8px;
            }

            .rainTitle {
              flex-wrap: wrap;
              gap: 4px;
              font-size: 6.5px;
              white-space: normal;
            }

            .rainTitle strong {
              font-size: 8px;
            }

            .rainPercentile {
              display: grid;
              justify-items: end;
              gap: 1px;
            }

            .rainPercentile strong {
              font-size: 11px;
            }

            .rainPercentile span {
              max-width: 150px;
              font-size: 6.8px;
              white-space: normal;
              text-align: right;
              line-height: 1.1;
            }

            .rainPercentile small {
              font-size: 5.8px;
            }

            .rainBody {
              margin-top: 9px;
              grid-template-columns: 1fr;
              gap: 8px;
            }

            .rainLabels strong {
              font-size: 7px;
            }

            .rainMetrics {
              gap: 5px;
            }

            .rainMetrics div {
              padding: 5px 4px;
              text-align: center;
            }

            .rainMetrics strong {
              font-size: 10.5px;
            }

            .rainAnomalyMetric small {
              font-size: 9px;
            }

            .rainMetrics span {
              font-size: 5.8px;
            }
          }

          @media (max-width: 430px) {
            .rainTitle span {
              display: none;
            }

            .rainMetrics {
              grid-template-columns: 1fr 1fr;
            }

            .rainMetrics div:last-child {
              grid-column: 1 / -1;
            }
          }
        `}</style>
      </section>
    );
  }

  const meta = deltaMetaForGroup(groupKey);

  const prepared = makePeriodAnomalySeries({
    currentData,
    climatologyData,
    currentBounds,
    mode,
    field: meta.field,
  });

  const stats = deltaStatsFromSeries(prepared.series);

  if (!stats.count) return null;

  const scaleMin = Math.min(0, n(stats.min));
  const scaleMax = Math.max(0, n(stats.max));
  const scaleRange = scaleMax - scaleMin || 1;
  const clampPercent = (value) =>
    Math.max(0, Math.min(100, ((value - scaleMin) / scaleRange) * 100));

  const zeroPosition = clampPercent(0);
  const meanPosition = clampPercent(n(stats.mean));
  const minPosition = clampPercent(n(stats.min));
  const maxPosition = clampPercent(n(stats.max));
  const allPositive = n(stats.min) >= 0 && n(stats.max) > 0;
  const allNegative = n(stats.max) <= 0 && n(stats.min) < 0;
  const oneSided = allPositive || allNegative;
  const zeroLabelTooClose =
    oneSided ||
    Math.abs(zeroPosition - minPosition) < 14 ||
    Math.abs(maxPosition - zeroPosition) < 14;
  const staggerExtremeLabels =
    oneSided && Math.abs(maxPosition - minPosition) < 22;

  const labelStyleForPosition = (position) => {
    const safePosition = Math.max(0, Math.min(100, Number(position) || 0));

    if (safePosition <= 8) {
      return {
        left: `${safePosition}%`,
        transform: "translateX(0)",
        justifyItems: "start",
      };
    }

    if (safePosition >= 92) {
      return {
        left: `${safePosition}%`,
        transform: "translateX(-100%)",
        justifyItems: "end",
      };
    }

    return {
      left: `${safePosition}%`,
      transform: "translateX(-50%)",
      justifyItems: "center",
    };
  };

  const above = Math.round(n(stats.abovePercent));
  const below = Math.round(n(stats.belowPercent));
  return (
    <section
      className={`anomalySummary ${deltaTone(stats.mean)}`}
      aria-label={`Riepilogo anomalia ${meta.label}`}
      style={{
        "--positive": meta.positiveColor,
        "--negative": meta.negativeColor,
        "--zero-position": `${zeroPosition}%`,
        "--mean-position": `${meanPosition}%`,
        "--min-position": `${minPosition}%`,
        "--max-position": `${maxPosition}%`,
        "--above": `${Number.isFinite(above) ? above : 0}%`,
        "--below": `${Number.isFinite(below) ? below : 0}%`,
      }}
    >
      <div className="anomalyMain">
        <div className="anomalyScale">
          <div className="anomalyHeader">
            <span className="anomalyIcon" aria-hidden="true">
              <SummaryParameterIcon type={iconType} />
            </span>
            <div className="anomalyHeaderText">
              <span>Anomalia {meta.label}</span>
              <i aria-hidden="true">·</i>
              <strong>{referenceLabel}</strong>
            </div>
          </div>

          <div className="meanBadge">
            <span>Anomalia media</span>
            <strong>{formatSignedDelta(stats.mean, meta.unit)}</strong>
            <i aria-hidden="true" />
          </div>

          <div className="scaleTrack">
            <span className="zeroMarker" aria-hidden="true" />
            <span className="meanMarker" aria-hidden="true" />
            <span className="minDot" aria-hidden="true" />
            <span className="maxDot" aria-hidden="true" />
          </div>

          <div
            className={`scaleLabels ${staggerExtremeLabels ? "staggered" : ""}`}
          >
            <div
              className="minLabel"
              style={labelStyleForPosition(minPosition)}
            >
              <strong>{formatSignedDelta(stats.min, meta.unit)}</strong>
              <span>Scarto minimo</span>
            </div>

            {!zeroLabelTooClose && (
              <div
                className="zeroLabel"
                style={labelStyleForPosition(zeroPosition)}
              >
                <strong>0 {meta.unit}</strong>
                <span>Media climatica</span>
              </div>
            )}

            <div
              className="maxLabel"
              style={labelStyleForPosition(maxPosition)}
            >
              <strong>{formatSignedDelta(stats.max, meta.unit)}</strong>
              <span>Scarto massimo</span>
            </div>
          </div>
        </div>
      </div>

      <div className="anomalyTime">
        <div className="timeMetric above">
          <strong>{Number.isFinite(above) ? `${above}%` : "—"}</strong>
          <span>Tempo sopra climatologia</span>
          <i><b /></i>
        </div>
        <div className="timeMetric below">
          <strong>{Number.isFinite(below) ? `${below}%` : "—"}</strong>
          <span>Tempo sotto climatologia</span>
          <i><b /></i>
        </div>
      </div>

      <style jsx>{`
        .anomalySummary {
          margin: -7px 20px 14px;
          min-width: 0;
          min-height: 88px;
          padding: 8px 14px;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 220px;
          align-items: stretch;
          gap: 14px;
          border: 1px solid #dce5ef;
          border-left: 4px solid var(--positive);
          border-radius: 15px;
          background:
            radial-gradient(520px 100px at 50% -60%, rgba(37, 99, 235, 0.045), transparent 72%),
            linear-gradient(180deg, #ffffff, #fbfdff);
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.035);
        }

        .anomalySummary.negative {
          border-left-color: var(--negative);
        }

        .anomalyMain {
          min-width: 0;
          padding-right: 14px;
          border-right: 1px solid #e5ebf1;
        }

        .anomalyHeader {
          position: absolute;
          left: 2px;
          top: 0;
          z-index: 4;
          min-width: 0;
          max-width: 42%;
          height: 20px;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .anomalyIcon {
          width: 20px;
          height: 20px;
          flex: 0 0 20px;
          display: grid;
          place-items: center;
          border-radius: 7px;
          background: color-mix(in srgb, var(--positive) 10%, white);
          color: var(--positive);
        }

        .negative .anomalyIcon {
          background: color-mix(in srgb, var(--negative) 10%, white);
          color: var(--negative);
        }

        .anomalyIcon :global(svg) {
          width: 13px;
          height: 13px;
          fill: none;
          stroke: currentColor;
          stroke-width: 1.8;
          stroke-linecap: round;
          stroke-linejoin: round;
        }

        .anomalyHeaderText {
          min-width: 0;
          display: flex;
          align-items: baseline;
          gap: 6px;
          overflow: hidden;
          white-space: nowrap;
        }

        .anomalyHeaderText span {
          color: #64748b;
          font-size: 7px;
          font-weight: 950;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .anomalyHeaderText i {
          color: #94a3b8;
          font-size: 9px;
          font-style: normal;
          font-weight: 900;
        }

        .anomalyHeaderText strong {
          overflow: hidden;
          color: #0f172a;
          font-size: 9.5px;
          font-weight: 950;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .anomalyScale {
          position: relative;
          min-width: 0;
          padding: 35px 4px 12px;
        }

        .meanBadge {
          position: absolute;
          left: var(--mean-position);
          top: 18px;
          z-index: 4;
          display: flex;
          align-items: baseline;
          gap: 4px;
          color: var(--positive);
          text-align: center;
          transform: translateX(-50%);
          white-space: nowrap;
        }

        .negative .meanBadge {
          color: var(--negative);
        }

        .meanBadge span {
          font-size: 6.8px;
          font-weight: 900;
        }

        .meanBadge strong {
          font-size: 11.5px;
          font-weight: 950;
          line-height: 1;
        }

        .meanBadge i {
          position: absolute;
          left: 50%;
          top: calc(100% + 1px);
          width: 0;
          height: 0;
          border-left: 4px solid transparent;
          border-right: 4px solid transparent;
          border-top: 5px solid currentColor;
          transform: translateX(-50%);
        }

        .scaleTrack {
          position: relative;
          height: 10px;
          border-radius: 999px;
          background:
            linear-gradient(
              90deg,
              var(--negative) 0%,
              #dbeafe var(--zero-position),
              #fee2e2 var(--zero-position),
              var(--positive) 100%
            );
          box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.12);
        }

        .zeroMarker {
          position: absolute;
          left: var(--zero-position);
          top: -6px;
          width: 2px;
          height: 23px;
          border-radius: 999px;
          background: #334155;
          transform: translateX(-50%);
        }

        .meanMarker,
        .minDot,
        .maxDot {
          position: absolute;
          top: 50%;
          border-radius: 50%;
          transform: translate(-50%, -50%);
        }

        .meanMarker {
          left: var(--mean-position);
          z-index: 3;
          width: 16px;
          height: 16px;
          border: 3px solid #fff;
          background: var(--positive);
          box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.12);
        }

        .negative .meanMarker {
          background: var(--negative);
        }

        .minDot,
        .maxDot {
          width: 14px;
          height: 14px;
        }

        .minDot {
          left: var(--min-position);
          border: 2px solid color-mix(in srgb, var(--negative) 30%, white);
          background: var(--negative);
        }

        .maxDot {
          left: var(--max-position);
          border: 2px solid color-mix(in srgb, var(--positive) 30%, white);
          background: var(--positive);
        }

        .scaleLabels {
          position: relative;
          min-height: 20px;
          margin-top: 4px;
        }

        .scaleLabels > div {
          position: absolute;
          top: 0;
          display: grid;
          gap: 0;
          max-width: 92px;
        }

        .scaleLabels.staggered {
          min-height: 36px;
        }

        .scaleLabels.staggered .maxLabel {
          top: 16px;
        }

        .scaleLabels strong {
          color: #0f172a;
          font-size: 9px;
          font-weight: 950;
          line-height: 1.05;
          white-space: nowrap;
        }

        .scaleLabels span {
          color: #64748b;
          font-size: 6.5px;
          font-weight: 850;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          white-space: nowrap;
        }

        .minLabel,
        .maxLabel,
        .zeroLabel {
          min-width: max-content;
        }

        .anomalyTime {
          min-width: 0;
          display: grid;
          align-content: center;
          gap: 7px;
        }

        .timeMetric {
          display: grid;
          grid-template-columns: 48px minmax(0, 1fr);
          align-items: center;
          gap: 0 9px;
        }

        .timeMetric strong {
          grid-row: 1 / span 2;
          min-width: 44px;
          font-size: 17px;
          font-weight: 950;
          line-height: 1;
          text-align: right;
        }

        .timeMetric span {
          align-self: end;
          overflow: hidden;
          color: #64748b;
          font-size: 6.8px;
          font-weight: 900;
          text-transform: uppercase;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .timeMetric i {
          align-self: start;
          height: 5px;
          margin-top: 2px;
          overflow: hidden;
          border-radius: 999px;
          background: #e9eef4;
        }

        .timeMetric b {
          display: block;
          height: 100%;
          border-radius: inherit;
        }

        .timeMetric.above strong {
          color: var(--positive);
        }

        .timeMetric.above b {
          width: var(--above);
          background: var(--positive);
        }

        .timeMetric.below strong {
          color: var(--negative);
        }

        .timeMetric.below b {
          width: var(--below);
          background: var(--negative);
        }

        @media (max-width: 1050px) {
          .anomalySummary {
            grid-template-columns: minmax(0, 1fr) 190px;
            gap: 11px;
          }

          .anomalyMain {
            padding-right: 11px;
          }

          .timeMetric {
            grid-template-columns: 42px minmax(0, 1fr);
            gap: 0 7px;
          }

          .timeMetric strong {
            font-size: 15px;
          }
        }

        @media (max-width: 760px) {
          .anomalySummary {
            margin: -2px 10px 12px;
            min-height: 0;
            padding: 10px;
            grid-template-columns: 1fr;
            gap: 9px;
          }

          .anomalyMain {
            padding: 0 0 9px;
            border-right: 0;
            border-bottom: 1px solid #e5ebf1;
          }

          .anomalyHeader {
            position: relative;
            left: auto;
            top: auto;
            max-width: 100%;
            height: 22px;
            margin-bottom: 2px;
          }

          .anomalyScale {
            padding: 20px 4px 20px;
          }

          .meanBadge {
            top: 3px;
          }

          .anomalyTime {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 10px;
          }

          .timeMetric {
            grid-template-columns: 42px minmax(0, 1fr);
          }

          .timeMetric span {
            white-space: normal;
          }
        }

        @media (max-width: 430px) {
          .anomalyHeaderText {
            gap: 4px;
          }

          .anomalyHeaderText span {
            font-size: 6.8px;
          }

          .anomalyHeaderText strong {
            font-size: 9px;
          }

          .meanBadge strong {
            font-size: 10.5px;
          }

          .scaleLabels > div {
            max-width: 72px;
          }

          .scaleLabels strong {
            font-size: 8.2px;
          }

          .scaleLabels span {
            font-size: 5.7px;
          }

          .scaleLabels.staggered {
            min-height: 34px;
          }

          .scaleLabels.staggered .maxLabel {
            top: 15px;
          }

          .zeroLabel span {
            display: none;
          }
        }
      `}</style>
    </section>
  );
}

function PeriodChart({ intradayDates = [], dailyRainByDate = {} }) {
  const GROUPS = useMemo(
    () => [
      { key: "temp", label: "Temperatura" },
      { key: "rain", label: "Precipitazioni" },
      { key: "rh", label: "Umidità" },
      { key: "wind", label: "Vento" },
      { key: "press", label: "Pressione" },
      { key: "uv", label: "Indice UV" },
      { key: "solar", label: "Radiazione solare" },
    ],
    [],
  );

  const PERIODS = useMemo(
    () => [
      { key: "day", label: "Oggi" },
      { key: "week", label: "Ultimi 7 giorni" },
      { key: "month", label: "Ultimi 30 giorni" },
    ],
    [],
  );

  const availableDates = useMemo(
    () =>
      Array.from(
        new Set(
          (Array.isArray(intradayDates) ? intradayDates : []).filter((iso) =>
            /^\d{4}-\d{2}-\d{2}$/.test(String(iso)),
          ),
        ),
      ).sort(),
    [intradayDates],
  );

  const [mode, setMode] = useState("day");
  const [groupKey, setGroupKey] = useState("temp");
  const [chartView, setChartView] = useState("observed");
  const [selectedDate, setSelectedDate] = useState(
    availableDates.length ? availableDates[availableDates.length - 1] : null,
  );
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [climatologyLoading, setClimatologyLoading] = useState(false);
  const [err, setErr] = useState("");
  const [climatologyError, setClimatologyError] = useState("");
  const [data, setData] = useState(null);
  const [climatologyData, setClimatologyData] = useState(null);
  const [precipHistoryData, setPrecipHistoryData] = useState(null);
  const [precipHistoryLoading, setPrecipHistoryLoading] = useState(false);
  const [precipHistoryError, setPrecipHistoryError] = useState("");
  const [viewportWidth, setViewportWidth] = useState(1280);
  const currentPeriodKeyRef = useRef("");
  const latestDataTimestampRef = useRef(null);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);

    updateViewportWidth();
    window.addEventListener("resize", updateViewportWidth, { passive: true });

    return () => window.removeEventListener("resize", updateViewportWidth);
  }, []);

  useEffect(() => {
    if (!availableDates.length) {
      setSelectedDate(null);
      return;
    }

    setSelectedDate((current) => {
      if (current && availableDates.includes(current)) return current;
      return availableDates[availableDates.length - 1];
    });
  }, [availableDates]);

  const bounds = useMemo(
    () => getPeriodBounds(mode, selectedDate),
    [mode, selectedDate],
  );

  const periodTitle = useMemo(() => {
    if (mode === "week") return "Grafico ultimi 7 giorni";
    if (mode === "month") return "Grafico ultimi 30 giorni";
    return "Grafico giornaliero";
  }, [mode]);

  const dataTitle = useMemo(() => {
    if (mode === "week") return "Dati ultimi 7 giorni";
    if (mode === "month") return "Dati ultimi 30 giorni";
    return "Dati giornalieri";
  }, [mode]);

  const periodLabel = useMemo(
    () => formatPeriodLabel(mode, selectedDate),
    [mode, selectedDate],
  );

  const isMobileChart = viewportWidth <= 720;
  const isVeryNarrowChart = viewportWidth <= 430;
  const latestAvailableDate = availableDates.length
    ? availableDates[availableDates.length - 1]
    : null;

  useEffect(() => {
    if (
      mode !== "day" ||
      !latestAvailableDate ||
      selectedDate !== latestAvailableDate
    ) {
      return undefined;
    }

    let alive = true;
    let checking = false;

    const checkForNewObservation = async () => {
      if (!alive || checking || document.visibilityState !== "visible") {
        return;
      }

      checking = true;

      try {
        const rows = await fetchIntradayJson(
          latestAvailableDate,
          true,
          `live-check-${Date.now()}`,
        );
        const latestTimestamp = latestIntradayTimestamp(rows);
        const currentTimestamp = Number(latestDataTimestampRef.current);

        if (
          Number.isFinite(latestTimestamp) &&
          Number.isFinite(currentTimestamp) &&
          latestTimestamp > currentTimestamp
        ) {
          setRefreshTick((value) => value + 1);
        }
      } finally {
        checking = false;
      }
    };

    const handleFocus = () => {
      checkForNewObservation();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkForNewObservation();
      }
    };

    const timer = window.setInterval(
      checkForNewObservation,
      60 * 1000,
    );

    window.addEventListener("focus", handleFocus);
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [latestAvailableDate, mode, selectedDate]);

  const showRealtimePulse =
    mode === "day" && selectedDate === latestAvailableDate;

  const fixedClimatologyConfig =
    FIXED_CLIMATOLOGY_CONFIG[groupKey] || null;

  const supportsFixedClimatology =
    !!fixedClimatologyConfig &&
    ["day", "week", "month"].includes(mode);

  const supportsRainClimatology =
    groupKey === "rain" &&
    ["week", "month"].includes(mode);

  const supportsClimatology =
    supportsFixedClimatology ||
    supportsRainClimatology;

  useEffect(() => {
    if (!supportsClimatology && chartView !== "observed") {
      setChartView("observed");
    }
  }, [chartView, supportsClimatology]);

  const changeMode = (nextMode) => {
    setMode(nextMode);

    if (nextMode === "day" && latestAvailableDate) {
      setSelectedDate(latestAvailableDate);
      setRefreshTick((value) => value + 1);
    }
  };

  useEffect(() => {
    let alive = true;

    async function run() {
      const requestKey = `${mode}:${bounds.startISO}:${bounds.endISO}`;
      const silentRefresh =
        currentPeriodKeyRef.current === requestKey &&
        Number(refreshTick) > 0;

      if (!silentRefresh) {
        setErr("");
        setData(null);
      }

      if (!selectedDate || !bounds.startISO || !bounds.endISO) {
        setLoading(false);
        setErr("Nessun file intraday disponibile.");
        return;
      }

      if (!silentRefresh) setLoading(true);

      try {
        const result = await loadIntradayPeriod({
          startISO: bounds.startISO,
          endISO: bounds.endISO,
          mode,
          availableDates,
          dailyRainByDate,
          refreshToken: `current-${refreshTick}-${Date.now()}`,
        });

        if (alive) {
          setData(result);
          currentPeriodKeyRef.current = requestKey;

          if (
            mode === "day" &&
            selectedDate === latestAvailableDate &&
            Number.isFinite(Number(result?.latestTimestamp))
          ) {
            latestDataTimestampRef.current = Number(result.latestTimestamp);
          }
        }
      } catch (error) {
        if (alive && !silentRefresh) {
          setErr(
            error?.message ||
              "Errore nel caricamento o nella lettura dei JSON intraday.",
          );
        }
      } finally {
        if (alive && !silentRefresh) setLoading(false);
      }
    }

    run();

    return () => {
      alive = false;
    };
  }, [
    availableDates,
    bounds.endISO,
    bounds.startISO,
    dailyRainByDate,
    latestAvailableDate,
    mode,
    refreshTick,
    selectedDate,
  ]);

  useEffect(() => {
    let alive = true;

    const config = fixedClimatologyConfig;
    const currentPairs = config ? data?.[config.field] : null;

    if (
      !supportsFixedClimatology ||
      !config ||
      !selectedDate ||
      !bounds.startISO ||
      !bounds.endISO ||
      !Array.isArray(currentPairs) ||
      !currentPairs.length
    ) {
      setClimatologyError("");
      setClimatologyData(null);
      setClimatologyLoading(false);

      return () => {
        alive = false;
      };
    }

    async function runClimatology() {
      setClimatologyError("");
      setClimatologyData(null);
      setClimatologyLoading(true);

      try {
        const result = await loadFixedScalarClimatologyPeriod(
          groupKey,
          currentPairs,
        );

        if (alive) {
          setClimatologyData(result);
        }
      } catch (error) {
        if (alive) {
          setClimatologyError(
            error?.message ||
              `Non è stato possibile caricare la climatologia ${config.label}.`,
          );
        }
      } finally {
        if (alive) {
          setClimatologyLoading(false);
        }
      }
    }

    runClimatology();

    return () => {
      alive = false;
    };
  }, [
    bounds.endISO,
    bounds.startISO,
    data,
    fixedClimatologyConfig,
    groupKey,
    mode,
    selectedDate,
    supportsFixedClimatology,
  ]);

  useEffect(() => {
    let alive = true;

    if (!supportsRainClimatology) {
      setPrecipHistoryError("");
      setPrecipHistoryLoading(false);

      return () => {
        alive = false;
      };
    }

    async function runPrecipitationHistory() {
      setPrecipHistoryError("");
      setPrecipHistoryLoading(true);

      try {
        const result = await loadFixedPrecipitationHistory();

        if (alive) {
          setPrecipHistoryData(result);
        }
      } catch (error) {
        if (alive) {
          setPrecipHistoryData(null);
          setPrecipHistoryError(
            error?.message ||
              "Non è stato possibile caricare la climatologia pluviometrica.",
          );
        }
      } finally {
        if (alive) {
          setPrecipHistoryLoading(false);
        }
      }
    }

    runPrecipitationHistory();

    return () => {
      alive = false;
    };
  }, [supportsRainClimatology]);

  const rainClimatologyData = useMemo(
    () =>
      supportsRainClimatology
        ? makePrecipitationPeriodClimatology({
            historyPayload: precipHistoryData,
            currentPairs: data?.rainCum,
            mode,
          })
        : null,
    [
      data?.rainCum,
      mode,
      precipHistoryData,
      supportsRainClimatology,
    ],
  );

  const activeClimatologyData =
    groupKey === "rain"
      ? rainClimatologyData
      : climatologyData;

  const activeClimatologyLoading =
    groupKey === "rain"
      ? precipHistoryLoading
      : climatologyLoading;

  const activeClimatologyError =
    groupKey === "rain"
      ? precipHistoryError
      : climatologyError;

  const parameterOptions = GROUPS;

  const option = useMemo(() => {
    if (!data) return null;

    const baseLegend = isMobileChart
      ? {
          bottom: 4,
          left: "center",
          orient: "horizontal",
          width: isVeryNarrowChart ? 250 : 270,
          itemGap: 10,
          itemWidth: 14,
          itemHeight: 7,
          textStyle: {
            fontSize: 9.5,
            fontWeight: 750,
            color: "#475569",
          },
        }
      : {
          bottom: 10,
          left: "center",
          orient: "horizontal",
          itemGap: 18,
          itemWidth: 18,
          itemHeight: 9,
          textStyle: {
            fontSize: 11.5,
            fontWeight: 750,
            color: "#475569",
          },
        };

    const desktopGridBase = {
      left: 68,
      right: 30,
      top: 80,
      bottom: 82,
      show: true,
      borderWidth: 0,
      backgroundColor: "rgba(248, 250, 252, 0.52)",
    };

    // Tutti i parametri usano la stessa area grafica:
    // stessa altezza, stessi margini e stessa posizione su mobile.
    const mobileStandardGrid = {
      left: isVeryNarrowChart ? 46 : 50,
      right: 12,
      top: 88,
      bottom: 78,
      containLabel: false,
    };

    const gridNoLegend = isMobileChart
      ? mobileStandardGrid
      : desktopGridBase;

    const gridWithLegend = isMobileChart
      ? mobileStandardGrid
      : desktopGridBase;

    const toolboxZoom = makeChartToolbox({
      filename: `meteo-collinas-${mode}-${groupKey}`,
      isMobile: isMobileChart,
    });

    const rollingEnd = n(data?.latestTimestamp);
    const rollingStart = n(data?.windowStartTimestamp);
    const chartReferenceStart = Number.isFinite(rollingStart)
      ? rollingStart
      : isoToLocalDate(bounds.startISO, 0)?.getTime();
    const chartReferenceEnd = mode === "day"
      ? (isoToLocalDate(addDaysISO(bounds.endISO, 1), 0)?.getTime() ?? 0) - 1
      : Number.isFinite(rollingEnd)
        ? rollingEnd
        : isoToLocalDate(addDaysISO(bounds.endISO, 1), 0)?.getTime();
    const chartDateReference = formatChartDateReference(
      mode,
      chartReferenceStart,
      chartReferenceEnd,
      selectedDate,
    );

    const chartTitle = (text) => ({
      text,
      subtext: chartDateReference,
      left: "center",
      top: isMobileChart ? 5 : 10,
      itemGap: isMobileChart ? 3 : 4,
      textStyle: {
        fontSize: isVeryNarrowChart ? 16 : isMobileChart ? 17 : 18,
        fontWeight: 800,
        lineHeight: isMobileChart ? 20 : 22,
        color: "#0f172a",
      },
      subtextStyle: {
        fontSize: isMobileChart ? 9 : 10,
        fontWeight: 650,
        color: "#64748b",
      },
    });

    const xAxis = {
      type: "time",
      min:
        Number.isFinite(rollingStart)
          ? rollingStart
          : isoToLocalDate(bounds.startISO, 0)?.getTime(),
      max:
        mode === "day"
          ? (isoToLocalDate(addDaysISO(bounds.endISO, 1), 0)?.getTime() ?? 0) - 1
          : Number.isFinite(rollingEnd)
            ? rollingEnd
            : isoToLocalDate(addDaysISO(bounds.endISO, 1), 0)?.getTime(),
      splitNumber:
        mode === "day" ? 8 : mode === "week" ? 7 : mode === "month" ? 10 : undefined,
      axisLine: {
        show: true,
        lineStyle: { color: "#cbd5e1", width: 1 },
      },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        hideOverlap: true,
        fontSize: isMobileChart ? 10 : 11,
        fontWeight: 650,
        color: "#64748b",
        margin: isMobileChart ? 8 : 10,
        formatter:
          mode === "day"
            ? "{HH}:{mm}"
            : {
                year: "{dd}/{MM}",
                month: "{dd}/{MM}",
                day: "{dd}/{MM}",
                hour: "{HH}:{mm}",
                minute: "{HH}:{mm}",
                second: "{HH}:{mm}",
                millisecond: "{HH}:{mm}",
                none: "{dd}/{MM}",
              },
      },
    };

    const dayBoundaryMarkLine = makeDailyBoundaryMarkLine(
      mode,
      xAxis.min,
      xAxis.max,
    );

    const hoverAxisPointer = {
      type: "line",
      snap: true,
      label: { show: false },
      lineStyle: {
        type: "dashed",
        width: 1.2,
        color: "rgba(100, 116, 139, 0.55)",
      },
    };

    const chartPairs = (pairs) => trimTrailingNullPoints(pairs);

    const tooltipCommon = {
      trigger: "axis",
      triggerOn: "mousemove|click",
      confine: true,
      backgroundColor: "rgba(255, 255, 255, 0.98)",
      borderColor: "#dbe3ec",
      borderWidth: 1,
      padding: [9, 11],
      extraCssText:
        "border-radius:10px;box-shadow:0 10px 28px rgba(15,23,42,.12);",
      textStyle: {
        color: "#0f172a",
        fontSize: 11,
        fontWeight: 650,
      },
      axisPointer: hoverAxisPointer,
      valueFormatter: (value) => {
        if (value === null || value === undefined) return "—";
        const vv = Number(value);
        return Number.isFinite(vv) ? vv.toFixed(1) : "—";
      },
    };

    const leftAxis = (name, extra = {}) => ({
      type: "value",
      name,
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: isMobileChart ? 34 : 42,
      nameTextStyle: {
        fontSize: isMobileChart ? 10 : 11,
        fontWeight: 700,
        color: "#64748b",
      },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontSize: isMobileChart ? 10 : 11,
        fontWeight: 650,
        color: "#64748b",
        formatter: (value) => Number(value).toFixed(1),
      },
      splitLine: {
        show: true,
        lineStyle: {
          color: "rgba(148, 163, 184, 0.24)",
          type: "dashed",
          width: 1,
        },
      },
      splitNumber: 6,
      ...extra,
    });

    const rightAxis = (name, extra = {}) => ({
      type: "value",
      name,
      position: "right",
      nameLocation: "middle",
      nameRotate: -90,
      nameGap: isMobileChart ? 34 : 42,
      nameTextStyle: {
        fontSize: isMobileChart ? 10 : 11,
        fontWeight: 700,
        color: "#64748b",
      },
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        fontSize: isMobileChart ? 10 : 11,
        fontWeight: 650,
        color: "#64748b",
        formatter: (value) => Number(value).toFixed(1),
      },
      splitLine: { show: false },
      splitNumber: 6,
      ...extra,
    });

    const minMaxFrom = (pairs) => {
      const values = seriesValues(pairs).map((point) => point.value);
      if (!values.length) return null;
      return { min: Math.min(...values), max: Math.max(...values) };
    };

    const common = {
      animation: true,
      animationDuration: 250,
      animationDurationUpdate: 250,
      toolbox: toolboxZoom,
      dataZoom: isMobileChart ? [] : makePeriodDataZoom(),
      xAxis,
    };

    if (groupKey === "temp") {
      const climateMean = Array.isArray(climatologyData?.temp)
        ? climatologyData.temp
        : [];
      const climateP10 = Array.isArray(climatologyData?.tempP10)
        ? climatologyData.tempP10
        : [];
      const climateP25 = Array.isArray(climatologyData?.tempP25)
        ? climatologyData.tempP25
        : [];
      const climateP75 = Array.isArray(climatologyData?.tempP75)
        ? climatologyData.tempP75
        : [];
      const climateP90 = Array.isArray(climatologyData?.tempP90)
        ? climatologyData.tempP90
        : [];

      const climateMeanAvailable = climateMean.some((point) =>
        Number.isFinite(n(point?.[1])),
      );

      const climateBand50Available =
        climateP25.some((point) => Number.isFinite(n(point?.[1]))) &&
        climateP75.some((point) => Number.isFinite(n(point?.[1])));

      const climateBand80Available =
        climateP10.some((point) => Number.isFinite(n(point?.[1]))) &&
        climateP90.some((point) => Number.isFinite(n(point?.[1])));

      const climateBand50Delta = climateP25.map((point, index) => {
        const timestamp = Number(point?.[0]);
        const lower = n(point?.[1]);
        const upper = n(climateP75?.[index]?.[1]);

        if (
          !Number.isFinite(timestamp) ||
          !Number.isFinite(lower) ||
          !Number.isFinite(upper)
        ) {
          return [timestamp, null];
        }

        return [timestamp, Math.max(0, upper - lower)];
      });

      const climateBand80Delta = climateP10.map((point, index) => {
        const timestamp = Number(point?.[0]);
        const lower = n(point?.[1]);
        const upper = n(climateP90?.[index]?.[1]);

        if (
          !Number.isFinite(timestamp) ||
          !Number.isFinite(lower) ||
          !Number.isFinite(upper)
        ) {
          return [timestamp, null];
        }

        return [timestamp, Math.max(0, upper - lower)];
      });

      const axisPairs = [
        ...(Array.isArray(data.temp) ? data.temp : []),
        ...(climateMeanAvailable ? climateMean : []),
        ...(climateBand80Available ? climateP10 : []),
        ...(climateBand80Available ? climateP90 : []),
      ];

      const mm = minMaxFrom(axisPairs) || { min: 0, max: 1 };
      const axis = axisNice(mm.min - 1, mm.max + 1, 6);

      const pulseTemp = showRealtimePulse
        ? makeRealtimePulseSeries(
            data.temp,
            data.latestTimestamp,
            0,
            "Temperatura osservata",
          )
        : null;

      const meanLegendLabel = "Media climatica 1991–2020";
      const band50LegendLabel = "Fascia 50%";
      const band80LegendLabel = "Fascia 80%";

      const tempLegend = isMobileChart
        ? [
            {
              ...baseLegend,
              left: "center",
              right: "auto",
              bottom: 29,
              width: isVeryNarrowChart ? 308 : 338,
              itemGap: 11,
              itemWidth: 14,
              itemHeight: 8,
              textStyle: {
                ...baseLegend.textStyle,
                fontSize: isVeryNarrowChart ? 8.7 : 9.2,
              },
              formatter: (name) => {
                if (name === "Temperatura osservata") return "Temperatura";
                if (name === meanLegendLabel) return "Media";
                return name;
              },
              data: [
                "Temperatura osservata",
                ...(climateMeanAvailable ? [meanLegendLabel] : []),
              ],
            },
            {
              ...baseLegend,
              left: "center",
              right: "auto",
              bottom: 8,
              width: isVeryNarrowChart ? 318 : 348,
              itemGap: 11,
              itemWidth: 14,
              itemHeight: 8,
              textStyle: {
                ...baseLegend.textStyle,
                fontSize: isVeryNarrowChart ? 8.7 : 9.2,
              },
              formatter: (name) => {
                if (name === band50LegendLabel) return "Fascia 50%";
                if (name === band80LegendLabel) return "Fascia 80%";
                return name;
              },
              data: [
                ...(climateBand50Available
                  ? [{ name: band50LegendLabel, icon: "roundRect" }]
                  : []),
                ...(climateBand80Available
                  ? [{ name: band80LegendLabel, icon: "roundRect" }]
                  : []),
              ],
            },
          ]
        : {
            ...baseLegend,
            itemGap: 18,
            data: [
              "Temperatura osservata",
              ...(climateMeanAvailable ? [meanLegendLabel] : []),
              ...(climateBand50Available
                ? [{ name: band50LegendLabel, icon: "roundRect" }]
                : []),
              ...(climateBand80Available
                ? [{ name: band80LegendLabel, icon: "roundRect" }]
                : []),
            ],
          };

      const tempGrid = isMobileChart
        ? mobileStandardGrid
        : { ...gridWithLegend, bottom: 88 };

      return {
        ...common,
        title: chartTitle("Temperatura"),
        grid: tempGrid,
        tooltip: {
          ...tooltipCommon,
          formatter: (params) => {
            const validParams = (Array.isArray(params) ? params : []).filter(
              (item) => {
                const name = String(item?.seriesName || "");

                return (
                  !name.startsWith("__") &&
                  name !== band50LegendLabel &&
                  name !== band80LegendLabel &&
                  Number.isFinite(n(item?.data?.[1]))
                );
              },
            );

            const timestamp = Number(
              (Array.isArray(params) ? params : [])
                .map((item) => Number(item?.data?.[0]))
                .find(Number.isFinite),
            );

            if (!validParams.length && !Number.isFinite(timestamp)) return "";

            const time = Number.isFinite(timestamp)
              ? formatSummaryTimestamp(timestamp, mode)
              : "";

            const lines = time ? [time] : [];

            const findParam = (seriesName) =>
              validParams.find(
                (item) => item?.seriesName === seriesName,
              );

            // Ordine intenzionale del tooltip:
            // 1. dato osservato
            // 2. riferimento climatico
            // 3. fasce climatiche
            const observedItem = findParam("Temperatura osservata");
            const meanItem = findParam(meanLegendLabel);

            for (const item of [observedItem, meanItem]) {
              if (!item) continue;

              const value = n(item?.data?.[1]);
              if (!Number.isFinite(value)) continue;

              lines.push(
                `${item.marker}${item.seriesName}: ${value.toFixed(1)} °C`,
              );
            }

            const findBandValues = (lowerPairs, upperPairs) => {
              if (!Number.isFinite(timestamp)) return null;

              const index = lowerPairs.findIndex(
                (point) => Number(point?.[0]) === timestamp,
              );

              if (index < 0) return null;

              const lower = n(lowerPairs?.[index]?.[1]);
              const upper = n(upperPairs?.[index]?.[1]);

              if (!Number.isFinite(lower) || !Number.isFinite(upper)) {
                return null;
              }

              return { lower, upper };
            };

            if (climateBand50Available) {
              const band = findBandValues(climateP25, climateP75);

              if (band) {
                lines.push(
                  `<span style="display:inline-block;margin-right:6px;border-radius:2px;width:10px;height:7px;background:rgba(71,85,105,.28);"></span>` +
                    `Fascia 50% (P25–P75): ${band.lower.toFixed(1)}–${band.upper.toFixed(1)} °C`,
                );
              }
            }

            if (climateBand80Available) {
              const band = findBandValues(climateP10, climateP90);

              if (band) {
                lines.push(
                  `<span style="display:inline-block;margin-right:6px;border-radius:2px;width:10px;height:7px;background:rgba(148,163,184,.18);"></span>` +
                    `Fascia 80% (P10–P90): ${band.lower.toFixed(1)}–${band.upper.toFixed(1)} °C`,
                );
              }
            }

            return lines.join("<br/>");
          },
        },
        legend: tempLegend,
        yAxis: leftAxis("°C", {
          min: axis.min,
          max: axis.max,
          interval: axis.interval,
        }),
        series: [
          ...(climateBand80Available
            ? [
                {
                  name: "__Fascia P10 base",
                  type: "line",
                  data: chartPairs(climateP10),
                  stack: "climatology-band-80",
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  silent: true,
                  tooltip: { show: false },
                  lineStyle: { width: 0, opacity: 0 },
                  areaStyle: { opacity: 0 },
                  itemStyle: { opacity: 0 },
                  emphasis: { disabled: true },
                  z: 0,
                },
                {
                  name: band80LegendLabel,
                  type: "line",
                  data: chartPairs(climateBand80Delta),
                  stack: "climatology-band-80",
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  silent: true,
                  tooltip: { show: false },
                  lineStyle: { width: 0, opacity: 0 },
                  areaStyle: {
                    color: "rgba(148, 163, 184, 0.16)",
                    opacity: 1,
                  },
                  itemStyle: { color: "rgba(148, 163, 184, 0.20)" },
                  emphasis: { disabled: true },
                  z: 0,
                },
              ]
            : []),

          ...(climateBand50Available
            ? [
                {
                  name: "__Fascia P25 base",
                  type: "line",
                  data: chartPairs(climateP25),
                  stack: "climatology-band-50",
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  silent: true,
                  tooltip: { show: false },
                  lineStyle: { width: 0, opacity: 0 },
                  areaStyle: { opacity: 0 },
                  itemStyle: { opacity: 0 },
                  emphasis: { disabled: true },
                  z: 1,
                },
                {
                  name: band50LegendLabel,
                  type: "line",
                  data: chartPairs(climateBand50Delta),
                  stack: "climatology-band-50",
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  silent: true,
                  tooltip: { show: false },
                  lineStyle: { width: 0, opacity: 0 },
                  areaStyle: {
                    color: "rgba(71, 85, 105, 0.24)",
                    opacity: 1,
                  },
                  itemStyle: { color: "rgba(71, 85, 105, 0.30)" },
                  emphasis: { disabled: true },
                  z: 1,
                },
              ]
            : []),

          ...(climateMeanAvailable
            ? [
                {
                  name: meanLegendLabel,
                  type: "line",
                  data: chartPairs(climateMean),
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  sampling: "lttb",
                  lineStyle: {
                    width: 2.0,
                    color: "#64748b",
                    type: "dashed",
                    opacity: 0.95,
                  },
                  itemStyle: { color: "#64748b" },
                  emphasis: { focus: "series" },
                  z: 3,
                },
              ]
            : []),

          {
            name: "Temperatura osservata",
            type: "line",
            data: chartPairs(data.temp),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            lineStyle: { width: 2.5, color: "#f97316" },
            itemStyle: { color: "#f97316" },
            emphasis: { focus: "series" },
            z: 5,
            ...(dayBoundaryMarkLine ? { markLine: dayBoundaryMarkLine } : {}),
          },

          ...(pulseTemp ? [pulseTemp] : []),
        ],
      };
    }

    if (groupKey === "rain") {
      const rainStepLabel =
        mode === "day" || mode === "week"
          ? "Pioggia 15 min (mm)"
          : "Pioggia oraria (mm)";

      const rainAxisLabel =
        mode === "day" || mode === "week"
          ? "mm/15m"
          : "mm/h";

      const climateMedian = Array.isArray(
        rainClimatologyData?.rainCumMedian,
      )
        ? rainClimatologyData.rainCumMedian
        : [];

      const climateP10 = Array.isArray(rainClimatologyData?.rainCumP10)
        ? rainClimatologyData.rainCumP10
        : [];

      const climateP25 = Array.isArray(rainClimatologyData?.rainCumP25)
        ? rainClimatologyData.rainCumP25
        : [];

      const climateP75 = Array.isArray(rainClimatologyData?.rainCumP75)
        ? rainClimatologyData.rainCumP75
        : [];

      const climateP90 = Array.isArray(rainClimatologyData?.rainCumP90)
        ? rainClimatologyData.rainCumP90
        : [];

      const showRainClimate =
        mode !== "day" &&
        !!rainClimatologyData;

      const climateMedianAvailable =
        showRainClimate &&
        climateMedian.some((point) =>
          Number.isFinite(n(point?.[1])),
        );

      const climateBand50Available =
        showRainClimate &&
        climateP25.some((point) =>
          Number.isFinite(n(point?.[1])),
        ) &&
        climateP75.some((point) =>
          Number.isFinite(n(point?.[1])),
        );

      const climateBand80Available =
        showRainClimate &&
        climateP10.some((point) =>
          Number.isFinite(n(point?.[1])),
        ) &&
        climateP90.some((point) =>
          Number.isFinite(n(point?.[1])),
        );

      const climateBand50Delta =
        climateBand50Available
          ? climateP75.map((point, index) => {
              const timestamp = Number(point?.[0]);
              const upper = n(point?.[1]);
              const lower = n(climateP25?.[index]?.[1]);

              return [
                timestamp,
                Number.isFinite(upper) &&
                Number.isFinite(lower)
                  ? Math.max(0, upper - lower)
                  : null,
              ];
            })
          : [];

      const climateBand80Delta =
        climateBand80Available
          ? climateP90.map((point, index) => {
              const timestamp = Number(point?.[0]);
              const upper = n(point?.[1]);
              const lower = n(climateP10?.[index]?.[1]);

              return [
                timestamp,
                Number.isFinite(upper) &&
                Number.isFinite(lower)
                  ? Math.max(0, upper - lower)
                  : null,
              ];
            })
          : [];

      const medianLegendLabel = "Mediana climatica 1991–2020";
      const band50LegendLabel = "Fascia 50%";
      const band80LegendLabel = "Fascia 80%";

      const pulseRain = showRealtimePulse
        ? makeRealtimePulseSeries(
            data.rainH,
            data.latestTimestamp,
            0,
            rainStepLabel,
          )
        : null;

      const pulseCum = showRealtimePulse
        ? makeRealtimePulseSeries(
            data.rainCum,
            data.latestTimestamp,
            1,
            "Cumulata osservata (mm)",
          )
        : null;

      const legendData = [
        rainStepLabel,
        "Cumulata osservata (mm)",
        ...(climateMedianAvailable
          ? [medianLegendLabel]
          : []),
        ...(climateBand50Available
          ? [band50LegendLabel]
          : []),
        ...(climateBand80Available
          ? [band80LegendLabel]
          : []),
      ];

      const rainLegend = isMobileChart
        ? {
            ...baseLegend,
            bottom: 7,
            width: isVeryNarrowChart ? 318 : 348,
            itemGap: 10,
            itemWidth: 14,
            itemHeight: 8,
            textStyle: {
              ...baseLegend.textStyle,
              fontSize: isVeryNarrowChart ? 8.5 : 9,
            },
            formatter: (name) => {
              if (name === rainStepLabel) {
                return mode === "month"
                  ? "Pioggia oraria"
                  : "Pioggia 15 min";
              }

              if (name === "Cumulata osservata (mm)") {
                return "Cumulata";
              }

              if (name === medianLegendLabel) {
                return "Mediana 1991–2020";
              }

              return name;
            },
            data: legendData,
          }
        : {
            ...baseLegend,
            data: legendData,
          };

      return {
        ...common,
        title: chartTitle("Precipitazioni"),
        grid: gridWithLegend,

        tooltip: {
          ...tooltipCommon,
          formatter: (params) => {
            const validParams = (Array.isArray(params) ? params : [])
              .filter(
                (item) =>
                  Number.isFinite(n(item?.data?.[1])) &&
                  !String(item?.seriesName || "").startsWith("__"),
              );

            if (!validParams.length) return "";

            const timestamp =
              Number(validParams[0]?.data?.[0]);

            const time = Number.isFinite(timestamp)
              ? formatSummaryTimestamp(timestamp, mode)
              : "";

            const lines = time ? [time] : [];

            const findParam = (seriesName) =>
              validParams.find(
                (item) => item?.seriesName === seriesName,
              );

            // Prima sempre i dati realmente rilevati.
            const observedStepItem = findParam(rainStepLabel);
            const observedCumItem = findParam(
              "Cumulata osservata (mm)",
            );
            const climateMedianItem = findParam(
              medianLegendLabel,
            );

            for (const item of [
              observedStepItem,
              observedCumItem,
              climateMedianItem,
            ]) {
              if (!item) continue;

              const value = n(item?.data?.[1]);
              if (!Number.isFinite(value)) continue;

              lines.push(
                `${item.marker}${item.seriesName}: ${value.toFixed(1)} mm`,
              );
            }

            // Nel giornaliero nessun dato climatologico:
            // la climatologia disponibile è giornaliera, non intragiornaliera.
            if (mode !== "day" && Number.isFinite(timestamp)) {
              const findValue = (pairs) => {
                const point = (Array.isArray(pairs) ? pairs : [])
                  .find(
                    (candidate) =>
                      Number(candidate?.[0]) === timestamp,
                  );

                const value = n(point?.[1]);
                return Number.isFinite(value) ? value : null;
              };

              const p25 = findValue(climateP25);
              const p75 = findValue(climateP75);
              const p10 = findValue(climateP10);
              const p90 = findValue(climateP90);

              if (
                climateBand50Available &&
                Number.isFinite(p25) &&
                Number.isFinite(p75)
              ) {
                lines.push(
                  `<span style="display:inline-block;margin-right:6px;border-radius:2px;width:10px;height:7px;background:rgba(71,85,105,.28);"></span>` +
                    `Fascia 50% (P25–P75): ${p25.toFixed(1)}–${p75.toFixed(1)} mm`,
                );
              }

              if (
                climateBand80Available &&
                Number.isFinite(p10) &&
                Number.isFinite(p90)
              ) {
                lines.push(
                  `<span style="display:inline-block;margin-right:6px;border-radius:2px;width:10px;height:7px;background:rgba(148,163,184,.18);"></span>` +
                    `Fascia 80% (P10–P90): ${p10.toFixed(1)}–${p90.toFixed(1)} mm`,
                );
              }
            }

            return lines.join("<br/>");
          },
        },

        legend: rainLegend,

        yAxis: [
          leftAxis(rainAxisLabel),
          rightAxis("mm cum."),
        ],

        series: [
          {
            name: rainStepLabel,
            type: "bar",
            data: chartPairs(data.rainH),
            yAxisIndex: 0,
            barMaxWidth: mode === "day" ? 12 : 10,
            itemStyle: {
              color: "#38bdf8",
              borderRadius: [3, 3, 0, 0],
            },
            ...(dayBoundaryMarkLine
              ? { markLine: dayBoundaryMarkLine }
              : {}),
            z: 5,
          },

          ...(climateBand80Available
            ? [
                {
                  name: "__Pioggia P10 base",
                  type: "line",
                  data: chartPairs(climateP10),
                  yAxisIndex: 1,
                  stack: "rain-band-80",
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  silent: true,
                  tooltip: { show: false },
                  lineStyle: {
                    width: 0,
                    opacity: 0,
                  },
                  areaStyle: {
                    opacity: 0,
                  },
                  itemStyle: {
                    opacity: 0,
                  },
                  emphasis: {
                    disabled: true,
                  },
                  z: 0,
                },
                {
                  name: band80LegendLabel,
                  type: "line",
                  data: chartPairs(climateBand80Delta),
                  yAxisIndex: 1,
                  stack: "rain-band-80",
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  silent: true,
                  tooltip: { show: false },
                  lineStyle: {
                    width: 0,
                    opacity: 0,
                  },
                  areaStyle: {
                    color: "rgba(148, 163, 184, 0.16)",
                    opacity: 1,
                  },
                  itemStyle: {
                    color: "rgba(148, 163, 184, 0.20)",
                  },
                  emphasis: {
                    disabled: true,
                  },
                  z: 0,
                },
              ]
            : []),

          ...(climateBand50Available
            ? [
                {
                  name: "__Pioggia P25 base",
                  type: "line",
                  data: chartPairs(climateP25),
                  yAxisIndex: 1,
                  stack: "rain-band-50",
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  silent: true,
                  tooltip: { show: false },
                  lineStyle: {
                    width: 0,
                    opacity: 0,
                  },
                  areaStyle: {
                    opacity: 0,
                  },
                  itemStyle: {
                    opacity: 0,
                  },
                  emphasis: {
                    disabled: true,
                  },
                  z: 1,
                },
                {
                  name: band50LegendLabel,
                  type: "line",
                  data: chartPairs(climateBand50Delta),
                  yAxisIndex: 1,
                  stack: "rain-band-50",
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  silent: true,
                  tooltip: { show: false },
                  lineStyle: {
                    width: 0,
                    opacity: 0,
                  },
                  areaStyle: {
                    color: "rgba(71, 85, 105, 0.24)",
                    opacity: 1,
                  },
                  itemStyle: {
                    color: "rgba(71, 85, 105, 0.30)",
                  },
                  emphasis: {
                    disabled: true,
                  },
                  z: 1,
                },
              ]
            : []),

          ...(climateMedianAvailable
            ? [
                {
                  name: medianLegendLabel,
                  type: "line",
                  data: chartPairs(climateMedian),
                  yAxisIndex: 1,
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  sampling: "lttb",
                  lineStyle: {
                    width: 2.1,
                    color: "#64748b",
                    type: "dashed",
                    opacity: 0.95,
                  },
                  itemStyle: {
                    color: "#64748b",
                  },
                  emphasis: {
                    focus: "series",
                  },
                  z: 3,
                },
              ]
            : []),

          {
            name: "Cumulata osservata (mm)",
            type: "line",
            data: chartPairs(data.rainCum),
            yAxisIndex: 1,
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            lineStyle: {
              width: 2.4,
              color: "#2563eb",
            },
            itemStyle: {
              color: "#2563eb",
            },
            emphasis: {
              focus: "series",
            },
            z: 6,
          },

          ...(pulseRain ? [pulseRain] : []),
          ...(pulseCum ? [pulseCum] : []),
        ],
      };
    }

    if (groupKey === "rh") {
      const climate = fixedClimateSeries(
        climatologyData,
        "rh",
      );

      const meanLegendLabel = "Media climatica 1991–2020";
      const band50LegendLabel = "Fascia 50%";
      const band80LegendLabel = "Fascia 80%";

      const pulse = showRealtimePulse
        ? makeRealtimePulseSeries(
            data.rh,
            data.latestTimestamp,
            0,
            "Umidità osservata",
          )
        : null;

      const humidityLegend = isMobileChart
        ? [
            {
              ...baseLegend,
              left: "center",
              right: "auto",
              bottom: 29,
              width: isVeryNarrowChart ? 308 : 338,
              itemGap: 11,
              itemWidth: 14,
              itemHeight: 8,
              textStyle: {
                ...baseLegend.textStyle,
                fontSize: isVeryNarrowChart ? 8.7 : 9.2,
              },
              formatter: (name) => {
                if (name === "Umidità osservata") return "Umidità";
                if (name === meanLegendLabel) return "Media";
                return name;
              },
              data: [
                "Umidità osservata",
                ...(climate.meanAvailable ? [meanLegendLabel] : []),
              ],
            },
            {
              ...baseLegend,
              left: "center",
              right: "auto",
              bottom: 8,
              width: isVeryNarrowChart ? 318 : 348,
              itemGap: 11,
              itemWidth: 14,
              itemHeight: 8,
              textStyle: {
                ...baseLegend.textStyle,
                fontSize: isVeryNarrowChart ? 8.7 : 9.2,
              },
              data: [
                ...(climate.band50Available
                  ? [{ name: band50LegendLabel, icon: "roundRect" }]
                  : []),
                ...(climate.band80Available
                  ? [{ name: band80LegendLabel, icon: "roundRect" }]
                  : []),
              ],
            },
          ]
        : {
            ...baseLegend,
            itemGap: 18,
            data: [
              "Umidità osservata",
              ...(climate.meanAvailable ? [meanLegendLabel] : []),
              ...(climate.band50Available
                ? [{ name: band50LegendLabel, icon: "roundRect" }]
                : []),
              ...(climate.band80Available
                ? [{ name: band80LegendLabel, icon: "roundRect" }]
                : []),
            ],
          };

      const humidityGrid = isMobileChart
        ? mobileStandardGrid
        : { ...gridWithLegend, bottom: 88 };

      return {
        ...common,
        title: chartTitle("Umidità"),
        grid: humidityGrid,
        tooltip: {
          ...tooltipCommon,
          formatter: (params) => {
            const allParams = Array.isArray(params) ? params : [];
            const timestamp = Number(
              allParams
                .map((item) => Number(item?.data?.[0]))
                .find(Number.isFinite),
            );

            if (!Number.isFinite(timestamp)) return "";

            const time = formatSummaryTimestamp(timestamp, mode);
            const lines = time ? [time] : [];

            const findValue = (seriesName) => {
              const item = allParams.find(
                (candidate) =>
                  candidate?.seriesName === seriesName &&
                  Number.isFinite(n(candidate?.data?.[1])),
              );

              if (!item) return null;

              return {
                marker: item.marker,
                value: n(item.data[1]),
              };
            };

            const observed = findValue("Umidità osservata");
            const mean = findValue(meanLegendLabel);

            if (observed) {
              lines.push(
                `${observed.marker}Umidità osservata: ${observed.value.toFixed(1)}%`,
              );
            }

            if (mean) {
              lines.push(
                `${mean.marker}Media climatica 1991–2020: ${mean.value.toFixed(1)}%`,
              );
            }

            const bandAt = (lowerPairs, upperPairs) => {
              const index = lowerPairs.findIndex(
                (point) => Number(point?.[0]) === timestamp,
              );

              if (index < 0) return null;

              const lower = n(lowerPairs?.[index]?.[1]);
              const upper = n(upperPairs?.[index]?.[1]);

              return Number.isFinite(lower) && Number.isFinite(upper)
                ? { lower, upper }
                : null;
            };

            if (climate.band50Available) {
              const band = bandAt(climate.p25, climate.p75);

              if (band) {
                lines.push(
                  `<span style="display:inline-block;margin-right:6px;border-radius:2px;width:10px;height:7px;background:rgba(71,85,105,.28);"></span>` +
                    `Fascia 50% (P25–P75): ${band.lower.toFixed(1)}–${band.upper.toFixed(1)}%`,
                );
              }
            }

            if (climate.band80Available) {
              const band = bandAt(climate.p10, climate.p90);

              if (band) {
                lines.push(
                  `<span style="display:inline-block;margin-right:6px;border-radius:2px;width:10px;height:7px;background:rgba(148,163,184,.18);"></span>` +
                    `Fascia 80% (P10–P90): ${band.lower.toFixed(1)}–${band.upper.toFixed(1)}%`,
                );
              }
            }

            return lines.join("<br/>");
          },
        },
        legend: humidityLegend,
        yAxis: leftAxis("% RH", { min: 0, max: 100 }),
        series: [
          ...fixedClimateBandSeries({
            climate,
            stackPrefix: "humidity-climatology",
            band50Label: band50LegendLabel,
            band80Label: band80LegendLabel,
          }),

          ...(climate.meanAvailable
            ? [
                {
                  name: meanLegendLabel,
                  type: "line",
                  data: chartPairs(climate.mean),
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  sampling: "lttb",
                  lineStyle: {
                    width: 2.0,
                    color: "#64748b",
                    type: "dashed",
                    opacity: 0.95,
                  },
                  itemStyle: { color: "#64748b" },
                  emphasis: { focus: "series" },
                  z: 3,
                },
              ]
            : []),

          {
            name: "Umidità osservata",
            type: "line",
            data: chartPairs(data.rh),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            lineStyle: { width: 2.5, color: "#06b6d4" },
            itemStyle: { color: "#06b6d4" },
            emphasis: { focus: "series" },
            z: 5,
            ...(dayBoundaryMarkLine
              ? { markLine: dayBoundaryMarkLine }
              : {}),
          },

          ...(pulse ? [pulse] : []),
        ],
      };
    }

    if (groupKey === "wind") {
      const climate = fixedClimateSeries(
        climatologyData,
        "wind",
      );

      const meanLegendLabel = "Media climatica 1991–2020";
      const band50LegendLabel = "Fascia 50%";
      const band80LegendLabel = "Fascia 80%";

      const pulseWind = showRealtimePulse
        ? makeRealtimePulseSeries(
            data.wind,
            data.latestTimestamp,
            0,
            "Vento medio (km/h)",
          )
        : null;

      const pulseGust = showRealtimePulse
        ? makeRealtimePulseSeries(
            data.gust,
            data.latestTimestamp,
            0,
            "Raffiche (km/h)",
          )
        : null;

      const pulseDir = showRealtimePulse
        ? makeRealtimePulseSeries(
            data.dirMean,
            data.latestTimestamp,
            1,
            "Direzione",
          )
        : null;

      const windLegend = isMobileChart
        ? [
            {
              ...baseLegend,
              left: "center",
              right: "auto",
              bottom: 29,
              width: isVeryNarrowChart ? 326 : 352,
              itemGap: 8,
              itemWidth: 12,
              itemHeight: 7,
              textStyle: {
                ...baseLegend.textStyle,
                fontSize: isVeryNarrowChart ? 7.4 : 8,
              },
              formatter: (name) => {
                if (name === "Vento medio (km/h)") return "Vento";
                if (name === "Raffiche (km/h)") return "Raffiche";
                if (name === "Direzione") return "Dir.";
                if (name === meanLegendLabel) return "Media";
                return name;
              },
              data: [
                "Vento medio (km/h)",
                "Raffiche (km/h)",
                "Direzione",
                ...(climate.meanAvailable ? [meanLegendLabel] : []),
              ],
            },
            {
              ...baseLegend,
              left: "center",
              right: "auto",
              bottom: 8,
              width: isVeryNarrowChart ? 318 : 348,
              itemGap: 11,
              itemWidth: 14,
              itemHeight: 8,
              textStyle: {
                ...baseLegend.textStyle,
                fontSize: isVeryNarrowChart ? 8.7 : 9.2,
              },
              data: [
                ...(climate.band50Available
                  ? [{ name: band50LegendLabel, icon: "roundRect" }]
                  : []),
                ...(climate.band80Available
                  ? [{ name: band80LegendLabel, icon: "roundRect" }]
                  : []),
              ],
            },
          ]
        : {
            ...baseLegend,
            itemGap: 15,
            data: [
              "Vento medio (km/h)",
              "Raffiche (km/h)",
              "Direzione",
              ...(climate.meanAvailable ? [meanLegendLabel] : []),
              ...(climate.band50Available
                ? [{ name: band50LegendLabel, icon: "roundRect" }]
                : []),
              ...(climate.band80Available
                ? [{ name: band80LegendLabel, icon: "roundRect" }]
                : []),
            ],
          };

      const windGrid = isMobileChart
        ? mobileStandardGrid
        : { ...gridWithLegend, bottom: 88 };

      return {
        ...common,
        title: chartTitle(
          isMobileChart
            ? "Vento, raffiche e direzione"
            : "Vento medio, raffiche e direzione",
        ),
        grid: windGrid,
        tooltip: {
          trigger: "axis",
          triggerOn: "mousemove|click",
          confine: true,
          axisPointer: hoverAxisPointer,
          formatter: (params) => {
            const allParams = Array.isArray(params) ? params : [];
            const timestamp = Number(
              allParams
                .map((item) => Number(item?.data?.[0]))
                .find(Number.isFinite),
            );

            if (!Number.isFinite(timestamp)) return "";

            const time = formatSummaryTimestamp(timestamp, mode);
            const lines = time ? [time] : [];

            const findValue = (seriesName) => {
              const item = allParams.find(
                (candidate) =>
                  candidate?.seriesName === seriesName &&
                  Number.isFinite(n(candidate?.data?.[1])),
              );

              if (!item) return null;

              return {
                marker: item.marker,
                value: n(item.data[1]),
              };
            };

            const observedWind = findValue("Vento medio (km/h)");
            const gust = findValue("Raffiche (km/h)");
            const direction = findValue("Direzione");
            const mean = findValue(meanLegendLabel);

            if (observedWind) {
              lines.push(
                `${observedWind.marker}Vento medio osservato: ${observedWind.value.toFixed(1)} km/h`,
              );
            }

            if (gust) {
              lines.push(
                `${gust.marker}Raffiche: ${gust.value.toFixed(1)} km/h`,
              );
            }

            if (direction) {
              lines.push(
                `${direction.marker}Direzione: ${degToCardinal8(direction.value)}`,
              );
            }

            if (mean) {
              lines.push(
                `${mean.marker}Media climatica 1991–2020: ${mean.value.toFixed(1)} km/h`,
              );
            }

            const bandAt = (lowerPairs, upperPairs) => {
              const index = lowerPairs.findIndex(
                (point) => Number(point?.[0]) === timestamp,
              );

              if (index < 0) return null;

              const lower = n(lowerPairs?.[index]?.[1]);
              const upper = n(upperPairs?.[index]?.[1]);

              return Number.isFinite(lower) && Number.isFinite(upper)
                ? { lower, upper }
                : null;
            };

            if (climate.band50Available) {
              const band = bandAt(climate.p25, climate.p75);

              if (band) {
                lines.push(
                  `<span style="display:inline-block;margin-right:6px;border-radius:2px;width:10px;height:7px;background:rgba(71,85,105,.28);"></span>` +
                    `Fascia 50% (P25–P75): ${band.lower.toFixed(1)}–${band.upper.toFixed(1)} km/h`,
                );
              }
            }

            if (climate.band80Available) {
              const band = bandAt(climate.p10, climate.p90);

              if (band) {
                lines.push(
                  `<span style="display:inline-block;margin-right:6px;border-radius:2px;width:10px;height:7px;background:rgba(148,163,184,.18);"></span>` +
                    `Fascia 80% (P10–P90): ${band.lower.toFixed(1)}–${band.upper.toFixed(1)} km/h`,
                );
              }
            }

            return lines.join("<br/>");
          },
        },
        legend: windLegend,
        yAxis: [
          leftAxis("km/h"),
          {
            ...rightAxis("Dir"),
            min: 0,
            max: 360,
            interval: 45,
            axisLabel: {
              fontSize: isMobileChart ? 10 : 12,
              formatter: (value) => degToCardinal8(value),
            },
          },
        ],
        series: [
          ...fixedClimateBandSeries({
            climate,
            stackPrefix: "wind-climatology",
            yAxisIndex: 0,
            band50Label: band50LegendLabel,
            band80Label: band80LegendLabel,
          }),

          ...(climate.meanAvailable
            ? [
                {
                  name: meanLegendLabel,
                  type: "line",
                  data: chartPairs(climate.mean),
                  yAxisIndex: 0,
                  showSymbol: false,
                  connectNulls: false,
                  smooth: false,
                  sampling: "lttb",
                  lineStyle: {
                    width: 2.0,
                    color: "#64748b",
                    type: "dashed",
                    opacity: 0.95,
                  },
                  itemStyle: { color: "#64748b" },
                  emphasis: { focus: "series" },
                  z: 3,
                },
              ]
            : []),

          {
            name: "Vento medio (km/h)",
            type: "line",
            data: chartPairs(data.wind),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            yAxisIndex: 0,
            lineStyle: { width: 2.5, color: "#8b5cf6" },
            itemStyle: { color: "#8b5cf6" },
            emphasis: { focus: "series" },
            z: 5,
            ...(dayBoundaryMarkLine
              ? { markLine: dayBoundaryMarkLine }
              : {}),
          },

          {
            name: "Raffiche (km/h)",
            type: "line",
            data: chartPairs(data.gust),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            yAxisIndex: 0,
            lineStyle: { width: 2.1, color: "#f59e0b" },
            itemStyle: { color: "#f59e0b" },
            emphasis: { focus: "series" },
            z: 5,
          },

          {
            name: "Direzione",
            type: "scatter",
            data: chartPairs(data.dirMean),
            yAxisIndex: 1,
            symbolSize: 5,
            itemStyle: { color: "#334155" },
            z: 6,
          },

          ...(pulseWind ? [pulseWind] : []),
          ...(pulseGust ? [pulseGust] : []),
          ...(pulseDir ? [pulseDir] : []),
        ],
      };
    }

    if (groupKey === "press") {

      const mm = minMaxFrom(data.press) || { min: 1010, max: 1020 };
      const axis = axisNice(mm.min - 1.5, mm.max + 1.5, 6);
      const pulse = showRealtimePulse
        ? makeRealtimePulseSeries(
            data.press,
            data.latestTimestamp,
            0,
            "Pressione (hPa)",
          )
        : null;

      return {
        ...common,
        title: chartTitle("Pressione"),
        grid: gridNoLegend,
        tooltip: tooltipCommon,
        yAxis: leftAxis("hPa", {
          min: axis.min,
          max: axis.max,
          interval: axis.interval,
        }),
        series: [
          {
            name: "Pressione (hPa)",
            type: "line",
            data: chartPairs(data.press),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            lineStyle: { width: 2.3, color: "#2563eb" },
            itemStyle: { color: "#2563eb" },
            emphasis: { focus: "series" },
            ...(dayBoundaryMarkLine ? { markLine: dayBoundaryMarkLine } : {}),
          },
          ...(pulse ? [pulse] : []),
        ],
      };
    }

    if (groupKey === "uv") {

      const pulse = showRealtimePulse
        ? makeRealtimePulseSeries(
            data.uv,
            data.latestTimestamp,
            0,
            "Indice UV",
          )
        : null;

      return {
        ...common,
        title: chartTitle("Indice UV"),
        grid: gridNoLegend,
        tooltip: tooltipCommon,
        yAxis: leftAxis("UV", { min: 0 }),
        series: [
          {
            name: "Indice UV",
            type: "line",
            data: chartPairs(data.uv),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            lineStyle: { width: 2.3, color: "#7c3aed" },
            itemStyle: { color: "#7c3aed" },
            emphasis: { focus: "series" },
            ...(dayBoundaryMarkLine ? { markLine: dayBoundaryMarkLine } : {}),
          },
          ...(pulse ? [pulse] : []),
        ],
      };
    }

    const pulse = showRealtimePulse
      ? makeRealtimePulseSeries(
          data.solar,
          data.latestTimestamp,
          0,
          "Radiazione solare (W/m²)",
        )
      : null;

    return {
      ...common,
      title: chartTitle("Radiazione solare"),
      grid: gridNoLegend,
      tooltip: tooltipCommon,
      yAxis: leftAxis("W/m²", { min: 0 }),
      series: [
        {
          name: "Radiazione solare (W/m²)",
          type: "line",
          data: chartPairs(data.solar),
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          sampling: "lttb",
          lineStyle: { width: 2.3, color: "#f59e0b" },
            itemStyle: { color: "#f59e0b" },
            emphasis: { focus: "series" },
          ...(dayBoundaryMarkLine ? { markLine: dayBoundaryMarkLine } : {}),
        },
        ...(pulse ? [pulse] : []),
      ],
    };
  }, [
    bounds.endISO,
    bounds.startISO,
    climatologyData,
    data,
    groupKey,
    isMobileChart,
    isVeryNarrowChart,
    mode,
    rainClimatologyData,
    showRealtimePulse,
  ]);

  // Altezza identica per qualunque parametro selezionato.
  const chartHeight = isMobileChart
    ? (isVeryNarrowChart ? 318 : 326)
    : 370;

  return (
    <div className="periodCard" aria-label={periodTitle}>
      <div className="dataHeader">
        <h2>{dataTitle}</h2>
      </div>

      <div className="dateNavigator">
        <div className="navControl navControlLeft">
          <span className="navControlLabel">Intervallo</span>
          <CustomSelect
            value={mode}
            options={PERIODS}
            onChange={changeMode}
            ariaLabel="Seleziona il periodo dei dati"
            variant="dark"
          />
        </div>

        <div className="dateNavigatorCenter">
          <div className="dateText">
            <strong>{periodLabel}</strong>
          </div>
        </div>

        <div className="navControl navControlRight">
          <span className="navControlLabel">Parametro</span>
          <CustomSelect
            value={groupKey}
            options={parameterOptions}
            onChange={setGroupKey}
            ariaLabel="Seleziona parametro"
            variant="dark"
          />
        </div>
      </div>

      {!loading && !err && data && (
        <PeriodSummary data={data} mode={mode} />
      )}

      <section
        className="chartPanel"
        aria-label={chartView === "anomaly" ? "Anomalia climatica" : "Andamento del periodo"}
      >
        {supportsClimatology && (
          <div className="chartViewToggle">
            <button
              type="button"
              className={`anomalyToggle ${chartView === "anomaly" ? "active" : ""}`}
              aria-pressed={chartView === "anomaly"}
              aria-label={
                chartView === "anomaly"
                  ? "Torna al grafico con osservazioni e climatologia"
                  : "Mostra il grafico dell'anomalia climatica"
              }
              onClick={() =>
                setChartView((current) =>
                  current === "anomaly" ? "observed" : "anomaly",
                )
              }
            >
              Anomalia
            </button>
          </div>
        )}

        {chartView === "anomaly" ? (
          <ClimatologyChart
            mode={mode}
            groupKey={groupKey}
            currentData={data}
            climatologyData={activeClimatologyData}
            currentBounds={bounds}
            loading={loading || activeClimatologyLoading}
            error={activeClimatologyError}
            isMobile={isMobileChart}
            isVeryNarrow={isVeryNarrowChart}
            chartHeight={chartHeight}
          />
        ) : (
          <div className="chartArea">
            {loading && <div className="msg">Caricamento del grafico…</div>}
            {!loading && err && <div className="msg">{err}</div>}
            {!loading && !err && option && (
              <ResponsivePeriodEChart
                option={option}
                height={chartHeight}
                chartKey={`period-${mode}-${groupKey}-${isMobileChart ? "mobile" : "desktop"}-${activeClimatologyData ? "clim" : "base"}`}
              />
            )}
            {!loading &&
              !err &&
              supportsClimatology &&
              activeClimatologyLoading && (
                <div className="climatologyStatus">Caricamento climatologia…</div>
              )}
          </div>
        )}
      </section>

      {supportsRainClimatology &&
        !loading &&
        !err &&
        precipHistoryError && (
          <div
            style={{
              margin: "-8px 20px 14px",
              fontSize: "10px",
              fontWeight: 750,
              color: "#64748b",
              textAlign: "center",
            }}
          >
            {precipHistoryError}
          </div>
        )}

      {supportsClimatology &&
        !loading &&
        !err &&
        data &&
        activeClimatologyData &&
        !activeClimatologyError && (
          <AnomalySummaryPanel
            mode={mode}
            groupKey={groupKey}
            currentData={data}
            climatologyData={activeClimatologyData}
            currentBounds={bounds}
          />
        )}

      <style jsx>{`
        .periodCard {
          border: 1px solid #dbe5ef;
          border-radius: 24px;
          background: #fff;
          box-shadow: 0 12px 34px rgba(15, 23, 42, 0.075);
          overflow: hidden;
        }

        .dataHeader {
          padding: 16px 24px 14px;
          display: grid;
          justify-items: center;
          gap: 0;
          border-bottom: 1px solid #e7edf4;
          background:
            radial-gradient(480px 110px at 50% -55%, rgba(37, 99, 235, 0.09), transparent 72%),
            linear-gradient(180deg, #ffffff, #fbfdff);
          text-align: center;
        }

        .dataHeader h2 {
          margin: 0;
          font-size: 24px;
          font-weight: 950;
          line-height: 1.08;
          letter-spacing: -0.025em;
          color: #0b1f45;
        }

        .dateNavigator {
          position: relative;
          min-height: 84px;
          padding: 11px 20px;
          display: grid;
          grid-template-columns: 220px minmax(0, 1fr) 220px;
          align-items: center;
          gap: 14px;
          background:
            radial-gradient(520px 120px at 50% -35%, rgba(55, 145, 255, 0.45), transparent 70%),
            linear-gradient(100deg, #0758c9, #06439a 58%, #06377c);
          color: #fff;
        }

        .navControl {
          min-width: 0;
          display: grid;
          gap: 5px;
          position: relative;
          z-index: 2;
        }

        .navControlLeft {
          grid-column: 1;
          justify-self: start;
          width: 190px;
        }

        .navControlRight {
          grid-column: 3;
          justify-self: end;
          width: 220px;
        }

        .navControlLabel {
          font-size: 7.5px;
          font-weight: 950;
          color: rgba(255, 255, 255, 0.72);
          text-transform: uppercase;
          letter-spacing: 0.075em;
          text-align: center;
        }

        .dateNavigatorCenter {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1;
        }

        .dateText {
          min-width: 270px;
          display: grid;
          justify-items: center;
          text-align: center;
        }

        .dateText strong {
          font-size: 14px;
          font-weight: 950;
          text-transform: capitalize;
        }

        .chartPanel {
          position: relative;
          margin: 0 20px 18px;
          overflow: hidden;
          border: 1px solid #dce5ef;
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.045);
        }

        .chartViewToggle {
          position: absolute;
          right: 14px;
          top: 13px;
          z-index: 20;
        }

        .anomalyToggle {
          min-width: 94px;
          min-height: 27px;
          padding: 5px 11px;
          border: 1px solid #d7e0ea;
          border-radius: 9px;
          background: #ffffff;
          color: #0f172a;
          font: inherit;
          font-size: 9px;
          font-weight: 900;
          line-height: 1;
          cursor: pointer;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
          transition:
            border-color 120ms ease,
            background 120ms ease,
            color 120ms ease,
            box-shadow 120ms ease;
        }

        .anomalyToggle:hover {
          border-color: #9db9dc;
          background: #f8fbff;
        }

        .anomalyToggle:focus-visible {
          outline: none;
          border-color: #6ea5ea;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .anomalyToggle.active {
          border-color: #70a7ef;
          background: #eaf3ff;
          color: #0b5ed7;
          box-shadow:
            inset 0 0 0 1px rgba(37, 99, 235, 0.04),
            0 1px 2px rgba(15, 23, 42, 0.03);
        }

        .chartArea {
          position: relative;
          z-index: 1;
          width: 100%;
          min-width: 0;
          min-height: 0;
          padding: 0;
          box-sizing: border-box;
          background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
        }

        .climatologyStatus {
          position: absolute;
          right: 120px;
          top: 14px;
          z-index: 12;
          padding: 5px 8px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.92);
          color: #64748b;
          font-size: 8px;
          font-weight: 850;
          pointer-events: none;
        }

        .msg {
          min-height: 390px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          text-align: center;
          font-size: 12px;
          color: rgba(15, 23, 42, 0.66);
          font-weight: 850;
        }

        @media (max-width: 1050px) and (min-width: 721px) {
          .dateNavigator {
            grid-template-columns: 180px minmax(0, 1fr) 210px;
            gap: 10px;
            padding-left: 14px;
            padding-right: 14px;
          }

          .navControlLeft { width: 170px; }
          .navControlRight { width: 205px; }

          .dateNavigatorCenter {
            justify-content: center;
          }

          .dateText {
            min-width: 0;
          }
        }

        @media (max-width: 720px) {
          .periodCard {
            border-radius: 17px;
          }

          .dataHeader {
            padding: 11px 10px 10px;
          }

          .dataHeader h2 {
            font-size: 19px;
          }

          .dateNavigator {
            min-height: 0;
            padding: 9px 10px 10px;
            grid-template-columns: minmax(92px, 0.78fr) minmax(0, 1.45fr);
            grid-template-rows: auto auto;
            align-items: end;
            gap: 8px 10px;
          }

          .dateNavigatorCenter {
            position: static;
            transform: none;
            grid-column: 1 / -1;
            grid-row: 1;
            width: 100%;
            display: flex;
            justify-content: center;
          }

          .navControlLeft {
            grid-column: 1;
            grid-row: 2;
            width: 100%;
            justify-self: stretch;
          }

          .navControlRight {
            grid-column: 2;
            grid-row: 2;
            width: 100%;
            justify-self: stretch;
          }

          .navControl {
            gap: 3px;
          }

          .navControlLabel {
            font-size: 6.5px;
            letter-spacing: 0.055em;
          }

          .dateText {
            min-width: 0;
          }

          .dateText strong {
            font-size: 12.5px;
            line-height: 1.1;
          }

          .chartPanel {
            width: auto;
            max-width: calc(100% - 16px);
            margin: 0 8px 10px;
            border-radius: 13px;
          }

          .chartViewToggle {
            right: 8px;
            top: 38px;
          }

          .anomalyToggle {
            min-width: 78px;
            min-height: 25px;
            padding: 4px 8px;
            border-radius: 8px;
            font-size: 8.5px;
          }

          .climatologyStatus {
            right: 8px;
            top: 8px;
            font-size: 7.5px;
          }

          .chartArea {
            min-height: 0;
            padding: 0;
            overflow: hidden;
          }

          .msg {
            min-height: 225px;
          }
        }

        @media (max-width: 390px) {
          .dateNavigator {
            grid-template-columns: 90px minmax(0, 1fr);
            gap: 7px;
          }

          .dateText strong {
            font-size: 11.5px;
          }

          .anomalyToggle {
            min-width: 72px;
            padding-left: 6px;
            padding-right: 6px;
            font-size: 8px;
          }

        }
      `}</style>
    </div>
  );
}