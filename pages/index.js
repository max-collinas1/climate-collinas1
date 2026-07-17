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

function addMonthsISO(iso, amount) {
  const d = isoToLocalDate(iso);
  if (!d) return iso;

  const originalDay = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + amount);

  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
  d.setDate(Math.min(originalDay, lastDay));

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
      startISO: addDaysISO(selectedDate, -6),
      endISO: selectedDate,
    };
  }

  const d = isoToLocalDate(selectedDate);
  if (!d) return { startISO: selectedDate, endISO: selectedDate };

  const start = new Date(d.getFullYear(), d.getMonth(), 1, 12);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12);

  return {
    startISO: dateToISO(start),
    endISO: dateToISO(end),
  };
}

function formatLongDate(iso) {
  const d = isoToLocalDate(iso);
  if (!d) return iso || "—";

  return `${WEEKDAYS_IT[d.getDay()]} ${d.getDate()} ${MONTHS_IT_LOWER[d.getMonth()]} ${d.getFullYear()}`;
}

function formatCompactDate(iso) {
  const d = isoToLocalDate(iso);
  if (!d) return iso || "—";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatPeriodLabel(mode, selectedDate) {
  const bounds = getPeriodBounds(mode, selectedDate);

  if (mode === "day") return formatLongDate(selectedDate);

  if (mode === "week") {
    return `${formatCompactDate(bounds.startISO)} – ${formatCompactDate(bounds.endISO)}`;
  }

  const d = isoToLocalDate(selectedDate);
  if (!d) return selectedDate || "—";
  return `${MONTHS_IT_FULL[d.getMonth()]} ${d.getFullYear()}`;
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

  if (mode === "week") {
    const target = addDaysISO(selectedDate, direction * 7);
    return nearestAvailableDate(dates, target, direction);
  }

  const target = addMonthsISO(selectedDate, direction);
  const targetMonth = target.slice(0, 7);
  const monthDates = dates.filter((iso) => iso.startsWith(targetMonth));

  if (monthDates.length) {
    return nearestAvailableDate(monthDates, target, direction);
  }

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

  if (mode === "week") {
    return direction < 0 ? selectedDate <= first : selectedDate >= last;
  }

  const selectedMonth = selectedDate.slice(0, 7);
  return direction < 0
    ? selectedMonth <= first.slice(0, 7)
    : selectedMonth >= last.slice(0, 7);
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

/*
 * Mantiene gli eventuali vuoti interni alla serie, ma elimina tutti i punti
 * successivi all'ultima osservazione realmente disponibile.
 *
 * In questo modo l'asse temporale può continuare fino alla fine del giorno,
 * mentre tooltip e linea verticale non possono spostarsi su orari futuri.
 */
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

function makePeriodDataZoom(mode, isMobile = false) {
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
      start: 0,
      end: 100,
      bottom: isMobile ? 6 : 8,
      height: isMobile ? 18 : 22,
      showDetail: false,
      brushSelect: mode !== "day",
    },
  ];
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

  const rainVals = yearStats.map((y) => n(y.rain)).filter(Number.isFinite);
  const rainMin = rainVals.length ? Math.min(...rainVals) : 0;
  const rainMax = rainVals.length ? Math.max(...rainVals) : 0;

  const tmeanVals = yearStats.map((y) => n(y.tmean)).filter(Number.isFinite);
  const tmeanMin = tmeanVals.length ? Math.min(...tmeanVals) : 0;
  const tmeanMax = tmeanVals.length ? Math.max(...tmeanVals) : 0;

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

  return {
    props: {
      start,
      end,
      yearStats,
      norm: { rainMin, rainMax, tmeanMin, tmeanMax },
      intradayDates,
      dailyRainByDate,
    },
    revalidate: 300,
  };
}

// -------------------- homepage --------------------
export default function Home({
  yearStats = [],
  start = null,
  end = null,
  norm = { rainMin: 0, rainMax: 0, tmeanMin: 0, tmeanMax: 0 },
  intradayDates = [],
  dailyRainByDate = {},
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = String(q || "").trim();
    if (!s) return yearStats;
    return yearStats.filter((y) => String(y.year).includes(s));
  }, [q, yearStats]);

  return (
    <SiteLayout
      headerProps={{
        title: "Meteo Collinas",
        kicker: "ARCHIVIO METEO",
        subtitle: "Dati storici della stazione, organizzati per anno e mese.",
        start,
        end,
        showPeriod: false,
        currentPath: "/",
      }}
    >
      <ForecastSection />

      <div className="chartWrap">
        <PeriodChart
          intradayDates={intradayDates}
          dailyRainByDate={dailyRainByDate}
        />
      </div>

      <section className="section">
        <div className="sectionHead">
          <div className="sectionText">
            <h2>Seleziona un anno</h2>
            <div className="hint">
              Apri una scheda per consultare mesi, statistiche e dati
              giornalieri.
            </div>
          </div>

          <label className="searchWrap" aria-label="Filtra anni">
            <span className="searchLabel">Filtro</span>
            <input
              className="search"
              placeholder="es. 2025"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>

        <div className="grid">
          {filtered.map((y) => (
            <YearCard key={y.year} y={y} norm={norm} />
          ))}

          {!yearStats.length && (
            <div className="empty">
              Nessun dato ancora. Metti i CSV in{" "}
              <code>data_raw/clean/AAAA</code> e lancia{" "}
              <code>node ./scripts/build-data.js</code>.
            </div>
          )}

          {yearStats.length > 0 && filtered.length === 0 && (
            <div className="empty">
              Nessun anno trovato per <code>{q}</code>. Cancella il filtro.
            </div>
          )}
        </div>
      </section>

      <style jsx>{`
        .chartWrap {
          margin-top: 18px;
        }

        .section {
          margin: 22px auto 0;
        }

        .sectionHead {
          min-height: 60px;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 16px;
          margin: 8px 0 12px;
        }

        .sectionText {
          grid-column: 2;
          text-align: center;
        }

        h2 {
          margin: 0;
          font-size: 22px;
          font-weight: 950;
          letter-spacing: -0.02em;
          color: #0f172a;
        }

        .hint {
          margin-top: 4px;
          font-size: 12px;
          color: rgba(15, 23, 42, 0.62);
        }

        .searchWrap {
          grid-column: 3;
          justify-self: end;
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 235px;
          border: 1px solid #e5e7eb;
          background: rgba(255, 255, 255, 0.96);
          padding: 9px 11px;
          border-radius: 14px;
          box-shadow: 0 4px 14px rgba(15, 23, 42, 0.035);
        }

        .searchLabel {
          font-size: 11px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.62);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .search {
          min-width: 0;
          width: 100px;
          border: none;
          outline: none;
          background: transparent;
          font-size: 13px;
          font-weight: 900;
          color: #0f172a;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }

        .empty {
          grid-column: 1 / -1;
          padding: 16px;
          border: 1px dashed #d9d9d9;
          border-radius: 16px;
          color: rgba(15, 23, 42, 0.78);
          background: rgba(255, 255, 255, 0.7);
        }

        code {
          background: #f1f5f9;
          padding: 2px 6px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          font-size: 12px;
        }

        @media (max-width: 1320px) {
          .grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (max-width: 980px) {
          .sectionHead {
            grid-template-columns: 1fr;
          }

          .sectionText,
          .searchWrap {
            grid-column: 1;
          }

          .searchWrap {
            justify-self: center;
          }

          .grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 640px) {
          .grid {
            grid-template-columns: 1fr;
          }

          .searchWrap {
            width: 100%;
            box-sizing: border-box;
          }

          .search {
            width: 100%;
          }
        }
      `}</style>
    </SiteLayout>
  );
}

// -------------------- previsioni brevi --------------------
const FORECAST_LATITUDE = 39.6413;
const FORECAST_LONGITUDE = 8.8399;
const FORECAST_TIMEZONE = "Europe/Rome";
const FORECAST_REFRESH_MS = 60 * 60 * 1000;
const FORECAST_CACHE_KEY = "meteo-collinas:forecast-cache-v2";

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
  const low = percentileFinite(values, 0.2);
  const high = percentileFinite(values, 0.8);

  if (Number.isFinite(low) && Number.isFinite(high)) {
    return {
      low: Math.floor(low),
      high: Math.ceil(high),
      ensemble: true,
    };
  }

  const fallback = n(fallbackValue);
  if (!Number.isFinite(fallback)) return null;

  return {
    low: Math.floor(fallback),
    high: Math.ceil(fallback),
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

  // ICON-2I e AROME vengono trattati come due ulteriori scenari della
  // distribuzione, senza allargare automaticamente il range fino ai loro
  // estremi. In questo modo un singolo deterministico molto caldo o freddo
  // non domina la fascia mostrata in home.
  if (ensemble.length) {
    const combined = [...ensemble, ...deterministic];
    const low = percentileFinite(combined, 0.2);
    const high = percentileFinite(combined, 0.8);

    if (Number.isFinite(low) && Number.isFinite(high)) {
      return {
        low: Math.floor(low),
        high: Math.ceil(high),
        ensemble: true,
      };
    }
  }

  if (deterministic.length) {
    return {
      low: Math.floor(Math.min(...deterministic)),
      high: Math.ceil(Math.max(...deterministic)),
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

  /*
   * Per ogni fascia oraria il limite inferiore deriva dalle minime
   * previste dai singoli scenari, mentre il limite superiore deriva
   * dalle loro massime. Vengono usati gli stessi percentili 20–80
   * applicati alle temperature giornaliere.
   */
  if (memberMinimums.length && memberMaximums.length) {
    const low = percentileFinite(
      [...memberMinimums, ...modelMinimums],
      0.2,
    );
    const high = percentileFinite(
      [...memberMaximums, ...modelMaximums],
      0.8,
    );

    if (Number.isFinite(low) && Number.isFinite(high)) {
      return {
        low: Math.floor(Math.min(low, high)),
        high: Math.ceil(Math.max(low, high)),
        ensemble: true,
      };
    }
  }

  if (modelMinimums.length && modelMaximums.length) {
    return {
      low: Math.floor(Math.min(...modelMinimums)),
      high: Math.ceil(Math.max(...modelMaximums)),
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

function summarizeDeterministicIndexes(hourly, indexes) {
  const temperatureValues = [];
  const codes = [];
  const cloudCover = [];
  const precipitationValues = [];
  const windSpeedValues = [];
  const gustValues = [];

  let directionSin = 0;
  let directionCos = 0;
  let directionWeight = 0;
  let availableHourCount = 0;

  for (const index of Array.isArray(indexes) ? indexes : []) {
    const temperature = n(hourly?.temperature_2m?.[index]);
    const code = n(hourly?.weather_code?.[index]);
    const cloud = n(hourly?.cloud_cover?.[index]);
    const precipitation = n(hourly?.precipitation?.[index]);
    const windSpeed = n(hourly?.wind_speed_10m?.[index]);
    const gust = n(hourly?.wind_gusts_10m?.[index]);
    const direction = n(hourly?.wind_direction_10m?.[index]);
    const hourAvailable = [
      temperature,
      code,
      cloud,
      precipitation,
      windSpeed,
      gust,
      direction,
    ].some(Number.isFinite);

    if (hourAvailable) availableHourCount += 1;
    if (Number.isFinite(temperature)) temperatureValues.push(temperature);
    if (Number.isFinite(code)) codes.push(code);
    if (Number.isFinite(cloud)) cloudCover.push(cloud);
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
    windSpeedMax: windSpeedValues.length ? Math.max(...windSpeedValues) : null,
    gustMax: gustValues.length ? Math.max(...gustValues) : null,
    cloudMean: avgFinite(cloudCover),
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
      const iconBand = summarizeDeterministicBand(
        iconHourly,
        iconTimes,
        iso,
        band,
      );
      const aromeBand = summarizeDeterministicBand(
        aromeHourly,
        aromeTimes,
        iso,
        band,
      );
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
      const rainProbability = Number.isFinite(ensembleRain.probability)
        ? ensembleRain.probability
        : Number.isFinite(deterministicProbability)
          ? Math.round(deterministicProbability)
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

      const expectedHours = Math.max(1, band.end - band.start);
      const aromeAvailableHours = Number(aromeBand.availableHourCount || 0);
      const aromeCoverage =
        aromeAvailableHours >= expectedHours
          ? "full"
          : aromeAvailableHours > 0
            ? "partial"
            : "none";

      return {
        ...band,
        weather: consensusWeatherMeta(modelBands, rainProbability),
        temperatureRange: consensusPeriodTemperatureRange(
          memberBandMinimums,
          memberBandMaximums,
          deterministicBandMinimums,
          deterministicBandMaximums,
        ),
        rainProbability,
        rainRange: formatRainRange(
          ensembleRain.totals,
          consensusPrecipitation,
        ),
        past: isForecastBandPast(iso, band),
        aromeUsed: aromeCoverage !== "none",
        aromeCoverage,
        aromeAvailableHours,
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

    const wettestPeriod = periods.reduce((best, period) => {
      if (!best || period.rainProbability > best.rainProbability) return period;
      return best;
    }, null);

    const deterministicMaximums = deterministicDays
      .map((summary) => summary.temperatureMax)
      .filter(Number.isFinite);
    const deterministicMinimums = deterministicDays
      .map((summary) => summary.temperatureMin)
      .filter(Number.isFinite);
    const deterministicRainTotal = consensusAverage(
      deterministicDays.map((summary) => summary.precipitationTotal),
    );
    const windDirection = consensusDirectionFromSummaries(deterministicDays);
    const windSpeed = consensusAverage(
      deterministicDays.map((summary) => summary.windSpeedMax),
    );
    const windGust = consensusAverage(
      deterministicDays.map((summary) => summary.gustMax),
    );
    const aromeFullPeriods = periods.filter(
      (period) => period.aromeCoverage === "full",
    ).length;
    const aromeAvailablePeriods = periods.filter(
      (period) => period.aromeCoverage !== "none",
    ).length;
    const aromeCoverage =
      aromeFullPeriods === FORECAST_BANDS.length
        ? "full"
        : aromeAvailablePeriods > 0
          ? "partial"
          : "none";
    const aromeUsed = aromeCoverage !== "none";
    const modelLabel =
      aromeCoverage === "full"
        ? "ICON + AROME"
        : aromeCoverage === "partial"
          ? "ICON + AROME parziale"
          : "ICON-2I";

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

    /*
     * La fascia giornaliera deve contenere le fasce orarie:
     * la massima giornaliera non può essere inferiore al valore più
     * alto previsto in una delle quattro parti del giorno e la minima
     * non può essere superiore al valore più basso.
     */
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
      title: forecastDateLabel(iso, dayIndex),
      dateLabel: forecastCompactDate(iso),
      modelLabel,
      aromeUsed,
      aromeCoverage,
      maxRange,
      minRange,
      rainProbability,
      rainPeriod:
        wettestPeriod?.rainProbability >= 20 ? wettestPeriod.label : "",
      rainRange: formatRainRange(memberRainTotals, deterministicRainTotal),
      windDirection: windCardinal16(windDirection),
      windSpeed,
      windGust,
      periods,
      ensembleMembers: Math.max(
        temperatureKeys.length,
        precipitationKeys.length,
      ),
    };
  });
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
    // Il sito continua a funzionare anche se il browser blocca localStorage.
  }
}

function ForecastSection() {
  const [forecast, setForecast] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer = null;
    let requestInFlight = false;
    let lastConsultationAt = null;

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
          Number.isFinite(nextConsultation)
            ? nextConsultation
            : Date.now(),
        );
      }, delay);
    };

    const loadForecast = async () => {
      if (requestInFlight) return lastConsultationAt;

      requestInFlight = true;

      try {
        setError("");

        const iconUrl = new URL("https://api.open-meteo.com/v1/forecast");
        iconUrl.search = new URLSearchParams({
          latitude: String(FORECAST_LATITUDE),
          longitude: String(FORECAST_LONGITUDE),
          models: "italia_meteo_arpae_icon_2i",
          timezone: FORECAST_TIMEZONE,
          forecast_days: "3",
          hourly:
            "temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
          daily:
            "temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant",
        }).toString();

        const aromeUrl = new URL("https://api.open-meteo.com/v1/forecast");
        aromeUrl.search = new URLSearchParams({
          latitude: String(FORECAST_LATITUDE),
          longitude: String(FORECAST_LONGITUDE),
          models: "meteofrance_arome_france_hd",
          timezone: FORECAST_TIMEZONE,
          forecast_days: "3",
          hourly:
            "temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
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

        const [iconResponse, aromeResponse, ensembleResponse] =
          await Promise.all([
            fetch(iconUrl.toString(), { cache: "no-store" }),
            fetch(aromeUrl.toString(), { cache: "no-store" }).catch(
              () => null,
            ),
            fetch(ensembleUrl.toString(), { cache: "no-store" }).catch(
              () => null,
            ),
          ]);

        if (!iconResponse.ok) {
          throw new Error(
            "La previsione ICON-2I non è momentaneamente disponibile.",
          );
        }

        const iconDeterministic = await iconResponse.json();
        let aromeDeterministic = null;
        let ensemble = null;

        if (aromeResponse?.ok) {
          aromeDeterministic = await aromeResponse.json();
        }

        if (ensembleResponse?.ok) {
          ensemble = await ensembleResponse.json();
        }

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
        !Number.isFinite(last) ||
        Date.now() - last >= FORECAST_REFRESH_MS;

      if (!refreshDue) {
        scheduleNextUpdate(last);
        return;
      }

      const consultationTime = await loadForecast();

      if (!alive) return;

      scheduleNextUpdate(
        Number.isFinite(consultationTime)
          ? consultationTime
          : Date.now(),
      );
    };

    /*
     * La cache viene mostrata immediatamente. Se ha meno di 60 minuti,
     * la nuova richiesta parte allo scadere dell'ora effettiva dall'ultima
     * consultazione; se è più vecchia, viene aggiornata subito.
     *
     * In questo modo chiudere o riaprire la pagina non fa ripartire da zero
     * il conteggio dei 60 minuti e non può lasciare le previsioni ferme al
     * giorno precedente.
     */
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

  const hasEnsemble = forecast.some((day) => day.ensembleMembers > 1);
  const hasArome = forecast.some((day) => day.aromeUsed);
  const hasFullArome = forecast.some((day) => day.aromeCoverage === "full");
  const hasPartialArome = forecast.some(
    (day) => day.aromeCoverage === "partial",
  );

  return (
    <section className="forecastSection" aria-label="Previsioni per Collinas">
      <div className="forecastHeader">
        <div className="forecastHeading">
          <span className="forecastKicker">PREVISIONI LOCALI</span>
          <h2>Previsioni per Collinas</h2>
          <p>
            Previsione di consenso suddivisa tra notte, mattino, pomeriggio
            e sera nelle prossime 72 ore.
          </p>
        </div>

        <div className="forecastSource">
          <strong>
            {[
              "ICON-2I",
              hasArome ? "AROME HD" : null,
              hasEnsemble ? "ICON-EU EPS" : null,
            ]
              .filter(Boolean)
              .join(" + ")}
          </strong>
          <span>
            {updatedAt
              ? `Consultazione ${updatedAt.toLocaleTimeString("it-IT", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`
              : "Orizzonte 3 giorni"}
          </span>
          <small>
            {hasFullArome && hasPartialArome
              ? "Copertura AROME completa o parziale secondo la scadenza"
              : hasFullArome
                ? "ICON e AROME disponibili su tutte le fasce"
                : hasPartialArome
                  ? "AROME disponibile soltanto su alcune fasce"
                  : "AROME temporaneamente non disponibile"}
          </small>
        </div>
      </div>

      {loading && !forecast.length && (
        <div className="forecastMessage">Caricamento delle previsioni…</div>
      )}

      {!loading && error && !forecast.length && (
        <div className="forecastMessage">{error}</div>
      )}

      {forecast.length > 0 && (
        <div className="forecastGrid">
          {forecast.map((day) => (
            <article className="forecastCard" key={day.iso}>
              <div className="forecastDay">
                <strong>{day.title}</strong>
                <div className="forecastDayMeta">
                  <span>{day.dateLabel}</span>
                  <small>{day.modelLabel}</small>
                </div>
              </div>

              <div className="dailySummary">
                <div className="summaryItem maximum">
                  <span>Massima</span>
                  <strong>{formatForecastRange(day.maxRange)}</strong>
                </div>
                <div className="summaryItem minimum">
                  <span>Minima</span>
                  <strong>{formatForecastRange(day.minRange)}</strong>
                </div>
                <div className="summaryItem rainSummary">
                  <span>Pioggia</span>
                  <strong>{day.rainProbability}%</strong>
                  <small>
                    {day.rainPeriod
                      ? `${day.rainPeriod} · ${day.rainRange}`
                      : day.rainRange}
                  </small>
                </div>
                <div className="summaryItem windSummary">
                  <span>Vento</span>
                  <strong>
                    {day.windDirection} {fmt(day.windSpeed, 0)} km/h
                  </strong>
                  <small>Raffiche {fmt(day.windGust, 0)} km/h</small>
                </div>
              </div>

              <div
                className="periodGrid"
                role="list"
                aria-label={`Dettaglio delle fasce orarie di ${day.title}`}
              >
                {day.periods.map((period) => (
                  <div
                    className={`periodForecast ${period.past ? "isPast" : ""}`}
                    key={period.key}
                    role="listitem"
                  >
                    <div className="periodTop">
                      <strong>{period.label}</strong>
                      <span>{period.timeLabel}</span>
                    </div>

                    <div className="periodBody">
                      <div className="periodIcon">
                        <WeatherForecastIcon
                          kind={period.weather.kind}
                          night={period.night}
                        />
                      </div>

                      <div className="periodDetails">
                        <div className="periodCondition">
                          {period.weather.label}
                        </div>
                        <strong className="periodTemperature">
                          {formatForecastRange(period.temperatureRange)}
                        </strong>
                        <span className="periodRain">
                          Pioggia {period.rainProbability}% · {period.rainRange}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="forecastFooter">
        <div>
          <strong>Oltre le 72 ore</strong>
          <span>
            Le previsioni confrontano ICON-2I, AROME HD e gli scenari
            dell’ensemble ICON-EU. Gli intervalli indicano la fascia più
            probabile tra le diverse simulazioni; oltre tre giorni
            l’incertezza aumenta e va letta nei grafici ensemble.
          </span>
        </div>

        <a href="/grafici-previsione">
          Apri i grafici ensemble
          <span aria-hidden="true">→</span>
        </a>
      </div>

      <style jsx>{`
        .forecastSection {
          margin: 18px auto 0;
          border: 1px solid #e4e7eb;
          border-radius: 22px;
          overflow: hidden;
          background:
            radial-gradient(
              800px 260px at 12% 0%,
              rgba(14, 165, 233, 0.09),
              transparent 62%
            ),
            linear-gradient(180deg, #ffffff, #f8fafc);
          box-shadow: 0 9px 28px rgba(15, 23, 42, 0.055);
        }

        .forecastHeader {
          min-height: 100px;
          padding: 18px 20px;
          display: grid;
          grid-template-columns: 1fr minmax(0, 720px) 1fr;
          align-items: center;
          gap: 20px;
          border-bottom: 1px solid #e9edf1;
        }

        .forecastHeading {
          grid-column: 2;
          min-width: 0;
          text-align: center;
        }

        .forecastKicker {
          display: block;
          margin-bottom: 5px;
          font-size: 9px;
          font-weight: 950;
          color: #0284c7;
          letter-spacing: 0.1em;
        }

        .forecastHeading h2 {
          margin: 0;
          font-size: 24px;
          font-weight: 950;
          letter-spacing: -0.025em;
          color: #0f172a;
          text-align: center;
        }

        .forecastHeading p {
          margin: 5px auto 0;
          font-size: 11px;
          font-weight: 700;
          line-height: 1.45;
          color: rgba(15, 23, 42, 0.56);
          text-align: center;
        }

        .forecastSource {
          grid-column: 3;
          justify-self: end;
          min-width: 190px;
          padding: 10px 13px;
          display: grid;
          gap: 3px;
          border: 1px solid #dfe7ee;
          border-radius: 13px;
          background: rgba(255, 255, 255, 0.86);
          text-align: center;
        }

        .forecastSource strong {
          font-size: 10px;
          font-weight: 950;
          color: #0f172a;
        }

        .forecastSource span {
          font-size: 9px;
          font-weight: 800;
          color: rgba(15, 23, 42, 0.5);
          text-transform: uppercase;
          letter-spacing: 0.035em;
        }

        .forecastSource small {
          font-size: 8px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.46);
          line-height: 1.25;
        }

        .forecastMessage {
          min-height: 220px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          font-size: 12px;
          font-weight: 800;
          color: rgba(15, 23, 42, 0.62);
          text-align: center;
        }

        .forecastGrid {
          padding: 16px 18px 18px;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 13px;
        }

        .forecastCard {
          min-width: 0;
          padding: 15px;
          border: 1px solid #e2e8ee;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 5px 16px rgba(15, 23, 42, 0.035);
        }

        .forecastDay {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
        }

        .forecastDay strong {
          font-size: 18px;
          font-weight: 950;
          color: #0f172a;
        }

        .forecastDayMeta {
          min-width: 0;
          display: grid;
          justify-items: end;
          gap: 2px;
          text-align: right;
        }

        .forecastDayMeta span {
          font-size: 10px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.5);
          text-transform: capitalize;
        }

        .forecastDayMeta small {
          padding: 3px 6px;
          border: 1px solid #e2e8f0;
          border-radius: 999px;
          background: #f8fafc;
          font-size: 7.5px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.55);
          text-transform: uppercase;
          letter-spacing: 0.025em;
          white-space: nowrap;
        }

        .dailySummary {
          margin-top: 9px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }

        .summaryItem {
          min-width: 0;
          min-height: 50px;
          padding: 5px 8px;
          display: grid;
          align-content: center;
          gap: 1px;
          border: 1px solid #e7ebef;
          border-radius: 11px;
          background: #fbfcfd;
          text-align: center;
        }

        .summaryItem > span {
          font-size: 7.5px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.5);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .summaryItem strong {
          overflow: hidden;
          font-size: 13.5px;
          font-weight: 950;
          color: #0f172a;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .summaryItem small {
          overflow: hidden;
          font-size: 8px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.48);
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .summaryItem.maximum strong {
          color: #dc2626;
        }

        .summaryItem.minimum strong {
          color: #2563eb;
        }

        .rainSummary strong {
          color: #0284c7;
        }

        .rainSummary small {
          font-size: 10px;
          font-weight: 900;
          color: #0369a1;
        }

        .periodGrid {
          margin-top: 10px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 7px;
        }

        .periodForecast {
          min-width: 0;
          min-height: 84px;
          padding: 8px 10px;
          display: grid;
          grid-template-rows: auto 1fr;
          gap: 5px;
          align-content: start;
          border: 1px solid #e5eaf0;
          border-radius: 12px;
          background:
            linear-gradient(180deg, rgba(248, 250, 252, 0.82), #ffffff);
          transition:
            transform 130ms ease,
            border-color 130ms ease,
            box-shadow 130ms ease,
            opacity 130ms ease;
        }

        .periodForecast:hover {
          transform: translateY(-1px);
          border-color: #cfd8e2;
          box-shadow: 0 6px 14px rgba(15, 23, 42, 0.045);
        }

        .periodForecast.isPast {
          opacity: 0.68;
        }

        .periodTop {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
          padding-bottom: 4px;
          border-bottom: 1px solid rgba(226, 232, 240, 0.78);
        }

        .periodTop strong {
          min-width: 0;
          font-size: 10.5px;
          font-weight: 950;
          color: #0f172a;
          white-space: nowrap;
        }

        .periodTop span {
          flex: 0 0 auto;
          font-size: 7.8px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.46);
        }

        .periodBody {
          min-width: 0;
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr);
          align-items: center;
          gap: 8px;
        }

        .periodIcon {
          width: 32px;
          height: 30px;
          margin: 0;
        }

        .periodIcon :global(svg) {
          width: 100%;
          height: 100%;
          display: block;
          overflow: visible;
        }

        .periodDetails {
          min-width: 0;
          display: grid;
          grid-template-columns: 1fr;
          grid-template-areas:
            "temperature"
            "condition"
            "rain";
          align-items: center;
          gap: 1px;
          text-align: left;
        }

        .periodCondition {
          grid-area: condition;
          min-width: 0;
          font-size: 8.7px;
          font-weight: 900;
          line-height: 1.15;
          color: #334155;
          white-space: normal;
          overflow-wrap: anywhere;
        }

        .periodTemperature {
          grid-area: temperature;
          font-size: 11.5px;
          font-weight: 950;
          color: #0f172a;
          white-space: nowrap;
        }

        .periodRain {
          grid-area: rain;
          min-width: 0;
          font-size: 8px;
          font-weight: 800;
          line-height: 1.15;
          color: rgba(15, 23, 42, 0.56);
          white-space: normal;
          overflow-wrap: anywhere;
        }

        .forecastFooter {
          min-height: 76px;
          padding: 13px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          border-top: 1px solid #e7ebef;
          background: rgba(255, 255, 255, 0.78);
        }

        .forecastFooter > div {
          min-width: 0;
          display: grid;
          gap: 3px;
        }

        .forecastFooter > div strong {
          font-size: 11px;
          font-weight: 950;
          color: #0f172a;
        }

        .forecastFooter > div span {
          max-width: 740px;
          font-size: 9.5px;
          font-weight: 700;
          line-height: 1.4;
          color: rgba(15, 23, 42, 0.52);
        }

        .forecastFooter a {
          flex: 0 0 auto;
          min-height: 42px;
          padding: 0 15px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          border: 1px solid #cbd5df;
          border-radius: 13px;
          background: #0f172a;
          color: #fff;
          font-size: 11px;
          font-weight: 900;
          text-decoration: none;
          transition:
            transform 120ms ease,
            background 120ms ease;
        }

        .forecastFooter a:hover {
          transform: translateY(-1px);
          background: #1e293b;
        }

        .forecastFooter a span {
          font-size: 17px;
          line-height: 1;
        }

        @media (max-width: 1180px) {
          .forecastHeader {
            grid-template-columns: 1fr minmax(0, 640px) 1fr;
          }

          .forecastSource {
            min-width: 165px;
          }

          .forecastGrid {
            grid-template-columns: 1fr;
          }

          .forecastCard {
            display: grid;
            grid-template-columns: 230px minmax(0, 1fr);
            grid-template-areas:
              "day day"
              "summary periods";
            column-gap: 12px;
          }

          .forecastDay {
            grid-area: day;
          }

          .dailySummary {
            grid-area: summary;
          }

          .periodGrid {
            grid-area: periods;
            margin-top: 11px;
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }

        @media (max-width: 820px) {
          .forecastHeader {
            padding: 16px 13px;
            grid-template-columns: 1fr;
            gap: 12px;
          }

          .forecastHeading,
          .forecastSource {
            grid-column: 1;
          }

          .forecastHeading h2 {
            font-size: 21px;
          }

          .forecastHeading p {
            font-size: 10px;
          }

          .forecastSource {
            justify-self: center;
            width: min(100%, 300px);
            min-width: 0;
            box-sizing: border-box;
          }

          .forecastCard {
            display: block;
          }

          .dailySummary {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

          .periodGrid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }
        }

        @media (max-width: 720px) {
          .forecastSection {
            border-radius: 18px;
          }

          .forecastGrid {
            padding: 12px 10px 14px;
            gap: 10px;
          }

          .forecastCard {
            padding: 13px;
          }

          .forecastDay strong {
            font-size: 16px;
          }

          .dailySummary,
          .periodGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .summaryItem {
            min-height: 48px;
            padding-top: 5px;
            padding-bottom: 5px;
          }

          .periodForecast {
            min-height: 82px;
            padding: 8px;
          }

          .periodBody {
            grid-template-columns: 30px minmax(0, 1fr);
            gap: 6px;
          }

          .periodIcon {
            width: 28px;
            height: 26px;
          }

          .periodDetails {
            gap: 1px;
          }

          .periodTemperature {
            font-size: 11px;
          }

          .periodRain {
            font-size: 7.7px;
          }

          .forecastFooter {
            padding: 14px 11px;
            display: grid;
            text-align: center;
          }

          .forecastFooter a {
            width: 100%;
            box-sizing: border-box;
          }
        }

        @media (max-width: 430px) {
          .forecastHeader {
            padding-left: 10px;
            padding-right: 10px;
          }

          .forecastHeading h2 {
            font-size: 20px;
          }

          .forecastCard {
            padding: 11px;
          }

          .summaryItem strong {
            font-size: 12.5px;
          }

          .rainSummary small {
            font-size: 9.5px;
          }

          .periodForecast {
            min-height: 78px;
            padding: 7px;
          }

          .periodBody {
            grid-template-columns: 26px minmax(0, 1fr);
            gap: 5px;
          }

          .periodIcon {
            width: 24px;
            height: 23px;
          }

          .periodTop strong {
            font-size: 9.5px;
          }

          .periodTop span {
            font-size: 7px;
          }

          .periodTemperature {
            font-size: 10px;
          }

          .periodCondition {
            font-size: 8px;
          }

          .periodRain {
            font-size: 6.8px;
          }
        }
      `}</style>
    </section>
  );
}


// -------------------- scheda anno compatta --------------------
function YearCard({ y, norm }) {
  const router = useRouter();
  const href = `/anni/${y.year}`;

  const onCardClick = (e) => {
    if (e?.target && typeof e.target.closest === "function") {
      const a = e.target.closest("a");
      if (a) return;
    }
    router.push(href);
  };

  const onCardKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      router.push(href);
    }
  };

  const rainBar = (() => {
    const v = n(y.rain);
    const min = n(norm.rainMin);
    const max = n(norm.rainMax);
    const denom = max - min;
    const t = denom > 0 ? (v - min) / denom : 0;
    return clamp01(t);
  })();

  const tBar = (() => {
    const v = n(y.tmean);
    const min = n(norm.tmeanMin);
    const max = n(norm.tmeanMax);
    const denom = max - min;
    const t = denom > 0 ? (v - min) / denom : 0;
    return clamp01(t);
  })();

  return (
    <article
      className="card"
      aria-label={`Anno ${y.year}`}
      role="link"
      tabIndex={0}
      onClick={onCardClick}
      onKeyDown={onCardKeyDown}
    >
      <div className="top">
        <div className="yr">{y.year}</div>
        <span className="chip">
          <b>{Number.isFinite(n(y.ndays)) ? y.ndays : "—"}</b> giorni
        </span>
      </div>

      <div className="mainStats">
        <div className="metric">
          <div className="mTop">
            <span className="mLabel">Temperatura media</span>
            <span className="mValue">{fmt(y.tmean, 1)} °C</span>
          </div>
          <div className="track" aria-hidden="true">
            <div
              className="fill"
              style={{ width: `${Math.round(tBar * 100)}%` }}
            />
          </div>
        </div>

        <div className="metric">
          <div className="mTop">
            <span className="mLabel">Precipitazione totale</span>
            <span
              className={`mValue ${y.rainHasOverride ? "rainOverrideValue" : ""}`}
              title={
                y.rainHasOverride
                  ? `Totale annuale con priorità ARPAS nei mesi: ${y.rainOverrideMonthsText}`
                  : ""
              }
            >
              {fmt(y.rain, 1)} mm
            </span>
          </div>
          <div className="track" aria-hidden="true">
            <div
              className="fill"
              style={{ width: `${Math.round(rainBar * 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="details">
        <div className="detail">
          <span>Minima</span>
          <b>{fmt(y.tmin, 1)} °C</b>
        </div>

        <div className="detail">
          <span>Massima</span>
          <b>{fmt(y.tmax, 1)} °C</b>
        </div>

        <div className="detail">
          <span>Giorni piovosi</span>
          <b>{Number.isFinite(n(y.rainyDays)) ? y.rainyDays : "—"}</b>
        </div>

        <div className="detail">
          <span>Raffica massima</span>
          <b>{fmt(y.gustMax, 1)} km/h</b>
        </div>
      </div>

      <style jsx>{`
        .card {
          min-width: 0;
          border: 1px solid #e6e8ec;
          border-radius: 18px;
          padding: 13px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 5px 18px rgba(15, 23, 42, 0.045);
          cursor: pointer;
          transition:
            transform 140ms ease,
            border-color 140ms ease,
            box-shadow 140ms ease;
          outline: none;
        }

        .card:hover {
          transform: translateY(-2px);
          border-color: #cfd5dd;
          box-shadow: 0 9px 22px rgba(15, 23, 42, 0.07);
        }

        .card:focus-visible {
          box-shadow:
            0 0 0 3px rgba(2, 132, 199, 0.2),
            0 9px 22px rgba(15, 23, 42, 0.07);
        }

        .top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .yr {
          font-size: 29px;
          font-weight: 950;
          letter-spacing: -0.035em;
          color: #0f172a;
          line-height: 1;
        }

        .chip {
          flex: 0 0 auto;
          border: 1px solid #e7e9ed;
          background: #f8fafc;
          padding: 5px 8px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.7);
          white-space: nowrap;
        }

        .mainStats {
          margin-top: 11px;
          padding-top: 10px;
          border-top: 1px solid #eef0f3;
          display: grid;
          gap: 10px;
        }

        .metric {
          display: grid;
          gap: 6px;
        }

        .mTop {
          min-width: 0;
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 8px;
        }

        .mLabel {
          min-width: 0;
          font-size: 11px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.65);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .mValue {
          flex: 0 0 auto;
          font-size: 12px;
          font-weight: 950;
          color: #0f172a;
          white-space: nowrap;
        }

        .rainOverrideValue {
          position: relative;
          text-decoration: underline;
          text-decoration-color: #dc2626;
          text-decoration-thickness: 2px;
          text-underline-offset: 3px;
          padding-left: 11px;
          cursor: help;
        }

        .rainOverrideValue::before {
          content: "";
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #dc2626;
          box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.14);
        }

        .track {
          height: 6px;
          border-radius: 999px;
          background: #eef2f6;
          overflow: hidden;
        }

        .fill {
          height: 100%;
          min-width: 3px;
          border-radius: inherit;
          background: rgba(15, 23, 42, 0.82);
        }

        .details {
          margin-top: 11px;
          padding-top: 10px;
          border-top: 1px solid #eef0f3;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 7px;
        }

        .detail {
          min-width: 0;
          padding: 7px 8px;
          border: 1px solid #edf0f3;
          border-radius: 11px;
          background: #fafbfc;
          display: grid;
          gap: 2px;
        }

        .detail span {
          min-width: 0;
          font-size: 9px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.56);
          text-transform: uppercase;
          letter-spacing: 0.025em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .detail b {
          min-width: 0;
          font-size: 11px;
          font-weight: 950;
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      `}</style>
    </article>
  );
}

// -------------------- menu a tendina personalizzato --------------------
function CustomSelect({ value, options = [], onChange, ariaLabel }) {
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
      className={`customSelect ${open ? "isOpen" : ""}`}
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

// -------------------- grafico giorno / settimana / mese --------------------
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

function comparisonOptionsForMode(mode) {
  if (mode === "week") {
    return [
      { key: "prev_week", label: "Settimana precedente" },
      { key: "year_week", label: "Stessa settimana un anno fa" },
    ];
  }

  if (mode === "month") {
    return [
      { key: "prev_month", label: "Mese precedente" },
      { key: "year_month", label: "Stesso mese un anno fa" },
    ];
  }

  return [
    { key: "yesterday", label: "Ieri" },
    { key: "thirty_days", label: "30 giorni fa" },
    { key: "year_day", label: "Un anno fa" },
  ];
}

function comparisonDescriptor(mode, compareKey, selectedDate) {
  if (!selectedDate) return null;

  const current = getPeriodBounds(mode, selectedDate);

  if (mode === "day") {
    if (compareKey === "thirty_days") {
      const date = addDaysISO(selectedDate, -30);
      return {
        key: compareKey,
        label: "30 giorni fa",
        anchorDate: date,
        bounds: getPeriodBounds("day", date),
      };
    }

    if (compareKey === "year_day") {
      const date = addYearsISO(selectedDate, -1);
      return {
        key: compareKey,
        label: "un anno fa",
        anchorDate: date,
        bounds: getPeriodBounds("day", date),
      };
    }

    const date = addDaysISO(selectedDate, -1);
    return {
      key: "yesterday",
      label: "ieri",
      anchorDate: date,
      bounds: getPeriodBounds("day", date),
    };
  }

  if (mode === "week") {
    if (compareKey === "year_week") {
      const endISO = addYearsISO(current.endISO, -1);
      const startISO = addDaysISO(endISO, -6);
      return {
        key: compareKey,
        label: "la stessa settimana di un anno fa",
        anchorDate: endISO,
        bounds: { startISO, endISO },
      };
    }

    return {
      key: "prev_week",
      label: "la settimana precedente",
      anchorDate: addDaysISO(selectedDate, -7),
      bounds: {
        startISO: addDaysISO(current.startISO, -7),
        endISO: addDaysISO(current.endISO, -7),
      },
    };
  }

  if (compareKey === "year_month") {
    const date = addYearsISO(selectedDate, -1);
    return {
      key: compareKey,
      label: "lo stesso mese di un anno fa",
      anchorDate: date,
      bounds: getPeriodBounds("month", date),
    };
  }

  const date = addMonthsISO(selectedDate, -1);
  return {
    key: "prev_month",
    label: "il mese precedente",
    anchorDate: date,
    bounds: getPeriodBounds("month", date),
  };
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
      maxPositive: null,
      minNegative: null,
      last: null,
      lastTimestamp: null,
    };
  }

  let total = 0;
  let maxPositive = null;
  let minNegative = null;

  for (const point of values) {
    total += point.value;

    if (
      point.value > 0 &&
      (maxPositive === null || point.value > maxPositive)
    ) {
      maxPositive = point.value;
    }

    if (
      point.value < 0 &&
      (minNegative === null || point.value < minNegative)
    ) {
      minNegative = point.value;
    }
  }

  const lastPoint = values[values.length - 1];

  return {
    count: values.length,
    mean: total / values.length,
    maxPositive,
    minNegative,
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
  const stepMinutes = mode === "day" ? 15 : 60;
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
          if (mode === "day") {
            bucketDate.setMinutes(Math.floor(mi / 15) * 15, 0, 0);
          } else {
            bucketDate.setMinutes(0, 0, 0);
          }

          const bucketTimestamp = bucketDate.getTime();
          const bucket = buckets.get(bucketTimestamp);
          if (!bucket) continue;

          bucket.observed = true;

          if (
            dISO === latestAvailableDate &&
            (!Number.isFinite(latestObservedTimestamp) ||
              bucketTimestamp > latestObservedTimestamp)
          ) {
            latestObservedTimestamp = bucketTimestamp;
          }

          const addMean = (keyBase, value) => {
            /*
             * n() distingue i dati mancanti da un vero valore pari a zero:
             * null, undefined e stringa vuota vengono esclusi dalla media,
             * mentre 0 rimane un'osservazione valida.
             */
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
        // Gli altri giorni disponibili restano comunque utilizzabili.
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

  return {
    temp,
    dew,
    rh,
    press,
    wind,
    gust,
    dirMean,
    rainH,
    rainCum,
    rainTotal: round1(cumulativeRain),
    uv,
    solar,
    loadedDays,
    requestedDays: datesToFetch.length,
    latestTimestamp: Number.isFinite(latestObservedTimestamp)
      ? latestObservedTimestamp
      : null,
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
  if (mode === "week") {
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}|${hh}:${mm}`;
  }

  return `${pad2(d.getDate())}|${hh}:${mm}`;
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

  return getPeriodBounds(mode, shiftedAnchor);
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

  const stepMinutes = mode === "day" ? 15 : 60;
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
      // Un anno privo del periodo richiesto viene semplicemente escluso.
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

function PeriodSummary({ data, mode }) {
  const items = useMemo(() => {
    if (!data) return [];

    const tempStats = seriesStats(data.temp);
    const gustStats = seriesStats(data.gust);
    const windStats = seriesStats(data.wind);
    const rhStats = seriesStats(data.rh);
    const pressStats = seriesStats(data.press);

    return [
      {
        label: "Temperatura minima",
        value: `${fmt(tempStats.min, 1)} °C`,
        detail: formatSummaryTimestamp(tempStats.minTimestamp, mode),
      },
      {
        label: "Temperatura massima",
        value: `${fmt(tempStats.max, 1)} °C`,
        detail: formatSummaryTimestamp(tempStats.maxTimestamp, mode),
      },
      {
        label: "Temperatura media",
        value: `${fmt(tempStats.mean, 1)} °C`,
        detail: "sui dati disponibili",
      },
      {
        label: "Precipitazione",
        value: `${fmt(data.rainTotal, 1)} mm`,
        detail: "cumulata del periodo",
      },
      {
        label: "Vento medio",
        value: `${fmt(windStats.mean, 1)} km/h`,
        detail: "media del periodo",
      },
      {
        label: "Raffica massima",
        value: `${fmt(gustStats.max, 1)} km/h`,
        detail: formatSummaryTimestamp(gustStats.maxTimestamp, mode),
      },
      {
        label: "Umidità media",
        value: `${fmt(rhStats.mean, 1)} %`,
        detail: "media del periodo",
      },
      {
        label: "Pressione media",
        value: `${fmt(pressStats.mean, 1)} hPa`,
        detail: "media del periodo",
      },
    ];
  }, [data, mode]);

  if (!items.length) return null;

  return (
    <section className="summarySection" aria-label="Riepilogo del periodo">
      <div className="summaryHead">
        <h3>Riepilogo del periodo</h3>
        <span>Valori calcolati sui dati effettivamente disponibili</span>
      </div>

      <div className="summaryGrid">
        {items.map((item) => (
          <div className="summaryCell" key={item.label}>
            <span className="summaryLabel">{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.detail}</small>
          </div>
        ))}
      </div>

      <style jsx>{`
        .summarySection {
          padding: 16px 18px 18px;
          border-bottom: 1px solid #eef0f2;
          background: #fff;
        }

        .summaryHead {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: baseline;
          gap: 14px;
          margin-bottom: 11px;
        }

        h3 {
          grid-column: 2;
          margin: 0;
          font-size: 16px;
          font-weight: 950;
          color: #0f172a;
          text-align: center;
        }

        .summaryHead span {
          grid-column: 3;
          justify-self: end;
          font-size: 10px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.52);
          text-align: right;
        }

        .summaryGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          border: 1px solid #e8ebef;
          border-radius: 16px;
          overflow: hidden;
          background: #fff;
        }

        .summaryCell {
          min-width: 0;
          min-height: 78px;
          padding: 11px 13px;
          display: grid;
          align-content: center;
          gap: 3px;
          border-right: 1px solid #eef0f3;
          border-bottom: 1px solid #eef0f3;
          background: #fbfcfd;
        }

        .summaryCell:nth-child(4n) {
          border-right: 0;
        }

        .summaryCell:nth-last-child(-n + 4) {
          border-bottom: 0;
        }

        .summaryLabel {
          overflow: hidden;
          font-size: 9px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.55);
          text-transform: uppercase;
          letter-spacing: 0.035em;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        strong {
          overflow: hidden;
          font-size: 17px;
          font-weight: 950;
          color: #0f172a;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        small {
          overflow: hidden;
          font-size: 9px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.48);
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 900px) {
          .summaryGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .summaryCell:nth-child(4n) {
            border-right: 1px solid #eef0f3;
          }

          .summaryCell:nth-child(2n) {
            border-right: 0;
          }

          .summaryCell:nth-last-child(-n + 4) {
            border-bottom: 1px solid #eef0f3;
          }

          .summaryCell:nth-last-child(-n + 2) {
            border-bottom: 0;
          }
        }

        @media (max-width: 560px) {
          .summarySection {
            padding: 14px 10px 16px;
          }

          .summaryHead {
            grid-template-columns: 1fr;
            gap: 3px;
            text-align: center;
          }

          h3 {
            grid-column: 1;
            font-size: 15px;
          }

          .summaryHead span {
            grid-column: 1;
            justify-self: center;
            font-size: 9px;
            text-align: center;
          }

          .summaryCell {
            min-height: 72px;
            padding: 9px 10px;
          }

          strong {
            font-size: 15px;
          }
        }
      `}</style>
    </section>
  );
}

function ComparisonChart({
  mode,
  groupKey,
  currentData,
  comparisonData,
  currentBounds,
  comparisonBounds,
  descriptor,
  options,
  compareKey,
  onCompareChange,
  loading,
  error,
  isMobile,
}) {
  const meta = useMemo(() => deltaMetaForGroup(groupKey), [groupKey]);

  const deltaSeries = useMemo(() => {
    if (!currentData || !comparisonData || !comparisonBounds) return [];

    return makeDeltaSeries({
      currentPairs: currentData?.[meta.field],
      comparisonPairs: comparisonData?.[meta.field],
      currentStartISO: currentBounds.startISO,
      comparisonStartISO: comparisonBounds.startISO,
      mode,
    });
  }, [
    currentData,
    comparisonData,
    comparisonBounds,
    currentBounds.startISO,
    meta.field,
    mode,
  ]);

  const displayDeltaSeries = useMemo(
    () => trimTrailingNullPoints(deltaSeries),
    [deltaSeries],
  );

  const validDeltaCount = useMemo(
    () => seriesValues(displayDeltaSeries).length,
    [displayDeltaSeries],
  );

  const splitSeries = useMemo(
    () => splitDeltaSeriesBySign(displayDeltaSeries),
    [displayDeltaSeries],
  );

  const deltaStats = useMemo(
    () => deltaStatsFromSeries(displayDeltaSeries),
    [displayDeltaSeries],
  );

  const option = useMemo(() => {
    if (!validDeltaCount) return null;

    const axis = symmetricAxisFromPairs(displayDeltaSeries);

    const xAxis = {
      type: "time",
      min: isoToLocalDate(currentBounds.startISO, 0)?.getTime(),
      max: isoToLocalDate(addDaysISO(currentBounds.endISO, 1), 0)?.getTime(),
      axisLabel: {
        hideOverlap: true,
        fontSize: isMobile ? 10 : 11,
        formatter: (value) => {
          const d = new Date(value);
          const dd = pad2(d.getDate());
          const mm = pad2(d.getMonth() + 1);
          const hh = pad2(d.getHours());
          const mi = pad2(d.getMinutes());

          if (mode === "day") return `${hh}:${mi}`;
          if (mode === "month") return `${dd}/${mm}`;
          return `${dd}/${mm} ${hh}`;
        },
      },
    };

    return {
      animation: true,
      animationDuration: 220,
      grid: isMobile
        ? { left: 50, right: 18, top: 35, bottom: 54 }
        : { left: 70, right: 34, top: 35, bottom: 58 },
      tooltip: {
        trigger: "axis",
        triggerOn: "mousemove|click",
        confine: true,
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

          const validPoints = seriesValues(displayDeltaSeries);
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
            `${marker}${meta.shortLabel}: ` +
            `${formatSignedDelta(value, meta.unit)}`
          );
        },
      },
      xAxis,
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
          name: meta.positiveText,
          type: "line",
          data: splitSeries.positive,
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          sampling: "lttb",
          lineStyle: {
            width: 2.4,
            color: meta.positiveColor,
          },
          itemStyle: {
            color: meta.positiveColor,
          },
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
          name: meta.negativeText,
          type: "line",
          data: splitSeries.negative,
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          sampling: "lttb",
          lineStyle: {
            width: 2.4,
            color: meta.negativeColor,
          },
          itemStyle: {
            color: meta.negativeColor,
          },
        },
      ],
    };
  }, [
    currentBounds.endISO,
    currentBounds.startISO,
    displayDeltaSeries,
    isMobile,
    meta.negativeColor,
    meta.negativeText,
    meta.positiveColor,
    meta.positiveText,
    meta.shortLabel,
    meta.unit,
    mode,
    splitSeries.negative,
    splitSeries.positive,
    validDeltaCount,
  ]);

  const comparisonPeriodText = descriptor
    ? formatPeriodLabel(mode, descriptor.anchorDate)
    : "—";

  const summaryItems = [
    {
      label: "Differenza media",
      value: formatSignedDelta(deltaStats.mean, meta.unit),
      detail: deltaStats.count
        ? `media su ${deltaStats.count} intervalli`
        : "nessun intervallo",
      tone: deltaTone(deltaStats.mean),
    },
    {
      label: "Massimo positivo",
      value: formatSignedDelta(deltaStats.maxPositive, meta.unit),
      detail: meta.positiveText,
      tone: "positive",
    },
    {
      label: "Massimo negativo",
      value: formatSignedDelta(deltaStats.minNegative, meta.unit),
      detail: meta.negativeText,
      tone: "negative",
    },
    {
      label: "Ultima differenza",
      value: formatSignedDelta(deltaStats.last, meta.unit),
      detail: Number.isFinite(Number(deltaStats.lastTimestamp))
        ? formatSummaryTimestamp(deltaStats.lastTimestamp, mode)
        : "ultimo intervallo disponibile",
      tone: deltaTone(deltaStats.last),
    },
  ];

  return (
    <section className="comparisonSection" aria-label="Grafico di confronto">
      <div className="comparisonHead">
        <div className="comparisonText">
          <h3>{meta.differenceTitle}</h3>
          <p>
            Periodo corrente meno {descriptor?.label || "periodo di confronto"}
            {descriptor ? ` · ${comparisonPeriodText}` : ""}
          </p>
        </div>

        <div className="comparisonMenu">
          <span>Confronta con</span>
          <CustomSelect
            value={compareKey}
            options={options}
            onChange={onCompareChange}
            ariaLabel="Seleziona il periodo di confronto"
          />
        </div>
      </div>

      <div className="comparisonChart">
        {loading && <div className="compareMsg">Caricamento confronto…</div>}
        {!loading && error && <div className="compareMsg">{error}</div>}
        {!loading && !error && !validDeltaCount && (
          <div className="compareMsg">
            Nessun intervallo confrontabile: la linea apparirà solo dove sono
            presenti entrambi i dati.
          </div>
        )}
        {!loading && !error && option && (
          <ReactECharts
            option={option}
            style={{ height: isMobile ? 245 : 260, width: "100%" }}
            notMerge={true}
            lazyUpdate={true}
          />
        )}
      </div>

      {!loading && !error && validDeltaCount > 0 && (
        <div
          className="deltaSummary"
          style={{
            "--positive-color": meta.positiveColor,
            "--negative-color": meta.negativeColor,
          }}
        >
          {summaryItems.map((item) => (
            <div className="deltaCell" key={item.label}>
              <span className="deltaLabel">{item.label}</span>
              <strong className={item.tone}>{item.value}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      )}

      <style jsx>{`
        .comparisonSection {
          position: relative;
          z-index: 4;
          border-top: 1px solid #e8ebef;
          background: #fbfcfd;
        }

        .comparisonHead {
          position: relative;
          z-index: 20;
          min-height: 78px;
          padding: 14px 18px 10px;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 18px;
        }

        .comparisonText {
          grid-column: 2;
          text-align: center;
        }

        .comparisonText h3 {
          margin: 0;
          font-size: 17px;
          font-weight: 950;
          color: #0f172a;
        }

        .comparisonText p {
          margin: 4px 0 0;
          font-size: 10px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.55);
        }

        .comparisonMenu {
          grid-column: 3;
          justify-self: end;
          width: 260px;
          display: grid;
          gap: 5px;
        }

        .comparisonMenu > span {
          font-size: 9px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.58);
          text-align: center;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .comparisonChart {
          min-height: 260px;
          padding: 0 8px 2px;
        }

        .compareMsg {
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

        .deltaSummary {
          margin: 0 18px 16px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          border: 1px solid #e3e7ec;
          border-radius: 14px;
          overflow: hidden;
          background: #fff;
        }

        .deltaCell {
          min-width: 0;
          min-height: 64px;
          padding: 9px 11px;
          display: grid;
          align-content: center;
          gap: 2px;
          border-right: 1px solid #edf0f3;
          background: rgba(255, 255, 255, 0.9);
        }

        .deltaCell:last-child {
          border-right: 0;
        }

        .deltaLabel {
          overflow: hidden;
          font-size: 8.5px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.53);
          text-transform: uppercase;
          letter-spacing: 0.035em;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .deltaCell strong {
          overflow: hidden;
          font-size: 15px;
          font-weight: 950;
          color: #0f172a;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .deltaCell strong.positive {
          color: var(--positive-color);
        }

        .deltaCell strong.negative {
          color: var(--negative-color);
        }

        .deltaCell small {
          overflow: hidden;
          font-size: 8.5px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.47);
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 720px) {
          .comparisonHead {
            min-height: 0;
            padding: 14px 10px 10px;
            grid-template-columns: 1fr;
            gap: 12px;
          }

          .comparisonText {
            grid-column: 1;
            text-align: center;
          }

          .comparisonText h3 {
            font-size: 16px;
          }

          .comparisonMenu {
            grid-column: 1;
            justify-self: stretch;
            width: 100%;
          }

          .comparisonChart {
            min-height: 245px;
            padding-left: 0;
            padding-right: 0;
          }

          .compareMsg {
            min-height: 215px;
          }

          .deltaSummary {
            margin: 0 10px 14px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .deltaCell {
            min-height: 60px;
            padding: 8px 9px;
            border-bottom: 1px solid #edf0f3;
          }

          .deltaCell:nth-child(2n) {
            border-right: 0;
          }

          .deltaCell:nth-last-child(-n + 2) {
            border-bottom: 0;
          }

          .deltaCell strong {
            font-size: 14px;
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
        ? { left: 50, right: 18, top: 35, bottom: 54 }
        : { left: 70, right: 34, top: 35, bottom: 58 },
      tooltip: {
        trigger: "axis",
        triggerOn: "mousemove|click",
        confine: true,
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
          formatter: (value) => {
            const d = new Date(value);
            const dd = pad2(d.getDate());
            const mm = pad2(d.getMonth() + 1);
            const hh = pad2(d.getHours());
            const mi = pad2(d.getMinutes());

            if (mode === "day") return `${hh}:${mi}`;
            if (mode === "month") return `${dd}/${mm}`;
            return `${dd}/${mm} ${hh}`;
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
      label: "Massimo sopra media",
      value: formatSignedDelta(anomalyStats.maxPositive, meta.unit),
      detail: meta.positiveText,
      tone: "positive",
    },
    {
      label: "Massimo sotto media",
      value: formatSignedDelta(anomalyStats.minNegative, meta.unit),
      detail: meta.negativeText,
      tone: "negative",
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
            style={{ height: isMobile ? 245 : 260, width: "100%" }}
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
            <div className="climateCell" key={item.label}>
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
          margin: 0 18px 12px;
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          border: 1px solid #e3e7ec;
          border-radius: 14px;
          overflow: hidden;
          background: #fff;
        }

        .climateCell {
          min-width: 0;
          min-height: 64px;
          padding: 9px 11px;
          display: grid;
          align-content: center;
          gap: 2px;
          border-right: 1px solid #edf0f3;
          background: #fbfcfd;
        }

        .climateCell:last-child {
          border-right: 0;
        }

        .climateLabel {
          overflow: hidden;
          font-size: 8.5px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.53);
          text-transform: uppercase;
          letter-spacing: 0.035em;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .climateCell strong {
          overflow: hidden;
          font-size: 15px;
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
          font-size: 8.5px;
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
            min-height: 245px;
            padding-left: 0;
            padding-right: 0;
          }

          .climateMsg {
            min-height: 215px;
          }

          .climateSummary {
            margin: 0 10px 12px;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .climateCell {
            min-height: 60px;
            padding: 8px 9px;
            border-bottom: 1px solid #edf0f3;
          }

          .climateCell:nth-child(2n) {
            border-right: 0;
          }

          .climateCell:nth-last-child(-n + 2) {
            border-bottom: 0;
          }

          .climateCell strong {
            font-size: 14px;
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
      { key: "day", label: "Giornaliero" },
      { key: "week", label: "Settimanale" },
      { key: "month", label: "Mensile" },
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
  const [compareKey, setCompareKey] = useState("yesterday");
  const [refreshTick, setRefreshTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [climatologyLoading, setClimatologyLoading] = useState(false);
  const [err, setErr] = useState("");
  const [comparisonError, setComparisonError] = useState("");
  const [climatologyError, setClimatologyError] = useState("");
  const [data, setData] = useState(null);
  const [comparisonData, setComparisonData] = useState(null);
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

  const comparisonOptions = useMemo(
    () => comparisonOptionsForMode(mode),
    [mode],
  );

  useEffect(() => {
    if (!comparisonOptions.some((option) => option.key === compareKey)) {
      setCompareKey(comparisonOptions[0]?.key || "");
    }
  }, [compareKey, comparisonOptions]);

  const bounds = useMemo(
    () => getPeriodBounds(mode, selectedDate),
    [mode, selectedDate],
  );

  const compareDescriptor = useMemo(
    () => comparisonDescriptor(mode, compareKey, selectedDate),
    [compareKey, mode, selectedDate],
  );

  const periodTitle = useMemo(() => {
    if (mode === "week") return "Grafico settimanale";
    if (mode === "month") return "Grafico mensile";
    return "Grafico giornaliero";
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

  /*
   * Il JSON di oggi viene controllato in modo leggero una volta al minuto.
   * Il grafico viene ricaricato soltanto quando compare davvero un orario
   * più recente; in assenza di nuovi dati la pagina resta immobile.
   */
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

  const canGoBack = !navigationDisabled(availableDates, selectedDate, mode, -1);
  const canGoForward = !navigationDisabled(
    availableDates,
    selectedDate,
    mode,
    1,
  );

  const isTodayView =
    mode === "day" &&
    Boolean(latestAvailableDate) &&
    selectedDate === latestAvailableDate;

  const goToToday = () => {
    if (!latestAvailableDate) return;
    setMode("day");
    setSelectedDate(latestAvailableDate);
    setRefreshTick((value) => value + 1);
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

    async function runComparison() {
      setComparisonError("");
      setComparisonData(null);

      const compareBounds = compareDescriptor?.bounds;
      if (!compareBounds?.startISO || !compareBounds?.endISO) {
        setComparisonLoading(false);
        return;
      }

      setComparisonLoading(true);

      try {
        const result = await loadIntradayPeriod({
          startISO: compareBounds.startISO,
          endISO: compareBounds.endISO,
          mode,
          availableDates,
          dailyRainByDate,
          refreshToken: `comparison-${Date.now()}`,
          forceRefreshEndDate: true,
        });

        if (alive) setComparisonData(result);
      } catch (error) {
        if (alive) {
          setComparisonError(
            error?.message || "Il periodo di confronto non è disponibile.",
          );
        }
      } finally {
        if (alive) setComparisonLoading(false);
      }
    }

    runComparison();

    return () => {
      alive = false;
    };
  }, [
    availableDates,
    compareDescriptor,
    dailyRainByDate,
    mode,
  ]);


  useEffect(() => {
    let alive = true;

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
  ]);

  const latestDataTimeLabel = useMemo(() => {
    if (
      !showRealtimePulse ||
      !Number.isFinite(Number(data?.latestTimestamp))
    ) {
      return "";
    }

    const latestDate = new Date(Number(data.latestTimestamp));
    return `${pad2(latestDate.getHours())}:${pad2(latestDate.getMinutes())}`;
  }, [data?.latestTimestamp, showRealtimePulse]);

  const option = useMemo(() => {
    if (!data) return null;

    const baseLegend = {
      bottom: isMobileChart ? 34 : 36,
      left: "center",
      orient: isMobileChart ? "vertical" : "horizontal",
      itemGap: isMobileChart ? 7 : 18,
      textStyle: {
        fontSize: isMobileChart ? 11 : 12,
        fontWeight: 700,
        color: "rgba(15, 23, 42, 0.7)",
      },
    };

    const gridNoLegend = isMobileChart
      ? { left: 50, right: 22, top: 88, bottom: 74, containLabel: false }
      : { left: 70, right: 34, top: 78, bottom: 92 };

    const gridWithLegend = isMobileChart
      ? { left: 50, right: 50, top: 96, bottom: 142, containLabel: false }
      : { left: 70, right: 70, top: 92, bottom: 100 };

    const toolboxZoom = {
      feature: {
        dataZoom: { yAxisIndex: "none" },
        restore: {},
      },
      right: isMobileChart ? 6 : 12,
      top: isMobileChart ? 46 : 38,
      itemSize: isMobileChart ? 16 : 18,
      itemGap: isMobileChart ? 8 : 10,
    };

    const chartTitle = (text) => ({
      text,
      left: "center",
      top: isMobileChart ? 7 : 8,
      textStyle: {
        fontSize: isVeryNarrowChart ? 16 : isMobileChart ? 17 : 18,
        fontWeight: 700,
        lineHeight: isMobileChart ? 20 : 22,
        color: "#3f3f46",
      },
    });

    const xAxis = {
      type: "time",
      min: isoToLocalDate(bounds.startISO, 0)?.getTime(),
      max: isoToLocalDate(addDaysISO(bounds.endISO, 1), 0)?.getTime(),
      axisLabel: {
        hideOverlap: true,
        fontSize: isMobileChart ? 10 : 12,
        margin: isMobileChart ? 8 : 10,
        formatter: (value) => {
          const d = new Date(value);
          const dd = pad2(d.getDate());
          const mm = pad2(d.getMonth() + 1);
          const hh = pad2(d.getHours());
          const mi = pad2(d.getMinutes());

          if (mode === "day") return `${hh}:${mi}`;
          if (mode === "month") return `${dd}/${mm}`;
          return `${dd}/${mm} ${hh}`;
        },
      },
    };

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
      nameGap: isMobileChart ? 34 : 43,
      nameTextStyle: { fontSize: isMobileChart ? 10 : 12 },
      axisLabel: {
        fontSize: isMobileChart ? 10 : 12,
        formatter: (value) => Number(value).toFixed(1),
      },
      splitLine: { show: true },
      splitNumber: 6,
      ...extra,
    });

    const rightAxis = (name, extra = {}) => ({
      type: "value",
      name,
      position: "right",
      nameLocation: "middle",
      nameRotate: -90,
      nameGap: isMobileChart ? 34 : 43,
      nameTextStyle: { fontSize: isMobileChart ? 10 : 12 },
      axisLabel: {
        fontSize: isMobileChart ? 10 : 12,
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
      dataZoom: makePeriodDataZoom(mode, isMobileChart),
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
            lineStyle: { width: 2 },
          },
          {
            name: "Punto di rugiada (°C)",
            type: "line",
            data: chartPairs(data.dew),
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            sampling: "lttb",
            lineStyle: { width: 2 },
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
        mode === "day" ? "Pioggia 15 min (mm)" : "Pioggia oraria (mm)";
      const rainAxisLabel = mode === "day" ? "mm/15m" : "mm/h";

      return {
        ...common,
        title: chartTitle(
          isMobileChart
            ? `Precipitazioni • ${fmt1(data.rainTotal)} mm`
            : `Precipitazioni • Totale periodo: ${fmt1(data.rainTotal)} mm`,
        ),
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
            lineStyle: { width: 2 },
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
            lineStyle: { width: 2 },
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
            lineStyle: { width: 2 },
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
            lineStyle: { width: 2 },
          },
          {
            name: "Direzione",
            type: "scatter",
            data: chartPairs(data.dirMean),
            yAxisIndex: 1,
            symbolSize: mode === "month" ? 3 : 5,
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
            lineStyle: { width: 2 },
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
            lineStyle: { width: 2 },
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
          lineStyle: { width: 2 },
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
      ? 455
      : 415
    : 420;

  return (
    <div className="periodCard" aria-label={periodTitle}>
      <div className="periodHead">
        <div className="leftControls">
          <div className="menu leftMenu">
            <span className="menuLabel">Tipo di grafico</span>
            <CustomSelect
              value={mode}
              options={PERIODS}
              onChange={setMode}
              ariaLabel="Tipo di grafico"
            />
          </div>

          <button
            type="button"
            className="todayButton"
            onClick={goToToday}
            disabled={!latestAvailableDate || isTodayView}
            aria-label="Torna al grafico di oggi"
            title="Torna al grafico di oggi"
          >
            Oggi
          </button>
        </div>

        <div className="periodText">
          <div className="periodTitle">{periodTitle}</div>
          <div className="periodSub">
            Live data{latestDataTimeLabel ? ` · ${latestDataTimeLabel}` : ""}
          </div>
        </div>

        <div className="menu parameterMenu rightMenu">
          <span className="menuLabel">Seleziona parametro</span>
          <CustomSelect
            value={groupKey}
            options={GROUPS}
            onChange={setGroupKey}
            ariaLabel="Seleziona parametro"
          />
        </div>
      </div>

      <div className="dateNavigator">
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
          <span>
            {mode === "day"
              ? "24 ore"
              : mode === "week"
                ? "7 giorni"
                : "mese di calendario"}
          </span>
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

      {!loading && !err && data && <PeriodSummary data={data} mode={mode} />}

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

      <ComparisonChart
        mode={mode}
        groupKey={groupKey}
        currentData={data}
        comparisonData={comparisonData}
        currentBounds={bounds}
        comparisonBounds={compareDescriptor?.bounds || null}
        descriptor={compareDescriptor}
        options={comparisonOptions}
        compareKey={compareKey}
        onCompareChange={setCompareKey}
        loading={loading || comparisonLoading}
        error={comparisonError}
        isMobile={isMobileChart}
      />

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

      <style jsx>{`
        .periodCard {
          border: 1px solid #e4e7eb;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 9px 28px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }

        .periodHead {
          position: relative;
          z-index: 30;
          min-height: 104px;
          padding: 17px 18px;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 18px;
          border-bottom: 1px solid #eef0f2;
        }

        .periodText {
          grid-column: 2;
          text-align: center;
        }

        .periodTitle {
          font-size: 25px;
          font-weight: 950;
          letter-spacing: -0.025em;
          line-height: 1.05;
          color: #0f172a;
        }

        .periodSub {
          margin-top: 6px;
          font-size: 11px;
          font-weight: 850;
          color: #dc2626;
          letter-spacing: 0.025em;
        }

        .menu {
          display: grid;
          gap: 5px;
        }

        .leftControls {
          grid-column: 1;
          justify-self: start;
          display: flex;
          align-items: end;
          gap: 9px;
        }

        .leftMenu {
          width: 210px;
        }

        .todayButton {
          width: 70px;
          height: 42px;
          flex: 0 0 70px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #dde2e8;
          border-radius: 13px;
          background: #fff;
          color: #0f172a;
          font-family: inherit;
          font-size: 12px;
          font-weight: 900;
          line-height: 1;
          cursor: pointer;
          transition:
            transform 120ms ease,
            border-color 120ms ease,
            background 120ms ease,
            color 120ms ease;
        }

        .todayButton:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: #bfc8d3;
          background: #f8fafc;
        }

        .todayButton:focus-visible {
          outline: none;
          border-color: #aab5c3;
          box-shadow: 0 0 0 3px rgba(15, 23, 42, 0.06);
        }

        .todayButton:disabled {
          background: #f8fafc;
          color: rgba(15, 23, 42, 0.38);
          cursor: default;
        }

        .rightMenu {
          grid-column: 3;
          width: 290px;
          justify-self: end;
        }

        .parameterMenu {
          max-width: 290px;
        }

        .menuLabel {
          width: 100%;
          display: block;
          font-size: 10px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.62);
          text-transform: uppercase;
          letter-spacing: 0.04em;
          text-align: center;
        }

        .dateNavigator {
          position: relative;
          z-index: 2;
          min-height: 66px;
          padding: 9px 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          border-bottom: 1px solid #f0f1f3;
          background: #fbfcfd;
        }

        .arrow {
          width: 40px;
          height: 40px;
          flex: 0 0 auto;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #dfe4ea;
          border-radius: 12px;
          background: #fff;
          color: #0f172a;
          font-size: 20px;
          font-weight: 900;
          cursor: pointer;
          transition:
            transform 120ms ease,
            border-color 120ms ease,
            background 120ms ease;
        }

        .arrow:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: #bfc8d3;
          background: #f8fafc;
        }

        .arrow:disabled {
          opacity: 0.34;
          cursor: not-allowed;
        }

        .dateText {
          min-width: 280px;
          text-align: center;
          display: grid;
          gap: 2px;
        }

        .dateText strong {
          font-size: 14px;
          font-weight: 950;
          color: #0f172a;
          text-transform: capitalize;
        }

        .dateText span {
          font-size: 10px;
          font-weight: 800;
          color: rgba(15, 23, 42, 0.52);
          text-transform: uppercase;
          letter-spacing: 0.045em;
        }

        .chartArea {
          position: relative;
          z-index: 1;
          width: 100%;
          min-width: 0;
          min-height: 430px;
          padding: 6px 8px 2px;
          box-sizing: border-box;
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

        @media (max-width: 1260px) {
          .periodHead {
            grid-template-columns: minmax(0, 1fr);
            grid-template-areas:
              "title"
              "left"
              "right";
            gap: 16px;
          }

          .periodText {
            grid-area: title;
            grid-column: 1;
            justify-self: center;
            width: min(100%, 620px);
          }

          .leftControls {
            grid-area: left;
            grid-column: 1;
            justify-self: center;
            justify-content: center;
            width: min(100%, 420px);
          }

          .rightMenu {
            grid-area: right;
            grid-column: 1;
            justify-self: center;
            width: min(100%, 420px);
            max-width: 420px;
          }

          .leftMenu {
            width: min(100%, 320px);
          }
        }

        @media (max-width: 720px) {
          .periodCard {
            border-radius: 18px;
          }

          .periodHead {
            min-height: 0;
            padding: 16px 12px;
            gap: 14px;
          }

          .periodText {
            width: 100%;
          }

          .periodTitle {
            font-size: 22px;
            line-height: 1.08;
            overflow-wrap: anywhere;
          }

          .periodSub {
            margin-top: 5px;
          }

          .leftControls {
            width: 100%;
            max-width: none;
            display: grid;
            grid-template-columns: minmax(0, 1fr) 68px;
            align-items: end;
            gap: 8px;
          }

          .menu,
          .leftMenu,
          .rightMenu,
          .parameterMenu {
            width: 100%;
            max-width: none;
            min-width: 0;
          }

          .todayButton {
            width: 68px;
            height: 42px;
            min-width: 0;
            flex-basis: auto;
          }

          .menuLabel {
            text-align: center;
          }

          .dateNavigator {
            min-height: 72px;
            gap: 8px;
            padding: 10px 8px;
          }

          .dateText {
            min-width: 0;
            flex: 1;
            padding: 0 3px;
          }

          .dateText strong {
            display: block;
            font-size: 12px;
            line-height: 1.2;
            overflow-wrap: anywhere;
          }

          .dateText span {
            font-size: 9px;
          }

          .arrow {
            width: 38px;
            height: 38px;
          }

          .chartArea {
            min-height: 415px;
            padding: 4px 0 0;
            overflow: hidden;
          }

          .msg {
            min-height: 375px;
          }
        }

        @media (max-width: 430px) {
          .periodHead {
            padding-left: 10px;
            padding-right: 10px;
          }

          .periodTitle {
            font-size: 20px;
          }

          .leftControls {
            grid-template-columns: minmax(0, 1fr) 62px;
            gap: 7px;
          }

          .todayButton {
            width: 62px;
            font-size: 11px;
          }

          .menuLabel {
            font-size: 9px;
          }

          .dateNavigator {
            padding-left: 6px;
            padding-right: 6px;
          }

          .dateText strong {
            font-size: 11.5px;
          }

          .arrow {
            width: 36px;
            height: 36px;
          }
        }
      `}</style>
    </div>
  );
}