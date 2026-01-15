// pages/records.js
import fs from "fs";
import path from "path";
import Link from "next/link";
import { useMemo, useState } from "react";

// -------------------- data load --------------------
function readRecords() {
  const filePath = path.join(process.cwd(), "data", "record.json");
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export async function getStaticProps() {
  const records = readRecords();
  return { props: { records } };
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
function fmtDateIT(yyyyMMdd) {
  if (!yyyyMMdd || typeof yyyyMMdd !== "string" || yyyyMMdd.length < 10) return "—";
  const y = yyyyMMdd.slice(0, 4);
  const m = yyyyMMdd.slice(5, 7);
  const d = yyyyMMdd.slice(8, 10);
  return `${d}/${m}/${y}`;
}
function fmtGeneratedAt(iso) {
  if (!iso || typeof iso !== "string") return "—";
  return iso.slice(0, 19).replace("T", " ");
}

const MONTHS_IT_SHORT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
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

function monthShortFromMM(mm) {
  const m = Number(mm);
  return MONTHS_IT_SHORT[m - 1] || String(mm);
}
function monthFullFromMM(mm) {
  const m = Number(mm);
  return MONTHS_IT_FULL[m - 1] || String(mm);
}
function ymLabel(year, month) {
  const m = Number(month);
  return `${MONTHS_IT_SHORT[(m || 1) - 1]} ${year}`;
}
function takeTop(arr, topN = 10) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, topN);
}

// -------------------- components --------------------
function MiniRankTable({ rows, unit, digits = 1, kind, topN = 10 }) {
  const list = takeTop(rows, topN);
  const has = list.length > 0;

  return (
    <table className="miniTable">
      <thead>
        <tr>
          <th className="thVal">Valore</th>
          <th className="thWhen">{kind === "daily" ? "Giorno" : kind === "monthly" ? "Mese" : "Anno"}</th>
        </tr>
      </thead>
      <tbody>
        {has ? (
          list.map((r, idx) => {
            const vStr = `${fmt(r.value, digits)}${unit ? ` ${unit}` : ""}`;

            if (kind === "daily") {
              return (
                <tr key={`${r.date}-${idx}`}>
                  <td className="tdVal">{vStr}</td>
                  <td className="tdWhen">
                    <Link href={`/giorni/${r.date}`} className="rowLink" title="Apri dettaglio giornaliero">
                      <span className="extCell" aria-hidden="true">
                        ↗
                      </span>
                      {fmtDateIT(r.date)}
                    </Link>
                  </td>
                </tr>
              );
            }

            if (kind === "monthly") {
              const yy = r.year;
              const mm = String(r.month).padStart(2, "0");
              return (
                <tr key={`${yy}-${mm}-${idx}`}>
                  <td className="tdVal">{vStr}</td>
                  <td className="tdWhen">
                    <Link href={`/mesi/${yy}/${mm}`} className="rowLink" title="Apri dettaglio mensile">
                      <span className="extCell" aria-hidden="true">
                        ↗
                      </span>
                      {ymLabel(yy, Number(mm))}
                    </Link>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={`${r.year}-${idx}`}>
                <td className="tdVal">{vStr}</td>
                <td className="tdWhen">
                  <Link href={`/anni/${r.year}`} className="rowLink" title="Apri dettaglio annuale">
                    <span className="extCell" aria-hidden="true">
                      ↗
                    </span>
                    {r.year}
                  </Link>
                </td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td colSpan={2} className="tdEmpty">
              Nessun dato disponibile.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Card({ title, subtitle, children, footer }) {
  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">{title}</div>
        {subtitle ? <div className="cardSub">{subtitle}</div> : null}
      </div>
      <div className="cardBody">{children}</div>
      {footer ? <div className="cardFoot">{footer}</div> : null}
    </div>
  );
}

function TabButton({ active, children, onClick }) {
  return (
    <button type="button" onClick={onClick} className={active ? "tabBtn tabBtnOn" : "tabBtn"}>
      {children}
    </button>
  );
}

function MonthPicker({ value, onChange }) {
  return (
    <div className="monthPick">
      {Array.from({ length: 12 }, (_, i) => {
        const mm = String(i + 1).padStart(2, "0");
        const active = mm === value;
        return (
          <button
            key={mm}
            type="button"
            onClick={() => onChange(mm)}
            className={active ? "mBtn mBtnOn" : "mBtn"}
            title={monthFullFromMM(mm)}
            aria-label={monthFullFromMM(mm)}
          >
            {monthShortFromMM(mm)}
          </button>
        );
      })}
    </div>
  );
}

function SubTabButton({ active, children, onClick }) {
  return (
    <button type="button" onClick={onClick} className={active ? "subBtn subBtnOn" : "subBtn"}>
      {children}
    </button>
  );
}

// -------------------- groups config --------------------
// Ogni gruppo elenca le "card" da mostrare per DAILY / MONTHLY / YEARLY.
// Se una chiave non esiste in record.json, la tabella risulta vuota (senza crash).

const GROUPS = [
  {
    id: "temp",
    label: "Temperature",
    daily: [
      { key: "tmax_abs_high", title: "Massime assolute più alte", sub: "Tmax giornaliera", unit: "°C", digits: 1 },
      { key: "tmax_abs_low", title: "Massime assolute più basse", sub: "Tmax giornaliera", unit: "°C", digits: 1 },
      { key: "tmin_abs_low", title: "Minime assolute più basse", sub: "Tmin giornaliera", unit: "°C", digits: 1 },
      { key: "tmin_abs_high", title: "Minime assolute più alte", sub: "Tmin giornaliera", unit: "°C", digits: 1 },
      { key: "tmean_high", title: "Temperature medie più alte", sub: "Tmedia giornaliera", unit: "°C", digits: 1 },
      { key: "tmean_low", title: "Temperature medie più basse", sub: "Tmedia giornaliera", unit: "°C", digits: 1 },
    ],
    monthly: [
      { key: "tmax_mean_high", title: "Massime medie più alte", sub: "Media delle Tmax giornaliere", unit: "°C", digits: 1 },
      { key: "tmax_mean_low", title: "Massime medie più basse", sub: "Media delle Tmax giornaliere", unit: "°C", digits: 1 },
      { key: "tmin_mean_low", title: "Minime medie più basse", sub: "Media delle Tmin giornaliere", unit: "°C", digits: 1 },
      { key: "tmin_mean_high", title: "Minime medie più alte", sub: "Media delle Tmin giornaliere", unit: "°C", digits: 1 },
      { key: "tmean_high", title: "Medie mensili più alte", sub: "Media delle Tmed giornaliere", unit: "°C", digits: 1 },
      { key: "tmean_low", title: "Medie mensili più basse", sub: "Media delle Tmed giornaliere", unit: "°C", digits: 1 },
    ],
    yearly: [
      { key: "tmax_abs_high", title: "Tmax assoluta più alta", sub: "Massimo dell’anno", unit: "°C", digits: 1 },
      { key: "tmin_abs_low", title: "Tmin assoluta più bassa", sub: "Minimo dell’anno", unit: "°C", digits: 1 },
      { key: "tmean_high", title: "Temperatura media annua più alta", sub: "Media annua Tmed", unit: "°C", digits: 1 },
      { key: "tmean_low", title: "Temperatura media annua più bassa", sub: "Media annua Tmed", unit: "°C", digits: 1 },
    ],
  },

  {
    id: "rain",
    label: "Precipitazioni",
    daily: [
      { key: "rain_total_high", title: "Precipitazioni massime", sub: "Totale giornaliero", unit: "mm", digits: 1 },
      { key: "rainrate_max_high", title: "Rain rate massimo", sub: "Picco giornaliero", unit: "mm/h", digits: 1 },
    ],
    monthly: [
      { key: "rain_total_high", title: "Precipitazioni massime", sub: "Totale mensile", unit: "mm", digits: 1 },
      { key: "rainrate_max_high", title: "Rain rate massimo", sub: "Picco mensile", unit: "mm/h", digits: 1 },
    ],
    yearly: [
      { key: "rain_total_high", title: "Pioggia annua massima", sub: "Totale annuo", unit: "mm", digits: 1 },
      { key: "rainrate_max_high", title: "Rain rate massimo annuo", sub: "Picco annuo", unit: "mm/h", digits: 1 },
    ],
  },

  {
    id: "wind",
    label: "Vento",
    daily: [{ key: "gust_max_high", title: "Raffiche massime", sub: "Gust max giornaliero", unit: "km/h", digits: 1 }],
    monthly: [{ key: "gust_max_high", title: "Raffiche massime", sub: "Gust max del mese", unit: "km/h", digits: 1 }],
    yearly: [{ key: "gust_max_high", title: "Raffica massima annua", sub: "Gust max annuo", unit: "km/h", digits: 1 }],
  },

  {
    id: "press",
    label: "Pressione",
    daily: [
      { key: "press_min_low", title: "Pressione minima", sub: "Min giornaliera", unit: "hPa", digits: 1 },
      { key: "press_max_high", title: "Pressione massima", sub: "Max giornaliera", unit: "hPa", digits: 1 },
    ],
    monthly: [],
    yearly: [
      { key: "press_min_low", title: "Pressione minima annua", sub: "Min annua", unit: "hPa", digits: 1 },
      { key: "press_max_high", title: "Pressione massima annua", sub: "Max annua", unit: "hPa", digits: 1 },
    ],
  },

  {
    id: "hum",
    label: "Umidità",
    daily: [
      { key: "rh_min_low", title: "Umidità minima", sub: "Min giornaliera", unit: "%", digits: 0 },
      { key: "rh_max_high", title: "Umidità massima", sub: "Max giornaliera", unit: "%", digits: 0 },
    ],
    monthly: [],
    yearly: [],
  },

  {
    id: "rad",
    label: "Rad/UV",
    daily: [
      { key: "uv_max_high", title: "UV massimo", sub: "Max giornaliero", unit: "", digits: 1 },
      { key: "solar_max_high", title: "Radiazione massima", sub: "Max giornaliero", unit: "W/m²", digits: 0 },
    ],
    monthly: [],
    yearly: [],
  },
];

// -------------------- page --------------------
export default function RecordsPage({ records }) {
  const [tab, setTab] = useState("daily"); // daily | monthly | yearly
  const [mm, setMm] = useState("01");
  const [group, setGroup] = useState("temp"); // temp | rain | wind | press | hum | rad

  const topN = 10;

  const activeGroup = useMemo(() => GROUPS.find((g) => g.id === group) || GROUPS[0], [group]);

  const monthlySelected = useMemo(() => {
    if (!records?.monthly?.by_month) return null;
    return records.monthly.by_month[mm] || null;
  }, [records, mm]);

  const cards = useMemo(() => {
    if (!records) return [];
    if (tab === "daily") return activeGroup.daily;
    if (tab === "monthly") return activeGroup.monthly;
    return activeGroup.yearly;
  }, [records, tab, activeGroup]);

  // funzione per estrarre i rows corretti in base a tab
  function getRowsForKey(key) {
    if (!records) return [];
    if (tab === "daily") return records.daily?.[key] || [];
    if (tab === "yearly") return records.yearly?.[key] || [];
    // monthly: dipende dal mese selezionato
    return monthlySelected?.[key] || [];
  }

  if (!records) {
    return (
      <div className="wrap">
        <div className="topbar">
          <Link className="back" href="/">
            ← Home
          </Link>
          <div className="brand">
            <div className="brandTitle">Archivio Meteo</div>
            <div className="brandSub">Collinas • record</div>
          </div>
        </div>

        <header className="hero">
          <div className="heroTop">
            <div className="heroLeft">
              <div className="kicker">Pagina</div>
              <h1 className="title">Record</h1>
              <div className="sub">
                File <code>data/record.json</code> non trovato. Genera i record con:
              </div>
            </div>
          </div>

          <pre className="cmd">node scripts/build-records.js</pre>
        </header>

        <style jsx>{baseCss}</style>
      </div>
    );
  }

  return (
    <div className="wrap">
      <div className="topbar">
        <Link className="back" href="/">
          ← Home
        </Link>
        <div className="brand">
          <div className="brandTitle">Archivio Meteo</div>
          <div className="brandSub">Collinas • record giornalieri / mensili / annuali</div>
        </div>
      </div>

      <header className="hero">
        <div className="heroTop">
          <div className="heroLeft">
            <div className="kicker">Record</div>
            <h1 className="title">
              {activeGroup.label} <span style={{ opacity: 0.65 }}>•</span> Top {topN}
            </h1>
            <div className="sub">
              Aggiornato: <b>{fmtGeneratedAt(records.generated_at)}</b>
            </div>
          </div>

          <div className="heroRight">
            <div className="tabs">
              <TabButton active={tab === "daily"} onClick={() => setTab("daily")}>
                Giornalieri
              </TabButton>
              <TabButton active={tab === "monthly"} onClick={() => setTab("monthly")}>
                Mensili
              </TabButton>
              <TabButton active={tab === "yearly"} onClick={() => setTab("yearly")}>
                Annuali
              </TabButton>
            </div>
          </div>
        </div>

        {/* sottotabs per parametro */}
        <div className="subTabs" aria-label="Seleziona categoria record">
          {GROUPS.map((g) => (
            <SubTabButton key={g.id} active={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </SubTabButton>
          ))}
        </div>

        {tab === "monthly" ? (
          <div className="monthBox">
            <div className="monthBoxTop">
              <div>
                <div className="monthLabel">Seleziona mese</div>
                <div className="monthSub">
                  Classifiche relative a <b>{monthFullFromMM(mm)}</b>
                </div>
              </div>
              <div className="pill">Mese dell’anno</div>
            </div>
            <MonthPicker value={mm} onChange={setMm} />
          </div>
        ) : null}
      </header>

      {/* GRID CARDS */}
      <section className="grid">
        {cards.length ? (
          cards.map((c) => (
            <Card
              key={`${tab}-${group}-${c.key}`}
              title={tab === "monthly" ? `${c.title} (${monthShortFromMM(mm)})` : c.title}
              subtitle={c.sub}
            >
              <MiniRankTable rows={getRowsForKey(c.key)} unit={c.unit} digits={c.digits} kind={tab} topN={topN} />
            </Card>
          ))
        ) : (
          <div className="empty">
            Nessuna tabella per questa categoria in questa vista ({tab}).<br />
            Se vuoi, possiamo aggiungere altri record anche per {activeGroup.label}.
          </div>
        )}
      </section>

      <style jsx>{baseCss}</style>
    </div>
  );
}

const baseCss = `
  :global(body) { background: #fff; }

  .wrap {
    max-width: 1280px;
    margin: 0 auto;
    padding: 18px 10px 50px;
    background: #fff;
  }

  .topbar { display:flex; align-items:center; gap:14px; margin-bottom:14px; }
  .back { text-decoration:none; color:#111; opacity:.75; white-space:nowrap; }
  .back:hover { opacity:1; }
  .brandTitle { font-weight:800; letter-spacing:.02em; }
  .brandSub { font-size:12px; opacity:.7; margin-top:2px; }

  .hero {
    border:1px solid #ececec;
    border-radius:18px;
    background:#fff;
    box-shadow:0 1px 0 rgba(0,0,0,.02), 0 12px 34px rgba(0,0,0,.04);
    padding:18px;
  }

  .heroTop { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }

  .kicker {
    font-size:12px;
    letter-spacing:.14em;
    text-transform:uppercase;
    opacity:.6;
    margin-bottom:8px;
  }

  .title {
    margin:0;
    font-size:52px;
    line-height:1;
    letter-spacing:-.03em;
  }

  .sub { margin-top:8px; font-size:13px; opacity:.75; line-height:1.35; }

  code { background:#f4f4f4; padding:2px 6px; border-radius:8px; }

  .tabs { display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; }

  .tabBtn {
    padding:10px 12px;
    border:1px solid #ededed;
    border-radius:999px;
    background:#fff;
    font-weight:950;
    font-size:13px;
    cursor:pointer;
    opacity:.9;
    transition:background 120ms ease, transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
  }
  .tabBtn:hover {
    background:#f4f4f4;
    transform:translateY(-1px);
    box-shadow:0 8px 20px rgba(0,0,0,.06);
    opacity:1;
  }
  .tabBtnOn {
    background:#111;
    color:#fff;
    border-color:#111;
    box-shadow:0 10px 24px rgba(0,0,0,.10);
    opacity:1;
  }

  /* sottotabs categoria */
  .subTabs {
    margin-top:12px;
    display:flex;
    flex-wrap:wrap;
    gap:10px;
    border-top:1px solid #efefef;
    padding-top:12px;
  }
  .subBtn {
    padding:8px 12px;
    border:1px solid #ededed;
    border-radius:999px;
    background:#fff;
    font-weight:950;
    font-size:13px;
    cursor:pointer;
    opacity:.9;
    transition:background 120ms ease, transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
  }
  .subBtn:hover {
    background:#f4f4f4;
    transform:translateY(-1px);
    box-shadow:0 8px 20px rgba(0,0,0,.06);
    opacity:1;
  }
  .subBtnOn {
    background:#111;
    color:#fff;
    border-color:#111;
    box-shadow:0 10px 24px rgba(0,0,0,.10);
    opacity:1;
  }

  .monthBox { margin-top:14px; border-top:1px solid #efefef; padding-top:12px; }
  .monthBoxTop { display:flex; justify-content:space-between; align-items:flex-end; gap:14px; margin-bottom:10px; }
  .monthLabel { font-weight:950; letter-spacing:.06em; text-transform:uppercase; font-size:12px; opacity:.8; }
  .monthSub { margin-top:4px; font-size:12px; opacity:.72; }
  .pill { border:1px solid #ededed; background:#fbfbfb; border-radius:999px; padding:6px 10px; font-size:12px; font-weight:900; opacity:.85; white-space:nowrap; }

  .monthPick { display:flex; flex-wrap:wrap; justify-content:center; gap:10px; }
  .mBtn {
    padding:8px 12px;
    border-radius:12px;
    border:1px solid #ededed;
    background:#fff;
    color:#111;
    font-weight:950;
    font-size:14px;
    cursor:pointer;
    transition:background 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  }
  .mBtn:hover { background:#f4f4f4; transform:translateY(-1px); box-shadow:0 8px 20px rgba(0,0,0,.06); }
  .mBtnOn { background:#111; color:#fff; border-color:#111; box-shadow:0 10px 24px rgba(0,0,0,.10); }

  .cmd { margin-top:14px; padding:12px; border-radius:14px; background:#111; color:#fff; overflow:auto; font-size:13px; }

  .grid {
    margin-top:12px;
    display:grid;
    grid-template-columns:repeat(3, 1fr);
    gap:12px;
  }

  .card {
    border:1px solid #e7e7e7;
    border-radius:16px;
    background:#fff;
    box-shadow:0 1px 0 rgba(0,0,0,.02), 0 12px 34px rgba(0,0,0,.04);
    overflow:hidden;
  }
  .cardHead { background:#111; color:#fff; padding:12px 12px 10px; }
  .cardTitle { font-weight:950; font-size:14px; letter-spacing:.01em; line-height:1.15; }
  .cardSub { margin-top:4px; font-size:12px; opacity:.85; line-height:1.2; }
  .cardBody { padding:10px 12px 12px; }
  .cardFoot { padding:10px 12px; border-top:1px solid #efefef; background:#fbfbfb; font-size:12px; opacity:.78; }

  .miniTable { width:100%; border-collapse:collapse; }
  .miniTable thead th {
    font-size:11px;
    text-transform:uppercase;
    letter-spacing:.08em;
    opacity:.75;
    padding:8px 6px;
    border-bottom:1px solid #efefef;
  }
  .thVal { text-align:left; }
  .thWhen { text-align:right; }

  .miniTable tbody td {
    padding:8px 6px;
    border-bottom:1px solid #f1f1f1;
    font-size:13px;
    white-space:nowrap;
  }
  .miniTable tbody tr:nth-child(even) td { background:#fcfcfc; }
  .miniTable tbody tr:hover td { background:#fafafa; }

  .tdVal { font-weight:950; letter-spacing:-.01em; text-align:left; }
  .tdWhen { text-align:right; }
  .tdEmpty { padding:10px 6px; font-size:13px; opacity:.7; }

  .rowLink {
    color:#111;
    text-decoration:none;
    font-weight:900;
    display:inline-flex;
    align-items:center;
    gap:6px;
    justify-content:flex-end;
  }
  .rowLink:hover { text-decoration:underline; }
  .extCell { font-size:12px; opacity:.65; transform:translateY(-1px); }

  .empty {
    grid-column: 1 / -1;
    border:1px solid #e7e7e7;
    border-radius:16px;
    padding:16px;
    background:#fbfbfb;
    font-weight:900;
    opacity:.8;
  }

  @media (max-width: 1100px) {
    .heroTop { flex-direction:column; }
    .tabs { justify-content:flex-start; }
    .grid { grid-template-columns:repeat(2, 1fr); }
  }
  @media (max-width: 640px) {
    .title { font-size:44px; }
    .grid { grid-template-columns:1fr; }
  }
`;