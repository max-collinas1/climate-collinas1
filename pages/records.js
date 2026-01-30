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

function takeTop(arr, topN = 20) {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, topN);
}

// -------------------- NEW: choose correct daily scope --------------------
function getDailyScope(records, yearSel, monthSel) {
  const d = records?.daily;
  if (!d) return null;

  const hasNew = !!(d.by_month || d.by_year || d.by_year_month);

  // se record.json è ancora vecchio, fallback al globale (e filtri non potranno funzionare bene)
  if (!hasNew) return d;

  const yAll = !yearSel || yearSel === "all";
  const mAll = !monthSel || monthSel === "all";

  if (yAll && mAll) return d;

  if (yAll && !mAll) return d.by_month?.[monthSel] || null;

  if (!yAll && mAll) return d.by_year?.[yearSel] || null;

  // year + month
  return d.by_year_month?.[yearSel]?.[monthSel] || null;
}

// -------------------- components --------------------
function MiniRankTable({ rows, unit, digits = 1, kind, topN = 20 }) {
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

            // yearly
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

function CatButton({ active, children, onClick }) {
  return (
    <button type="button" onClick={onClick} className={active ? "catBtn catBtnOn" : "catBtn"}>
      {children}
    </button>
  );
}

function MonthPicker({ value, onChange, allowAll = true }) {
  return (
    <div className="monthPick">
      {allowAll ? (
        <button
          type="button"
          onClick={() => onChange("all")}
          className={value === "all" ? "mBtn mBtnOn" : "mBtn"}
          title="Tutti i mesi"
          aria-label="Tutti i mesi"
        >
          Tutti
        </button>
      ) : null}

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

function YearPicker({ value, onChange, years }) {
  return (
    <select className="yearSel" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Seleziona anno">
      <option value="all">Tutti gli anni</option>
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}

// -------------------- page --------------------
export default function RecordsPage({ records }) {
  const [tab, setTab] = useState("daily"); // daily | monthly | yearly

  // filtri daily (anno/mese)
  const [yearSel, setYearSel] = useState("all"); // all | "2021"...
  const [monthSel, setMonthSel] = useState("all"); // all | "01".."12"

  // categorie daily
  const [catDaily, setCatDaily] = useState("temp"); // temp | precip | wind | press | rh | rad

  const topN = useMemo(() => {
    const v = Number(records?.top_n);
    return Number.isFinite(v) && v > 0 ? v : 20;
  }, [records]);

  const yearsAvail = useMemo(() => {
    const ys = records?.daily?.by_year ? Object.keys(records.daily.by_year) : [];
    return ys.sort();
  }, [records]);

  const dailyScope = useMemo(() => getDailyScope(records, yearSel, monthSel), [records, yearSel, monthSel]);

  const monthlySelected = useMemo(() => {
    if (!records?.monthly?.by_month) return null;
    // monthly tab: mese dell’anno (tutti i gennaio, ecc.) -> qui mm è per tab monthly, non monthSel
    return null;
  }, [records]);

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

  // monthly tab state (separato) - lasciato identico alla tua logica originale
  const [mmMonthly, setMmMonthly] = useState("01"); // solo per tab mensili
  const monthlyScope = records?.monthly?.by_month?.[mmMonthly] || null;

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
            <h1 className="title">Record</h1>
            <div className="sub">
              Prime <b>{topN}</b> posizioni • Aggiornato: <b>{fmtGeneratedAt(records.generated_at)}</b>
            </div>
          </div>

          <div className="heroRight">
            <div className="tabs">
              <TabButton
                active={tab === "daily"}
                onClick={() => {
                  setTab("daily");
                  setCatDaily("temp");
                }}
              >
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

        {/* --- FILTRI SOLO PER TAB DAILY --- */}
        {tab === "daily" ? (
          <div className="filterBar">
            <div className="filterBox">
              <div className="filterLabel">Anno</div>
              <YearPicker value={yearSel} onChange={setYearSel} years={yearsAvail} />
            </div>

            <div className="filterBox grow">
              <div className="filterLabel">Mese</div>
              <MonthPicker value={monthSel} onChange={setMonthSel} allowAll />
            </div>
          </div>
        ) : null}

        {tab === "daily" ? (
          <div className="catBar">
            <div className="catLabel">Sezione</div>
            <div className="catBtns">
              <CatButton active={catDaily === "temp"} onClick={() => setCatDaily("temp")}>
                Temperature
              </CatButton>
              <CatButton active={catDaily === "precip"} onClick={() => setCatDaily("precip")}>
                Precipitazioni
              </CatButton>
              <CatButton active={catDaily === "wind"} onClick={() => setCatDaily("wind")}>
                Vento
              </CatButton>
              <CatButton active={catDaily === "press"} onClick={() => setCatDaily("press")}>
                Pressione
              </CatButton>
              <CatButton active={catDaily === "rh"} onClick={() => setCatDaily("rh")}>
                Umidità
              </CatButton>
              <CatButton active={catDaily === "rad"} onClick={() => setCatDaily("rad")}>
                Radiazione
              </CatButton>
            </div>
          </div>
        ) : null}

        {tab === "monthly" ? (
          <div className="monthBox">
            <div className="monthBoxTop">
              <div>
                <div className="monthLabel">Seleziona mese</div>
                <div className="monthSub">
                  Classifiche relative a <b>{monthFullFromMM(mmMonthly)}</b>
                </div>
              </div>
              <div className="pill">Mese dell’anno</div>
            </div>
            <MonthPicker value={mmMonthly} onChange={setMmMonthly} allowAll={false} />
          </div>
        ) : null}
      </header>
            {/* -------------------- DAILY: TEMPERATURE -------------------- */}
      {tab === "daily" && catDaily === "temp" ? (
        <section className="grid">
          {/* 1° riga */}
          <Card title="Temperature massime più alte" subtitle="Tmax giornaliera">
            <MiniRankTable rows={dailyScope?.tmax_abs_high} unit="°C" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Temperature medie più alte" subtitle="Tmedia giornaliera">
            <MiniRankTable rows={dailyScope?.tmean_high} unit="°C" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Temperature minime più alte" subtitle="Tmin giornaliera">
            <MiniRankTable rows={dailyScope?.tmin_abs_high} unit="°C" digits={1} kind="daily" topN={topN} />
          </Card>

          {/* 2° riga */}
          <Card title="Temperature massime più basse" subtitle="Tmax giornaliera">
            <MiniRankTable rows={dailyScope?.tmax_abs_low} unit="°C" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Temperature medie più basse" subtitle="Tmedia giornaliera">
            <MiniRankTable rows={dailyScope?.tmean_low} unit="°C" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Temperature minime più basse" subtitle="Tmin giornaliera">
            <MiniRankTable rows={dailyScope?.tmin_abs_low} unit="°C" digits={1} kind="daily" topN={topN} />
          </Card>

          {/* 3° riga */}
          <Card title="Escursione termica giornaliera più alta" subtitle="Tmax − Tmin">
            <MiniRankTable rows={dailyScope?.trange_high} unit="°C" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Escursione termica giornaliera più bassa" subtitle="Tmax − Tmin">
            <MiniRankTable rows={dailyScope?.trange_low} unit="°C" digits={1} kind="daily" topN={topN} />
          </Card>
        </section>
      ) : null}

      {/* -------------------- DAILY: PRECIPITAZIONI -------------------- */}
      {tab === "daily" && catDaily === "precip" ? (
        <section className="grid">
          <Card title="Precipitazioni massime" subtitle="Totale giornaliero">
            <MiniRankTable rows={dailyScope?.rain_total_high} unit="mm" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Rain rate massimo" subtitle="Picco giornaliero">
            <MiniRankTable rows={dailyScope?.rainrate_max_high} unit="mm/h" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Pioggia massima 15 min" subtitle="Somma su 15 minuti (intraday)">
            <MiniRankTable rows={dailyScope?.rain_15m_high} unit="mm" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Pioggia massima 30 min" subtitle="Somma su 30 minuti (intraday)">
            <MiniRankTable rows={dailyScope?.rain_30m_high} unit="mm" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Pioggia massima 1 ora" subtitle="Somma su 60 minuti (intraday)">
            <MiniRankTable rows={dailyScope?.rain_1h_high} unit="mm" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Pioggia massima 6 ore" subtitle="Somma su 6 ore (intraday)">
            <MiniRankTable rows={dailyScope?.rain_6h_high} unit="mm" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Pioggia massima 12 ore" subtitle="Somma su 12 ore (intraday)">
            <MiniRankTable rows={dailyScope?.rain_12h_high} unit="mm" digits={1} kind="daily" topN={topN} />
          </Card>
        </section>
      ) : null}

      {/* -------------------- DAILY: VENTO -------------------- */}
      {tab === "daily" && catDaily === "wind" ? (
        <section className="grid">
          <Card title="Raffiche massime" subtitle="Gust max giornaliero">
            <MiniRankTable rows={dailyScope?.gust_max_high} unit="km/h" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Raffiche medie più alte" subtitle="Media giornaliera delle raffiche (intraday)">
            <MiniRankTable rows={dailyScope?.gust_mean_high} unit="km/h" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Vento medio più alto" subtitle="Media giornaliera del vento (intraday)">
            <MiniRankTable rows={dailyScope?.wind_avg_high} unit="km/h" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Vento massimo più alto" subtitle="Picco giornaliero del vento (intraday)">
            <MiniRankTable rows={dailyScope?.wind_max_high} unit="km/h" digits={1} kind="daily" topN={topN} />
          </Card>
        </section>
      ) : null}

      {/* -------------------- DAILY: PRESSIONE -------------------- */}
      {tab === "daily" && catDaily === "press" ? (
        <section className="grid">
          <Card title="Pressione minima" subtitle="Min giornaliera">
            <MiniRankTable rows={dailyScope?.press_min_low} unit="hPa" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Pressione massima" subtitle="Max giornaliera">
            <MiniRankTable rows={dailyScope?.press_max_high} unit="hPa" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Calo pressione (giorno → giorno+1)" subtitle="ΔP: oggi − domani (media press.)">
            <MiniRankTable rows={dailyScope?.press_drop_nextday_high} unit="hPa" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Aumento pressione (giorno−1 → giorno)" subtitle="ΔP: oggi − ieri (media press.)">
            <MiniRankTable rows={dailyScope?.press_rise_prevday_high} unit="hPa" digits={1} kind="daily" topN={topN} />
          </Card>
        </section>
      ) : null}

      {/* -------------------- DAILY: UMIDITÀ -------------------- */}
      {tab === "daily" && catDaily === "rh" ? (
        <section className="grid">
          <Card title="Umidità minima" subtitle="Min giornaliera">
            <MiniRankTable rows={dailyScope?.rh_min_low} unit="%" digits={0} kind="daily" topN={topN} />
          </Card>

          <Card title="Umidità massima" subtitle="Max giornaliera">
            <MiniRankTable rows={dailyScope?.rh_max_high} unit="%" digits={0} kind="daily" topN={topN} />
          </Card>

          <Card title="Umidità media più alta" subtitle="Media giornaliera (derivata se manca)">
            <MiniRankTable rows={dailyScope?.rh_mean_high} unit="%" digits={0} kind="daily" topN={topN} />
          </Card>
        </section>
      ) : null}

      {/* -------------------- DAILY: RADIAZIONE -------------------- */}
      {tab === "daily" && catDaily === "rad" ? (
        <section className="grid">
          <Card title="UV massimo" subtitle="Max giornaliero">
            <MiniRankTable rows={dailyScope?.uv_max_high} unit="" digits={1} kind="daily" topN={topN} />
          </Card>

          <Card title="Radiazione massima" subtitle="Max giornaliero">
            <MiniRankTable rows={dailyScope?.solar_max_high} unit="W/m²" digits={0} kind="daily" topN={topN} />
          </Card>
        </section>
      ) : null}

      {/* -------------------- MONTHLY (come prima) -------------------- */}
      {tab === "monthly" ? (
        <section className="grid">
          <Card title={`Massime medie più alte (${monthShortFromMM(mmMonthly)})`} subtitle="Media delle Tmax giornaliere">
            <MiniRankTable rows={monthlyScope?.tmax_mean_high} unit="°C" digits={1} kind="monthly" topN={topN} />
          </Card>

          <Card title={`Massime medie più basse (${monthShortFromMM(mmMonthly)})`} subtitle="Media delle Tmax giornaliere">
            <MiniRankTable rows={monthlyScope?.tmax_mean_low} unit="°C" digits={1} kind="monthly" topN={topN} />
          </Card>

          <Card title={`Minime medie più basse (${monthShortFromMM(mmMonthly)})`} subtitle="Media delle Tmin giornaliere">
            <MiniRankTable rows={monthlyScope?.tmin_mean_low} unit="°C" digits={1} kind="monthly" topN={topN} />
          </Card>

          <Card title={`Minime medie più alte (${monthShortFromMM(mmMonthly)})`} subtitle="Media delle Tmin giornaliere">
            <MiniRankTable rows={monthlyScope?.tmin_mean_high} unit="°C" digits={1} kind="monthly" topN={topN} />
          </Card>

          <Card title={`Medie mensili più alte (${monthShortFromMM(mmMonthly)})`} subtitle="Media delle Tmed giornaliere">
            <MiniRankTable rows={monthlyScope?.tmean_high} unit="°C" digits={1} kind="monthly" topN={topN} />
          </Card>

          <Card title={`Medie mensili più basse (${monthShortFromMM(mmMonthly)})`} subtitle="Media delle Tmed giornaliere">
            <MiniRankTable rows={monthlyScope?.tmean_low} unit="°C" digits={1} kind="monthly" topN={topN} />
          </Card>

          <Card title={`Precipitazioni massime (${monthShortFromMM(mmMonthly)})`} subtitle="Totale mensile">
            <MiniRankTable rows={monthlyScope?.rain_total_high} unit="mm" digits={1} kind="monthly" topN={topN} />
          </Card>

          <Card title={`Raffiche massime (${monthShortFromMM(mmMonthly)})`} subtitle="Gust max del mese">
            <MiniRankTable rows={monthlyScope?.gust_max_high} unit="km/h" digits={1} kind="monthly" topN={topN} />
          </Card>

          <Card title={`Rain rate massimo (${monthShortFromMM(mmMonthly)})`} subtitle="Picco mensile">
            <MiniRankTable rows={monthlyScope?.rainrate_max_high} unit="mm/h" digits={1} kind="monthly" topN={topN} />
          </Card>
        </section>
      ) : null}

      {/* -------------------- YEARLY (come prima) -------------------- */}
      {tab === "yearly" ? (
        <section className="grid">
          <Card title="Tmax assoluta più alta" subtitle="Massimo dell’anno">
            <MiniRankTable rows={records.yearly?.tmax_abs_high} unit="°C" digits={1} kind="yearly" topN={topN} />
          </Card>

          <Card title="Tmin assoluta più bassa" subtitle="Minimo dell’anno">
            <MiniRankTable rows={records.yearly?.tmin_abs_low} unit="°C" digits={1} kind="yearly" topN={topN} />
          </Card>

          <Card title="Temperatura media annua più alta" subtitle="Media annua Tmed giornaliere">
            <MiniRankTable rows={records.yearly?.tmean_high} unit="°C" digits={1} kind="yearly" topN={topN} />
          </Card>

          <Card title="Temperatura media annua più bassa" subtitle="Media annua Tmed giornaliere">
            <MiniRankTable rows={records.yearly?.tmean_low} unit="°C" digits={1} kind="yearly" topN={topN} />
          </Card>

          <Card title="Pioggia annua massima" subtitle="Totale annuo">
            <MiniRankTable rows={records.yearly?.rain_total_high} unit="mm" digits={1} kind="yearly" topN={topN} />
          </Card>

          <Card title="Raffica massima annua" subtitle="Gust max annuo">
            <MiniRankTable rows={records.yearly?.gust_max_high} unit="km/h" digits={1} kind="yearly" topN={topN} />
          </Card>

          <Card title="Rain rate massimo annuo" subtitle="Picco annuo">
            <MiniRankTable rows={records.yearly?.rainrate_max_high} unit="mm/h" digits={1} kind="yearly" topN={topN} />
          </Card>

          <Card title="Pressione minima annua" subtitle="Min annua">
            <MiniRankTable rows={records.yearly?.press_min_low} unit="hPa" digits={1} kind="yearly" topN={topN} />
          </Card>

          <Card title="Pressione massima annua" subtitle="Max annua">
            <MiniRankTable rows={records.yearly?.press_max_high} unit="hPa" digits={1} kind="yearly" topN={topN} />
          </Card>
        </section>
      ) : null}

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
    border: 1px solid #ececec;
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 12px 34px rgba(0,0,0,0.04);
    padding: 18px;
  }

  .heroTop { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }

  .kicker {
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    opacity: 0.6;
    margin-bottom: 8px;
  }

  .title { margin:0; font-size:56px; line-height:1; letter-spacing:-0.03em; }

  .sub { margin-top: 8px; font-size: 13px; opacity: 0.75; line-height: 1.35; }

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
    transition: background 120ms ease, transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
  }
  .tabBtn:hover { background:#f4f4f4; transform: translateY(-1px); box-shadow:0 8px 20px rgba(0,0,0,0.06); opacity:1; }
  .tabBtnOn { background:#111; color:#fff; border-color:#111; box-shadow:0 10px 24px rgba(0,0,0,0.10); opacity:1; }

  /* --- NEW: year+month filter bar (daily) --- */
  .filterBar{
    margin-top: 14px;
    border-top: 1px solid #efefef;
    padding-top: 12px;
    display:flex;
    gap: 14px;
    align-items: flex-end;
    flex-wrap: wrap;
  }
  .filterBox{ display:flex; flex-direction:column; gap:8px; }
  .filterBox.grow{ flex: 1; min-width: 320px; }
  .filterLabel{
    font-weight: 950;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 12px;
    opacity: 0.8;
  }
  .yearSel{
    height: 40px;
    padding: 0 12px;
    border: 1px solid #ededed;
    border-radius: 14px;
    background: #fff;
    font-weight: 900;
    font-size: 14px;
  }

  /* ---- category bar (Daily) ---- */
  .catBar {
    margin-top: 14px;
    border-top: 1px solid #efefef;
    padding-top: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }
  .catLabel {
    font-weight: 950;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 12px;
    opacity: 0.8;
    white-space: nowrap;
  }
  .catBtns { display:flex; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
  .catBtn {
    padding: 8px 12px;
    border: 1px solid #ededed;
    border-radius: 999px;
    background: #fff;
    font-weight: 950;
    font-size: 13px;
    cursor: pointer;
    opacity: 0.9;
    transition: background 120ms ease, transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
  }
  .catBtn:hover { background:#f4f4f4; transform: translateY(-1px); box-shadow:0 8px 20px rgba(0,0,0,0.06); opacity:1; }
  .catBtnOn { background:#111; color:#fff; border-color:#111; box-shadow:0 10px 24px rgba(0,0,0,0.10); opacity:1; }

  .monthBox { margin-top:14px; border-top:1px solid #efefef; padding-top:12px; }
  .monthBoxTop { display:flex; justify-content:space-between; align-items:flex-end; gap:14px; margin-bottom:10px; }
  .monthLabel {
    font-weight: 950;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 12px;
    opacity: 0.8;
  }
  .monthSub { margin-top:4px; font-size:12px; opacity:.72; }
  .pill {
    border: 1px solid #ededed;
    background: #fbfbfb;
    border-radius: 999px;
    padding: 6px 10px;
    font-size: 12px;
    font-weight: 900;
    opacity: 0.85;
    white-space: nowrap;
  }

  .monthPick { display:flex; flex-wrap:wrap; justify-content:center; gap:10px; }
  .mBtn {
    display:inline-flex;
    align-items:center;
    gap:6px;
    padding: 8px 12px;
    border-radius: 12px;
    border: 1px solid #ededed;
    background: #fff;
    text-decoration:none;
    color:#111;
    font-weight: 950;
    font-size: 14px;
    cursor:pointer;
    transition: background 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  }
  .mBtn:hover { background:#f4f4f4; transform: translateY(-1px); box-shadow:0 8px 20px rgba(0,0,0,0.06); }
  .mBtnOn { background:#111; color:#fff; border-color:#111; box-shadow:0 10px 24px rgba(0,0,0,0.10); }

  .cmd {
    margin-top: 14px;
    padding: 12px;
    border-radius: 14px;
    background: #111;
    color: #fff;
    overflow: auto;
    font-size: 13px;
  }
  code { background:#f4f4f4; padding:2px 6px; border-radius:8px; }

  .grid { margin-top: 12px; display:grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }

  .card {
    border: 1px solid #e7e7e7;
    border-radius: 16px;
    background: #fff;
    box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 12px 34px rgba(0,0,0,0.04);
    overflow: hidden;
  }
  .cardHead { background:#111; color:#fff; padding: 12px 12px 10px; }
  .cardTitle { font-weight:950; font-size:14px; letter-spacing:.01em; line-height:1.15; }
  .cardSub { margin-top:4px; font-size:12px; opacity:.85; line-height:1.2; }
  .cardBody { padding: 10px 12px 12px; }

  .miniTable { width:100%; border-collapse:collapse; }
  .miniTable thead th {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.75;
    padding: 8px 6px;
    border-bottom: 1px solid #efefef;
  }
  .thVal { text-align:left; }
  .thWhen { text-align:right; }

  .miniTable tbody td {
    padding: 8px 6px;
    border-bottom: 1px solid #f1f1f1;
    font-size: 13px;
    white-space: nowrap;
  }
  .miniTable tbody tr:nth-child(even) td { background:#fcfcfc; }
  .miniTable tbody tr:hover td { background:#fafafa; }

  .tdVal { font-weight: 950; letter-spacing: -0.01em; text-align:left; }
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
  .rowLink:hover { text-decoration: underline; }
  .extCell { font-size:12px; opacity:.65; transform: translateY(-1px); }

  @media (max-width: 1100px) {
    .heroTop { flex-direction: column; }
    .tabs { justify-content: flex-start; }
    .filterBox.grow{ min-width: 260px; }
    .catBar { flex-direction: column; align-items: flex-start; }
    .catBtns { justify-content: flex-start; }
    .grid { grid-template-columns: repeat(2, 1fr); }
  }

  @media (max-width: 640px) {
    .title { font-size: 48px; }
    .grid { grid-template-columns: 1fr; }
    .filterBox.grow{ min-width: 0; width: 100%; }
  }
`;