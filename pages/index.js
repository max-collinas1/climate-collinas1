import fs from "fs";
import path from "path";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import SiteLayout from "../components/SiteLayout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// -------------------- caricamento dati (SSG) --------------------
function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function readMonthlyOverrides() {
  const filePath = path.join(process.cwd(), "data", "monthly_overrides.json");
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function readIntradayDates() {
  const dirPath = path.join(process.cwd(), "public", "data", "intraday");
  if (!fs.existsSync(dirPath)) return [];

  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .map((name) => name.replace(/\.json$/, ""))
      .sort();
  } catch {
    return [];
  }
}

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

// -------------------- helper numerici --------------------
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

function fmt1(x, fallback = "—") {
  const r = round1(x);
  return r === null ? fallback : r.toFixed(1);
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

// -------------------- helper date --------------------
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

  // "Oggi" è un giorno di calendario: 00:00–24:00 della data selezionata.
  if (mode === "day") {
    return { startISO: selectedDate, endISO: selectedDate };
  }

  // Per 7 e 30 giorni carichiamo anche il giorno iniziale necessario a
  // costruire una finestra mobile esatta fino all'ultima osservazione.
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


function nearestAvailableDate(dates, targetISO, direction = 0) {
  if (!Array.isArray(dates) || !dates.length) return targetISO || null;
  const sorted = dates;

  if (sorted.includes(targetISO)) return targetISO;

  if (direction < 0) {
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      if (sorted[i] <= targetISO) return sorted[i];
    }
    return sorted[0];
  }

  if (direction > 0) {
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i] >= targetISO) return sorted[i];
    }
    return sorted[sorted.length - 1];
  }

  const target = isoToLocalDate(targetISO)?.getTime();
  if (!Number.isFinite(target)) return sorted[sorted.length - 1];

  let best = sorted[0];
  let bestDistance = Infinity;

  for (const iso of sorted) {
    const t = isoToLocalDate(iso)?.getTime();
    const distance = Number.isFinite(t) ? Math.abs(t - target) : Infinity;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = iso;
    }
  }

  return best;
}

function moveSelectedDate(dates, selectedDate, mode, direction) {
  if (!dates.length || !selectedDate) return selectedDate;

  if (mode === "day") {
    const current = nearestAvailableDate(dates, selectedDate, direction);
    const index = Math.max(0, dates.indexOf(current));
    const nextIndex = Math.max(
      0,
      Math.min(dates.length - 1, index + direction),
    );
    return dates[nextIndex];
  }

  const days = mode === "week" ? 7 : 30;
  const target = addDaysISO(selectedDate, direction * days);
  return nearestAvailableDate(dates, target, direction);
}


function navigationDisabled(dates, selectedDate, mode, direction) {
  if (!dates.length || !selectedDate) return true;

  if (mode === "day") {
    const current = nearestAvailableDate(dates, selectedDate, direction);
    const index = dates.indexOf(current);
    return direction < 0 ? index <= 0 : index >= dates.length - 1;
  }

  const first = dates[0];
  const last = dates[dates.length - 1];
  const currentBounds = getPeriodBounds(mode, selectedDate);

  if (!currentBounds?.startISO || !currentBounds?.endISO) return true;

  return direction < 0
    ? currentBounds.startISO <= first
    : currentBounds.endISO >= last;
}

// -------------------- helper grafici --------------------
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

function lastNonNullPoint(pairs) {
  if (!Array.isArray(pairs)) return null;

  for (let i = pairs.length - 1; i >= 0; i -= 1) {
    const point = pairs[i];
    const x = point?.[0];
    const rawY = point?.[1];
    const y = n(rawY);

    if (x !== null && x !== undefined && Number.isFinite(y)) {
      return [Number(x), y];
    }
  }

  return null;
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

function makeRealtimePulseSeries(dataPairs, timestamp, yAxisIndex = 0) {
  const point = pointAtOrBeforeTimestamp(dataPairs, timestamp);
  if (!point) return null;

  return {
    name: "Dato live",
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

// -------------------- helper dati giornalieri --------------------
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

// -------------------- getStaticProps --------------------
export async function getStaticProps() {
  const rows = readDaily()
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r?.date || "")))
    .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));

  const overrides = readMonthlyOverrides();

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

    const tmin = minFinite(d.map((x) => dailyTmin(x)));
    const tmax = maxFinite(d.map((x) => dailyTmax(x)));
    const tmean = avgFinite(d.map((x) => dailyTmean(x)));
    const rainSum = sumFinite(monthly.map((m) => m.rainSum));
    const gustMax = maxFinite(d.map((x) => dailyGust(x)));

    return {
      year: y,
      ndays: d.length,
      tmin: Number.isFinite(tmin) ? tmin : null,
      tmax: Number.isFinite(tmax) ? tmax : null,
      tmean: Number.isFinite(tmean) ? tmean : null,
      rain: Number.isFinite(rainSum) ? rainSum : null,
      rainyDays: d
        .map((x) => n(x?.rain_total))
        .filter((x) => Number.isFinite(x) && x > 1).length,
      gustMax: Number.isFinite(gustMax) ? gustMax : null,
      rainHasOverride: overrideMonths.length > 0,
      rainOverrideMonthsText: overrideMonths
        .map((m) => monthFull(m.ym))
        .join(", "),
    };
  });

  const dailyDates = rows
    .map((r) => String(r?.date || "").slice(0, 10))
    .filter((iso) => /^\d{4}-\d{2}-\d{2}$/.test(iso));

  const diskIntradayDates = readIntradayDates();
  const intradayDates = diskIntradayDates.length
    ? diskIntradayDates
    : Array.from(new Set(dailyDates)).sort();

  const dailyRainByDate = {};
  for (const row of rows) {
    const iso = String(row?.date || "").slice(0, 10);
    const rain = dailyRain(row);

    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      dailyRainByDate[iso] = Number.isFinite(rain) ? round1(rain) : null;
    }
  }

  // Dati giornalieri compatti usati esclusivamente dal grafico annuale
  // della Home. Limitiamo il payload agli ultimi 6 anni mostrati in pagina.
  const annualDataByYear = {};
  for (const year of years.slice(0, 6)) {
    annualDataByYear[year] = (byYear.get(year) || []).map((row) => {
      const tmin = dailyTmin(row);
      const tmean = dailyTmean(row);
      const tmax = dailyTmax(row);
      const rain = dailyRain(row);
      const gust = dailyGust(row);

      return {
        date: String(row?.date || ""),
        tmin: Number.isFinite(tmin) ? round1(tmin) : null,
        tmean: Number.isFinite(tmean) ? round1(tmean) : null,
        tmax: Number.isFinite(tmax) ? round1(tmax) : null,
        rain: Number.isFinite(rain) ? round1(rain) : null,
        gust: Number.isFinite(gust) ? round1(gust) : null,
      };
    });
  }

  return {
    props: {
      start,
      end,
      yearStats,
      intradayDates,
      dailyRainByDate,
      annualDataByYear,
    },
    revalidate: 300,
  };
}

// -------------------- homepage --------------------
export default function Home({
  yearStats = [],
  start = null,
  end = null,
  intradayDates = [],
  dailyRainByDate = {},
  annualDataByYear = {},
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
      <CivilProtectionSection />

      <ForecastSection />

      <div className="chartWrap">
        <PeriodChart
          intradayDates={intradayDates}
          dailyRainByDate={dailyRainByDate}
        />
      </div>

      <HomeLowerSection
        yearStats={yearStats}
        annualDataByYear={annualDataByYear}
      />

      <style jsx>{`
        .chartWrap {
          margin-top: 18px;
        }
      `}</style>
    </SiteLayout>
  );
}

function CivilProtectionSection() {
  return (
    <section
      className="civilProtectionSection"
      aria-label="Protezione Civile e avvisi ufficiali"
    >
      <div className="civilHeading">
        <span className="civilShield" aria-hidden="true">◇</span>
        <div>
          <h2>Protezione Civile e avvisi</h2>
          <p>
            Informazioni ufficiali su allerte, criticità e avvisi per il territorio
            di Collinas e la Sardegna.
          </p>
        </div>
      </div>

      <div className="civilBody">
        <div className="civilStatusCard">
          <span className="civilStatusIcon" aria-hidden="true">◇</span>
          <div>
            <span className="civilEyebrow">Stato attuale</span>
            <strong>Consulta gli avvisi in corso</strong>
            <p>
              Lo stato mostrato sul sito non sostituisce le comunicazioni ufficiali:
              verifica sempre gli ultimi bollettini pubblicati dalla Regione Sardegna.
            </p>
          </div>
        </div>

        <div className="civilLinksCard">
          <div className="civilLinksTitle">
            <span className="civilLinkIcon" aria-hidden="true">↗</span>
            <div>
              <span className="civilEyebrow">Link ufficiali</span>
              <strong>Approfondisci e consulta</strong>
              <p>Bollettini, allerte e comunicazioni della Protezione Civile regionale.</p>
            </div>
          </div>

          <div className="civilLinks">
            <a
              href="https://www.sardegnaambiente.it/protezionecivile/"
              target="_blank"
              rel="noreferrer"
            >
              <span aria-hidden="true">↗</span>
              <span>
                <b>Bollettini e avvisi</b>
                <small>Protezione Civile Sardegna</small>
              </span>
              <i aria-hidden="true">›</i>
            </a>
            <a
              href="https://www.sardegnaambiente.it/"
              target="_blank"
              rel="noreferrer"
            >
              <span aria-hidden="true">↗</span>
              <span>
                <b>Portale regionale</b>
                <small>Regione Sardegna</small>
              </span>
              <i aria-hidden="true">›</i>
            </a>
          </div>
        </div>
      </div>

      <style jsx>{`
        .civilProtectionSection {
          margin: 18px auto 0;
          padding: 18px;
          border: 1px solid #e1e8f0;
          border-radius: 22px;
          background: #ffffff;
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.045);
        }

        .civilHeading {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 14px;
        }

        .civilShield,
        .civilStatusIcon,
        .civilLinkIcon {
          flex: 0 0 auto;
          display: grid;
          place-items: center;
          border-radius: 50%;
          font-weight: 950;
        }

        .civilShield {
          width: 48px;
          height: 48px;
          background: #eaf3ff;
          color: #1667d9;
          font-size: 27px;
        }

        .civilHeading h2,
        .civilHeading p,
        .civilStatusCard p,
        .civilLinksTitle p {
          margin: 0;
        }

        .civilHeading h2 {
          font-size: 22px;
          line-height: 1.08;
          font-weight: 950;
          letter-spacing: -0.025em;
          color: #0f172a;
        }

        .civilHeading p {
          margin-top: 3px;
          font-size: 11px;
          color: #64748b;
        }

        .civilBody {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 12px;
        }

        .civilStatusCard,
        .civilLinksCard {
          min-width: 0;
          border: 1px solid #e3e9ef;
          border-radius: 17px;
          padding: 16px;
          background: #fbfdff;
        }

        .civilStatusCard {
          display: grid;
          grid-template-columns: 58px minmax(0, 1fr);
          align-items: center;
          gap: 14px;
          background: linear-gradient(135deg, #f3fff8 0%, #ffffff 100%);
          border-color: #d9efe2;
        }

        .civilStatusIcon {
          width: 58px;
          height: 58px;
          background: #dcfce7;
          color: #0a9b59;
          font-size: 33px;
        }

        .civilEyebrow {
          display: block;
          margin-bottom: 4px;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #64748b;
        }

        .civilStatusCard strong,
        .civilLinksTitle strong {
          display: block;
          font-size: 17px;
          line-height: 1.12;
          font-weight: 950;
          color: #0f172a;
        }

        .civilStatusCard p,
        .civilLinksTitle p {
          margin-top: 6px;
          font-size: 10px;
          line-height: 1.4;
          color: #64748b;
        }

        .civilLinksTitle {
          display: grid;
          grid-template-columns: 46px minmax(0, 1fr);
          align-items: center;
          gap: 12px;
        }

        .civilLinkIcon {
          width: 46px;
          height: 46px;
          background: #eaf3ff;
          color: #1768d9;
          font-size: 20px;
        }

        .civilLinks {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .civilLinks a {
          min-width: 0;
          min-height: 52px;
          padding: 9px 11px;
          display: grid;
          grid-template-columns: 24px minmax(0, 1fr) auto;
          align-items: center;
          gap: 8px;
          border: 1px solid #e0e9f5;
          border-radius: 12px;
          background: #eef5ff;
          color: #0f5bc7;
          text-decoration: none;
          transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
        }

        .civilLinks a:hover {
          transform: translateY(-1px);
          border-color: #b6d2f7;
          background: #e6f1ff;
        }

        .civilLinks a > span:first-child {
          font-size: 17px;
          font-weight: 900;
          text-align: center;
        }

        .civilLinks a > span:nth-child(2) {
          min-width: 0;
          display: grid;
          gap: 2px;
        }

        .civilLinks b {
          overflow: hidden;
          font-size: 10.5px;
          font-weight: 950;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .civilLinks small {
          overflow: hidden;
          font-size: 8.5px;
          color: #5f7fa9;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .civilLinks i {
          font-size: 20px;
          font-style: normal;
          color: #1768d9;
        }

        @media (max-width: 760px) {
          .civilProtectionSection {
            padding: 14px;
            border-radius: 18px;
          }

          .civilHeading h2 {
            font-size: 19px;
          }

          .civilBody {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 480px) {
          .civilHeading {
            align-items: flex-start;
          }

          .civilShield {
            width: 42px;
            height: 42px;
            font-size: 24px;
          }

          .civilHeading h2 {
            font-size: 17px;
          }

          .civilHeading p {
            font-size: 9.5px;
          }

          .civilStatusCard {
            grid-template-columns: 46px minmax(0, 1fr);
            padding: 13px;
          }

          .civilStatusIcon {
            width: 46px;
            height: 46px;
            font-size: 27px;
          }

          .civilStatusCard strong,
          .civilLinksTitle strong {
            font-size: 14px;
          }

          .civilLinks {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}

function HomeLowerSection({ yearStats = [], annualDataByYear = {} }) {
  const router = useRouter();
  const years = Array.isArray(yearStats) ? yearStats.slice(0, 6) : [];
  const [selectedYear, setSelectedYear] = useState(years[0]?.year || "");
  const [annualParameter, setAnnualParameter] = useState("temperature");

  const selectedStats =
    years.find((item) => String(item?.year) === String(selectedYear)) ||
    years[0] ||
    null;

  const selectedRows = Array.isArray(annualDataByYear?.[selectedYear])
    ? annualDataByYear[selectedYear]
    : [];

  const annualParameterOptions = [
    { key: "temperature", label: "Temperatura dell'aria (°C)" },
    { key: "rain", label: "Precipitazioni (mm)" },
    { key: "gust", label: "Raffica massima (km/h)" },
  ];

  const annualChartOption = useMemo(() => {
    if (!selectedRows.length) return null;

    const dates = selectedRows.map((row) => String(row?.date || ""));
    const monthLines = dates
      .filter((date, index) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
        if (index === 0) return false;
        return date.endsWith("-01");
      })
      .map((date) => ({ xAxis: date }));

    const commonMarkLine = monthLines.length
      ? {
          silent: true,
          symbol: "none",
          label: { show: false },
          lineStyle: {
            color: "rgba(148, 163, 184, 0.20)",
            width: 1,
            type: "solid",
          },
          data: monthLines,
        }
      : undefined;

    const axisLabelFormatter = (value, index) => {
      const date = String(value || "");
      const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return "";

      const day = Number(match[3]);
      if (index !== 0 && day !== 1) return "";

      const month = MONTHS_IT_FULL[Number(match[2]) - 1] || "";
      return month.slice(0, 3);
    };

    const base = {
      animationDuration: 260,
      color: ["#ef4444", "#64748b", "#2563eb", "#0ea5e9"],
      grid: { left: 58, right: 42, top: 24, bottom: 62 },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(255,255,255,.98)",
        borderColor: "#dbe3ec",
        borderWidth: 1,
        padding: [9, 11],
        textStyle: { color: "#0f172a", fontSize: 11, fontWeight: 650 },
        extraCssText:
          "border-radius:10px;box-shadow:0 10px 28px rgba(15,23,42,.12);",
      },
      toolbox: {
        right: 4,
        top: -2,
        feature: {
          restore: { title: "Ripristina" },
          saveAsImage: {
            title: "Salva grafico",
            name: `meteo-collinas-${selectedYear}-${annualParameter}`,
            pixelRatio: 2,
            backgroundColor: "#ffffff",
          },
        },
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: dates,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: "#aab4c0" } },
        axisLabel: {
          color: "#64748b",
          fontSize: 10,
          interval: 0,
          formatter: axisLabelFormatter,
        },
        splitLine: { show: false },
      },
      dataZoom: [
        {
          type: "inside",
          xAxisIndex: 0,
          filterMode: "none",
          zoomOnMouseWheel: true,
          moveOnMouseWheel: true,
          moveOnMouseMove: true,
        },
      ],
    };

    if (annualParameter === "rain") {
      let cumulative = 0;
      const rainDaily = selectedRows.map((row) => {
        const value = n(row?.rain);
        return Number.isFinite(value) ? Math.max(0, value) : null;
      });
      const rainCumulative = rainDaily.map((value) => {
        if (Number.isFinite(n(value))) cumulative += n(value);
        return round1(cumulative);
      });

      return {
        ...base,
        legend: {
          bottom: 4,
          left: "center",
          itemGap: 22,
          textStyle: { color: "#475569", fontSize: 10, fontWeight: 700 },
          data: ["Pioggia giornaliera", "Cumulata"],
        },
        xAxis: { ...base.xAxis, boundaryGap: true },
        yAxis: [
          {
            type: "value",
            name: "mm",
            nameLocation: "middle",
            nameGap: 42,
            min: 0,
            splitLine: {
              lineStyle: { color: "rgba(148,163,184,.18)", type: "dashed" },
            },
            axisLabel: { color: "#64748b", fontSize: 10 },
          },
          {
            type: "value",
            name: "mm cum.",
            nameLocation: "middle",
            nameGap: 40,
            min: 0,
            splitLine: { show: false },
            axisLabel: { color: "#64748b", fontSize: 10 },
          },
        ],
        series: [
          {
            name: "Pioggia giornaliera",
            type: "bar",
            data: rainDaily,
            yAxisIndex: 0,
            barMaxWidth: 8,
            itemStyle: {
              color: "#38bdf8",
              borderRadius: [3, 3, 0, 0],
            },
            markLine: commonMarkLine,
          },
          {
            name: "Cumulata",
            type: "line",
            data: rainCumulative,
            yAxisIndex: 1,
            showSymbol: false,
            smooth: false,
            lineStyle: { width: 2.2, color: "#2563eb" },
            itemStyle: { color: "#2563eb" },
          },
        ],
      };
    }

    if (annualParameter === "gust") {
      return {
        ...base,
        legend: {
          bottom: 4,
          left: "center",
          textStyle: { color: "#475569", fontSize: 10, fontWeight: 700 },
          data: ["Raffica massima"],
        },
        yAxis: {
          type: "value",
          name: "km/h",
          nameLocation: "middle",
          nameGap: 45,
          min: 0,
          splitLine: {
            lineStyle: { color: "rgba(148,163,184,.18)", type: "dashed" },
          },
          axisLabel: { color: "#64748b", fontSize: 10 },
        },
        series: [
          {
            name: "Raffica massima",
            type: "line",
            data: selectedRows.map((row) => {
              const value = n(row?.gust);
              return Number.isFinite(value) ? value : null;
            }),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            lineStyle: { width: 2.1, color: "#7c3aed" },
            itemStyle: { color: "#7c3aed" },
            markLine: commonMarkLine,
          },
        ],
      };
    }

    return {
      ...base,
      legend: {
        bottom: 4,
        left: "center",
        itemGap: 22,
        textStyle: { color: "#475569", fontSize: 10, fontWeight: 700 },
        data: ["Temperatura massima", "Temperatura media", "Temperatura minima"],
      },
      yAxis: {
        type: "value",
        name: "°C",
        nameLocation: "middle",
        nameGap: 42,
        splitLine: {
          lineStyle: { color: "rgba(148,163,184,.18)", type: "dashed" },
        },
        axisLabel: { color: "#64748b", fontSize: 10 },
      },
      series: [
        {
          name: "Temperatura massima",
          type: "line",
          data: selectedRows.map((row) => {
            const value = n(row?.tmax);
            return Number.isFinite(value) ? value : null;
          }),
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          lineStyle: { width: 1.9, color: "#ef4444" },
          itemStyle: { color: "#ef4444" },
          markLine: commonMarkLine,
        },
        {
          name: "Temperatura media",
          type: "line",
          data: selectedRows.map((row) => {
            const value = n(row?.tmean);
            return Number.isFinite(value) ? value : null;
          }),
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          lineStyle: { width: 2.2, color: "#64748b", type: "dashed" },
          itemStyle: { color: "#64748b" },
        },
        {
          name: "Temperatura minima",
          type: "line",
          data: selectedRows.map((row) => {
            const value = n(row?.tmin);
            return Number.isFinite(value) ? value : null;
          }),
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          lineStyle: { width: 1.9, color: "#2563eb" },
          itemStyle: { color: "#2563eb" },
        },
      ],
    };
  }, [annualParameter, selectedRows, selectedYear]);

  const latestYear = years[0]?.year || null;
  const goArchive = () => {
    if (latestYear) router.push(`/anni/${latestYear}`);
  };

  return (
    <section className="homeLower" aria-label="Archivio meteo e stazione meteorologica">
      <article className="lowerPanel archiveSection">
        <div className="lowerPanelHead">
          <div className="lowerTitle">
            <span className="lowerIcon" aria-hidden="true">▥</span>
            <div>
              <h2>Archivio meteo</h2>
              <p>Consulta e confronta i dati meteorologici degli anni passati.</p>
            </div>
          </div>

          <button type="button" className="archiveLink" onClick={goArchive} disabled={!latestYear}>
            Vedi l&apos;archivio completo <span aria-hidden="true">→</span>
          </button>
        </div>

        <div className="yearCards">
          {years.map((item) => {
            const active = String(item?.year) === String(selectedYear);
            return (
              <button
                key={item.year}
                type="button"
                className={`yearCard ${active ? "active" : ""}`}
                onClick={() => setSelectedYear(String(item.year))}
                aria-pressed={active}
              >
                <div className="yearCardTop">
                  <strong>{item.year}</strong>
                  <span>{Number.isFinite(n(item.ndays)) ? `${item.ndays} giorni` : "—"}</span>
                </div>
                <div className="yearMetric temperatureMetric">
                  <i aria-hidden="true">↕</i>
                  <span><b>{fmt(item.tmean, 1)} °C</b><small>Temp. media</small></span>
                </div>
                <div className="yearMetric rainMetric">
                  <i aria-hidden="true">◆</i>
                  <span><b>{fmt(item.rain, 1)} mm</b><small>Prec. totale</small></span>
                </div>
                <span className="yearChevron" aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
      </article>

      <article className="lowerPanel annualSection">
        <div className="annualHeader">
          <div className="lowerTitle">
            <span className="lowerIcon" aria-hidden="true">⌁</span>
            <div>
              <h2>Grafico annuale</h2>
              <p>
                Andamento dei principali parametri meteorologici per il {selectedYear || "—"}.
              </p>
            </div>
          </div>

          <div className="annualControl">
            <span>Parametro</span>
            <CustomSelect
              value={annualParameter}
              options={annualParameterOptions}
              onChange={setAnnualParameter}
              ariaLabel="Seleziona parametro del grafico annuale"
            />
          </div>
        </div>

        {selectedStats && (
          <div className="annualHighlights">
            <div className="annualHighlight maxTemp">
              <span className="highlightIcon" aria-hidden="true">↑</span>
              <div><strong>{fmt(selectedStats.tmax, 1)} °C</strong><span>Massima assoluta</span></div>
            </div>
            <div className="annualHighlight minTemp">
              <span className="highlightIcon" aria-hidden="true">↓</span>
              <div><strong>{fmt(selectedStats.tmin, 1)} °C</strong><span>Minima assoluta</span></div>
            </div>
            <div className="annualHighlight meanTemp">
              <span className="highlightIcon" aria-hidden="true">↕</span>
              <div><strong>{fmt(selectedStats.tmean, 1)} °C</strong><span>Media annuale</span></div>
            </div>
            <div className="annualHighlight rainTotal">
              <span className="highlightIcon" aria-hidden="true">◆</span>
              <div><strong>{fmt(selectedStats.rain, 1)} mm</strong><span>Precipitazioni totali</span></div>
            </div>
          </div>
        )}

        <div className="annualChartWrap">
          {annualChartOption ? (
            <ReactECharts
              option={annualChartOption}
              style={{ height: 330, width: "100%" }}
              notMerge={true}
              lazyUpdate={true}
            />
          ) : (
            <div className="annualChartMessage">
              Dati annuali non disponibili per l&apos;anno selezionato.
            </div>
          )}
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
          border-radius: 21px;
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 8px 28px rgba(15, 23, 42, 0.045);
        }

        .archiveSection {
          padding: 17px 18px 18px;
        }

        .lowerPanelHead,
        .annualHeader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .lowerTitle {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .lowerIcon {
          flex: 0 0 auto;
          width: 46px;
          height: 46px;
          display: grid;
          place-items: center;
          border-radius: 15px;
          background: #eaf3ff;
          color: #126be8;
          font-size: 22px;
          font-weight: 950;
        }

        .lowerTitle h2,
        .lowerTitle p,
        .stationIntro h2,
        .stationIntro h3,
        .stationIntro p,
        .stationSensors h3 {
          margin: 0;
        }

        .lowerTitle h2,
        .stationIntro h2 {
          font-size: 22px;
          line-height: 1.05;
          font-weight: 950;
          letter-spacing: -0.025em;
          color: #0f172a;
        }

        .lowerTitle p {
          margin-top: 3px;
          font-size: 10.5px;
          color: #64748b;
        }

        .archiveLink {
          appearance: none;
          border: 0;
          background: transparent;
          color: #1169e8;
          font: inherit;
          font-size: 10.5px;
          font-weight: 900;
          cursor: pointer;
          white-space: nowrap;
        }

        .archiveLink:disabled {
          opacity: 0.45;
          cursor: default;
        }

        .yearCards {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(6, minmax(0, 1fr));
          gap: 9px;
        }

        .yearCard {
          position: relative;
          min-width: 0;
          min-height: 112px;
          padding: 12px 13px;
          border: 1px solid #e2e8f0;
          border-radius: 14px;
          background: #ffffff;
          color: #0f172a;
          font-family: inherit;
          text-align: left;
          cursor: pointer;
          transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;
        }

        .yearCard:hover {
          transform: translateY(-2px);
          border-color: #b9cce6;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.06);
        }

        .yearCard.active {
          border-color: #6ba9ff;
          background: linear-gradient(180deg, #ffffff 0%, #f6faff 100%);
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.06);
        }

        .yearCardTop {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 9px;
        }

        .yearCardTop strong {
          font-size: 21px;
          line-height: 1;
          font-weight: 950;
          letter-spacing: -0.02em;
        }

        .yearCardTop span {
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
          grid-template-columns: 19px minmax(0, 1fr);
          align-items: center;
          gap: 6px;
          margin-top: 5px;
        }

        .yearMetric i {
          font-size: 12px;
          font-style: normal;
          font-weight: 950;
          text-align: center;
        }

        .temperatureMetric i { color: #2563eb; }
        .rainMetric i { color: #0b77df; }

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

        .yearChevron {
          position: absolute;
          right: 10px;
          top: 50%;
          transform: translateY(-50%);
          color: #64748b;
          font-size: 19px;
        }

        .annualSection {
          overflow: visible;
          padding: 17px 18px 8px;
        }

        .annualControl {
          width: 290px;
          min-width: 0;
          display: grid;
          grid-template-columns: auto minmax(0, 1fr);
          align-items: center;
          gap: 10px;
        }

        .annualControl > span {
          font-size: 9.5px;
          font-weight: 850;
          color: #64748b;
        }

        .annualControl :global(.customSelect .selectButton) {
          min-height: 38px;
          border-radius: 11px;
          padding: 8px 34px 8px 12px;
          justify-content: flex-start;
          font-size: 10.5px;
          text-align: left;
        }

        .annualControl :global(.customSelect .selectedValue) {
          text-align: left;
        }

        .annualHighlights {
          margin-top: 14px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          border: 1px solid #e8edf3;
          border-radius: 15px;
          background: #fbfcfe;
          overflow: hidden;
        }

        .annualHighlight {
          min-width: 0;
          min-height: 70px;
          padding: 10px 14px;
          display: grid;
          grid-template-columns: 38px minmax(0, 1fr);
          align-items: center;
          gap: 9px;
          border-right: 1px solid #e8edf3;
        }

        .annualHighlight:last-child {
          border-right: 0;
        }

        .highlightIcon {
          width: 36px;
          height: 36px;
          display: grid;
          place-items: center;
          border-radius: 50%;
          background: #edf5ff;
          color: #2563eb;
          font-size: 18px;
          font-weight: 950;
        }

        .maxTemp .highlightIcon { background: #fff0ef; color: #ef4444; }
        .minTemp .highlightIcon { background: #eef5ff; color: #2563eb; }
        .meanTemp .highlightIcon { background: #f1f5f9; color: #64748b; }
        .rainTotal .highlightIcon { background: #eaf7ff; color: #0284c7; }

        .annualHighlight div {
          min-width: 0;
          display: grid;
          gap: 2px;
        }

        .annualHighlight strong {
          overflow: hidden;
          font-size: 15px;
          font-weight: 950;
          color: #0f172a;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .annualHighlight div span {
          font-size: 9px;
          color: #64748b;
        }

        .annualChartWrap {
          min-height: 330px;
          margin-top: 6px;
        }

        .annualChartMessage {
          min-height: 300px;
          display: flex;
          align-items: center;
          justify-content: center;
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
          box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.10);
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
            border-radius: 17px;
          }

          .lowerPanelHead,
          .annualHeader {
            align-items: flex-start;
            flex-direction: column;
          }

          .archiveLink {
            align-self: flex-end;
          }

          .annualControl {
            width: 100%;
            grid-template-columns: 1fr;
            gap: 4px;
          }

          .annualHighlights {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .annualHighlight:nth-child(2) {
            border-right: 0;
          }

          .annualHighlight:nth-child(-n + 2) {
            border-bottom: 1px solid #e8edf3;
          }
        }

        @media (max-width: 560px) {
          .lowerTitle h2,
          .stationIntro h2 {
            font-size: 18px;
          }

          .lowerIcon {
            width: 40px;
            height: 40px;
            border-radius: 13px;
            font-size: 19px;
          }

          .yearCards {
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 7px;
          }

          .yearCard {
            min-height: 104px;
            padding: 10px;
          }

          .yearCardTop strong {
            font-size: 18px;
          }

          .yearCardTop span {
            font-size: 7px;
          }

          .annualHighlights {
            gap: 0;
          }

          .annualHighlight {
            min-height: 62px;
            padding: 8px 9px;
            grid-template-columns: 31px minmax(0, 1fr);
          }

          .highlightIcon {
            width: 30px;
            height: 30px;
            font-size: 15px;
          }

          .annualHighlight strong {
            font-size: 12px;
          }

          .annualChartWrap {
            min-height: 280px;
          }

          .annualChartWrap :global(.echarts-for-react) {
            min-height: 280px;
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


// -------------------- previsioni brevi --------------------
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
  // La direzione meteorologica indica da dove proviene il vento.
  // La freccia grafica mostra invece verso dove si sposta la massa d'aria.
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

          /* Su telefono la legenda "Dettaglio previsione" viene eliminata:
             ogni card riporta direttamente il nome del parametro. */
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

          /* L'orario è un'etichetta indipendente nell'angolo: non partecipa
             al layout e non sposta il blocco meteo dal centro. */
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

          /* Nome fascia + icona + condizione + temperatura sono centrati
             geometricamente nel pannello sinistro. */
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

          /* La temperatura è già mostrata sotto il simbolo: la riga duplicata
             non deve comparire né occupare spazio nel pannello dati. */
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


// -------------------- menu a tendina personalizzato --------------------
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
            min-height: 44px;
            padding-left: 34px;
            padding-right: 34px;
            font-size: 11.5px;
          }

          .selectedValue {
            min-width: 0;
          }

          .chevron {
            right: 12px;
          }

          .options {
            max-height: 240px;
          }

          .option {
            min-height: 38px;
            padding: 9px 10px;
            font-size: 11.5px;
          }
        }
      `}</style>
    </div>
  );
}

// -------------------- grafico oggi / 7 giorni / 30 giorni --------------------
function addYearsISO(iso, amount) {
  const d = isoToLocalDate(iso);
  if (!d) return iso;

  const month = d.getMonth();
  const day = d.getDate();
  d.setDate(1);
  d.setFullYear(d.getFullYear() + amount);
  d.setMonth(month);

  const lastDay = new Date(d.getFullYear(), month + 1, 0, 12).getDate();
  d.setDate(Math.min(day, lastDay));

  return dateToISO(d);
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
    };
  }

  let total = 0;
  let maxPoint = values[0];
  let minPoint = values[0];

  for (const point of values) {
    total += point.value;

    if (point.value > maxPoint.value) maxPoint = point;
    if (point.value < minPoint.value) minPoint = point;
  }

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

  const request = fetch(`/data/intraday/${dISO}.json${cacheBuster}`, {
    cache: "no-store",
  })
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
  // "Oggi" usa l'intero giorno di calendario, quindi non va ritagliato
  // sulle 24 ore precedenti all'ultima osservazione.
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
      dew_sum: 0,
      dew_cnt: 0,
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
          addMean("dew", r?.dewpoint_c);
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
  const dew = [];
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
    const dewValue = mean(bucket.dew_sum, bucket.dew_cnt);
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
    dew.push([timestamp, dewValue === null ? null : round1(dewValue)]);
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
    dew: trimPairs(dew),
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

const CLIMATOLOGY_FIELDS = [
  "temp",
  "dew",
  "rh",
  "press",
  "wind",
  "gust",
  "rainH",
  "rainCum",
  "uv",
  "solar",
];

function climatologyTimeKey(timestamp, mode) {
  const d = new Date(Number(timestamp));
  if (!Number.isFinite(d.getTime())) return null;

  const hh = pad2(d.getHours());
  const mm = pad2(d.getMinutes());

  if (mode === "day") return `${hh}:${mm}`;
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}|${hh}:${mm}`;
}


function climatologyCandidateBounds(mode, selectedDate, yearShift) {
  if (!selectedDate || !Number.isFinite(Number(yearShift))) return null;

  const shiftedAnchor = addYearsISO(selectedDate, yearShift);
  if (!shiftedAnchor) return null;

  if (
    mode === "day" &&
    String(shiftedAnchor).slice(5) !== String(selectedDate).slice(5)
  ) {
    return null;
  }

  if (mode === "week") {
    const current = getPeriodBounds("week", selectedDate);
    return {
      startISO: addYearsISO(current.startISO, yearShift),
      endISO: addYearsISO(current.endISO, yearShift),
    };
  }

  return getPeriodBounds("day", shiftedAnchor);
}


async function loadHistoricalAverage({
  selectedDate,
  currentBounds,
  mode,
  availableDates,
  dailyRainByDate,
}) {
  if (!selectedDate || !currentBounds?.startISO || !currentBounds?.endISO) {
    throw new Error("Periodo non valido per il calcolo della media storica.");
  }

  const anchorYear = Number(String(selectedDate).slice(0, 4));
  const availableYears = Array.from(
    new Set(
      (Array.isArray(availableDates) ? availableDates : [])
        .map((iso) => Number(String(iso).slice(0, 4)))
        .filter(Number.isFinite),
    ),
  ).sort((a, b) => a - b);

  const candidateYears = availableYears.filter((year) => year !== anchorYear);
  if (!candidateYears.length) {
    throw new Error(
      "Servono dati della stessa data in almeno un altro anno per calcolare la media storica.",
    );
  }

  const stepMinutes = 15;
  const currentTimeline = makePeriodTimeline(
    currentBounds.startISO,
    currentBounds.endISO,
    stepMinutes,
  );

  if (!currentTimeline.length) {
    throw new Error("Non è stato possibile costruire la linea temporale storica.");
  }

  const sums = {};
  for (const field of CLIMATOLOGY_FIELDS) {
    sums[field] = new Map();
  }

  const usedPeriods = [];

  for (const year of candidateYears) {
    const yearShift = year - anchorYear;
    const historicalBounds = climatologyCandidateBounds(
      mode,
      selectedDate,
      yearShift,
    );

    if (!historicalBounds?.startISO || !historicalBounds?.endISO) continue;

    try {
      const historicalPeriod = await loadIntradayPeriod({
        startISO: historicalBounds.startISO,
        endISO: historicalBounds.endISO,
        mode,
        availableDates,
        dailyRainByDate,
      });

      if (!historicalPeriod?.loadedDays) continue;

      usedPeriods.push({
        year,
        startISO: historicalBounds.startISO,
        endISO: historicalBounds.endISO,
        loadedDays: historicalPeriod.loadedDays,
        requestedDays: historicalPeriod.requestedDays,
      });

      for (const field of CLIMATOLOGY_FIELDS) {
        for (const point of Array.isArray(historicalPeriod?.[field])
          ? historicalPeriod[field]
          : []) {
          const timestamp = Number(point?.[0]);
          const value = n(point?.[1]);
          const key = climatologyTimeKey(timestamp, mode);

          if (!key || !Number.isFinite(value)) continue;

          const previous = sums[field].get(key) || { sum: 0, count: 0 };
          previous.sum += value;
          previous.count += 1;
          sums[field].set(key, previous);
        }
      }
    } catch {
    }
  }

  if (!usedPeriods.length) {
    throw new Error(
      "Non sono disponibili periodi omologhi in altri anni per costruire la media storica.",
    );
  }

  const historicalAverage = {};
  const sampleCounts = {};

  for (const field of CLIMATOLOGY_FIELDS) {
    historicalAverage[field] = currentTimeline.map((timestamp) => {
      const key = climatologyTimeKey(timestamp, mode);
      const aggregate = key ? sums[field].get(key) : null;

      if (!aggregate?.count) return [timestamp, null];
      return [timestamp, round1(aggregate.sum / aggregate.count)];
    });

    sampleCounts[field] = currentTimeline.map((timestamp) => {
      const key = climatologyTimeKey(timestamp, mode);
      const aggregate = key ? sums[field].get(key) : null;
      return [timestamp, aggregate?.count || 0];
    });
  }

  const historicalRainTotal = lastNonNullPoint(
    historicalAverage.rainCum,
  )?.[1];

  return {
    ...historicalAverage,
    sampleCounts,
    periodCount: usedPeriods.length,
    years: usedPeriods.map((period) => period.year).sort((a, b) => a - b),
    periods: usedPeriods,
    rainTotal: Number.isFinite(n(historicalRainTotal))
      ? round1(historicalRainTotal)
      : null,
  };
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
            padding: 12px 10px;
          }

          .summaryGrid {
            grid-template-columns: repeat(7, 166px);
            gap: 8px;
          }

          .summaryCell {
            min-height: 166px;
            padding: 11px 9px 10px;
            border-radius: 14px;
          }

          .summaryLabel {
            min-height: 24px;
            font-size: 9px;
          }

          .summaryIcon {
            width: 38px;
            height: 38px;
          }

          .summaryIcon :global(svg) {
            width: 24px;
            height: 24px;
          }

          .summaryMain strong {
            font-size: 17px;
          }
        }
      `}</style>
    </section>
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
}) {
  const meta = useMemo(() => deltaMetaForGroup(groupKey), [groupKey]);

  const anomalySeries = useMemo(() => {
    if (!currentData || !climatologyData) return [];

    return makeDeltaSeries({
      currentPairs: currentData?.[meta.field],
      comparisonPairs: climatologyData?.[meta.field],
      currentStartISO: currentBounds.startISO,
      comparisonStartISO: currentBounds.startISO,
      mode,
    });
  }, [
    climatologyData,
    currentBounds.startISO,
    currentData,
    meta.field,
    mode,
  ]);

  const displayAnomalySeries = useMemo(
    () => trimTrailingNullPoints(anomalySeries),
    [anomalySeries],
  );

  const validAnomalyCount = useMemo(
    () => seriesValues(displayAnomalySeries).length,
    [displayAnomalySeries],
  );

  const splitSeries = useMemo(
    () => splitDeltaSeriesBySign(displayAnomalySeries),
    [displayAnomalySeries],
  );

  const anomalyStats = useMemo(
    () => deltaStatsFromSeries(displayAnomalySeries),
    [displayAnomalySeries],
  );

  const option = useMemo(() => {
    if (!validAnomalyCount) return null;

    const axis = symmetricAxisFromPairs(displayAnomalySeries);

    return {
      animation: true,
      animationDuration: 220,
      grid: isMobile
        ? { left: 48, right: 14, top: 28, bottom: 42 }
        : { left: 70, right: 34, top: 35, bottom: 58 },
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
          textStyle: { color: "#0f172a", fontSize: 11, fontWeight: 650 },
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
          const validPoints = seriesValues(displayAnomalySeries);
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
          const marker =
            `<span style="display:inline-block;margin-right:6px;` +
            `border-radius:50%;width:9px;height:9px;` +
            `background:${markerColor};"></span>`;

          return (
            `${time}<br/>` +
            `${marker}Scarto dalla media: ` +
            `${formatSignedDelta(value, meta.unit)}`
          );
        },
      },
      xAxis: {
        type: "time",
        min: isoToLocalDate(currentBounds.startISO, 0)?.getTime(),
        max: isoToLocalDate(addDaysISO(currentBounds.endISO, 1), 0)?.getTime(),
        axisLabel: {
          hideOverlap: true,
          fontSize: isMobile ? 10 : 11,
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
        nameGap: isMobile ? 34 : 46,
        min: axis.min,
        max: axis.max,
        interval: axis.interval,
        axisLabel: {
          fontSize: isMobile ? 10 : 11,
          formatter: (value) => {
            const vv = Number(value);
            return `${vv > 0 ? "+" : ""}${vv.toFixed(1)}`;
          },
        },
        splitLine: { show: true },
      },
      series: [
        {
          name: "Sopra la media storica",
          type: "line",
          data: splitSeries.positive,
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          sampling: "lttb",
          lineStyle: { width: 2.4, color: meta.positiveColor },
          itemStyle: { color: meta.positiveColor },
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: {
              width: 1.2,
              type: "dashed",
              color: "rgba(15, 23, 42, 0.42)",
            },
            data: [{ yAxis: 0 }],
          },
        },
        {
          name: "Sotto la media storica",
          type: "line",
          data: splitSeries.negative,
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          sampling: "lttb",
          lineStyle: { width: 2.4, color: meta.negativeColor },
          itemStyle: { color: meta.negativeColor },
        },
      ],
    };
  }, [
    currentBounds.endISO,
    currentBounds.startISO,
    displayAnomalySeries,
    isMobile,
    meta.negativeColor,
    meta.positiveColor,
    meta.unit,
    mode,
    splitSeries.negative,
    splitSeries.positive,
    validAnomalyCount,
  ]);

  const historicalYears = Array.isArray(climatologyData?.years)
    ? climatologyData.years
    : [];
  const yearsText = historicalYears.length
    ? historicalYears.join(", ")
    : "—";
  const periodCount = Number(climatologyData?.periodCount || 0);

  const summaryItems = [
    {
      label: "Scarto medio",
      value: formatSignedDelta(anomalyStats.mean, meta.unit),
      detail: anomalyStats.count
        ? `media su ${anomalyStats.count} intervalli`
        : "nessun intervallo",
      tone: deltaTone(anomalyStats.mean),
    },
    {
      label: "Scarto massimo",
      value: formatSignedDelta(anomalyStats.max, meta.unit),
      detail: Number.isFinite(Number(anomalyStats.maxTimestamp))
        ? formatSummaryTimestamp(anomalyStats.maxTimestamp, mode)
        : "—",
      tone: deltaTone(anomalyStats.max),
    },
    {
      label: "Scarto minimo",
      value: formatSignedDelta(anomalyStats.min, meta.unit),
      detail: Number.isFinite(Number(anomalyStats.minTimestamp))
        ? formatSummaryTimestamp(anomalyStats.minTimestamp, mode)
        : "—",
      tone: deltaTone(anomalyStats.min),
    },
    {
      label: "Ultimo scarto",
      value: formatSignedDelta(anomalyStats.last, meta.unit),
      detail: Number.isFinite(Number(anomalyStats.lastTimestamp))
        ? formatSummaryTimestamp(anomalyStats.lastTimestamp, mode)
        : "ultimo intervallo disponibile",
      tone: deltaTone(anomalyStats.last),
    },
  ];

  return (
    <section
      className="climatologySection"
      aria-label="Confronto con la media storica"
    >
      <div className="climatologyHead">
        <div className="climatologyText">
          <h3>Scarto rispetto alla media storica</h3>
          <p>
            {meta.shortLabel}: periodo selezionato meno media delle stesse date
            e degli stessi orari negli altri anni disponibili
          </p>
        </div>

        <div className="archiveInfo">
          <span>Archivio utilizzato</span>
          <strong>
            {periodCount
              ? `${periodCount} ${periodCount === 1 ? "periodo" : "periodi"}`
              : "—"}
          </strong>
          <small title={yearsText}>{yearsText}</small>
        </div>
      </div>

      <div className="climatologyChart">
        {loading && <div className="climateMsg">Calcolo media storica…</div>}
        {!loading && error && <div className="climateMsg">{error}</div>}
        {!loading && !error && !validAnomalyCount && (
          <div className="climateMsg">
            La media storica esiste, ma non ci sono ancora intervalli comuni
            sufficienti per calcolare lo scarto.
          </div>
        )}
        {!loading && !error && option && (
          <ReactECharts
            option={option}
            style={{ height: isMobile ? 210 : 260, width: "100%" }}
            notMerge={true}
            lazyUpdate={true}
          />
        )}
      </div>

      {!loading && !error && validAnomalyCount > 0 && (
        <div
          className="climateSummary"
          style={{
            "--positive-color": meta.positiveColor,
            "--negative-color": meta.negativeColor,
          }}
        >
          {summaryItems.map((item) => (
            <div className={`climateCell tone-${item.tone}`} key={item.label}>
              <span className="climateLabel">{item.label}</span>
              <strong className={item.tone}>{item.value}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      )}

      <div className="climateNote">
        La media non è salvata manualmente: viene ricalcolata dai JSON intraday
        presenti nell’archivio. Un dato mancante viene escluso soltanto da
        quell’orario e non viene trasformato in 0; un valore reale pari a 0
        resta invece valido. I nuovi dati Wunderground entrano automaticamente
        nel riferimento storico quando diventano disponibili per i periodi
        omologhi.
      </div>

      <style jsx>{`
        .climatologySection {
          position: relative;
          z-index: 3;
          border-top: 1px solid #e8ebef;
          background: #fff;
        }

        .climatologyHead {
          min-height: 82px;
          padding: 15px 18px 10px;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 18px;
        }

        .climatologyText {
          grid-column: 2;
          text-align: center;
        }

        .climatologyText h3 {
          margin: 0;
          font-size: 17px;
          font-weight: 950;
          color: #0f172a;
        }

        .climatologyText p {
          max-width: 620px;
          margin: 4px auto 0;
          font-size: 10px;
          font-weight: 750;
          line-height: 1.45;
          color: rgba(15, 23, 42, 0.55);
        }

        .archiveInfo {
          grid-column: 3;
          justify-self: end;
          width: 220px;
          min-width: 0;
          padding: 9px 11px;
          display: grid;
          gap: 2px;
          border: 1px solid #e4e8ed;
          border-radius: 13px;
          background: #fbfcfd;
          text-align: center;
        }

        .archiveInfo span {
          font-size: 8.5px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.54);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .archiveInfo strong {
          font-size: 13px;
          font-weight: 950;
          color: #0f172a;
        }

        .archiveInfo small {
          overflow: hidden;
          font-size: 8.5px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.48);
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .climatologyChart {
          min-height: 260px;
          padding: 0 8px 2px;
        }

        .climateMsg {
          min-height: 240px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px;
          color: rgba(15, 23, 42, 0.62);
          font-size: 11px;
          font-weight: 800;
          text-align: center;
        }

        .climateSummary {
          width: min(calc(100% - 36px), 920px);
          margin: 0 auto 10px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 6px;
        }

        .climateCell {
          min-width: 0;
          min-height: 42px;
          padding: 5px 8px;
          display: grid;
          align-content: center;
          justify-items: center;
          gap: 0;
          text-align: center;
          border: 1px solid #e3e7ec;
          border-radius: 9px;
          background: linear-gradient(180deg, #ffffff, #fafbfc);
        }

        .climateCell.tone-positive {
          border-color: color-mix(
            in srgb,
            var(--positive-color) 24%,
            #e3e7ec
          );
          background: color-mix(
            in srgb,
            var(--positive-color) 6%,
            #ffffff
          );
        }

        .climateCell.tone-negative {
          border-color: color-mix(
            in srgb,
            var(--negative-color) 24%,
            #e3e7ec
          );
          background: color-mix(
            in srgb,
            var(--negative-color) 6%,
            #ffffff
          );
        }

        .climateLabel {
          overflow: hidden;
          font-size: 7.5px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.53);
          text-transform: uppercase;
          letter-spacing: 0.035em;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .climateCell strong {
          overflow: hidden;
          font-size: 13px;
          font-weight: 950;
          color: #0f172a;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .climateCell strong.positive {
          color: var(--positive-color);
        }

        .climateCell strong.negative {
          color: var(--negative-color);
        }

        .climateCell small {
          overflow: hidden;
          font-size: 7.5px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.47);
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .climateNote {
          margin: 0 18px 16px;
          padding: 10px 12px;
          border: 1px solid #e8ebef;
          border-radius: 12px;
          background: #f8fafc;
          color: rgba(15, 23, 42, 0.58);
          font-size: 9.5px;
          font-weight: 750;
          line-height: 1.45;
          text-align: center;
        }

        @media (max-width: 720px) {
          .climatologyHead {
            min-height: 0;
            padding: 14px 10px 10px;
            grid-template-columns: 1fr;
            gap: 10px;
          }

          .climatologyText,
          .archiveInfo {
            grid-column: 1;
          }

          .climatologyText h3 {
            font-size: 16px;
          }

          .archiveInfo {
            justify-self: stretch;
            width: auto;
          }

          .climatologyChart {
            min-height: 210px;
            padding-left: 0;
            padding-right: 0;
          }

          .climateMsg {
            min-height: 188px;
          }

          .climateSummary {
            width: calc(100% - 20px);
            margin: 0 auto 10px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 5px;
          }

          .climateCell {
            min-height: 42px;
            padding: 5px 7px;
          }

          .climateCell strong {
            font-size: 12.5px;
          }

          .climateNote {
            margin: 0 10px 14px;
            font-size: 9px;
          }
        }
      `}</style>
    </section>
  );
}


function PeriodChart({ intradayDates = [], dailyRainByDate = {} }) {
  const GROUPS = useMemo(
    () => [
      { key: "temp", label: "Temperatura e Punto di rugiada" },
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

  const periodDurationLabel = useMemo(() => {
    if (mode === "week") return "7 giorni · intervalli di 15 minuti";
    if (mode === "month") return "30 giorni · intervalli di 1 ora";
    return "Intervalli di 15 minuti";
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

  const canGoBack = !navigationDisabled(
    availableDates,
    selectedDate,
    mode,
    -1,
  );

  const canGoForward = !navigationDisabled(
    availableDates,
    selectedDate,
    mode,
    1,
  );

  const supportsClimatology = mode === "day" || mode === "week";

  const changeMode = (nextMode) => {
    setMode(nextMode);

    // Se si sceglie "Oggi", si torna sempre all'ultima data disponibile.
    if (nextMode === "day" && latestAvailableDate) {
      setSelectedDate(latestAvailableDate);
      setRefreshTick((value) => value + 1);
    }
  };

  const changePeriod = (direction) => {
    setSelectedDate((current) =>
      moveSelectedDate(availableDates, current, mode, direction),
    );
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

    if (!supportsClimatology) {
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

      if (!selectedDate || !bounds.startISO || !bounds.endISO) {
        setClimatologyLoading(false);
        return;
      }

      setClimatologyLoading(true);

      try {
        const result = await loadHistoricalAverage({
          selectedDate,
          currentBounds: bounds,
          mode,
          availableDates,
          dailyRainByDate,
        });

        if (alive) setClimatologyData(result);
      } catch (error) {
        if (alive) {
          setClimatologyError(
            error?.message ||
              "Non è stato possibile calcolare la media storica.",
          );
        }
      } finally {
        if (alive) setClimatologyLoading(false);
      }
    }

    runClimatology();

    return () => {
      alive = false;
    };
  }, [
    availableDates,
    bounds.endISO,
    bounds.startISO,
    dailyRainByDate,
    mode,
    selectedDate,
    supportsClimatology,
  ]);

  const parameterOptions = GROUPS;

  const option = useMemo(() => {
    if (!data) return null;

    const baseLegend = isMobileChart
      ? {
          bottom: 4,
          left: "center",
          orient: "vertical",
          itemGap: 4,
          textStyle: {
            fontSize: 10.5,
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

    const gridNoLegend = isMobileChart
      ? { left: 50, right: 22, top: 78, bottom: 38, containLabel: false }
      : {
          ...desktopGridBase,
          bottom: 42,
        };

    const gridWithLegend = isMobileChart
      ? { left: 50, right: 22, top: 78, bottom: 98, containLabel: false }
      : desktopGridBase;

    const toolboxZoom = {
      feature: {
        restore: { title: "Ripristina" },
        saveAsImage: {
          type: "png",
          name: `meteo-collinas-${mode}-${groupKey}`,
          backgroundColor: "#ffffff",
          pixelRatio: 2,
          title: "Salva grafico",
        },
      },
      right: isMobileChart ? 6 : 14,
      top: isMobileChart ? 38 : 13,
      itemSize: isMobileChart ? 16 : 17,
      itemGap: isMobileChart ? 8 : 9,
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
      dataZoom: makePeriodDataZoom(),
      xAxis,
    };

    if (groupKey === "temp") {

      const mm = minMaxFrom([...data.temp, ...data.dew]) || { min: 0, max: 1 };
      const axis = axisNice(mm.min - 1, mm.max + 1, 6);

      const pulseTemp = showRealtimePulse
        ? makeRealtimePulseSeries(data.temp, data.latestTimestamp, 0)
        : null;
      const pulseDew = showRealtimePulse
        ? makeRealtimePulseSeries(data.dew, data.latestTimestamp, 0)
        : null;

      return {
        ...common,
        title: chartTitle("Temperatura e Punto di rugiada"),
        grid: gridWithLegend,
        tooltip: tooltipCommon,
        legend: {
          ...baseLegend,
          data: ["Temperatura (°C)", "Punto di rugiada (°C)"],
        },
        yAxis: leftAxis("°C", {
          min: axis.min,
          max: axis.max,
          interval: axis.interval,
        }),
        series: [
          {
            name: "Temperatura (°C)",
            type: "line",
            data: chartPairs(data.temp),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            lineStyle: { width: 2.3, color: "#f97316" },
            itemStyle: { color: "#f97316" },
            emphasis: { focus: "series" },
            ...(dayBoundaryMarkLine ? { markLine: dayBoundaryMarkLine } : {}),
          },
          {
            name: "Punto di rugiada (°C)",
            type: "line",
            data: chartPairs(data.dew),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            lineStyle: { width: 2.3, color: "#06b6d4" },
            itemStyle: { color: "#06b6d4" },
            emphasis: { focus: "series" },
          },
          ...(pulseTemp ? [pulseTemp] : []),
          ...(pulseDew ? [pulseDew] : []),
        ],
      };
    }

    if (groupKey === "rain") {

      const pulseRain = showRealtimePulse
        ? makeRealtimePulseSeries(data.rainH, data.latestTimestamp, 0)
        : null;
      const pulseCum = showRealtimePulse
        ? makeRealtimePulseSeries(data.rainCum, data.latestTimestamp, 1)
        : null;
      const rainStepLabel =
        mode === "day" || mode === "week"
          ? "Pioggia 15 min (mm)"
          : "Pioggia oraria (mm)";
      const rainAxisLabel =
        mode === "day" || mode === "week" ? "mm/15m" : "mm/h";

      return {
        ...common,
        title: chartTitle("Precipitazioni"),
        grid: gridWithLegend,
        tooltip: tooltipCommon,
        legend: {
          ...baseLegend,
          data: [rainStepLabel, "Cumulata (mm)"],
        },
        yAxis: [leftAxis(rainAxisLabel), rightAxis("mm cum.")],
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
            ...(dayBoundaryMarkLine ? { markLine: dayBoundaryMarkLine } : {}),
          },
          {
            name: "Cumulata (mm)",
            type: "line",
            data: chartPairs(data.rainCum),
            yAxisIndex: 1,
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            lineStyle: { width: 2.3, color: "#2563eb" },
            itemStyle: { color: "#2563eb" },
            emphasis: { focus: "series" },
          },
          ...(pulseRain ? [pulseRain] : []),
          ...(pulseCum ? [pulseCum] : []),
        ],
      };
    }

    if (groupKey === "rh") {

      const pulse = showRealtimePulse
        ? makeRealtimePulseSeries(data.rh, data.latestTimestamp, 0)
        : null;

      return {
        ...common,
        title: chartTitle("Umidità"),
        grid: gridNoLegend,
        tooltip: tooltipCommon,
        yAxis: leftAxis("% RH", { min: 0, max: 100 }),
        series: [
          {
            name: "Umidità (%)",
            type: "line",
            data: chartPairs(data.rh),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            lineStyle: { width: 2.3, color: "#06b6d4" },
            itemStyle: { color: "#06b6d4" },
            emphasis: { focus: "series" },
            ...(dayBoundaryMarkLine ? { markLine: dayBoundaryMarkLine } : {}),
          },
          ...(pulse ? [pulse] : []),
        ],
      };
    }

    if (groupKey === "wind") {

      const pulseWind = showRealtimePulse
        ? makeRealtimePulseSeries(data.wind, data.latestTimestamp, 0)
        : null;
      const pulseGust = showRealtimePulse
        ? makeRealtimePulseSeries(data.gust, data.latestTimestamp, 0)
        : null;
      const pulseDir = showRealtimePulse
        ? makeRealtimePulseSeries(data.dirMean, data.latestTimestamp, 1)
        : null;

      return {
        ...common,
        title: chartTitle(
          isMobileChart
            ? "Vento, raffiche e direzione"
            : "Vento medio, raffiche e direzione",
        ),
        grid: gridWithLegend,
        tooltip: {
          trigger: "axis",
          triggerOn: "mousemove|click",
          confine: true,
          axisPointer: hoverAxisPointer,
          formatter: (params) => {
            const validParams = (Array.isArray(params) ? params : []).filter(
              (item) => Number.isFinite(n(item?.data?.[1])),
            );

            if (!validParams.length) return "";

            const timestamp = Number(validParams[0]?.data?.[0]);
            const time = Number.isFinite(timestamp)
              ? formatSummaryTimestamp(timestamp, mode)
              : "";
            const lines = [time];

            for (const p of validParams) {
              const value = p.data?.[1];
              if (p.seriesName === "Direzione") {
                lines.push(
                  `${p.marker}${p.seriesName}: ${degToCardinal8(value)}`,
                );
              } else {
                lines.push(
                  `${p.marker}${p.seriesName}: ${Number(value).toFixed(1)}`,
                );
              }
            }

            return lines.join("<br/>");
          },
        },
        legend: {
          ...baseLegend,
          data: ["Vento medio (km/h)", "Raffiche (km/h)", "Direzione"],
        },
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
          {
            name: "Vento medio (km/h)",
            type: "line",
            data: chartPairs(data.wind),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            yAxisIndex: 0,
            lineStyle: { width: 2.3, color: "#8b5cf6" },
            itemStyle: { color: "#8b5cf6" },
            emphasis: { focus: "series" },
            ...(dayBoundaryMarkLine ? { markLine: dayBoundaryMarkLine } : {}),
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
          },
          {
            name: "Direzione",
            type: "scatter",
            data: chartPairs(data.dirMean),
            yAxisIndex: 1,
            symbolSize: 5,
            itemStyle: { color: "#334155" },
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
        ? makeRealtimePulseSeries(data.press, data.latestTimestamp, 0)
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
        ? makeRealtimePulseSeries(data.uv, data.latestTimestamp, 0)
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
      ? makeRealtimePulseSeries(data.solar, data.latestTimestamp, 0)
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
    data,
    groupKey,
    isMobileChart,
    isVeryNarrowChart,
    mode,
    showRealtimePulse,
  ]);

  const chartHeight = isMobileChart
    ? groupKey === "wind"
      ? 370
      : 340
    : 390;


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
          <button
            type="button"
            className="arrow"
            aria-label="Periodo precedente"
            title="Periodo precedente"
            disabled={!canGoBack}
            onClick={() => changePeriod(-1)}
          >
            ←
          </button>

          <div className="dateText">
            <strong>{periodLabel}</strong>
            <span>{periodDurationLabel}</span>
          </div>

          <button
            type="button"
            className="arrow"
            aria-label="Periodo successivo"
            title="Periodo successivo"
            disabled={!canGoForward}
            onClick={() => changePeriod(1)}
          >
            →
          </button>
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

      <section className="chartPanel" aria-label="Andamento del periodo">
        <div className="chartPanelHead">
          <span className="chartPanelKicker">Andamento del periodo</span>
          <h3>{periodTitle}</h3>
        </div>

        <div className="chartArea">
          {loading && <div className="msg">Caricamento del grafico…</div>}
          {!loading && err && <div className="msg">{err}</div>}
          {!loading && !err && option && (
            <ReactECharts
              option={option}
              style={{ height: chartHeight, width: "100%" }}
              notMerge={true}
              lazyUpdate={true}
            />
          )}
        </div>
      </section>


      {supportsClimatology && (
        <ClimatologyChart
          mode={mode}
          groupKey={groupKey}
          currentData={data}
          climatologyData={climatologyData}
          currentBounds={bounds}
          loading={loading || climatologyLoading}
          error={climatologyError}
          isMobile={isMobileChart}
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
          display: grid;
          grid-template-columns: 42px auto 42px;
          align-items: center;
          justify-content: center;
          gap: 8px;
          z-index: 1;
        }

        .arrow {
          width: 42px;
          height: 42px;
          flex: 0 0 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
          font-size: 22px;
          font-weight: 800;
          cursor: pointer;
          transition:
            transform 120ms ease,
            background 120ms ease;
        }

        .arrow:hover:not(:disabled) {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.19);
        }

        .arrow:disabled {
          opacity: 0.28;
          cursor: not-allowed;
        }

        .dateText {
          min-width: 270px;
          display: grid;
          justify-items: center;
          gap: 3px;
          text-align: center;
        }

        .dateText strong {
          font-size: 14px;
          font-weight: 950;
          text-transform: capitalize;
        }

        .dateText span {
          font-size: 9px;
          font-weight: 800;
          color: rgba(255, 255, 255, 0.78);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .chartPanel {
          margin: 0 20px 18px;
          overflow: hidden;
          border: 1px solid #dce5ef;
          border-radius: 18px;
          background: #fff;
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.045);
        }

        .chartPanelHead {
          min-height: 68px;
          padding: 11px 18px 10px;
          display: grid;
          justify-items: center;
          align-content: center;
          gap: 2px;
          border-bottom: 1px solid #edf1f5;
          background:
            radial-gradient(420px 90px at 50% -45%, rgba(37, 99, 235, 0.08), transparent 72%),
            linear-gradient(180deg, #ffffff, #fbfdff);
          text-align: center;
        }

        .chartPanelKicker {
          font-size: 8px;
          font-weight: 950;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.07em;
        }

        .chartPanelHead h3 {
          margin: 0;
          font-size: 20px;
          font-weight: 950;
          line-height: 1.08;
          letter-spacing: -0.025em;
          color: #0b1f45;
        }

        .chartArea {
          position: relative;
          z-index: 1;
          width: 100%;
          min-width: 0;
          min-height: 400px;
          padding: 4px 10px 8px;
          box-sizing: border-box;
          background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
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
            grid-template-columns: 40px auto 40px;
            justify-content: center;
            gap: 7px;
          }

          .arrow {
            width: 40px;
            height: 40px;
            flex-basis: 40px;
          }

          .dateText {
            min-width: 0;
          }
        }

        @media (max-width: 720px) {
          .periodCard {
            border-radius: 18px;
          }

          .dataHeader {
            padding: 15px 12px 13px;
          }

          .dataHeader h2 {
            font-size: 21px;
          }



          .dateNavigator {
            min-height: 0;
            padding: 10px;
            grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
            gap: 9px;
          }

          .navControlLeft,
          .navControlRight {
            grid-row: 1;
          }

          .dateNavigatorCenter {
            position: static;
            transform: none;
            grid-column: 1 / -1;
            grid-row: 2;
            width: 100%;
            display: grid;
            grid-template-columns: 38px minmax(0, 1fr) 38px;
            gap: 8px;
          }

          .navControlLeft,
          .navControlRight {
            width: 100%;
          }

          .navControlLabel {
            font-size: 7px;
          }

          .dateText {
            min-width: 0;
          }

          .dateText strong {
            font-size: 12px;
            line-height: 1.2;
          }

          .dateText span {
            font-size: 8px;
          }

          .arrow {
            width: 38px;
            height: 38px;
            flex-basis: 38px;
          }

          .chartPanel {
            margin: 0 10px 12px;
            border-radius: 14px;
          }

          .chartPanelHead {
            min-height: 64px;
            padding: 10px 10px 8px;
          }

          .chartPanelKicker {
            font-size: 7px;
          }

          .chartPanelHead h3 {
            font-size: 18px;
          }


          .chartArea {
            min-height: 340px;
            padding: 0;
            overflow: hidden;
          }

          .msg {
            min-height: 310px;
          }

        }
      `}</style>
    </div>
  );
}