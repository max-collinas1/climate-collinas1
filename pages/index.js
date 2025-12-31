import fs from "fs";
import path from "path";
import Link from "next/link";

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

    const tminYear = tmins.length ? Math.min(...tmins) : NaN;
    const tmaxYear = tmaxs.length ? Math.max(...tmaxs) : NaN;

    return {
      year: y,
      ndays: d.length,
      tmin: tminYear,
      tmax: tmaxYear,
      tmean: avg(tmeans),
      rain: sum(rains),
      rainyDays: rains.filter((x) => x > 0).length,
      gustMax: gusts.length ? Math.max(...gusts) : NaN,
    };
  });

  return {
    props: {
      years,
      totalDays: rows.length,
      start,
      end,
      yearStats,
    },
  };
}

// FIX: fallback robusti per evitare crash se props mancanti
export default function Home({
  years = [],
  totalDays = 0,
  start = null,
  end = null,
  yearStats = [],
}) {
  return (
    <div className="wrap">
      <header className="hero">
        <div>
          <div className="kicker">Archivio meteo</div>
          <h1>Meteo Collinas</h1>
          <div className="sub">
            Dati giornalieri e intraday • {totalDays ? <b>{totalDays}</b> : "0"} giorni • Periodo:{" "}
            <b>{start || "—"}</b> → <b>{end || "—"}</b>
          </div>
        </div>

        <div className="cards">
          <div className="card">
            <div className="label">Anni disponibili</div>
            <div className="value">{years.length ? years.length : "—"}</div>
          </div>
          <div className="card">
            <div className="label">Giorni totali</div>
            <div className="value">{totalDays ? totalDays : "—"}</div>
          </div>
          <div className="card">
            <div className="label">Ultimo giorno</div>
            <div className="value small">{end || "—"}</div>
          </div>
        </div>
      </header>

      <section className="section">
        <div className="sectionHead">
          <h2>Anni</h2>
          <div className="hint">Apri un anno per vedere mesi, statistiche e tabella giornaliera.</div>
        </div>

        <div className="grid">
          {yearStats.map((y) => (
            <Link key={y.year} href={`/anni/${y.year}`} className="yearCard">
              <div className="yearTop">
                <div className="year">{y.year}</div>
                <div className="open">Apri →</div>
              </div>

              <div className="yearRow">
                <span>Giorni</span>
                <b>{y.ndays}</b>
              </div>
              <div className="yearRow">
                <span>Tmin / Tmax</span>
                <b>
                  {fmt(y.tmin, 1)} / {fmt(y.tmax, 1)} °C
                </b>
              </div>
              <div className="yearRow">
                <span>Tmedia</span>
                <b>{fmt(y.tmean, 1)} °C</b>
              </div>
              <div className="yearRow">
                <span>Pioggia</span>
                <b>
                  {fmt(y.rain, 1)} mm ({y.rainyDays} gg)
                </b>
              </div>
              <div className="yearRow">
                <span>Raffica max</span>
                <b>{fmt(y.gustMax, 1)} km/h</b>
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

      <style jsx>{`
        .wrap {
          max-width: 1180px;
          margin: 0 auto;
          padding: 18px 16px 50px;
          background: #fff;
        }

        .hero {
          display: grid;
          grid-template-columns: 1.2fr 1fr;
          gap: 14px;
          padding: 18px;
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          background: linear-gradient(180deg, #fff, #fbfbfb);
        }
        .kicker {
          font-size: 12px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          opacity: 0.65;
          margin-bottom: 6px;
        }
        h1 {
          margin: 0;
          font-size: 46px;
          line-height: 1.05;
        }
        .sub {
          margin-top: 10px;
          opacity: 0.78;
        }

        .cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
          align-content: start;
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
          font-size: 26px;
          margin-top: 6px;
          font-weight: 900;
        }
        .value.small {
          font-size: 16px;
          font-weight: 800;
        }

        .section {
          margin-top: 16px;
        }
        .sectionHead {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        h2 {
          margin: 0;
          font-size: 20px;
        }
        .hint {
          font-size: 12px;
          opacity: 0.7;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .yearCard {
          text-decoration: none;
          color: inherit;
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          padding: 14px;
          background: #fff;
          transition: transform 120ms ease, border-color 120ms ease;
        }
        .yearCard:hover {
          transform: translateY(-2px);
          border-color: #bdbdbd;
        }

        .yearTop {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 10px;
        }
        .year {
          font-size: 28px;
          font-weight: 950;
          letter-spacing: 0.01em;
        }
        .open {
          font-size: 12px;
          opacity: 0.75;
          font-weight: 700;
        }

        .yearRow {
          display: flex;
          justify-content: space-between;
          gap: 10px;
          padding: 8px 0;
          border-top: 1px solid #f1f1f1;
          font-size: 14px;
        }
        .yearRow span {
          opacity: 0.72;
        }
        .yearRow b {
          font-weight: 900;
        }

        .empty {
          grid-column: 1 / -1;
          padding: 16px;
          border: 1px dashed #d9d9d9;
          border-radius: 14px;
          opacity: 0.8;
        }
        code {
          background: #f6f6f6;
          padding: 2px 6px;
          border-radius: 8px;
        }

        @media (max-width: 980px) {
          .hero {
            grid-template-columns: 1fr;
          }
          .grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}