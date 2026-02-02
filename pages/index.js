// pages/index.js (FULL - compilabile)
import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

// -------------------- data load (SSG) --------------------
function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function n(x) {
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
function fmtDateISO(d) {
  if (!d) return "—";
  return String(d).slice(0, 10);
}
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
function fmtSigned(x, d = 1) {
  const v = n(x);
  if (!Number.isFinite(v)) return "—";
  const s = v > 0 ? "+" : "";
  return `${s}${v.toFixed(d)}`;
}

function pad2(x) {
  return String(x).padStart(2, "0");
}
function dateToISO(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// direzione vento: N, NE, E, SE, S, SW, W, NW
function degToCardinal8(v) {
  const nn = Number(v);
  if (!Number.isFinite(nn)) return "";
  const d = ((nn % 360) + 360) % 360;
  const ix = Math.round(d / 45) % 8;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][ix];
}

// assi "nice"
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
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return { min: 0, max: 1, interval: 0.2 };
  const range = max - min;
  const interval = niceStep(range, targetTicks);
  const niceMin = Math.floor(min / interval) * interval;
  const niceMax = Math.ceil(max / interval) * interval;
  return { min: niceMin, max: niceMax, interval };
}

// dataZoom per grafico settimanale (time axis)
function makeWeekDataZoom() {
  return [
    { type: "inside", xAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: true, moveOnMouseWheel: true, moveOnMouseMove: true },
    { type: "slider", xAxisIndex: 0, start: 0, end: 100, bottom: 8, height: 22, showDetail: false },
  ];
}

/**
 * Ultimi 7 giorni CONSECUTIVI presenti nel daily.
 * - Non richiede Lun→Dom
 * - Cerca una finestra di 7 giorni consecutivi terminante su lastDateISO.
 * - Se manca anche 1 giorno, scorre indietro di 1 giorno e riprova.
 */
function findLast7ConsecutiveISO(datesSet, lastDateISO) {
  if (!lastDateISO) return [];
  let cursor = new Date(`${lastDateISO}T12:00:00`);

  // max ~260 tentativi (quasi 9 mesi di buchi)
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

    // scorro indietro di 1 giorno e riprovo
    cursor = new Date(end);
    cursor.setDate(cursor.getDate() - 1);
  }

  return [];
}

// -------------------- Protezione Civile (build-time fetch) --------------------
async function fetchPcAlertForCollinas() {
  try {
    const res = await fetch("http://localhost:3000/api/pc-alert", {
      headers: { "User-Agent": "meteo-collinas/1.0" },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();

    const levelRaw = String(j?.level || "verde").toLowerCase();
    const level =
      levelRaw.includes("ross")
        ? "rosso"
        : levelRaw.includes("aranc")
        ? "arancione"
        : levelRaw.includes("giall")
        ? "giallo"
        : "verde";

    return {
      ok: Boolean(j?.ok),
      level,
      title: String(j?.title || "Avvisi Protezione Civile"),
      area: String(j?.area || "Collinas (Campidano - SARD-B)"),
      from: j?.from ?? null,
      to: j?.to ?? null,
      url: j?.url ?? null,
      note: j?.note ?? null,
    };
  } catch (e) {
    return {
      ok: false,
      level: "verde",
      title: "Avvisi Protezione Civile",
      area: "Collinas (Campidano - SARD-B)",
      from: null,
      to: null,
      url: null,
      note: "Errore nel recupero avvisi Protezione Civile.",
    };
  }
}

export async function getStaticProps() {
  const rows = readDaily().sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));

  // anni in ordine: più recente -> meno recente
  const years = Array.from(new Set(rows.map((r) => String(r?.date || "").slice(0, 4)).filter(Boolean))).sort((a, b) => b.localeCompare(a));

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
    const tmins = d.map((x) => n(x?.tmin)).filter(Number.isFinite);
    const tmaxs = d.map((x) => n(x?.tmax)).filter(Number.isFinite);
    const tmeans = d.map((x) => n(x?.tmean)).filter(Number.isFinite);
    const rains = d.map((x) => n(x?.rain_total)).filter(Number.isFinite);
    const gusts = d.map((x) => n(x?.gust_max)).filter(Number.isFinite);

    return {
      year: y,
      ndays: d.length,
      tmin: tmins.length ? Math.min(...tmins) : NaN,
      tmax: tmaxs.length ? Math.max(...tmaxs) : NaN,
      tmean: avg(tmeans),
      rain: sum(rains),
      rainyDays: rains.filter((x) => x > 0).length,
      gustMax: gusts.length ? Math.max(...gusts) : NaN,
    };
  });

  const allTmean = yearStats.map((y) => n(y.tmean)).filter(Number.isFinite);
  const overallTmean = avg(allTmean);

  const rainVals = yearStats.map((y) => n(y.rain)).filter(Number.isFinite);
  const rainMin = rainVals.length ? Math.min(...rainVals) : 0;
  const rainMax = rainVals.length ? Math.max(...rainVals) : 0;

  const tmeanVals = yearStats.map((y) => n(y.tmean)).filter(Number.isFinite);
  const tmeanMin = tmeanVals.length ? Math.min(...tmeanVals) : 0;
  const tmeanMax = tmeanVals.length ? Math.max(...tmeanVals) : 0;

  const dateSet = new Set(rows.map((r) => String(r?.date || "").slice(0, 10)).filter(Boolean));
  const lastDateISO = rows.length ? String(rows[rows.length - 1]?.date || "").slice(0, 10) : null;

  // ✅ Ultimi 7 giorni consecutivi realmente disponibili nel daily
  let weekDates = findLast7ConsecutiveISO(dateSet, lastDateISO);

  // fallback estremo: se ci sono buchi enormi, prendo comunque le ultime 7 date presenti (non consecutive)
  if (!weekDates.length) {
    const uniqSorted = Array.from(dateSet).sort();
    weekDates = uniqSorted.slice(-7);
  }

  const pcAlert = await fetchPcAlertForCollinas();

  return {
    props: {
      start,
      end,
      yearStats,
      overallTmean,
      norm: { rainMin, rainMax, tmeanMin, tmeanMax },
      weekDates,
      pcAlert,
    },
    revalidate: 300,
  };
}

export default function Home({
  yearStats = [],
  start = null,
  end = null,
  overallTmean = NaN,
  norm = { rainMin: 0, rainMax: 0, tmeanMin: 0, tmeanMax: 0 },
  weekDates = [],
  pcAlert = { ok: false, level: "verde", title: "Avvisi Protezione Civile", area: "Collinas", from: null, to: null, url: null, note: null },
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = String(q || "").trim();
    if (!s) return yearStats;
    return yearStats.filter((y) => String(y.year).includes(s));
  }, [q, yearStats]);

  const weekLabel = useMemo(() => {
    if (!Array.isArray(weekDates) || weekDates.length < 2) return "Ultimi giorni disponibili";
    const a = weekDates[0];
    const b = weekDates[weekDates.length - 1];
    return `${a} → ${b}`;
  }, [weekDates]);

  return (
    <div className="page">
      <header className="hero">
        <div className="heroTop">
          <div className="heroLeft">
            <div className="kicker">ARCHIVIO METEO</div>
            <h1 className="title">Meteo Collinas</h1>

            <div className="subline">Dati storici della stazione, organizzati per anno e mese.</div>

            <div className="howto" role="note">
              <b>Come si usa:</b> sotto trovi gli anni. Puoi cliccare direttamente una scheda per aprire l’anno (il pulsante “Apri dettagli” resta disponibile).
              <span className="dot">•</span>
              Periodo dati: <b>{fmtDateISO(start)}</b> → <b>{fmtDateISO(end)}</b>
            </div>
          </div>

          <div className="heroRight">
            <PcAlertCard alert={pcAlert} />
          </div>
        </div>

        <div className="embedWrap" aria-label="Widget WeatherLink">
          {/* barra link sopra il widget (stile bottoni) */}
          <nav className="quickBar" aria-label="Sezioni principali">
            <Link href="/records" className="quickPill">
              Record
            </Link>
            <Link href="/radar" className="quickPill">
              Radar
            </Link>
            <Link href="/previsioni" className="quickPill">
              Grafici di previsione
            </Link>
          </nav>

          <div className="embedFrame">
            <iframe
              src="https://www.weatherlink.com/embeddablePage/show/865c69d0529a4b2d907ab00a67d2935d/signature"
              width="760"
              height="200"
              frameBorder="0"
              title="WeatherLink Signature"
            />
          </div>
        </div>

        <div className="weekWrap">
          <WeekChart weekDates={weekDates} weekLabel={weekLabel} />
        </div>
      </header>

      <section className="section">
        <div className="sectionHead">
          <div>
            <h2>Seleziona un anno</h2>
            <div className="hint">Clicca una scheda per entrare nell’anno. Gli anni sono ordinati dal più recente al meno recente.</div>
          </div>

          <div className="tools">
            <label className="searchWrap" aria-label="Filtra anni">
              <span className="searchLabel">Filtro</span>
              <input className="search" placeholder="es. 2025" value={q} onChange={(e) => setQ(e.target.value)} inputMode="numeric" />
            </label>
          </div>
        </div>

        <div className="grid">
          {filtered.map((y) => (
            <YearCard key={y.year} y={y} overallTmean={overallTmean} norm={norm} />
          ))}

          {!yearStats.length && (
            <div className="empty">
              Nessun dato ancora. Metti i CSV in <code>data_raw/clean/AAAA</code> e lancia <code>node ./scripts/build-data.js</code>.
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
        .page {
          min-height: 100vh;
          background: radial-gradient(1200px 400px at 20% 0%, rgba(15, 23, 42, 0.05), transparent 60%),
            radial-gradient(900px 350px at 90% 10%, rgba(2, 132, 199, 0.07), transparent 55%),
            linear-gradient(180deg, #ffffff, #f8fafc);
          padding: 22px 16px 56px;
        }

        .hero {
          max-width: 1180px;
          margin: 0 auto;
          border: 1px solid #e8e8e8;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.86);
          backdrop-filter: blur(8px);
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }

        .heroTop {
          display: grid;
          grid-template-columns: 1.15fr 1fr;
          gap: 16px;
          padding: 22px;
        }

        .kicker {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(15, 23, 42, 0.62);
          font-weight: 900;
        }

        .title {
          margin: 8px 0 0;
          font-size: 52px;
          line-height: 1.02;
          letter-spacing: -0.02em;
          font-weight: 950;
          color: #0f172a;
        }

        .subline {
          margin-top: 10px;
          font-size: 14px;
          color: rgba(15, 23, 42, 0.72);
          line-height: 1.45;
        }

        .dot {
          margin: 0 8px;
          opacity: 0.5;
        }

        .howto {
          margin-top: 14px;
          border: 1px solid #ececec;
          background: rgba(248, 250, 252, 0.85);
          border-radius: 16px;
          padding: 10px 12px;
          font-size: 12px;
          color: rgba(15, 23, 42, 0.74);
          line-height: 1.45;
        }

        .heroRight {
          display: flex;
          justify-content: flex-end;
          align-items: flex-start;
        }

        .embedWrap {
          border-top: 1px solid #efefef;
          padding: 16px 22px 18px;
          background: linear-gradient(180deg, rgba(248, 250, 252, 0.65), rgba(255, 255, 255, 0.92));
        }

        /* ---- barra link sopra al widget (stile come screenshot: bottoni, niente puntini/frecce) ---- */
        .quickBar {
          margin: 0 auto 12px;
          width: min(760px, 100%);
          display: flex;
          gap: 10px;
          justify-content: center;
          align-items: center;
          flex-wrap: wrap;
        }

        .quickPill {
          text-decoration: none;
          color: #0f172a;
          background: rgba(255, 255, 255, 0.96);
          border: 1px solid #d7d7d7;
          padding: 12px 16px;
          border-radius: 18px;
          font-weight: 950;
          font-size: 14px;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          white-space: nowrap;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
        }

        .quickPill:hover {
          transform: translateY(-1px);
          background: #ffffff;
          border-color: #bfbfbf;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
        }

        .quickPill:focus-visible {
          outline: none;
          box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.22), 0 6px 18px rgba(15, 23, 42, 0.08);
        }

        .embedFrame {
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
        }
        .embedFrame iframe {
          border-radius: 16px;
        }

        .weekWrap {
          padding: 0 22px 22px;
        }

        .section {
          max-width: 1180px;
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
          .heroTop {
            grid-template-columns: 1fr;
          }
          .title {
            font-size: 44px;
          }
          .embedFrame iframe {
            width: 100%;
            max-width: 760px;
          }
          .grid {
            grid-template-columns: 1fr;
          }
          .tools {
            justify-content: flex-start;
          }
        }
      `}</style>
    </div>
  );
}

// -------------------- YearCard --------------------
function YearCard({ y, overallTmean, norm }) {
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

  const tDelta = Number.isFinite(n(y.tmean)) && Number.isFinite(n(overallTmean)) ? n(y.tmean) - n(overallTmean) : NaN;
  const labelDelta = !Number.isFinite(tDelta) ? null : tDelta >= 0.2 ? "Più caldo" : tDelta <= -0.2 ? "Più freddo" : "In linea";

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
    <article className="card" aria-label={`Anno ${y.year}`} role="link" tabIndex={0} onClick={onCardClick} onKeyDown={onCardKeyDown}>
      <div className="top">
        <div className="yr">{y.year}</div>

        <div className="chips" aria-label="Sintesi anno">
          <span className="chip">
            <b>{y.ndays}</b> giorni
          </span>
          <span className="chip">
            <b>{fmt(y.rain, 0)}</b> mm
          </span>
          <span className="chip">
            <b>{fmt(y.tmean, 1)}</b> °C
          </span>
        </div>
      </div>

      <div className="simple">
        <div className="metric">
          <div className="mTop">
            <span className="mLabel">Pioggia</span>
            <span className="mValue">{fmt(y.rain, 1)} mm</span>
          </div>
          <div className="track" aria-hidden="true">
            <div className="fill" style={{ width: `${Math.round(rainBar * 100)}%` }} />
          </div>
        </div>

        <div className="metric">
          <div className="mTop">
            <span className="mLabel">Temperatura media</span>
            <span className="mValue">{fmt(y.tmean, 1)} °C</span>
          </div>
          <div className="track" aria-hidden="true">
            <div className="fill" style={{ width: `${Math.round(tBar * 100)}%` }} />
          </div>
          <div className="note">{labelDelta ? `${labelDelta} (${fmtSigned(tDelta, 1)}° vs media archivio)` : "—"}</div>
        </div>
      </div>

      <div className="details">
        <div className="row">
          <span>Tmin / Tmax</span>
          <b>
            {fmt(y.tmin, 1)} / {fmt(y.tmax, 1)} °C
          </b>
        </div>
        <div className="row">
          <span>Giorni piovosi</span>
          <b>{Number.isFinite(n(y.rainyDays)) ? y.rainyDays : "—"}</b>
        </div>
        <div className="row">
          <span>Raffica max</span>
          <b>{fmt(y.gustMax, 1)} km/h</b>
        </div>
      </div>

      <div className="actions">
        <Link className="btn" href={href} aria-label={`Apri dettagli anno ${y.year}`}>
          Apri dettagli <span aria-hidden="true">→</span>
        </Link>
        <div className="hint" aria-hidden="true">
          mesi + tabella giornaliera
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
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
          outline: none;
        }
        .card:hover {
          transform: translateY(-1px);
          border-color: #d6d6d6;
          background: rgba(255, 255, 255, 0.99);
        }
        .card:focus-visible {
          box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.22), 0 10px 22px rgba(15, 23, 42, 0.08);
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
          gap: 6px;
        }
        .chip {
          border: 1px solid #ececec;
          background: rgba(248, 250, 252, 0.92);
          padding: 5px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.78);
          white-space: nowrap;
        }
        .simple {
          margin-top: 10px;
          border-top: 1px solid #f1f1f1;
          padding-top: 10px;
          display: grid;
          gap: 10px;
        }
        .metric {
          display: grid;
          gap: 6px;
        }
        .mTop {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          align-items: baseline;
        }
        .mLabel {
          font-size: 12px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.72);
        }
        .mValue {
          font-size: 12px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.88);
          white-space: nowrap;
        }
        .track {
          height: 10px;
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
        .note {
          font-size: 11px;
          color: rgba(15, 23, 42, 0.6);
          font-weight: 800;
        }
        .details {
          margin-top: 10px;
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
          justify-content: space-between;
          align-items: center;
          gap: 10px;
        }
        .btn {
          text-decoration: none;
          color: #fff;
          background: #0f172a;
          padding: 10px 12px;
          border-radius: 16px;
          font-weight: 950;
          font-size: 13px;
          box-shadow: 0 10px 20px rgba(15, 23, 42, 0.16);
          transition: transform 140ms ease, background 140ms ease;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .btn:hover {
          transform: translateY(-1px);
          background: #0b1223;
        }
        .hint {
          font-size: 11px;
          color: rgba(15, 23, 42, 0.58);
          font-weight: 800;
          white-space: nowrap;
        }
      `}</style>
    </article>
  );
}

// -------------------- PC Alert Card --------------------
function PcAlertCard({ alert }) {
  const level = String(alert?.level || "verde").toLowerCase();
  const badgeLabel =
    level === "rosso"
      ? "Allerta rossa"
      : level === "arancione"
      ? "Allerta arancione"
      : level === "giallo"
      ? "Allerta gialla"
      : "Nessuna criticità";

  return (
    <div className={`pcCard ${level}`} aria-label="Avvisi Protezione Civile">
      <div className="pcHead">
        <div>
          <div className="pcTitle">Avvisi Protezione Civile (Sardegna)</div>
          <div className="pcSub">
            Area: <b>{alert?.area || "Collinas"}</b>
          </div>
        </div>

        <div className={`badge ${level}`}>
          <span className="dot" aria-hidden="true" />
          {badgeLabel}
        </div>
      </div>

      <div className="pcBody">
        <div className="pcMain">{alert?.title || "—"}</div>

        <div className="pcMeta">
          <span>
            Da: <b>{alert?.from ? String(alert.from) : "—"}</b>
          </span>
          <span>
            A: <b>{alert?.to ? String(alert.to) : "—"}</b>
          </span>
        </div>

        {alert?.next ? (
          <div className="pcNote">
            <b>Prossima allerta:</b> {String(alert.next.level || "").toUpperCase()} dalle <b>{String(alert.next.from || "—").slice(11)}</b> alle{" "}
            <b>{String(alert.next.to || "—").slice(11)}</b>
          </div>
        ) : alert?.note ? (
          <div className="pcNote">{alert.note}</div>
        ) : null}

        {alert?.url ? (
          <a className="pcLink" href={alert.url} target="_blank" rel="noreferrer">
            Dettagli avviso <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <div className="pcLinkDisabled">Dettagli avviso ↗</div>
        )}
      </div>

      <style jsx>{`
        .pcCard {
          width: 100%;
          border: 1px solid #ececec;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 18px;
          padding: 12px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
        }

        /* ---- THEMING: tutto il riquadro prende il colore ---- */
        .pcCard.giallo {
          border-color: rgba(250, 204, 21, 0.55);
          background: rgba(250, 204, 21, 0.18);
        }
        .pcCard.arancione {
          border-color: rgba(249, 115, 22, 0.55);
          background: rgba(249, 115, 22, 0.16);
        }
        .pcCard.rosso {
          border-color: rgba(220, 38, 38, 0.55);
          background: rgba(220, 38, 38, 0.14);
        }
        .pcCard.verde {
          border-color: rgba(22, 163, 74, 0.32);
          background: rgba(22, 163, 74, 0.06);
        }

        .pcHead {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
        }
        .pcTitle {
          font-size: 14px;
          font-weight: 950;
          color: #0f172a;
        }
        .pcSub {
          margin-top: 3px;
          font-size: 11px;
          color: rgba(15, 23, 42, 0.7);
        }

        .badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid rgba(15, 23, 42, 0.12);
          background: rgba(255, 255, 255, 0.85);
          padding: 8px 10px;
          border-radius: 999px;
          font-weight: 950;
          font-size: 12px;
          white-space: nowrap;
        }
        .badge .dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          display: inline-block;
        }
        .badge.verde .dot {
          background: #16a34a;
        }
        .badge.giallo .dot {
          background: #facc15;
        }
        .badge.arancione .dot {
          background: #f97316;
        }
        .badge.rosso .dot {
          background: #dc2626;
        }

        .pcBody {
          margin-top: 10px;
          border-top: 1px solid rgba(15, 23, 42, 0.08);
          padding-top: 10px;
          display: grid;
          gap: 8px;
        }
        .pcMain {
          font-weight: 950;
          color: #0f172a;
          font-size: 13px;
        }
        .pcMeta {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          font-size: 11px;
          color: rgba(15, 23, 42, 0.72);
          font-weight: 800;
        }

        .pcNote {
          font-size: 11px;
          color: rgba(15, 23, 42, 0.74);
          font-weight: 850;
          background: rgba(255, 255, 255, 0.55);
          border: 1px solid rgba(15, 23, 42, 0.12);
          padding: 8px 10px;
          border-radius: 14px;
        }

        .pcLink,
        .pcLinkDisabled {
          font-weight: 950;
          font-size: 12px;
          border: 1px solid rgba(15, 23, 42, 0.12);
          background: rgba(255, 255, 255, 0.78);
          padding: 10px 12px;
          border-radius: 14px;
          display: inline-flex;
          justify-content: space-between;
          align-items: center;
        }
        .pcLink {
          text-decoration: none;
          color: #0f172a;
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
        }
        .pcLink:hover {
          transform: translateY(-1px);
          border-color: rgba(15, 23, 42, 0.2);
          background: rgba(255, 255, 255, 0.9);
        }
        .pcLinkDisabled {
          opacity: 0.55;
        }
      `}</style>
    </div>
  );
}

// -------------------- WeekChart (orario, aggregato) --------------------
function WeekChart({ weekDates = [], weekLabel = "Ultimi giorni disponibili" }) {
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
          setErr("Periodo non disponibile (servono 7 giorni consecutivi presenti nel daily).");
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
            rainrate_max: -Infinity,
            rain_hour_sum: 0,
            dir_sin: 0,
            dir_cos: 0,
            dir_cnt: 0,
          });
        }

        for (const dISO of dates) {
          const url = `/data/intraday/${dISO}.json`;
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) continue;
          const arr = await res.json();
          if (!Array.isArray(arr)) continue;

          for (const r of arr) {
            const tt = r?.t ? String(r.t) : "";
            if (!tt) continue;

            const m = tt.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
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

            const rr = Number(r?.rain_rate_mmph);
            if (Number.isFinite(rr)) b.rainrate_max = Math.max(b.rainrate_max, rr);

            const r15 = Number(r?.rain_15m_mm);
            if (Number.isFinite(r15)) b.rain_hour_sum += r15;

            const dir = Number(r?.wind_dir_deg);
            if (Number.isFinite(dir)) {
              const rad = (dir * Math.PI) / 180;
              b.dir_cos += Math.cos(rad);
              b.dir_sin += Math.sin(rad);
              b.dir_cnt += 1;
            }
          }
        }

        const mean = (sum, cnt) => (cnt > 0 ? sum / cnt : null);

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
            const meanRad = Math.atan2(b.dir_sin / b.dir_cnt, b.dir_cos / b.dir_cnt);
            let deg = (meanRad * 180) / Math.PI;
            if (deg < 0) deg += 360;
            dirV = deg;
          }

          const rainHour = Number.isFinite(b.rain_hour_sum) ? b.rain_hour_sum : 0;
          cum += rainHour;

          temp.push([h, tempV === null ? null : round1(tempV)]);
          dew.push([h, dewV === null ? null : round1(dewV)]);
          rh.push([h, rhV === null ? null : round1(rhV)]);
          press.push([h, pressV === null ? null : round1(pressV)]);
          wind.push([h, windV === null ? null : round1(windV)]);
          gust.push([h, gustV === null ? null : round1(gustV)]);
          dirMean.push([h, dirV === null ? null : round1(dirV)]);
          rainH.push([h, round1(rainHour)]);
          rainCum.push([h, round1(cum)]);
          uv.push([h, uvV === null ? null : round1(uvV)]);
          solar.push([h, solarV === null ? null : round1(solarV)]);
        }

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
          rainTotalWeek: round1(cum),
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
  }, [weekDates]);

  const option = useMemo(() => {
    if (!data) return null;

    const gridNoLegend = { left: 55, right: 30, top: 55, bottom: 55 };
    const gridWithLegend = { left: 55, right: 55, top: 85, bottom: 55 };

    const toolboxZoom = { feature: { dataZoom: { yAxisIndex: "none" }, restore: {} }, right: 10, top: 8 };

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

    const minMaxFrom = (pairs) => {
      const ys = (pairs || []).map((p) => Number(p?.[1])).filter(Number.isFinite);
      if (!ys.length) return null;
      return { min: Math.min(...ys), max: Math.max(...ys) };
    };

    if (groupKey === "temp") {
      const mm = minMaxFrom([...data.temp, ...data.dew]) || { min: 0, max: 1 };
      const ax = axisNice(mm.min - 1, mm.max + 1, 6);

      return {
        title: { text: "Temperatura e Punto di rugiada (orario)", left: "center", top: 10 },
        grid: gridWithLegend,
        toolbox: toolboxZoom,
        dataZoom: makeWeekDataZoom(),
        tooltip: tooltipCommon,
        legend: { top: 40, left: "center" },
        xAxis,
        yAxis: {
          type: "value",
          name: "°C",
          min: ax.min,
          max: ax.max,
          interval: ax.interval,
          splitNumber: 6,
          axisLabel: { formatter: (v) => Number(v).toFixed(1) },
          splitLine: { show: true },
        },
        series: [
          { name: "Temperatura (°C)", type: "line", data: data.temp, showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: 2 } },
          { name: "Punto di rugiada (°C)", type: "line", data: data.dew, showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: 2 } },
        ],
      };
    }

    if (groupKey === "rain") {
      const tWeek = data.rainTotalWeek;
      return {
        title: { text: `Precipitazioni (orario + cumulata) • Totale: ${fmt1(tWeek)} mm`, left: "center", top: 10 },
        grid: gridWithLegend,
        toolbox: toolboxZoom,
        dataZoom: makeWeekDataZoom(),
        tooltip: tooltipCommon,
        legend: { top: 40, left: "center" },
        xAxis,
        yAxis: [
          { type: "value", name: "mm/h", splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: true } },
          { type: "value", name: "mm cum.", position: "right", splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: false } },
        ],
        series: [
          { name: "Pioggia oraria (mm)", type: "bar", data: data.rainH, yAxisIndex: 0 },
          { name: "Cumulata (mm)", type: "line", data: data.rainCum, yAxisIndex: 1, showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: 2 } },
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
        xAxis,
        yAxis: { type: "value", name: "% RH", min: 0, max: 100, splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: true } },
        series: [{ name: "Umidità (%)", type: "line", data: data.rh, showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: 2 } }],
      };
    }

    if (groupKey === "wind") {
      return {
        title: { text: "Vento (medio + raffiche + direzione) • orario", left: "center", top: 10 },
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
                lines.push(`${p.marker}${p.seriesName}: ${v == null ? "—" : degToCardinal8(v)}`);
              } else {
                lines.push(`${p.marker}${p.seriesName}: ${v == null ? "—" : Number(v).toFixed(1)}`);
              }
            }
            return lines.join("<br/>");
          },
        },
        legend: { top: 40, left: "center" },
        xAxis,
        yAxis: [
          { type: "value", name: "km/h", splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: true } },
          { type: "value", name: "Dir", position: "right", min: 0, max: 360, interval: 45, axisLabel: { formatter: (v) => degToCardinal8(v) }, splitLine: { show: false } },
        ],
        series: [
          { name: "Vento medio (km/h)", type: "line", data: data.wind, showSymbol: false, connectNulls: false, smooth: false, yAxisIndex: 0, lineStyle: { width: 2 } },
          { name: "Raffiche (km/h)", type: "line", data: data.gust, showSymbol: false, connectNulls: false, smooth: false, yAxisIndex: 0, lineStyle: { width: 2 } },
          { name: "Direzione", type: "scatter", data: data.dirMean, yAxisIndex: 1, symbolSize: 5 },
        ],
      };
    }

    if (groupKey === "press") {
      const mm = minMaxFrom(data.press) || { min: 0, max: 1 };
      const ax = axisNice(mm.min - 2, mm.max + 2, 6);

      return {
        title: { text: "Pressione (media oraria)", left: "center", top: 10 },
        grid: gridNoLegend,
        toolbox: toolboxZoom,
        dataZoom: makeWeekDataZoom(),
        tooltip: tooltipCommon,
        xAxis,
        yAxis: { type: "value", name: "hPa", min: ax.min, max: ax.max, interval: ax.interval, splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: true } },
        series: [{ name: "Pressione (hPa)", type: "line", data: data.press, showSymbol: false, connectNulls: false, smooth: false, lineStyle: { width: 2 } }],
      };
    }

    return {
      title: { text: "UV + Radiazione (media oraria)", left: "center", top: 10 },
      grid: gridWithLegend,
      toolbox: toolboxZoom,
      dataZoom: makeWeekDataZoom(),
      tooltip: tooltipCommon,
      legend: { top: 40, left: "center" },
      xAxis,
      yAxis: [
        { type: "value", name: "UV", min: 0, splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: true } },
        { type: "value", name: "W/m²", position: "right", min: 0, splitNumber: 6, axisLabel: { formatter: (v) => Number(v).toFixed(1) }, splitLine: { show: false } },
      ],
      series: [
        { name: "UV", type: "line", data: data.uv, showSymbol: false, connectNulls: false, smooth: false, yAxisIndex: 0, lineStyle: { width: 2 } },
        { name: "Radiazione (W/m²)", type: "line", data: data.solar, showSymbol: false, connectNulls: false, smooth: false, yAxisIndex: 1, lineStyle: { width: 2 } },
      ],
    };
  }, [data, groupKey]);

  return (
    <div className="weekCard" aria-label="Grafico ultimi 7 giorni (orario)">
      <div className="weekHead">
        <div>
          <div className="weekTitle">Ultimi 7 giorni disponibili</div>
          <div className="weekSub">
            {weekLabel}. Valori <b>orari</b> (aggregati dai dati intraday).
          </div>
        </div>

        <div className="menu">
          <span className="menuLabel">Parametro</span>
          <select className="select" value={groupKey} onChange={(e) => setGroupKey(e.target.value)}>
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
        {!loading && !err && option && <ReactECharts option={option} style={{ height: 360, width: "100%" }} notMerge={true} lazyUpdate={true} />}
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