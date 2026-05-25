import fs from "fs";
import path from "path";
import Link from "next/link";
import { useMemo, useState } from "react";
import SiteLayout from "../components/SiteLayout";
import SiteHeader from "../components/SiteHeader";

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

function hasArpasPriority(row, kind, arpasMode = "") {
  if (!row || typeof row !== "object") return false;
  if (arpasMode !== "rain_total") return false;

  if (kind === "monthly") return !!row.rain_is_override;
  if (kind === "yearly") return !!row.rain_has_override;

  return false;
}

function getArpasNote(row, kind, arpasMode = "") {
  if (!row || typeof row !== "object") return "";
  if (arpasMode !== "rain_total") return "";

  if (kind === "monthly" && row.rain_is_override) {
    return row.rain_override_label || "Dato ARPAS";
  }

  if (kind === "yearly" && row.rain_has_override) {
    const months = Array.isArray(row.rain_override_months) ? row.rain_override_months : [];
    return months.length ? `Anno con mesi ARPAS: ${months.join(", ")}` : "Anno con mesi ARPAS";
  }

  return "";
}

// -------------------- coverage helpers --------------------
function getCoverageValue(row, paramKey) {
  if (!row || typeof row !== "object") return NaN;

  const candidates = [
    row.coverage,
    row.coverage_pct,
    row.coveragePercent,
    row.completeness,
    row.completeness_pct,
    row.valid_fraction,
    row.validFraction,
    row.data_coverage,
    row.dataCoverage,
    row.daily_coverage,
    row.dailyCoverage,
    row.parameter_coverage?.[paramKey],
    row.parameterCoverage?.[paramKey],
    row.coverage_by_param?.[paramKey],
    row.coverageByParam?.[paramKey],
  ];

  for (const c of candidates) {
    const v = Number(c);
    if (Number.isFinite(v)) return v > 1 ? v / 100 : v;
  }

  return NaN;
}

function shouldBypassCoverage(row, paramKey, arpasMode = "") {
  if (!row || typeof row !== "object") return false;
  if (paramKey !== "rain") return false;
  if (arpasMode !== "rain_total") return false;

  if (row.rain_is_override) return true;
  if (row.rain_has_override) return true;

  return false;
}

function filterRowsByCoverage(arr, paramKey, minCoverage = 0.95, arpasMode = "") {
  if (!Array.isArray(arr)) return [];
  return arr.filter((row) => {
    if (shouldBypassCoverage(row, paramKey, arpasMode)) return true;

    const cov = getCoverageValue(row, paramKey);
    if (!Number.isFinite(cov)) return true;
    return cov >= minCoverage;
  });
}

// -------------------- array helpers --------------------
function pickFirstArray(scope, keys) {
  if (!scope || typeof scope !== "object") return [];
  for (const key of keys) {
    const v = scope?.[key];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function makeCard(title, rows, unit, digits, paramKey, arpasMode = "") {
  return {
    title,
    rows: Array.isArray(rows) ? rows : [],
    unit,
    digits,
    paramKey,
    arpasMode,
  };
}

// -------------------- scope helpers --------------------
function getDailyScope(records, yearSel, monthSel) {
  const d = records?.daily;
  if (!d) return null;

  const hasNew = !!(d.by_month || d.by_year || d.by_year_month);
  if (!hasNew) return d;

  const yAll = !yearSel || yearSel === "all";
  const mAll = !monthSel || monthSel === "all";

  if (yAll && mAll) return d;
  if (yAll && !mAll) return d.by_month?.[monthSel] || null;
  if (!yAll && mAll) return d.by_year?.[yearSel] || null;
  return d.by_year_month?.[yearSel]?.[monthSel] || null;
}

function getMonthlyScope(records, monthSel) {
  return records?.monthly?.by_month?.[monthSel] || null;
}

// -------------------- cards builders --------------------
function getDailyCards(cat, scope) {
  const cards = {
    temp: [
      makeCard("Temperature massime più alte", scope?.tmax_abs_high || scope?.tmax_mean_high, "°C", 1, "temperature"),
      makeCard("Temperature medie più alte", scope?.tmean_high, "°C", 1, "temperature"),
      makeCard("Temperature minime più alte", scope?.tmin_abs_high || scope?.tmin_mean_high, "°C", 1, "temperature"),
      makeCard("Temperature massime più basse", scope?.tmax_abs_low || scope?.tmax_mean_low, "°C", 1, "temperature"),
      makeCard("Temperature medie più basse", scope?.tmean_low, "°C", 1, "temperature"),
      makeCard("Temperature minime più basse", scope?.tmin_abs_low || scope?.tmin_mean_low, "°C", 1, "temperature"),
      makeCard("Escursione termica più alta", scope?.trange_high, "°C", 1, "temperature"),
      makeCard("Escursione termica più bassa", scope?.trange_low, "°C", 1, "temperature"),
    ],
    precip: [
      makeCard("Precipitazioni massime", scope?.rain_total_high, "mm", 1, "rain"),
      makeCard("Rain rate massimo", scope?.rainrate_max_high, "mm/h", 1, "rain"),
      makeCard("Pioggia massima 15 min", scope?.rain_15m_high, "mm", 1, "rain"),
      makeCard("Pioggia massima 30 min", scope?.rain_30m_high, "mm", 1, "rain"),
      makeCard("Pioggia massima 1 ora", scope?.rain_1h_high, "mm", 1, "rain"),
      makeCard("Pioggia massima 6 ore", scope?.rain_6h_high, "mm", 1, "rain"),
      makeCard("Pioggia massima 12 ore", scope?.rain_12h_high, "mm", 1, "rain"),
    ],
    wind: [
      makeCard("Raffiche massime", scope?.gust_max_high, "km/h", 1, "wind"),
      makeCard("Raffiche medie più alte", scope?.gust_mean_high, "km/h", 1, "wind"),
      makeCard("Vento medio più alto", scope?.wind_avg_high, "km/h", 1, "wind"),
      makeCard("Vento massimo più alto", scope?.wind_max_high, "km/h", 1, "wind"),
    ],
    press: [
      makeCard("Pressione minima", scope?.press_min_low, "hPa", 1, "pressure"),
      makeCard("Pressione massima", scope?.press_max_high, "hPa", 1, "pressure"),
      makeCard("Calo pressione", scope?.press_drop_nextday_high, "hPa", 1, "pressure"),
      makeCard("Aumento pressione", scope?.press_rise_prevday_high, "hPa", 1, "pressure"),
    ],
    rh: [
      makeCard("Umidità minima", scope?.rh_min_low, "%", 0, "humidity"),
      makeCard("Umidità massima", scope?.rh_max_high, "%", 0, "humidity"),
      makeCard("Umidità media più alta", scope?.rh_mean_high, "%", 0, "humidity"),
    ],
    rad: [
      makeCard("UV massimo", scope?.uv_max_high, "", 1, "radiation"),
      makeCard("Radiazione massima", scope?.solar_max_high, "W/m²", 0, "radiation"),
    ],
  };

  return (cards[cat] || []).filter((c) => c.rows.length > 0);
}

function getMonthlyCards(cat, scope, mmMonthly) {
  const tag = ` (${monthShortFromMM(mmMonthly)})`;

  const cards = {
    temp: [
      makeCard(`Temperature massime più alte${tag}`, scope?.tmax_abs_high || scope?.tmax_mean_high, "°C", 1, "temperature"),
      makeCard(`Temperature medie più alte${tag}`, scope?.tmean_high, "°C", 1, "temperature"),
      makeCard(`Temperature minime più alte${tag}`, scope?.tmin_abs_high || scope?.tmin_mean_high, "°C", 1, "temperature"),
      makeCard(`Temperature massime più basse${tag}`, scope?.tmax_abs_low || scope?.tmax_mean_low, "°C", 1, "temperature"),
      makeCard(`Temperature medie più basse${tag}`, scope?.tmean_low, "°C", 1, "temperature"),
      makeCard(`Temperature minime più basse${tag}`, scope?.tmin_abs_low || scope?.tmin_mean_low, "°C", 1, "temperature"),
      makeCard(`Escursione termica più alta${tag}`, scope?.trange_high, "°C", 1, "temperature"),
      makeCard(`Escursione termica più bassa${tag}`, scope?.trange_low, "°C", 1, "temperature"),
    ],
    precip: [
      makeCard(`Precipitazioni massime${tag}`, scope?.rain_total_high, "mm", 1, "rain", "rain_total"),
      makeCard(`Precipitazioni minime${tag}`, scope?.rain_total_low, "mm", 1, "rain", "rain_total"),
      makeCard(`Rain rate massimo${tag}`, scope?.rainrate_max_high, "mm/h", 1, "rain"),
      makeCard(`Pioggia massima 15 min${tag}`, scope?.rain_15m_high, "mm", 1, "rain"),
      makeCard(`Pioggia massima 30 min${tag}`, scope?.rain_30m_high, "mm", 1, "rain"),
      makeCard(`Pioggia massima 1 ora${tag}`, scope?.rain_1h_high, "mm", 1, "rain"),
      makeCard(`Pioggia massima 6 ore${tag}`, scope?.rain_6h_high, "mm", 1, "rain"),
      makeCard(`Pioggia massima 12 ore${tag}`, scope?.rain_12h_high, "mm", 1, "rain"),
    ],
    wind: [
      makeCard(`Raffiche massime${tag}`, scope?.gust_max_high, "km/h", 1, "wind"),
      makeCard(`Raffiche medie più alte${tag}`, scope?.gust_mean_high, "km/h", 1, "wind"),
      makeCard(`Vento medio più alto${tag}`, scope?.wind_avg_high, "km/h", 1, "wind"),
      makeCard(`Vento massimo più alto${tag}`, scope?.wind_max_high, "km/h", 1, "wind"),
    ],
    press: [
      makeCard(`Pressione minima${tag}`, scope?.press_min_low, "hPa", 1, "pressure"),
      makeCard(`Pressione massima${tag}`, scope?.press_max_high, "hPa", 1, "pressure"),
      makeCard(`Calo pressione${tag}`, scope?.press_drop_nextday_high, "hPa", 1, "pressure"),
      makeCard(`Aumento pressione${tag}`, scope?.press_rise_prevday_high, "hPa", 1, "pressure"),
    ],
    rh: [
      makeCard(`Umidità minima${tag}`, scope?.rh_min_low, "%", 0, "humidity"),
      makeCard(`Umidità massima${tag}`, scope?.rh_max_high, "%", 0, "humidity"),
      makeCard(`Umidità media più alta${tag}`, scope?.rh_mean_high, "%", 0, "humidity"),
    ],
    rad: [
      makeCard(`UV massimo${tag}`, scope?.uv_max_high, "", 1, "radiation"),
      makeCard(`Radiazione massima${tag}`, scope?.solar_max_high, "W/m²", 0, "radiation"),
    ],
  };

  return (cards[cat] || [])
    .map((c) => ({
      ...c,
      rows: filterRowsByCoverage(c.rows, c.paramKey, 0.95, c.arpasMode),
    }))
    .filter((c) => c.rows.length > 0);
}

function getYearlyCards(cat, scope) {
  const cards = {
    temp: [
      makeCard(
        "Temperatura media massima più elevata",
        pickFirstArray(scope, [
          "tmax_mean_high",
          "tmax_avg_high",
          "tmax_ann_mean_high",
          "annual_tmax_mean_high",
        ]),
        "°C",
        1,
        "temperature"
      ),
      makeCard(
        "Temperatura media assoluta più elevata",
        pickFirstArray(scope, [
          "tmean_high",
          "tmean_avg_high",
          "tavg_high",
          "tmean_ann_high",
          "annual_tmean_high",
        ]),
        "°C",
        1,
        "temperature"
      ),
      makeCard(
        "Temperatura media minima più elevata",
        pickFirstArray(scope, [
          "tmin_mean_high",
          "tmin_avg_high",
          "tmin_ann_mean_high",
          "annual_tmin_mean_high",
        ]),
        "°C",
        1,
        "temperature"
      ),
      makeCard(
        "Temperatura media massima più bassa",
        pickFirstArray(scope, [
          "tmax_mean_low",
          "tmax_avg_low",
          "tmax_ann_mean_low",
          "annual_tmax_mean_low",
        ]),
        "°C",
        1,
        "temperature"
      ),
      makeCard(
        "Temperatura media assoluta più bassa",
        pickFirstArray(scope, [
          "tmean_low",
          "tmean_avg_low",
          "tavg_low",
          "tmean_ann_low",
          "annual_tmean_low",
        ]),
        "°C",
        1,
        "temperature"
      ),
      makeCard(
        "Temperatura media minima più bassa",
        pickFirstArray(scope, [
          "tmin_mean_low",
          "tmin_avg_low",
          "tmin_ann_mean_low",
          "annual_tmin_mean_low",
        ]),
        "°C",
        1,
        "temperature"
      ),
      makeCard(
        "Escursione termica media annua più elevata",
        pickFirstArray(scope, [
          "trange_mean_high",
          "trange_high",
          "annual_trange_high",
          "annual_mean_trange_high",
        ]),
        "°C",
        1,
        "temperature"
      ),
      makeCard(
        "Escursione termica media annua più bassa",
        pickFirstArray(scope, [
          "trange_mean_low",
          "trange_low",
          "annual_trange_low",
          "annual_mean_trange_low",
        ]),
        "°C",
        1,
        "temperature"
      ),
    ],

    precip: [
      makeCard(
        "Precipitazioni totali annue più elevate",
        pickFirstArray(scope, [
          "rain_total_high",
          "annual_rain_total_high",
          "precip_total_high",
        ]),
        "mm",
        1,
        "rain",
        "rain_total"
      ),
      makeCard(
        "Precipitazioni totali annue più basse",
        pickFirstArray(scope, [
          "rain_total_low",
          "annual_rain_total_low",
          "precip_total_low",
        ]),
        "mm",
        1,
        "rain",
        "rain_total"
      ),
      makeCard(
        "Anni con giorni più piovosi (>1 mm)",
        pickFirstArray(scope, [
          "rain_days_over_1mm_high",
          "rain_days_high",
          "wet_days_high",
          "days_rain_gt_1mm_high",
        ]),
        "gg",
        0,
        "rain"
      ),
      makeCard(
        "Anni con giorni meno piovosi (>1 mm)",
        pickFirstArray(scope, [
          "rain_days_over_1mm_low",
          "rain_days_low",
          "wet_days_low",
          "days_rain_gt_1mm_low",
        ]),
        "gg",
        0,
        "rain"
      ),
      makeCard(
        "Anni con periodo più lungo senza piogge",
        pickFirstArray(scope, [
          "max_dry_spell_high",
          "dry_spell_high",
          "longest_dry_spell_high",
        ]),
        "gg",
        0,
        "rain"
      ),
      makeCard(
        "Anni con periodo più breve senza piogge",
        pickFirstArray(scope, [
          "max_dry_spell_low",
          "dry_spell_low",
          "longest_dry_spell_low",
        ]),
        "gg",
        0,
        "rain"
      ),
      makeCard(
        "Rain Rate più elevato annuo",
        pickFirstArray(scope, [
          "rainrate_max_high",
          "annual_rainrate_max_high",
          "rain_rate_high",
        ]),
        "mm/h",
        1,
        "rain"
      ),
    ],

    wind: [
      makeCard(
        "Media annua più elevata",
        pickFirstArray(scope, [
          "wind_avg_high",
          "wind_mean_high",
          "annual_wind_mean_high",
        ]),
        "km/h",
        1,
        "wind"
      ),
      makeCard(
        "Media annua più bassa",
        pickFirstArray(scope, [
          "wind_avg_low",
          "wind_mean_low",
          "annual_wind_mean_low",
        ]),
        "km/h",
        1,
        "wind"
      ),
      makeCard(
        "Media annua raffiche più elevata",
        pickFirstArray(scope, [
          "gust_mean_high",
          "annual_gust_mean_high",
          "gust_avg_high",
        ]),
        "km/h",
        1,
        "wind"
      ),
      makeCard(
        "Media annua raffiche più bassa",
        pickFirstArray(scope, [
          "gust_mean_low",
          "annual_gust_mean_low",
          "gust_avg_low",
        ]),
        "km/h",
        1,
        "wind"
      ),
    ],

    press: [
      makeCard(
        "Media annua più elevata",
        pickFirstArray(scope, [
          "press_mean_high",
          "press_avg_high",
          "annual_press_mean_high",
          "pressure_mean_high",
        ]),
        "hPa",
        1,
        "pressure"
      ),
      makeCard(
        "Media annua più bassa",
        pickFirstArray(scope, [
          "press_mean_low",
          "press_avg_low",
          "annual_press_mean_low",
          "pressure_mean_low",
        ]),
        "hPa",
        1,
        "pressure"
      ),
    ],

    rh: [
      makeCard(
        "Umidità media assoluta più elevata",
        pickFirstArray(scope, [
          "rh_mean_high",
          "humidity_mean_high",
          "annual_rh_mean_high",
        ]),
        "%",
        0,
        "humidity"
      ),
      makeCard(
        "Umidità media assoluta più bassa",
        pickFirstArray(scope, [
          "rh_mean_low",
          "humidity_mean_low",
          "annual_rh_mean_low",
        ]),
        "%",
        0,
        "humidity"
      ),
    ],

    rad: [
      makeCard(
        "Media annua UV più elevata",
        pickFirstArray(scope, [
          "uv_mean_high",
          "annual_uv_mean_high",
        ]),
        "",
        1,
        "radiation"
      ),
      makeCard(
        "Media annua UV più bassa",
        pickFirstArray(scope, [
          "uv_mean_low",
          "annual_uv_mean_low",
        ]),
        "",
        1,
        "radiation"
      ),
      makeCard(
        "Media annua Radiazione più elevata",
        pickFirstArray(scope, [
          "solar_mean_high",
          "radiation_mean_high",
          "annual_solar_mean_high",
        ]),
        "W/m²",
        0,
        "radiation"
      ),
      makeCard(
        "Media annua Radiazione più bassa",
        pickFirstArray(scope, [
          "solar_mean_low",
          "radiation_mean_low",
          "annual_solar_mean_low",
        ]),
        "W/m²",
        0,
        "radiation"
      ),
    ],
  };

  return (cards[cat] || []).map((c) => ({
    ...c,
    rows: filterRowsByCoverage(c.rows, c.paramKey, 0.95, c.arpasMode),
  }));
}

// -------------------- components --------------------
function MiniRankTable({ rows, unit, digits = 1, kind, topN = 20, arpasMode = "" }) {
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
            const isArpas = hasArpasPriority(r, kind, arpasMode);
            const arpasNote = getArpasNote(r, kind, arpasMode);

            if (kind === "daily") {
              return (
                <tr key={`${r.date}-${idx}`}>
                  <td className="tdVal">{vStr}</td>
                  <td className="tdWhen">
                    <Link href={`/giorni/${r.date}`} className="rowLink" title="Apri dettaglio giornaliero">
                      <span className="extCell" aria-hidden="true">↗</span>
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
                  <td className="tdVal">
                    <span className={isArpas ? "arpasValue" : ""} title={isArpas ? arpasNote : ""}>
                      {vStr}
                    </span>
                    {isArpas ? <span className="arpasMiniNote">{arpasNote}</span> : null}
                  </td>
                  <td className="tdWhen">
                    <Link href={`/mesi/${yy}/${mm}`} className="rowLink" title="Apri dettaglio mensile">
                      <span className="extCell" aria-hidden="true">↗</span>
                      {ymLabel(yy, Number(mm))}
                    </Link>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={`${r.year}-${idx}`}>
                <td className="tdVal">
                  <span className={isArpas ? "arpasValue" : ""} title={isArpas ? arpasNote : ""}>
                    {vStr}
                  </span>
                  {isArpas ? <span className="arpasMiniNote">{arpasNote}</span> : null}
                </td>
                <td className="tdWhen">
                  <Link href={`/anni/${r.year}`} className="rowLink" title="Apri dettaglio annuale">
                    <span className="extCell" aria-hidden="true">↗</span>
                    {r.year}
                  </Link>
                </td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td colSpan={2} className="tdEmpty">Nessun dato disponibile.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Card({ title, children }) {
  return (
    <div className="card">
      <div className="cardHead">
        <div className="cardTitle">{title}</div>
      </div>
      <div className="cardBody">{children}</div>
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
        <button type="button" onClick={() => onChange("all")} className={value === "all" ? "mBtn mBtnOn" : "mBtn"}>
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
  const [tab, setTab] = useState("daily");
  const [yearSel, setYearSel] = useState("all");
  const [monthSel, setMonthSel] = useState("all");
  const [catDaily, setCatDaily] = useState("temp");
  const [catMonthly, setCatMonthly] = useState("temp");
  const [catYearly, setCatYearly] = useState("temp");
  const [mmMonthly, setMmMonthly] = useState("01");

  if (!records) {
    return (
      <SiteLayout>
        <div className="wrap">
          <SiteHeader kicker="RECORD" title="Record" subtitle="" />
          <section className="hero">
            <div className="sub">
              File <code>data/record.json</code> non trovato. Crealo manualmente.
            </div>
          </section>
          <style jsx>{baseCss}</style>
        </div>
      </SiteLayout>
    );
  }

  const topN = useMemo(() => {
    const v = Number(records?.top_n);
    return Number.isFinite(v) && v > 0 ? v : 20;
  }, [records]);

  const yearsAvail = useMemo(() => {
    const ys = records?.daily?.by_year ? Object.keys(records.daily.by_year) : [];
    return ys.sort();
  }, [records]);

  const dailyScope = useMemo(() => getDailyScope(records, yearSel, monthSel), [records, yearSel, monthSel]);
  const monthlyScope = useMemo(() => getMonthlyScope(records, mmMonthly), [records, mmMonthly]);
  const yearlyScope = records?.yearly || null;

  const dailyCards = useMemo(() => getDailyCards(catDaily, dailyScope), [catDaily, dailyScope]);
  const monthlyCards = useMemo(() => getMonthlyCards(catMonthly, monthlyScope, mmMonthly), [catMonthly, monthlyScope, mmMonthly]);
  const yearlyCards = useMemo(() => getYearlyCards(catYearly, yearlyScope), [catYearly, yearlyScope]);

  return (
    <SiteLayout>
      <div className="wrap">
        <SiteHeader kicker="RECORD" title="Record" subtitle="" />

        <section className="pageDescription" aria-label="Descrizione pagina record">
          <div className="descriptionCard">
            <p>
              Questa pagina raccoglie i principali record meteorologici
              registrati nell’archivio della stazione. Puoi consultare le
              classifiche giornaliere, mensili e annuali, filtrando i dati per
              anno, mese e parametro: temperature, precipitazioni, vento,
              pressione, umidità e radiazione. Ogni tabella mostra i valori più
              significativi disponibili e permette di aprire direttamente il
              dettaglio del giorno, del mese o dell’anno corrispondente. Per le
              precipitazioni mensili e annuali, quando presenti, vengono
              mantenuti in evidenza anche i valori corretti o integrati con dato
              ARPAS.
            </p>
          </div>
        </section>

        <header className="hero">
          <div className="heroTop">
            <div className="heroMeta">
              <div className="sub">
                Aggiornato: <b>{fmtGeneratedAt(records.generated_at)}</b>
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
                <TabButton
                  active={tab === "monthly"}
                  onClick={() => {
                    setTab("monthly");
                    setCatMonthly("temp");
                  }}
                >
                  Mensili
                </TabButton>
                <TabButton
                  active={tab === "yearly"}
                  onClick={() => {
                    setTab("yearly");
                    setCatYearly("temp");
                  }}
                >
                  Annuali
                </TabButton>
              </div>
            </div>
          </div>

          {tab === "daily" ? (
            <div className="filterBar filterBarCenter">
              <div className="filterBox filterBoxYear">
                <div className="filterLabel filterLabelCenter">Seleziona Anno</div>
                <YearPicker value={yearSel} onChange={setYearSel} years={yearsAvail} />
              </div>

              <div className="filterBox filterBoxMonths">
                <div className="filterLabel filterLabelCenter">Seleziona Mese</div>
                <MonthPicker value={monthSel} onChange={setMonthSel} allowAll />
              </div>
            </div>
          ) : null}

          {tab === "monthly" ? (
            <div className="filterBar filterBarOnlyMonths">
              <div className="filterBox filterBoxMonthsOnly">
                <div className="filterLabel filterLabelCenter">Seleziona Mese</div>
                <MonthPicker value={mmMonthly} onChange={setMmMonthly} allowAll={false} />
              </div>
            </div>
          ) : null}

          {tab === "daily" ? (
            <div className="catBar catBarCenter">
              <div className="catBox">
                <div className="catLabel catLabelCenter">Seleziona Parametro</div>
                <div className="catBtns catBtnsCenter">
                  <CatButton active={catDaily === "temp"} onClick={() => setCatDaily("temp")}>Temperature</CatButton>
                  <CatButton active={catDaily === "precip"} onClick={() => setCatDaily("precip")}>Precipitazioni</CatButton>
                  <CatButton active={catDaily === "wind"} onClick={() => setCatDaily("wind")}>Vento</CatButton>
                  <CatButton active={catDaily === "press"} onClick={() => setCatDaily("press")}>Pressione</CatButton>
                  <CatButton active={catDaily === "rh"} onClick={() => setCatDaily("rh")}>Umidità</CatButton>
                  <CatButton active={catDaily === "rad"} onClick={() => setCatDaily("rad")}>Radiazione</CatButton>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "monthly" ? (
            <div className="catBar catBarCenter">
              <div className="catBox">
                <div className="catLabel catLabelCenter">Seleziona Parametro</div>
                <div className="catBtns catBtnsCenter">
                  <CatButton active={catMonthly === "temp"} onClick={() => setCatMonthly("temp")}>Temperature</CatButton>
                  <CatButton active={catMonthly === "precip"} onClick={() => setCatMonthly("precip")}>Precipitazioni</CatButton>
                  <CatButton active={catMonthly === "wind"} onClick={() => setCatMonthly("wind")}>Vento</CatButton>
                  <CatButton active={catMonthly === "press"} onClick={() => setCatMonthly("press")}>Pressione</CatButton>
                  <CatButton active={catMonthly === "rh"} onClick={() => setCatMonthly("rh")}>Umidità</CatButton>
                  <CatButton active={catMonthly === "rad"} onClick={() => setCatMonthly("rad")}>Radiazione</CatButton>
                </div>
              </div>
            </div>
          ) : null}

          {tab === "yearly" ? (
            <div className="catBar catBarCenter catBarNoTopBorder">
              <div className="catBox">
                <div className="catLabel catLabelCenter">Seleziona Parametro</div>
                <div className="catBtns catBtnsCenter">
                  <CatButton active={catYearly === "temp"} onClick={() => setCatYearly("temp")}>Temperature</CatButton>
                  <CatButton active={catYearly === "precip"} onClick={() => setCatYearly("precip")}>Precipitazioni</CatButton>
                  <CatButton active={catYearly === "wind"} onClick={() => setCatYearly("wind")}>Vento</CatButton>
                  <CatButton active={catYearly === "press"} onClick={() => setCatYearly("press")}>Pressione</CatButton>
                  <CatButton active={catYearly === "rh"} onClick={() => setCatYearly("rh")}>Umidità</CatButton>
                  <CatButton active={catYearly === "rad"} onClick={() => setCatYearly("rad")}>Radiazione</CatButton>
                </div>
              </div>
            </div>
          ) : null}
        </header>

        {tab === "daily" ? (
          dailyCards.length ? (
            <section className="grid">
              {dailyCards.map((c, i) => (
                <Card key={`${c.title}-${i}`} title={c.title}>
                  <MiniRankTable rows={c.rows} unit={c.unit} digits={c.digits} kind="daily" topN={topN} arpasMode={c.arpasMode} />
                </Card>
              ))}
            </section>
          ) : (
            <section className="emptyBox">Nessun dato disponibile per questa selezione.</section>
          )
        ) : null}

        {tab === "monthly" ? (
          monthlyCards.length ? (
            <section className="grid">
              {monthlyCards.map((c, i) => (
                <Card key={`${c.title}-${i}`} title={c.title}>
                  <MiniRankTable rows={c.rows} unit={c.unit} digits={c.digits} kind="monthly" topN={topN} arpasMode={c.arpasMode} />
                </Card>
              ))}
            </section>
          ) : (
            <section className="emptyBox">Nessun dato disponibile per questa selezione.</section>
          )
        ) : null}

        {tab === "yearly" ? (
          <section className="grid">
            {yearlyCards.map((c, i) => (
              <Card key={`${c.title}-${i}`} title={c.title}>
                <MiniRankTable rows={c.rows} unit={c.unit} digits={c.digits} kind="yearly" topN={topN} arpasMode={c.arpasMode} />
              </Card>
            ))}
          </section>
        ) : null}

        <style jsx>{baseCss}</style>
      </div>
    </SiteLayout>
  );
}

const baseCss = `
  :global(body) {
    background: #fff;
  }

  .wrap {
    max-width: 1280px;
    margin: 0 auto;
    padding: 18px 10px 50px;
    background: #fff;
  }

  .pageDescription {
    width: 100%;
    margin: 14px 0 12px;
  }

  .descriptionCard {
    width: 100%;
    box-sizing: border-box;
    margin: 0 auto;
    padding: 18px 24px;
    border: 1px solid #dfe5ec;
    border-radius: 18px;
    background: rgba(248, 250, 252, 0.92);
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
  }

  .descriptionCard p {
    margin: 0;
    font-size: 14px;
    line-height: 1.75;
    font-weight: 800;
    color: #334155;
    text-align: justify;
    text-align-last: left;
    hyphens: auto;
    -webkit-hyphens: auto;
    overflow-wrap: break-word;
  }

  .hero {
    border: 1px solid #ececec;
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 12px 34px rgba(0,0,0,0.04);
    padding: 18px;
  }

  .heroTop {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    align-items: center;
  }

  .heroMeta {
    min-height: 24px;
    display: flex;
    align-items: center;
  }

  .sub {
    font-size: 13px;
    opacity: 0.75;
    line-height: 1.35;
  }

  .tabs {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .tabBtn {
    padding: 10px 12px;
    border: 1px solid #ededed;
    border-radius: 999px;
    background: #fff;
    font-weight: 950;
    font-size: 13px;
    cursor: pointer;
    opacity: 0.9;
    transition: background 120ms ease, transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
  }

  .tabBtn:hover {
    background: #f4f4f4;
    transform: translateY(-1px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.06);
    opacity: 1;
  }

  .tabBtnOn {
    background: #111;
    color: #fff;
    border-color: #111;
    box-shadow: 0 10px 24px rgba(0,0,0,0.10);
    opacity: 1;
  }

  .filterBar {
    margin-top: 14px;
    border-top: 1px solid #efefef;
    padding-top: 12px;
    display: flex;
    gap: 18px;
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .filterBarCenter {
    justify-content: space-between;
  }

  .filterBarOnlyMonths {
    justify-content: center;
  }

  .filterBox {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .filterBoxYear {
    min-width: 210px;
  }

  .filterBoxMonths {
    flex: 1;
    min-width: 320px;
  }

  .filterBoxMonthsOnly {
    width: 100%;
  }

  .filterLabel {
    font-weight: 950;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 12px;
    opacity: 0.8;
  }

  .filterLabelCenter {
    text-align: center;
    width: 100%;
  }

  .yearSel {
    height: 48px;
    padding: 0 16px;
    border: 1px solid #ededed;
    border-radius: 16px;
    background: #fff;
    font-weight: 900;
    font-size: 14px;
  }

  .catBar {
    margin-top: 14px;
    border-top: 1px solid #efefef;
    padding-top: 12px;
    display: flex;
    justify-content: center;
  }

  .catBarNoTopBorder {
    border-top: 0;
    margin-top: 10px;
    padding-top: 0;
  }

  .catBarCenter {
    justify-content: center;
  }

  .catBox {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
  }

  .catLabel {
    font-weight: 950;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 12px;
    opacity: 0.8;
    white-space: nowrap;
  }

  .catLabelCenter {
    text-align: center;
  }

  .catBtns {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }

  .catBtnsCenter {
    justify-content: center;
  }

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

  .catBtn:hover {
    background: #f4f4f4;
    transform: translateY(-1px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.06);
    opacity: 1;
  }

  .catBtnOn {
    background: #111;
    color: #fff;
    border-color: #111;
    box-shadow: 0 10px 24px rgba(0,0,0,0.10);
    opacity: 1;
  }

  .monthPick {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 10px;
    width: 100%;
  }

  .mBtn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    border-radius: 12px;
    border: 1px solid #ededed;
    background: #fff;
    color: #111;
    font-weight: 950;
    font-size: 14px;
    cursor: pointer;
    transition: background 120ms ease, transform 120ms ease, box-shadow 120ms ease;
  }

  .mBtn:hover {
    background: #f4f4f4;
    transform: translateY(-1px);
    box-shadow: 0 8px 20px rgba(0,0,0,0.06);
  }

  .mBtnOn {
    background: #111;
    color: #fff;
    border-color: #111;
    box-shadow: 0 10px 24px rgba(0,0,0,0.10);
  }

  code {
    background: #f4f4f4;
    padding: 2px 6px;
    border-radius: 8px;
  }

  .grid {
    margin-top: 12px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }

  .card {
    border: 1px solid #e7e7e7;
    border-radius: 16px;
    background: #fff;
    box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 12px 34px rgba(0,0,0,0.04);
    overflow: hidden;
  }

  .cardHead {
    background: #111;
    color: #fff;
    padding: 12px 12px 10px;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 62px;
    text-align: center;
  }

  .cardTitle {
    font-weight: 950;
    font-size: 14px;
    letter-spacing: 0.01em;
    line-height: 1.2;
    text-align: center;
    width: 100%;
  }

  .cardBody {
    padding: 10px 12px 12px;
  }

  .miniTable {
    width: 100%;
    border-collapse: collapse;
  }

  .miniTable thead th {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.75;
    padding: 8px 6px;
    border-bottom: 1px solid #efefef;
  }

  .thVal {
    text-align: left;
  }

  .thWhen {
    text-align: right;
  }

  .miniTable tbody td {
    padding: 8px 6px;
    border-bottom: 1px solid #f1f1f1;
    font-size: 13px;
    white-space: nowrap;
    vertical-align: top;
  }

  .miniTable tbody tr:nth-child(even) td {
    background: #fcfcfc;
  }

  .miniTable tbody tr:hover td {
    background: #fafafa;
  }

  .tdVal {
    font-weight: 950;
    letter-spacing: -0.01em;
    text-align: left;
  }

  .tdWhen {
    text-align: right;
  }

  .tdEmpty {
    padding: 10px 6px;
    font-size: 13px;
    opacity: 0.7;
  }

  .arpasValue {
    position: relative;
    display: inline-block;
    color: #111827;
    text-decoration: underline;
    text-decoration-color: #dc2626;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
    padding-left: 16px;
  }

  .arpasValue::before {
    content: "";
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #dc2626;
    box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.16);
  }

  .arpasMiniNote {
    display: block;
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.2;
    color: #64748b;
    font-weight: 700;
  }

  .rowLink {
    color: #111;
    text-decoration: none;
    font-weight: 900;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-end;
  }

  .rowLink:hover {
    text-decoration: underline;
  }

  .extCell {
    font-size: 12px;
    opacity: 0.65;
    transform: translateY(-1px);
  }

  .emptyBox {
    margin-top: 12px;
    border: 1px solid #ececec;
    border-radius: 16px;
    background: #fff;
    padding: 20px;
    text-align: center;
    font-weight: 800;
    color: #444;
    box-shadow: 0 1px 0 rgba(0,0,0,0.02), 0 12px 34px rgba(0,0,0,0.04);
  }

  @media (max-width: 1100px) {
    .heroTop {
      flex-direction: column;
      align-items: flex-start;
    }

    .tabs {
      justify-content: flex-start;
    }

    .filterBarCenter {
      justify-content: flex-start;
    }

    .filterBoxMonths {
      min-width: 260px;
      width: 100%;
    }

    .filterBoxMonthsOnly {
      width: 100%;
    }

    .grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 640px) {
    .pageDescription {
      margin: 12px 0 10px;
    }

    .descriptionCard {
      padding: 16px 18px;
      border-radius: 18px;
    }

    .descriptionCard p {
      font-size: 14px;
      line-height: 1.75;
      font-weight: 800;
      text-align: justify;
      text-align-last: left;
    }

    .grid {
      grid-template-columns: 1fr;
    }

    .filterBoxYear,
    .filterBoxMonths,
    .filterBoxMonthsOnly {
      min-width: 0;
      width: 100%;
    }

    .yearSel {
      width: 100%;
    }
  }
`;