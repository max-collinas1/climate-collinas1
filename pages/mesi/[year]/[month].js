import fs from "fs";
import path from "path";
import Link from "next/link";
import { useMemo, useState } from "react";

function readDaily() {
  const filePath = path.join(process.cwd(), "data", "daily.json");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export async function getStaticPaths() {
  const rows = readDaily();

  const ymSet = new Set(rows.map((r) => String(r.date).slice(0, 7)));
  const paths = Array.from(ymSet)
    .sort()
    .map((ym) => {
      const [year, month] = ym.split("-");
      return { params: { year, month } };
    });

  return { paths, fallback: false };
}

export async function getStaticProps({ params }) {
  const rows = readDaily();

  const year = String(params.year);
  const month = String(params.month).padStart(2, "0");
  const ym = `${year}-${month}`;

  const days = rows
    .filter((r) => String(r.date).startsWith(ym + "-"))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const monthsInYear = Array.from(
    new Set(
      rows
        .filter((r) => String(r.date).startsWith(year + "-"))
        .map((r) => String(r.date).slice(0, 7))
    )
  ).sort();

  return {
    props: {
      year,
      month,
      ym,
      days,
      monthsInYear,
    },
  };
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
function monthName(mm) {
  const m = Number(mm);
  return MONTHS_IT[m - 1] || mm;
}

export default function MonthPage(props) {
  // fallback anti-crash (il tuo errore era qui)
  const year = props.year ?? "";
  const month = props.month ?? "";
  const ym = props.ym ?? "";
  const days = Array.isArray(props.days) ? props.days : [];
  const monthsInYear = Array.isArray(props.monthsInYear) ? props.monthsInYear : [];

  const [q, setQ] = useState("");
  const [showExtra, setShowExtra] = useState(true);

  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("asc"); // asc|desc

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return days;
    return days.filter((d) => String(d.date).toLowerCase().includes(qq));
  }, [days, q]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      if (sortKey === "date") return dir * String(a.date).localeCompare(String(b.date));
      const av = n(a[sortKey]);
      const bv = n(b[sortKey]);
      if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
      if (!Number.isFinite(av)) return 1;
      if (!Number.isFinite(bv)) return -1;
      return dir * (av - bv);
    });

    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(k) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else {
      setSortKey(k);
      setSortDir(k === "date" ? "asc" : "desc");
    }
  }

  const summary = useMemo(() => {
    const minT = minFinite(days.map((d) => d.tmin));
    const maxT = maxFinite(days.map((d) => d.tmax));
    const meanT = avgFinite(days.map((d) => d.tmean));
    const esc = Number.isFinite(minT) && Number.isFinite(maxT) ? maxT - minT : NaN;

    const rainSum = sumFinite(days.map((d) => d.rain_total));
    const rainyDays = days.map((d) => n(d.rain_total)).filter((x) => Number.isFinite(x) && x > 0).length;

    const gustMax = maxFinite(days.map((d) => d.gust_max));
    const pressMean = avgFinite(days.map((d) => d.press_avg));

    return { ndays: days.length, minT, maxT, meanT, esc, rainSum, rainyDays, gustMax, pressMean };
  }, [days]);

  function downloadCsv() {
    const cols = [
      "date",
      "tmin",
      "tmax",
      "tmean",
      "dewpoint_mean",
      "rh_mean",
      "wind_avg",
      "wind_max",
      "gust_max",
      "press_avg",
      "press_min",
      "press_max",
      "rain_total",
      "rainrate_max",
      "uv_max",
      "solar_max",
    ];

    const header = cols.join(",");
    const lines = sorted.map((d) =>
      cols
        .map((c) => {
          const v = d[c];
          if (v === null || v === undefined) return "";
          const s = String(v).replaceAll('"', '""');
          return /[",\n]/.test(s) ? `"${s}"` : s;
        })
        .join(",")
    );

    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `${ym || "mese"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <Link className="back" href={`/anni/${year}`}>
          ← Anno {year}
        </Link>
        <div className="brand">
          <div className="brandTitle">Archivio Meteo</div>
          <div className="brandSub">Collinas • mese • {ym}</div>
        </div>
      </div>

      <header className="hero">
        <div className="heroLeft">
          <div className="kicker">Mese</div>
          <h1>
            {monthName(month)} {year}
          </h1>
          <div className="sub">
            {summary.ndays} giorni • Pioggia: <b>{fmt(summary.rainSum, 1)} mm</b> • Giorni piovosi: <b>{summary.rainyDays}</b>
          </div>

          <div className="months">
            {monthsInYear.map((m) => {
              const mm = String(m).slice(5, 7);
              return (
                <Link key={m} href={`/mesi/${year}/${mm}`} className={m === ym ? "pill active" : "pill"}>
                  {mm}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="cards">
          <div className="card">
            <div className="label">Tmin mese</div>
            <div className="value">{fmt(summary.minT, 1)} °C</div>
          </div>
          <div className="card">
            <div className="label">Tmax mese</div>
            <div className="value">{fmt(summary.maxT, 1)} °C</div>
          </div>
          <div className="card">
            <div className="label">Tmedia mese</div>
            <div className="value">{fmt(summary.meanT, 1)} °C</div>
          </div>
          <div className="card">
            <div className="label">Escursione</div>
            <div className="value">{fmt(summary.esc, 1)} °C</div>
          </div>
          <div className="card">
            <div className="label">Raffica max mese</div>
            <div className="value">{fmt(summary.gustMax, 1)} km/h</div>
          </div>
          <div className="card">
            <div className="label">Press. media mese</div>
            <div className="value">{fmt(summary.pressMean, 1)} hPa</div>
          </div>
        </div>
      </header>

      <section className="toolbar">
        <div className="search">
          <span className="hint">Filtra per data</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="es. 2021-02-21" />
        </div>

        <div className="tools">
          <button className="btn" onClick={() => setShowExtra(!showExtra)}>
            {showExtra ? "Nascondi colonne extra" : "Mostra colonne extra"}
          </button>
          <button className="btn primary" onClick={downloadCsv}>
            Scarica CSV (mese)
          </button>
        </div>
      </section>

      <section className="tableWrap">
        <table>
          <thead>
            <tr>
              <Th onClick={() => toggleSort("date")} active={sortKey === "date"} dir={sortDir}>
                Data
              </Th>
              <Th onClick={() => toggleSort("tmin")} active={sortKey === "tmin"} dir={sortDir}>
                Tmin
              </Th>
              <Th onClick={() => toggleSort("tmax")} active={sortKey === "tmax"} dir={sortDir}>
                Tmax
              </Th>
              <Th onClick={() => toggleSort("tmean")} active={sortKey === "tmean"} dir={sortDir}>
                Tmedia
              </Th>
              <Th onClick={() => toggleSort("rain_total")} active={sortKey === "rain_total"} dir={sortDir}>
                Pioggia
              </Th>

              {showExtra && (
                <>
                  <Th onClick={() => toggleSort("gust_max")} active={sortKey === "gust_max"} dir={sortDir}>
                    Raffica max
                  </Th>
                  <Th onClick={() => toggleSort("press_avg")} active={sortKey === "press_avg"} dir={sortDir}>
                    Press. media
                  </Th>
                  <Th onClick={() => toggleSort("wind_avg")} active={sortKey === "wind_avg"} dir={sortDir}>
                    Vento medio
                  </Th>
                  <Th onClick={() => toggleSort("wind_max")} active={sortKey === "wind_max"} dir={sortDir}>
                    Vento max
                  </Th>
                </>
              )}
            </tr>
          </thead>

          <tbody>
            {sorted.map((d) => (
              <tr key={d.date}>
                <td className="date sticky">
                  <Link href={`/giorni/${d.date}`}>{d.date}</Link>
                </td>
                <td>{fmt(d.tmin, 1)} °C</td>
                <td>{fmt(d.tmax, 1)} °C</td>
                <td className="strong">{fmt(d.tmean, 1)} °C</td>
                <td className={n(d.rain_total) > 0 ? "rainy" : ""}>{fmt(d.rain_total, 1)} mm</td>

                {showExtra && (
                  <>
                    <td>{fmt(d.gust_max, 1)} km/h</td>
                    <td>{fmt(d.press_avg, 1)} hPa</td>
                    <td>{fmt(d.wind_avg, 1)} km/h</td>
                    <td>{fmt(d.wind_max, 1)} km/h</td>
                  </>
                )}
              </tr>
            ))}

            {!sorted.length && (
              <tr>
                <td colSpan={showExtra ? 10 : 6} className="empty">
                  Nessun dato per il filtro corrente.
                </td>
              </tr>
            )}
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
          white-space: nowrap;
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

        .months {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }
        .pill {
          border: 1px solid #e2e2e2;
          background: #fff;
          padding: 8px 10px;
          border-radius: 999px;
          text-decoration: none;
          color: #111;
          font-weight: 700;
        }
        .pill:hover {
          border-color: #bdbdbd;
        }
        .pill.active {
          border-color: #111;
          background: #111;
          color: #fff;
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
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02);
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

        .toolbar {
          margin-top: 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 12px;
          border: 1px solid #e7e7e7;
          border-radius: 14px;
          background: #fff;
        }
        .search {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 240px;
        }
        .hint {
          font-size: 12px;
          opacity: 0.7;
        }
        input {
          border: 1px solid #e2e2e2;
          border-radius: 10px;
          padding: 10px 12px;
          outline: none;
        }
        input:focus {
          border-color: #111;
        }
        .tools {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }
        .btn {
          border: 1px solid #e2e2e2;
          background: #fff;
          padding: 10px 12px;
          border-radius: 10px;
          cursor: pointer;
          white-space: nowrap;
        }
        .btn:hover {
          border-color: #bdbdbd;
        }
        .btn.primary {
          border-color: #111;
          background: #111;
          color: #fff;
        }
        .btn.primary:hover {
          opacity: 0.9;
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
          user-select: none;
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

        .date a {
          color: #111;
          text-decoration: none;
          font-weight: 800;
        }
        .date a:hover {
          text-decoration: underline;
        }

        .sticky {
          position: sticky;
          left: 0;
          z-index: 2;
          background: inherit;
        }

        .strong {
          font-weight: 800;
        }
        .rainy {
          font-weight: 800;
        }
        .empty {
          padding: 18px 10px;
          opacity: 0.7;
        }

        @media (max-width: 980px) {
          .hero {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

function Th({ children, onClick, active, dir }) {
  return (
    <th onClick={onClick} style={{ cursor: "pointer" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {children}
        {active ? <span style={{ opacity: 0.6 }}>{dir === "asc" ? "▲" : "▼"}</span> : <span style={{ opacity: 0.25 }}>↕</span>}
      </span>
    </th>
  );
}