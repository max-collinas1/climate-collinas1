import fs from "fs";
import path from "path";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo } from "react";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export async function getStaticPaths() {
  const rows = readDaily();
  const years = Array.from(new Set(rows.map((r) => String(r.date).slice(0, 4)))).sort();
  return { paths: years.map((y) => ({ params: { year: y } })), fallback: false };
}

export async function getStaticProps({ params }) {
  const rows = readDaily();
  const year = params.year;

  const days = rows
    .filter((r) => String(r.date).startsWith(year + "-"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return { props: { year, days } };
}

// >>> FIX CRITICO: null/undefined/"" non devono diventare 0
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
function fmt0(x) {
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

const MONTHS_IT = [
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
function monthLabel(ym) {
  const mm = Number(String(ym).slice(5, 7));
  return MONTHS_IT[mm - 1] || ym;
}

export default function YearOverviewPage({ year, days }) {
  // lista mesi presenti
  const months = useMemo(() => {
    const set = new Set(days.map((d) => String(d.date).slice(0, 7)));
    return Array.from(set).sort(); // YYYY-MM
  }, [days]);

  // raggruppo per mese
  const byMonth = useMemo(() => {
    const m = new Map();
    for (const d of days) {
      const ym = String(d.date).slice(0, 7);
      if (!m.has(ym)) m.set(ym, []);
      m.get(ym).push(d);
    }
    return m;
  }, [days]);

  // summary mensile
  const monthly = useMemo(() => {
    return months.map((ym) => {
      const arr = byMonth.get(ym) || [];

      const tmin = minFinite(arr.map((d) => d.tmin));
      const tmax = maxFinite(arr.map((d) => d.tmax));
      const tmean = avgFinite(arr.map((d) => d.tmean));
      const esc = Number.isFinite(tmin) && Number.isFinite(tmax) ? tmax - tmin : NaN;

      const rainSum = sumFinite(arr.map((d) => d.rain_total));
      const rainyDays = arr.map((d) => n(d.rain_total)).filter((x) => Number.isFinite(x) && x > 0).length;

      const gustMax = maxFinite(arr.map((d) => d.gust_max));
      const pressMean = avgFinite(arr.map((d) => d.press_avg));

      return {
        ym,
        days: arr.length,
        tmin,
        tmax,
        tmean,
        esc,
        rainSum,
        rainyDays,
        gustMax,
        pressMean,
      };
    });
  }, [months, byMonth]);

  // summary annuale
  const annual = useMemo(() => {
    const tmin = minFinite(days.map((d) => d.tmin));
    const tmax = maxFinite(days.map((d) => d.tmax));
    const tmean = avgFinite(days.map((d) => d.tmean));
    const esc = Number.isFinite(tmin) && Number.isFinite(tmax) ? tmax - tmin : NaN;

    const rainSum = sumFinite(days.map((d) => d.rain_total));
    const rainyDays = days.map((d) => n(d.rain_total)).filter((x) => Number.isFinite(x) && x > 0).length;

    const gustMax = maxFinite(days.map((d) => d.gust_max));
    const pressMean = avgFinite(days.map((d) => d.press_avg));

    return { tmin, tmax, tmean, esc, rainSum, rainyDays, gustMax, pressMean, ndays: days.length };
  }, [days]);

  // grafici mensili (null se manca)
  const x = monthly.map((m) => monthLabel(m.ym));
  const tmeanSeries = monthly.map((m) => (Number.isFinite(n(m.tmean)) ? n(m.tmean) : null));
  const rainSeries = monthly.map((m) => (Number.isFinite(n(m.rainSum)) ? n(m.rainSum) : null));

  const optTemp = {
    tooltip: { trigger: "axis" },
    grid: { left: 52, right: 16, top: 30, bottom: 40 },
    xAxis: { type: "category", data: x, axisLabel: { rotate: 30 } },
    yAxis: { type: "value", name: "°C" },
    series: [{ name: "T media mensile", type: "line", data: tmeanSeries, connectNulls: false, symbolSize: 6 }],
  };

  const optRain = {
    tooltip: { trigger: "axis" },
    grid: { left: 52, right: 16, top: 30, bottom: 40 },
    xAxis: { type: "category", data: x, axisLabel: { rotate: 30 } },
    yAxis: { type: "value", name: "mm" },
    series: [{ name: "Pioggia mensile", type: "bar", data: rainSeries }],
  };

  return (
    <div className="wrap">
      <div className="topbar">
        <Link className="back" href="/">
          ← Home
        </Link>
        <div className="brand">
          <div className="brandTitle">Archivio Meteo</div>
          <div className="brandSub">Collinas • riepilogo annuale • {year}</div>
        </div>
      </div>

      <header className="hero">
        <div className="heroLeft">
          <div className="kicker">Anno</div>
          <h1>{year}</h1>
          <div className="sub">
            {annual.ndays} giorni • Pioggia: <b>{fmt(annual.rainSum, 1)} mm</b> • Giorni piovosi: <b>{annual.rainyDays}</b>
          </div>
        </div>

        <div className="cards">
          <div className="card">
            <div className="label">Tmin anno</div>
            <div className="value">{fmt(annual.tmin, 1)} °C</div>
          </div>
          <div className="card">
            <div className="label">Tmax anno</div>
            <div className="value">{fmt(annual.tmax, 1)} °C</div>
          </div>
          <div className="card">
            <div className="label">Tmedia anno</div>
            <div className="value">{fmt(annual.tmean, 1)} °C</div>
          </div>
          <div className="card">
            <div className="label">Escursione</div>
            <div className="value">{fmt(annual.esc, 1)} °C</div>
          </div>
          <div className="card">
            <div className="label">Raffica max anno</div>
            <div className="value">{fmt(annual.gustMax, 1)} km/h</div>
          </div>
          <div className="card">
            <div className="label">Press. media anno</div>
            <div className="value">{fmt(annual.pressMean, 1)} hPa</div>
          </div>
        </div>
      </header>

      <section className="charts">
        <div className="chartBox">
          <ReactECharts option={optTemp} style={{ height: 280, width: "100%" }} />
        </div>
        <div className="chartBox">
          <ReactECharts option={optRain} style={{ height: 280, width: "100%" }} />
        </div>
      </section>

      <section className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Mese</th>
              <th>Giorni</th>
              <th>Tmin</th>
              <th>Tmax</th>
              <th>Tmedia</th>
              <th>Esc.</th>
              <th>Pioggia</th>
              <th>Giorni piovosi</th>
              <th>Raffica max</th>
              <th>Press. media</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((m) => {
              const mm = String(m.ym).slice(5, 7);
              const rs = n(m.rainSum);
              return (
                <tr key={m.ym}>
                  <td className="strong">
                    <Link href={`/mesi/${year}/${mm}`}>{monthLabel(m.ym)}</Link>
                  </td>
                  <td>{m.days}</td>
                  <td>{fmt(m.tmin, 1)} °C</td>
                  <td>{fmt(m.tmax, 1)} °C</td>
                  <td>{fmt(m.tmean, 1)} °C</td>
                  <td>{fmt(m.esc, 1)} °C</td>
                  <td className={Number.isFinite(rs) && rs > 0 ? "rainy" : ""}>{fmt(m.rainSum, 1)} mm</td>
                  <td>{fmt0(m.rainyDays)}</td>
                  <td>{fmt(m.gustMax, 1)} km/h</td>
                  <td>{fmt(m.pressMean, 1)} hPa</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <style jsx>{`
        .wrap {
          max-width: 1180px;
          margin: 0 auto;
          padding: 18px 16px 50px;
          background: #fff;
        }
        .topbar {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-bottom: 14px;
        }
        .back {
          text-decoration: none;
          color: #111;
          opacity: 0.75;
        }
        .back:hover {
          opacity: 1;
        }
        .brandTitle {
          font-weight: 800;
          letter-spacing: 0.02em;
        }
        .brandSub {
          font-size: 12px;
          opacity: 0.7;
          margin-top: 2px;
        }

        .hero {
          display: grid;
          grid-template-columns: 1.1fr 1fr;
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
          font-size: 40px;
          line-height: 1.05;
        }
        .sub {
          margin-top: 8px;
          opacity: 0.75;
        }

        .cards {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .card {
          border: 1px solid #ededed;
          border-radius: 14px;
          padding: 12px;
          background: #fff;
        }
        .label {
          font-size: 12px;
          opacity: 0.7;
        }
        .value {
          font-size: 22px;
          margin-top: 6px;
          font-weight: 800;
        }

        .charts {
          margin-top: 14px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .chartBox {
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          padding: 8px;
          background: #fff;
        }

        .tableWrap {
          margin-top: 12px;
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          overflow: auto;
          background: #fff;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          min-width: 980px;
        }
        thead th {
          position: sticky;
          top: 0;
          background: #fff;
          border-bottom: 1px solid #e7e7e7;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          opacity: 0.75;
          padding: 10px 10px;
          text-align: left;
          white-space: nowrap;
        }
        tbody td {
          border-bottom: 1px solid #f1f1f1;
          padding: 12px 10px;
          white-space: nowrap;
        }
        tbody tr:hover td {
          background: #fafafa;
        }
        tbody tr:nth-child(even) td {
          background: #fcfcfc;
        }

        .strong a {
          color: #111;
          text-decoration: none;
          font-weight: 800;
        }
        .strong a:hover {
          text-decoration: underline;
        }
        .rainy {
          font-weight: 800;
        }

        @media (max-width: 980px) {
          .hero {
            grid-template-columns: 1fr;
          }
          .charts {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}