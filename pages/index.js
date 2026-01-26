import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}
function fmt(x, d = 1) {
  const v = n(x);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(d);
}
function sum(arr) {
  return arr.reduce((s, x) => s + x, 0);
}
function avg(arr) {
  return arr.length ? sum(arr) / arr.length : NaN;
}
function fmtDateISO(d) {
  if (!d) return "—";
  return String(d).slice(0, 10);
}
function clampInt(x, min, max) {
  const v = Math.max(min, Math.min(max, x));
  return v;
}

export async function getStaticProps() {
  const rows = readDaily().sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));

  const years = Array.from(new Set(rows.map((r) => String(r?.date || "").slice(0, 4)).filter(Boolean))).sort();

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

    const tminAbs = tmins.length ? Math.min(...tmins) : NaN;
    const tmaxAbs = tmaxs.length ? Math.max(...tmaxs) : NaN;

    return {
      year: y,
      ndays: d.length,
      tmeanAnn: avg(tmeans),
      tminAbs,
      tmaxAbs,
      rainAnn: sum(rains),
      rainyDays: rains.filter((x) => x > 0).length,
      gustAbs: gusts.length ? Math.max(...gusts) : NaN,
    };
  });

  // record teaser (all-time)
  const allTmin = rows.map((r) => n(r?.tmin)).filter(Number.isFinite);
  const allTmax = rows.map((r) => n(r?.tmax)).filter(Number.isFinite);
  const allGust = rows.map((r) => n(r?.gust_max)).filter(Number.isFinite);
  const allRain = rows.map((r) => n(r?.rain_total)).filter(Number.isFinite);

  const recordTeaser = {
    tminAbs: allTmin.length ? Math.min(...allTmin) : NaN,
    tmaxAbs: allTmax.length ? Math.max(...allTmax) : NaN,
    gustAbs: allGust.length ? Math.max(...allGust) : NaN,
    rainMaxDay: allRain.length ? Math.max(...allRain) : NaN,
  };

  return {
    props: {
      years,
      totalDays: rows.length,
      start,
      end,
      yearStats,
      recordTeaser,
    },
  };
}

export default function Home({
  years = [],
  totalDays = 0,
  start = null,
  end = null,
  yearStats = [],
  recordTeaser = { tminAbs: NaN, tmaxAbs: NaN, gustAbs: NaN, rainMaxDay: NaN },
}) {
  const lastYear = yearStats.length ? yearStats[yearStats.length - 1].year : null;

  // Quanti anni mostrare di default (home non deve diventare infinita)
  const DEFAULT_VISIBLE_YEARS = 6;

  // Mostro gli ultimi N anni, ma se ne hai meno non rompo nulla
  const maxVisible = useMemo(() => clampInt(DEFAULT_VISIBLE_YEARS, 1, Math.max(1, yearStats.length)), [yearStats.length]);
  const [showAllYears, setShowAllYears] = useState(false);

  // ordine: ultimi anni prima (più utile)
  const yearsDesc = useMemo(() => [...yearStats].sort((a, b) => String(b.year).localeCompare(String(a.year))), [yearStats]);

  const visibleYears = useMemo(() => {
    if (showAllYears) return yearsDesc;
    return yearsDesc.slice(0, maxVisible);
  }, [yearsDesc, showAllYears, maxVisible]);

  // TREND
  const metrics = useMemo(
    () => [
      { key: "tmeanAnn", label: "Temperatura media annua", unit: "°C", decimals: 1, kind: "line" },
      { key: "tminAbs", label: "Minima assoluta annua", unit: "°C", decimals: 1, kind: "line" },
      { key: "tmaxAbs", label: "Massima assoluta annua", unit: "°C", decimals: 1, kind: "line" },
      { key: "rainAnn", label: "Pioggia annua", unit: "mm", decimals: 1, kind: "bar" },
      { key: "rainyDays", label: "Giorni piovosi annui", unit: "gg", decimals: 0, kind: "bar" },
      { key: "gustAbs", label: "Raffica massima annua", unit: "km/h", decimals: 1, kind: "line" },
    ],
    []
  );

  const [metricKey, setMetricKey] = useState(metrics[0].key);
  const metric = metrics.find((m) => m.key === metricKey) || metrics[0];

  const trendOption = useMemo(() => {
    // trend su tutti gli anni (ordine crescente per senso temporale)
    const ysAsc = [...yearStats].sort((a, b) => String(a.year).localeCompare(String(b.year)));
    const yearsX = ysAsc.map((y) => y.year);
    const values = ysAsc.map((y) => {
      const v = Number(y?.[metric.key]);
      return Number.isFinite(v) ? v : null;
    });

    const isBar = metric.kind === "bar";

    return {
      grid: { left: 52, right: 18, top: 30, bottom: 42 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => (v == null ? "—" : `${Number(v).toFixed(metric.decimals)} ${metric.unit}`),
      },
      xAxis: {
        type: "category",
        data: yearsX,
        axisLabel: { interval: 0 },
      },
      yAxis: {
        type: "value",
        splitLine: { show: true },
      },
      series: [
        isBar
          ? { type: "bar", data: values, barMaxWidth: 34 }
          : { type: "line", data: values, showSymbol: true, symbolSize: 7, smooth: true, connectNulls: false },
      ],
    };
  }, [yearStats, metric]);

  return (
    <div className="page">
      <div className="container">
        {/* HERO */}
        <header className="hero">
          <div className="heroInner">
            <div className="heroLeft">
              <div className="kicker">ARCHIVIO METEO</div>
              <h1 className="title">Meteo Collinas</h1>
              <p className="lead">
                Storico meteo della stazione: riepiloghi annuali, dettagli mensili e pagina Record (in arrivo).
              </p>

              <div className="chips">
                <span className="chip">
                  <span className="dot" /> Giornalieri + intraday
                </span>
                <span className="chip">
                  <b>{totalDays || 0}</b>&nbsp;giorni archiviati
                </span>
                <span className="chip">
                  Periodo: <b>{fmtDateISO(start)}</b> → <b>{fmtDateISO(end)}</b>
                </span>
              </div>

              <div className="actions">
                <Link href="/records" className="btnPrimary">
                  Vedi record →
                </Link>
                <Link href={lastYear ? `/anni/${lastYear}` : "/anni"} className="btnGhost">
                  Apri ultimo anno →
                </Link>
              </div>
            </div>

            <div className="heroRight">
              <div className="kpiGrid">
                <Kpi icon="📅" title="Anni disponibili" value={years.length ? String(years.length) : "—"} sub="anni con dati" />
                <Kpi icon="🗓️" title="Giorni totali" value={totalDays ? String(totalDays) : "—"} sub="osservazioni" />
                <Kpi icon="✅" title="Ultimo aggiornamento" value={fmtDateISO(end)} sub="ultimo giorno" small />
                <Kpi icon="⏱️" title="Copertura" value={`${fmtDateISO(start)} → ${fmtDateISO(end)}`} sub="periodo" small />
              </div>
            </div>
          </div>

          {/* RECORD TEASER (compatto) */}
          <div className="strip">
            <div className="stripHead">
              <div>
                <div className="stripTitle">Record principali (anteprima)</div>
                <div className="stripSub">Valori estremi più importanti, spiegati semplice.</div>
              </div>
              <Link href="/records" className="stripLink">
                Vai ai record →
              </Link>
            </div>

            <div className="miniGrid">
              <MiniStat icon="🥶" label="Min assoluta" value={`${fmt(recordTeaser.tminAbs, 1)} °C`} />
              <MiniStat icon="🔥" label="Max assoluta" value={`${fmt(recordTeaser.tmaxAbs, 1)} °C`} />
              <MiniStat icon="💨" label="Raffica max" value={`${fmt(recordTeaser.gustAbs, 1)} km/h`} />
              <MiniStat icon="🌧️" label="Pioggia max gg" value={`${fmt(recordTeaser.rainMaxDay, 1)} mm`} />
            </div>
          </div>
        </header>

        {/* TREND (uno solo, compatto) */}
        <section className="section">
          <div className="sectionHead">
            <div>
              <h2 className="h2">Trend nel tempo</h2>
              <p className="hint">Seleziona un parametro: vedi come cambia anno per anno.</p>
            </div>

            <div className="controls">
              <label className="ctrlLabel" htmlFor="metric">
                Parametro
              </label>
              <select id="metric" className="select" value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
                {metrics.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="trendCard">
            <div className="trendTop">
              <div className="trendTitle">{metric.label}</div>
              <div className="trendUnit">Unità: {metric.unit}</div>
            </div>
            <div className="trendChart">
              <ReactECharts option={trendOption} style={{ height: 300, width: "100%" }} />
            </div>
          </div>
        </section>

        {/* ANNI (COMPATTI + MOSTRA ALTRI) */}
        <section className="section">
          <div className="sectionHead">
            <div>
              <h2 className="h2">Anni</h2>
              <p className="hint">
                Home compatta: qui vedi solo un riepilogo. Clicca l’anno per i dettagli.
              </p>
            </div>

            <div className="yearsActions">
              {yearStats.length > maxVisible && (
                <button className="btnToggle" onClick={() => setShowAllYears((s) => !s)}>
                  {showAllYears ? "Mostra meno" : `Mostra tutti (${yearStats.length})`}
                </button>
              )}
            </div>
          </div>

          <div className="yearGridCompact">
            {visibleYears.map((y) => (
              <Link key={y.year} href={`/anni/${y.year}`} className="yearCardCompact" title={`Apri ${y.year}`}>
                <div className="ycTop">
                  <div className="ycYear">{y.year}</div>
                  <div className="ycOpen">
                    Apri <span className="arr">→</span>
                  </div>
                </div>

                {/* SOLO 4 info: basta e avanza per la home */}
                <div className="ycGrid">
                  <Tiny label="Temp. media" value={`${fmt(y.tmeanAnn, 1)} °C`} />
                  <Tiny label="Min / Max" value={`${fmt(y.tminAbs, 1)} / ${fmt(y.tmaxAbs, 1)} °C`} />
                  <Tiny label="Pioggia annua" value={`${fmt(y.rainAnn, 1)} mm`} />
                  <Tiny label="Raffica max" value={`${fmt(y.gustAbs, 1)} km/h`} />
                </div>

                <div className="ycFoot">
                  <span className="ycDays">{y.ndays} giorni</span>
                  <span className="ycRainy">{y.rainyDays} gg piovosi</span>
                </div>
              </Link>
            ))}

            {!yearStats.length && (
              <div className="empty">
                Nessun dato ancora. Metti i CSV in <code>data_raw/clean/AAAA</code> e lancia{" "}
                <code>node ./scripts/build-data.js</code>.
              </div>
            )}
          </div>
        </section>
      </div>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: radial-gradient(900px 420px at 15% 0%, rgba(59, 130, 246, 0.10), transparent 55%),
            radial-gradient(900px 420px at 85% 10%, rgba(16, 185, 129, 0.08), transparent 60%),
            linear-gradient(180deg, #ffffff, #f8fafc);
          padding: 22px 14px 56px;
        }
        .container {
          max-width: 1180px;
          margin: 0 auto;
        }

        /* HERO */
        .hero {
          border: 1px solid #e8e8e8;
          border-radius: 26px;
          background: rgba(255, 255, 255, 0.86);
          box-shadow: 0 12px 36px rgba(15, 23, 42, 0.08);
          overflow: hidden;
        }
        .heroInner {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 18px;
          padding: 24px;
        }
        .kicker {
          font-size: 12px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(15, 23, 42, 0.62);
          font-weight: 900;
        }
        .title {
          margin: 10px 0 0;
          font-size: 56px;
          line-height: 1;
          letter-spacing: -0.03em;
          font-weight: 950;
          color: #0f172a;
        }
        .lead {
          margin: 12px 0 0;
          font-size: 14px;
          color: rgba(15, 23, 42, 0.72);
          max-width: 60ch;
        }
        .chips {
          margin-top: 14px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid #e9e9e9;
          background: rgba(255, 255, 255, 0.95);
          padding: 7px 11px;
          border-radius: 999px;
          font-size: 13px;
          color: rgba(15, 23, 42, 0.76);
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.03);
        }
        .dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #0f172a;
          opacity: 0.8;
        }
        .actions {
          margin-top: 16px;
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }
        .btnPrimary {
          text-decoration: none;
          color: #fff;
          background: #0f172a;
          padding: 11px 14px;
          border-radius: 16px;
          font-weight: 950;
          font-size: 13px;
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.22);
          transition: transform 140ms ease, background 140ms ease;
        }
        .btnPrimary:hover {
          transform: translateY(-1px);
          background: #0b1223;
        }
        .btnGhost {
          text-decoration: none;
          color: #0f172a;
          background: rgba(255, 255, 255, 0.9);
          border: 1px solid #e7e7e7;
          padding: 11px 14px;
          border-radius: 16px;
          font-weight: 950;
          font-size: 13px;
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
        }
        .btnGhost:hover {
          transform: translateY(-1px);
          border-color: #d6d6d6;
          background: #ffffff;
        }
        .kpiGrid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          align-content: start;
        }

        /* RECORD STRIP */
        .strip {
          border-top: 1px solid #efefef;
          padding: 18px 24px 22px;
          background: linear-gradient(180deg, rgba(248, 250, 252, 0.7), rgba(255, 255, 255, 0.92));
        }
        .stripHead {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 14px;
        }
        .stripTitle {
          font-size: 16px;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.01em;
        }
        .stripSub {
          margin-top: 4px;
          font-size: 12px;
          color: rgba(15, 23, 42, 0.68);
        }
        .stripLink {
          text-decoration: none;
          color: #0f172a;
          font-weight: 950;
          font-size: 13px;
          border: 1px solid #e7e7e7;
          background: #fff;
          padding: 10px 14px;
          border-radius: 16px;
          transition: transform 140ms ease, border-color 140ms ease;
          white-space: nowrap;
        }
        .stripLink:hover {
          transform: translateY(-1px);
          border-color: #d2d2d2;
        }
        .miniGrid {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 10px;
        }

        /* SECTIONS */
        .section {
          margin-top: 18px;
        }
        .sectionHead {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 12px;
          margin: 14px 0 10px;
          flex-wrap: wrap;
        }
        .h2 {
          margin: 0;
          font-size: 24px;
          font-weight: 950;
          letter-spacing: -0.02em;
          color: #0f172a;
        }
        .hint {
          margin: 6px 0 0;
          font-size: 13px;
          color: rgba(15, 23, 42, 0.66);
        }

        /* TREND */
        .controls {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ctrlLabel {
          font-size: 12px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.72);
        }
        .select {
          border: 1px solid #e7e7e7;
          background: rgba(255, 255, 255, 0.95);
          border-radius: 14px;
          padding: 10px 12px;
          font-weight: 900;
          color: #0f172a;
          outline: none;
        }
        .trendCard {
          border: 1px solid #e9e9e9;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
          padding: 14px;
        }
        .trendTop {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 10px;
          padding: 4px 6px 10px;
        }
        .trendTitle {
          font-size: 15px;
          font-weight: 950;
          color: #0f172a;
        }
        .trendUnit {
          font-size: 12px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.62);
        }
        .trendChart {
          border-top: 1px solid #f1f1f1;
          padding-top: 10px;
        }

        /* ANNI COMPATTI */
        .yearsActions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .btnToggle {
          border: 1px solid #e7e7e7;
          background: rgba(255, 255, 255, 0.9);
          border-radius: 14px;
          padding: 10px 12px;
          font-weight: 950;
          color: #0f172a;
          cursor: pointer;
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
        }
        .btnToggle:hover {
          transform: translateY(-1px);
          border-color: #d6d6d6;
          background: #fff;
        }

        .yearGridCompact {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }

        .yearCardCompact {
          text-decoration: none;
          color: inherit;
          border: 1px solid #e9e9e9;
          border-radius: 22px;
          padding: 14px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 10px 26px rgba(15, 23, 42, 0.06);
          transition: transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
        }
        .yearCardCompact:hover {
          transform: translateY(-3px);
          border-color: #d2d2d2;
          box-shadow: 0 14px 34px rgba(15, 23, 42, 0.09);
        }

        .ycTop {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 10px;
        }
        .ycYear {
          font-size: 30px;
          font-weight: 950;
          letter-spacing: -0.02em;
          color: #0f172a;
        }
        .ycOpen {
          font-size: 12px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.70);
          border: 1px solid #e7e7e7;
          background: #fff;
          border-radius: 999px;
          padding: 6px 10px;
          white-space: nowrap;
        }
        .arr {
          display: inline-block;
          transform: translateY(0.5px);
        }

        .ycGrid {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 10px;
          border-top: 1px solid #f1f1f1;
          padding-top: 12px;
        }

        .ycFoot {
          margin-top: 12px;
          padding-top: 10px;
          border-top: 1px dashed #e7e7e7;
          display: flex;
          justify-content: space-between;
          gap: 10px;
          font-size: 12px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.62);
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
          .heroInner {
            grid-template-columns: 1fr;
          }
          .title {
            font-size: 44px;
          }
          .miniGrid {
            grid-template-columns: repeat(2, 1fr);
          }
          .yearGridCompact {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function Kpi({ icon = "•", title, value, sub, small }) {
  return (
    <div className={`kpi ${small ? "small" : ""}`}>
      <div className="kpiTop">
        <span className="kpiIcon" aria-hidden="true">
          {icon}
        </span>
        <div className="kpiLabel">{title}</div>
      </div>
      <div className={`kpiValue ${small ? "small" : ""}`}>{value}</div>
      <div className="kpiSub">{sub}</div>

      <style jsx>{`
        .kpi {
          border: 1px solid #ececec;
          border-radius: 18px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
        }
        .kpiTop {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .kpiIcon {
          width: 26px;
          height: 26px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.06);
          border: 1px solid #ececec;
          font-size: 14px;
        }
        .kpiLabel {
          font-size: 12px;
          color: rgba(15, 23, 42, 0.66);
          font-weight: 900;
        }
        .kpiValue {
          margin-top: 6px;
          font-size: 26px;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.01em;
        }
        .kpiValue.small {
          font-size: 14px;
          font-weight: 900;
          line-height: 1.2;
        }
        .kpiSub {
          margin-top: 3px;
          font-size: 11px;
          color: rgba(15, 23, 42, 0.58);
          font-weight: 800;
        }
      `}</style>
    </div>
  );
}

function MiniStat({ icon = "•", label, value }) {
  return (
    <div className="mini">
      <div className="miniTop">
        <span className="miniIcon" aria-hidden="true">
          {icon}
        </span>
        <div className="miniLabel">{label}</div>
      </div>
      <div className="miniValue">{value}</div>

      <style jsx>{`
        .mini {
          border: 1px solid #e9e9e9;
          border-radius: 18px;
          padding: 12px;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
        }
        .miniTop {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .miniIcon {
          width: 26px;
          height: 26px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.06);
          border: 1px solid #ececec;
          font-size: 14px;
        }
        .miniLabel {
          font-size: 12px;
          color: rgba(15, 23, 42, 0.72);
          font-weight: 950;
        }
        .miniValue {
          margin-top: 6px;
          font-size: 18px;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.01em;
        }
      `}</style>
    </div>
  );
}

function Tiny({ label, value }) {
  return (
    <div className="t">
      <div className="tl">{label}</div>
      <div className="tv">{value}</div>
      <style jsx>{`
        .t {
          border: 1px solid #efefef;
          background: rgba(248, 250, 252, 0.65);
          border-radius: 16px;
          padding: 10px 12px;
        }
        .tl {
          font-size: 12px;
          color: rgba(15, 23, 42, 0.64);
          font-weight: 900;
        }
        .tv {
          margin-top: 6px;
          font-size: 14px;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.01em;
        }
      `}</style>
    </div>
  );
}