import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import SiteLayout from "../components/SiteLayout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// -------------------- data load (SSG) --------------------
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

function n(x) {
  if (x === null || x === undefined || x === "") return NaN;
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

function sum(arr) {
  return arr.reduce((s, x) => s + x, 0);
}

function avg(arr) {
  return arr.length ? sum(arr) / arr.length : NaN;
}

function fmt(x, d = 1) {
  const v = n(x);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

function round1(x) {
  const v = Number(x);
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

function monthFull(ym) {
  const mm = Number(String(ym).slice(5, 7));
  return MONTHS_IT_FULL[mm - 1] || String(ym);
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function pad2(x) {
  return String(x).padStart(2, "0");
}

function dateToISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

function makeWeekDataZoom() {
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
      bottom: 8,
      height: 22,
      showDetail: false,
    },
  ];
}

function findLast7ConsecutiveISO(datesSet, lastDateISO) {
  if (!lastDateISO) return [];

  let cursor = new Date(`${lastDateISO}T12:00:00`);

  for (let tries = 0; tries < 260; tries++) {
    const end = new Date(cursor);
    const start = new Date(cursor);
    start.setDate(start.getDate() - 6);

    const week = [];
    let ok = true;

    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const iso = dateToISO(d);
      week.push(iso);
      if (!datesSet.has(iso)) ok = false;
    }

    if (ok) return week;

    cursor = new Date(end);
    cursor.setDate(cursor.getDate() - 1);
  }

  return [];
}

// -------------------- helpers per dati daily --------------------
function dailyTempField(row, field) {
  const v = n(row?.[field]);
  if (!Number.isFinite(v)) return NaN;

  const tmin = n(row?.tmin);
  const tmax = n(row?.tmax);
  const tmean = n(row?.tmean);
  const tempVals = [tmin, tmax, tmean].filter(Number.isFinite);

  if (!tempVals.length) return NaN;

  const hasSomeNonZeroTemp = tempVals.some((x) => Math.abs(x) > 0.001);

  if (!hasSomeNonZeroTemp && Math.abs(v) <= 0.001) return NaN;

  return v;
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
    if (
      Math.abs(raw) <= 0.001 &&
      Number.isFinite(mid) &&
      Math.abs(mid) > 0.25
    ) {
      return mid;
    }
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
    new Set(rows.map((r) => String(r?.date || "").slice(0, 4)).filter(Boolean))
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
    const tmean = avgFinite(d.map((x) => n(x?.tmean)));
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
      rainOverrideMonthsText: overrideMonths.map((m) => monthFull(m.ym)).join(", "),
    };
  });

  const rainVals = yearStats.map((y) => n(y.rain)).filter(Number.isFinite);
  const rainMin = rainVals.length ? Math.min(...rainVals) : 0;
  const rainMax = rainVals.length ? Math.max(...rainVals) : 0;

  const tmeanVals = yearStats.map((y) => n(y.tmean)).filter(Number.isFinite);
  const tmeanMin = tmeanVals.length ? Math.min(...tmeanVals) : 0;
  const tmeanMax = tmeanVals.length ? Math.max(...tmeanVals) : 0;

  const dateSet = new Set(
    rows.map((r) => String(r?.date || "").slice(0, 10)).filter(Boolean)
  );

  const lastDateISO = rows.length
    ? String(rows[rows.length - 1]?.date || "").slice(0, 10)
    : null;

  let weekDates = findLast7ConsecutiveISO(dateSet, lastDateISO);

  if (!weekDates.length) {
    const uniqSorted = Array.from(dateSet).sort();
    weekDates = uniqSorted.slice(-7);
  }

  const weekDailyRain = {};
  for (const d of weekDates) {
    const row = rows.find((r) => String(r?.date || "").slice(0, 10) === d);
    weekDailyRain[d] = Number.isFinite(dailyRain(row))
      ? round1(dailyRain(row))
      : null;
  }

  return {
    props: {
      start,
      end,
      yearStats,
      norm: { rainMin, rainMax, tmeanMin, tmeanMax },
      weekDates,
      weekDailyRain,
    },
    revalidate: 300,
  };
}

export default function Home({
  yearStats = [],
  start = null,
  end = null,
  norm = { rainMin: 0, rainMax: 0, tmeanMin: 0, tmeanMax: 0 },
  weekDates = [],
  weekDailyRain = {},
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = String(q || "").trim();
    if (!s) return yearStats;
    return yearStats.filter((y) => String(y.year).includes(s));
  }, [q, yearStats]);

  const weekLabel = useMemo(() => {
    if (!Array.isArray(weekDates) || weekDates.length < 2) {
      return "Ultimi giorni disponibili";
    }
    const a = weekDates[0];
    const b = weekDates[weekDates.length - 1];
    return `${a} → ${b}`;
  }, [weekDates]);

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
      <div className="weekWrap">
        <WeekChart
          weekDates={weekDates}
          weekLabel={weekLabel}
          weekDailyRain={weekDailyRain}
        />
      </div>

      <section className="section">
        <div className="sectionHead">
          <div>
            <h2>Seleziona un anno</h2>
            <div className="hint">
              Clicca una scheda per entrare nell’anno. Gli anni sono ordinati dal
              più recente al meno recente.
            </div>
          </div>

          <div className="tools">
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
        </div>

        <div className="grid">
          {filtered.map((y) => (
            <YearCard key={y.year} y={y} norm={norm} />
          ))}

          {!yearStats.length && (
            <div className="empty">
              Nessun dato ancora. Metti i CSV in <code>data_raw/clean/AAAA</code>{" "}
              e lancia <code>node ./scripts/build-data.js</code>.
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
        .weekWrap {
          margin-top: 18px;
        }

        .section {
          margin: 18px auto 0;
        }

        .sectionHead {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
          margin: 16px 0 10px;
        }

        h2 {
          margin: 0;
          font-size: 22px;
          font-weight: 950;
          letter-spacing: -0.01em;
          color: #0f172a;
        }

        .hint {
          margin-top: 4px;
          font-size: 12px;
          color: rgba(15, 23, 42, 0.66);
          max-width: 720px;
        }

        .tools {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .searchWrap {
          display: flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #e7e7e7;
          background: rgba(255, 255, 255, 0.95);
          padding: 9px 10px;
          border-radius: 16px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
        }

        .searchLabel {
          font-size: 12px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.7);
        }

        .search {
          width: 110px;
          border: none;
          outline: none;
          background: transparent;
          font-size: 13px;
          font-weight: 950;
          color: #0f172a;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
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

        @media (max-width: 1080px) {
          .grid {
            grid-template-columns: 1fr;
          }

          .tools {
            justify-content: flex-start;
          }
        }
      `}</style>
    </SiteLayout>
  );
}

// -------------------- YearCard --------------------
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

        <div className="chips" aria-label="Sintesi anno">
          <span className="chip">
            <b>{Number.isFinite(n(y.ndays)) ? y.ndays : "—"}</b> giorni
          </span>
        </div>
      </div>

      <div className="mainStats">
        <div className="metric">
          <div className="mTop">
            <span className="mLabel">Temperatura media annua</span>
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
            <span className="mLabel">Precipitazione totale annua</span>
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
        <div className="row">
          <span>Minima assoluta giornaliera</span>
          <b>{fmt(y.tmin, 1)} °C</b>
        </div>

        <div className="row">
          <span>Massima assoluta giornaliera</span>
          <b>{fmt(y.tmax, 1)} °C</b>
        </div>

        <div className="row">
          <span>Giorni con pioggia &gt; 1 mm</span>
          <b>{Number.isFinite(n(y.rainyDays)) ? y.rainyDays : "—"}</b>
        </div>

        <div className="row">
          <span>Raffica massima giornaliera</span>
          <b>{fmt(y.gustMax, 1)} km/h</b>
        </div>
      </div>

      <style jsx>{`
        .card {
          border: 1px solid #e9e9e9;
          border-radius: 22px;
          padding: 14px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 6px 20px rgba(15, 23, 42, 0.05);
          cursor: pointer;
          transition:
            transform 140ms ease,
            border-color 140ms ease,
            background 140ms ease;
          outline: none;
        }

        .card:hover {
          transform: translateY(-1px);
          border-color: #d6d6d6;
          background: rgba(255, 255, 255, 0.99);
        }

        .card:focus-visible {
          box-shadow:
            0 0 0 3px rgba(2, 132, 199, 0.22),
            0 10px 22px rgba(15, 23, 42, 0.08);
        }

        .top {
          display: grid;
          gap: 8px;
        }

        .yr {
          font-size: 34px;
          font-weight: 950;
          letter-spacing: -0.01em;
          color: #0f172a;
          line-height: 1;
        }

        .chips {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .chip {
          border: 1px solid #ececec;
          background: rgba(248, 250, 252, 0.92);
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.78);
          white-space: nowrap;
        }

        .mainStats {
          margin-top: 12px;
          border-top: 1px solid #f1f1f1;
          padding-top: 12px;
          display: grid;
          gap: 12px;
        }

        .metric {
          display: grid;
          gap: 7px;
        }

        .mTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: baseline;
        }

        .mLabel {
          font-size: 13px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.72);
        }

        .mValue {
          font-size: 13px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.9);
          white-space: nowrap;
        }

        .rainOverrideValue {
          position: relative;
          text-decoration: underline;
          text-decoration-color: #dc2626;
          text-decoration-thickness: 2px;
          text-underline-offset: 3px;
          padding-left: 14px;
          cursor: help;
        }

        .rainOverrideValue::before {
          content: "";
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #dc2626;
          box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.16);
        }

        .track {
          height: 12px;
          border-radius: 999px;
          background: #f1f5f9;
          border: 1px solid #e5e7eb;
          overflow: hidden;
        }

        .fill {
          height: 100%;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.85);
        }

        .details {
          margin-top: 12px;
          border-top: 1px solid #f1f1f1;
          padding-top: 8px;
        }

        .row {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 0;
          border-top: 1px solid #f5f5f5;
          font-size: 13px;
        }

        .row:first-child {
          border-top: none;
        }

        .row span {
          color: rgba(15, 23, 42, 0.68);
          font-weight: 800;
        }

        .row b {
          font-weight: 950;
          color: #0f172a;
          white-space: nowrap;
        }

        .actions {
          margin-top: 12px;
          border-top: 1px dashed #e7e7e7;
          padding-top: 12px;
          display: flex;
          justify-content: flex-start;
          align-items: center;
          gap: 10px;
        }

        .btn {
          text-decoration: none;
          color: #0f172a;
          background: #fff;
          border: 1px solid #e5e7eb;
          padding: 10px 12px;
          border-radius: 16px;
          font-weight: 950;
          font-size: 13px;
          transition:
            transform 140ms ease,
            background 140ms ease,
            border-color 140ms ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .btn:hover {
          transform: translateY(-1px);
          background: #f8fafc;
          border-color: #d7dde5;
        }
      `}</style>
    </article>
  );
}

// -------------------- WeekChart (orario, aggregato) --------------------
function WeekChart({
  weekDates = [],
  weekLabel = "Ultimi giorni disponibili",
  weekDailyRain = {},
}) {
  const GROUPS = useMemo(
    () => [
      { key: "temp", label: "Temperatura + Dew point" },
      { key: "rain", label: "Precipitazioni (oraria + cumulata)" },
      { key: "rh", label: "Umidità" },
      { key: "wind", label: "Vento (medio + raffiche + direzione)" },
      { key: "press", label: "Pressione" },
      { key: "uv", label: "UV + Radiazione" },
    ],
    []
  );

  const [groupKey, setGroupKey] = useState("temp");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    let alive = true;

    async function run() {
      setErr("");
      setLoading(true);
      setData(null);

      try {
        const dates = Array.isArray(weekDates) ? weekDates.filter(Boolean) : [];

        if (dates.length !== 7) {
          setErr(
            "Periodo non disponibile (servono 7 giorni consecutivi presenti nel daily)."
          );
          return;
        }

        const startLocal = new Date(`${dates[0]}T00:00:00`);
        const hrs = [];

        for (let i = 0; i < 168; i++) {
          const d = new Date(startLocal);
          d.setHours(d.getHours() + i, 0, 0, 0);
          hrs.push(d.getTime());
        }

        const buckets = new Map();
        for (const h of hrs) {
          buckets.set(h, {
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
            rain_hour_sum: 0,
            dir_sin: 0,
            dir_cos: 0,
            dir_cnt: 0,
          });
        }

        const dailyHourMap = new Map();

        for (const dISO of dates) {
          const url = `/data/intraday/${dISO}.json`;
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) continue;

          const arr = await res.json();
          if (!Array.isArray(arr)) continue;

          const hourTotals = new Map();

          for (const r of arr) {
            const tt = r?.t ? String(r.t) : "";
            if (!tt) continue;

            const m = tt.match(
              /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/
            );
            if (!m) continue;

            const y = Number(m[1]);
            const mo = Number(m[2]);
            const da = Number(m[3]);
            const hh = Number(m[4]);
            const mi = Number(m[5]);

            const t = new Date(y, mo - 1, da, hh, mi, 0, 0);
            t.setMinutes(0, 0, 0);
            const hourMs = t.getTime();

            const b = buckets.get(hourMs);
            if (!b) continue;

            const addMean = (keyBase, val) => {
              const vv = Number(val);
              if (!Number.isFinite(vv)) return;
              b[`${keyBase}_sum`] += vv;
              b[`${keyBase}_cnt`] += 1;
            };

            addMean("temp", r?.temp_c);
            addMean("dew", r?.dewpoint_c);
            addMean("rh", r?.rh_pct);
            addMean("press", r?.press_hpa);
            addMean("wind", r?.wind_kmh);
            addMean("uv", r?.uv);
            addMean("solar", r?.solar_wm2);

            const gust = Number(r?.gust_kmh);
            if (Number.isFinite(gust)) b.gust_max = Math.max(b.gust_max, gust);

            const r15 = Number(r?.rain_15m_mm);
            if (Number.isFinite(r15)) {
              b.rain_hour_sum += r15;
              hourTotals.set(hourMs, (hourTotals.get(hourMs) || 0) + r15);
            }

            const dir = Number(r?.wind_dir_deg);
            if (Number.isFinite(dir)) {
              const rad = (dir * Math.PI) / 180;
              b.dir_cos += Math.cos(rad);
              b.dir_sin += Math.sin(rad);
              b.dir_cnt += 1;
            }
          }

          dailyHourMap.set(dISO, hourTotals);
        }

        const adjustedRainHours = new Map();

        for (const dISO of dates) {
          const hourTotals = dailyHourMap.get(dISO) || new Map();
          const rawTotal = Array.from(hourTotals.values()).reduce((a, b) => a + b, 0);
          const ovrTotal = Number.isFinite(n(weekDailyRain?.[dISO]))
            ? Number(weekDailyRain[dISO])
            : null;

          const targetTotal = ovrTotal !== null ? ovrTotal : rawTotal;

          if (rawTotal > 0) {
            const ratio = targetTotal / rawTotal;
            for (const [hourMs, val] of hourTotals.entries()) {
              adjustedRainHours.set(hourMs, round1(val * ratio) ?? 0);
            }
          } else if (targetTotal > 0) {
            const endHour = new Date(`${dISO}T23:00:00`).getTime();
            adjustedRainHours.set(endHour, round1(targetTotal) ?? 0);
          }
        }

        const mean = (sumV, cntV) => (cntV > 0 ? sumV / cntV : null);

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

        let cum = 0;

        for (const h of hrs) {
          const b = buckets.get(h);

          const tempV = mean(b.temp_sum, b.temp_cnt);
          const dewV = mean(b.dew_sum, b.dew_cnt);
          const rhV = mean(b.rh_sum, b.rh_cnt);
          const pressV = mean(b.press_sum, b.press_cnt);
          const windV = mean(b.wind_sum, b.wind_cnt);
          const uvV = mean(b.uv_sum, b.uv_cnt);
          const solarV = mean(b.solar_sum, b.solar_cnt);

          const gustV = Number.isFinite(b.gust_max) ? b.gust_max : null;

          let dirV = null;
          if (b.dir_cnt > 0) {
            const meanRad = Math.atan2(
              b.dir_sin / b.dir_cnt,
              b.dir_cos / b.dir_cnt
            );
            let deg = (meanRad * 180) / Math.PI;
            if (deg < 0) deg += 360;
            dirV = deg;
          }

          const rainHourAdj = Number(adjustedRainHours.get(h) || 0);
          cum += rainHourAdj;

          temp.push([h, tempV === null ? null : round1(tempV)]);
          dew.push([h, dewV === null ? null : round1(dewV)]);
          rh.push([h, rhV === null ? null : round1(rhV)]);
          press.push([h, pressV === null ? null : round1(pressV)]);
          wind.push([h, windV === null ? null : round1(windV)]);
          gust.push([h, gustV === null ? null : round1(gustV)]);
          dirMean.push([h, dirV === null ? null : round1(dirV)]);
          rainH.push([h, round1(rainHourAdj)]);
          rainCum.push([h, round1(cum)]);
          uv.push([h, uvV === null ? null : round1(uvV)]);
          solar.push([h, solarV === null ? null : round1(solarV)]);
        }

        const rainTotalWeek = round1(
          dates.reduce((acc, d) => {
            const vv = Number.isFinite(n(weekDailyRain?.[d]))
              ? Number(weekDailyRain[d])
              : 0;
            return acc + vv;
          }, 0)
        );

        if (!alive) return;

        setData({
          temp,
          dew,
          rh,
          press,
          wind,
          gust,
          dirMean,
          rainH,
          rainCum,
          rainTotalWeek,
          uv,
          solar,
        });
      } catch (e) {
        if (!alive) return;
        setErr("Errore nel caricamento/lettura dei JSON intraday.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();

    return () => {
      alive = false;
    };
  }, [weekDates, weekDailyRain]);

  const option = useMemo(() => {
    if (!data) return null;

    const baseLegend = {
      bottom: 36,
      left: "center",
      itemGap: 18,
      textStyle: {
        fontWeight: 700,
        color: "rgba(15, 23, 42, 0.7)",
      },
    };

    const gridNoLegend = { left: 70, right: 32, top: 55, bottom: 100 };
    const gridWithLegend = { left: 70, right: 70, top: 85, bottom: 100 };

    const toolboxZoom = {
      feature: { dataZoom: { yAxisIndex: "none" }, restore: {} },
      right: 10,
      top: 8,
    };

    const xAxis = {
      type: "time",
      axisLabel: {
        hideOverlap: true,
        formatter: (val) => {
          const d = new Date(val);
          const dd = pad2(d.getDate());
          const mm = pad2(d.getMonth() + 1);
          const hh = pad2(d.getHours());
          return `${dd}/${mm} ${hh}`;
        },
      },
    };

    const tooltipCommon = {
      trigger: "axis",
      valueFormatter: (v) => {
        if (v === null || v === undefined) return "—";
        const vv = Number(v);
        return Number.isFinite(vv) ? vv.toFixed(1) : "—";
      },
    };

    const leftAxis = (name, extra = {}) => ({
      type: "value",
      name,
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 42,
      axisLabel: { formatter: (v) => Number(v).toFixed(1) },
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
      nameGap: 42,
      axisLabel: { formatter: (v) => Number(v).toFixed(1) },
      splitLine: { show: false },
      splitNumber: 6,
      ...extra,
    });

    const minMaxFrom = (pairs) => {
      const ys = (pairs || [])
        .map((p) => p?.[1])
        .filter(
          (v) => v !== null && v !== undefined && Number.isFinite(Number(v))
        )
        .map((v) => Number(v));

      if (!ys.length) return null;
      return { min: Math.min(...ys), max: Math.max(...ys) };
    };

    if (groupKey === "temp") {
      const mm = minMaxFrom([...data.temp, ...data.dew]) || { min: 0, max: 1 };
      const ax = axisNice(mm.min - 1, mm.max + 1, 6);

      return {
        title: {
          text: "Temperatura e Punto di rugiada (orario)",
          left: "center",
          top: 10,
        },
        grid: gridWithLegend,
        toolbox: toolboxZoom,
        dataZoom: makeWeekDataZoom(),
        tooltip: tooltipCommon,
        legend: baseLegend,
        xAxis,
        yAxis: leftAxis("°C", {
          min: ax.min,
          max: ax.max,
          interval: ax.interval,
        }),
        series: [
          {
            name: "Temperatura (°C)",
            type: "line",
            data: data.temp,
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            lineStyle: { width: 2 },
          },
          {
            name: "Punto di rugiada (°C)",
            type: "line",
            data: data.dew,
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            lineStyle: { width: 2 },
          },
        ],
      };
    }

    if (groupKey === "rain") {
      const tWeek = data.rainTotalWeek;

      return {
        title: {
          text: `Precipitazioni (oraria + cumulata) • Totale: ${fmt1(tWeek)} mm`,
          left: "center",
          top: 10,
        },
        grid: gridWithLegend,
        toolbox: toolboxZoom,
        dataZoom: makeWeekDataZoom(),
        tooltip: tooltipCommon,
        legend: baseLegend,
        xAxis,
        yAxis: [leftAxis("mm/h"), rightAxis("mm cum.")],
        series: [
          {
            name: "Pioggia oraria (mm)",
            type: "bar",
            data: data.rainH,
            yAxisIndex: 0,
          },
          {
            name: "Cumulata (mm)",
            type: "line",
            data: data.rainCum,
            yAxisIndex: 1,
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            lineStyle: { width: 2 },
          },
        ],
      };
    }

    if (groupKey === "rh") {
      return {
        title: { text: "Umidità (media oraria)", left: "center", top: 10 },
        grid: gridNoLegend,
        toolbox: toolboxZoom,
        dataZoom: makeWeekDataZoom(),
        tooltip: tooltipCommon,
        legend: baseLegend,
        xAxis,
        yAxis: leftAxis("% RH", {
          min: 0,
          max: 100,
        }),
        series: [
          {
            name: "Umidità (%)",
            type: "line",
            data: data.rh,
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            lineStyle: { width: 2 },
          },
        ],
      };
    }

    if (groupKey === "wind") {
      return {
        title: {
          text: "Vento (medio + raffiche + direzione) • orario",
          left: "center",
          top: 10,
        },
        grid: gridWithLegend,
        toolbox: toolboxZoom,
        dataZoom: makeWeekDataZoom(),
        tooltip: {
          trigger: "axis",
          formatter: (params) => {
            const time = params?.[0]?.axisValueLabel ?? "";
            const lines = [time];

            for (const p of params || []) {
              const v = p.data?.[1];
              if (p.seriesName === "Direzione") {
                lines.push(
                  `${p.marker}${p.seriesName}: ${
                    v == null ? "—" : degToCardinal8(v)
                  }`
                );
              } else {
                lines.push(
                  `${p.marker}${p.seriesName}: ${
                    v == null ? "—" : Number(v).toFixed(1)
                  }`
                );
              }
            }

            return lines.join("<br/>");
          },
        },
        legend: baseLegend,
        xAxis,
        yAxis: [
          leftAxis("km/h"),
          {
            ...rightAxis("Dir"),
            min: 0,
            max: 360,
            interval: 45,
            axisLabel: { formatter: (v) => degToCardinal8(v) },
          },
        ],
        series: [
          {
            name: "Vento medio (km/h)",
            type: "line",
            data: data.wind,
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            yAxisIndex: 0,
            lineStyle: { width: 2 },
          },
          {
            name: "Raffiche (km/h)",
            type: "line",
            data: data.gust,
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            yAxisIndex: 0,
            lineStyle: { width: 2 },
          },
          {
            name: "Direzione",
            type: "scatter",
            data: data.dirMean,
            yAxisIndex: 1,
            symbolSize: 5,
          },
        ],
      };
    }

    if (groupKey === "press") {
      const mm = minMaxFrom(data.press) || { min: 1010, max: 1020 };
      const ax = axisNice(mm.min - 1.5, mm.max + 1.5, 6);

      return {
        title: { text: "Pressione (media oraria)", left: "center", top: 10 },
        grid: gridNoLegend,
        toolbox: toolboxZoom,
        dataZoom: makeWeekDataZoom(),
        tooltip: tooltipCommon,
        legend: baseLegend,
        xAxis,
        yAxis: leftAxis("hPa", {
          min: ax.min,
          max: ax.max,
          interval: ax.interval,
        }),
        series: [
          {
            name: "Pressione (hPa)",
            type: "line",
            data: data.press,
            showSymbol: false,
            connectNulls: false,
            smooth: false,
            lineStyle: { width: 2 },
          },
        ],
      };
    }

    return {
      title: { text: "UV + Radiazione (media oraria)", left: "center", top: 10 },
      grid: gridWithLegend,
      toolbox: toolboxZoom,
      dataZoom: makeWeekDataZoom(),
      tooltip: tooltipCommon,
      legend: baseLegend,
      xAxis,
      yAxis: [
        leftAxis("UV", {
          min: 0,
        }),
        rightAxis("W/m²", {
          min: 0,
        }),
      ],
      series: [
        {
          name: "UV",
          type: "line",
          data: data.uv,
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          yAxisIndex: 0,
          lineStyle: { width: 2 },
        },
        {
          name: "Radiazione (W/m²)",
          type: "line",
          data: data.solar,
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          yAxisIndex: 1,
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [data, groupKey]);

  return (
    <div className="weekCard" aria-label="Grafico ultimi 7 giorni (orario)">
      <div className="weekHead">
        <div>
          <div className="weekTitle">Ultimi 7 giorni disponibili</div>
          <div className="weekSub">
            {weekLabel}. Valori <b>orari</b> aggregati dai dati intraday.
          </div>
        </div>

        <div className="menu">
          <span className="menuLabel">Parametro</span>
          <select
            className="select"
            value={groupKey}
            onChange={(e) => setGroupKey(e.target.value)}
          >
            {GROUPS.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="chartArea">
        {loading && <div className="msg">Caricamento…</div>}
        {!loading && err && <div className="msg">{err}</div>}
        {!loading && !err && option && (
          <ReactECharts
            option={option}
            style={{ height: 420, width: "100%" }}
            notMerge={true}
            lazyUpdate={true}
          />
        )}
      </div>

      <style jsx>{`
        .weekCard {
          border: 1px solid #e8e8e8;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }

        .weekHead {
          padding: 14px 14px 10px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          border-bottom: 1px solid #f0f0f0;
        }

        .weekTitle {
          font-size: 14px;
          font-weight: 950;
          color: #0f172a;
        }

        .weekSub {
          margin-top: 3px;
          font-size: 11px;
          color: rgba(15, 23, 42, 0.64);
          max-width: 760px;
        }

        .menu {
          display: grid;
          gap: 6px;
          justify-items: end;
        }

        .menuLabel {
          font-size: 11px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.7);
        }

        .select {
          border: 1px solid #e7e7e7;
          background: #fff;
          border-radius: 14px;
          padding: 9px 10px;
          font-size: 12px;
          font-weight: 900;
          color: #0f172a;
          outline: none;
        }

        .chartArea {
          padding: 8px 8px 2px;
        }

        .msg {
          padding: 18px 14px 20px;
          font-size: 12px;
          color: rgba(15, 23, 42, 0.7);
          font-weight: 800;
        }

        @media (max-width: 1080px) {
          .weekHead {
            flex-direction: column;
            align-items: stretch;
          }

          .menu {
            justify-items: start;
          }

          .select {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}