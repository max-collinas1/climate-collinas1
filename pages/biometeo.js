import fs from "fs";
import path from "path";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import SiteLayout from "../components/SiteLayout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const TIMEZONE = "Europe/Rome";
const HISTORICAL_CACHE = new Map();

const BIOMETE0_SOURCES = {
  humidex: {
    label: "ARPAV – Humidex",
    shortLabel: "ARPAV",
    url: "https://www.arpa.veneto.it/dati-ambientali/bollettini/meteo/indice-disagio-fisico/humidex",
  },
  heatIndex: {
    label: "ARPAS Sardegna – Indice di calore",
    shortLabel: "ARPAS",
    url: "https://www.sar.sardegna.it/documentazione/bio/indicecalore.asp",
  },
  windChill: {
    label: "ARPA Piemonte – Wind Chill",
    shortLabel: "ARPA Piemonte",
    url: "https://www.arpa.piemonte.it/rischi_naturali/snippets_arpa/wind_chill/",
  },
  wbgt: {
    label: "CeSNIR – Metodo WBGT",
    shortLabel: "CeSNIR",
    url: "https://www.cesnir.com/microclima-wbgt-ratio-e-corretto-uso/",
  },
  uv: {
    label: "ARPAS Sardegna – Indice UV",
    shortLabel: "ARPAS",
    url: "https://www.sar.sardegna.it/documentazione/bio/indiceUV.asp",
  },
};

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

export async function getStaticProps() {
  const intradayDates = readIntradayDates();

  return {
    props: {
      intradayDates,
      latestDate: intradayDates.length
        ? intradayDates[intradayDates.length - 1]
        : null,
    },
    revalidate: 300,
  };
}

function n(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function round1(value) {
  const parsed = n(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed + Number.EPSILON) * 10) / 10;
}

function fmt(value, decimals = 1, suffix = "") {
  const parsed = n(value);
  if (!Number.isFinite(parsed)) return "—";
  return `${parsed.toFixed(decimals)}${suffix}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function currentRomeISO() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseLocalTimestamp(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/,
  );

  if (!match) return null;

  return new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    0,
    0,
  );
}

function dateFromISO(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function formatLongDate(iso) {
  const date = dateFromISO(iso);
  if (!date) return iso || "—";

  return new Intl.DateTimeFormat("it-IT", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatObservationTime(value) {
  const date = parseLocalTimestamp(value);
  if (!date) return "—";
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function dateToISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addDaysISO(iso, amount) {
  const date = dateFromISO(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + amount);
  return dateToISO(date);
}

function dateRangeISO(startISO, endISO) {
  const start = dateFromISO(startISO);
  const end = dateFromISO(endISO);
  if (!start || !end || start > end) return [];

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(dateToISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

function periodStartISO(endISO, period) {
  if (period === "week") return addDaysISO(endISO, -6);
  if (period === "month") return addDaysISO(endISO, -29);
  return endISO;
}

function periodLabel(period) {
  if (period === "week") return "ultimi 7 giorni";
  if (period === "month") return "ultimi 30 giorni";
  return "oggi";
}

function chartTimeBounds(endISO, period) {
  const start = dateFromISO(periodStartISO(endISO, period));
  const end = dateFromISO(addDaysISO(endISO, 1));
  if (!start || !end) return { min: null, max: null };

  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return { min: start.getTime(), max: end.getTime() };
}

function formatChartTime(timestamp, period = "day") {
  const date = new Date(timestamp);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;

  if (period === "week") {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)} ${time}`;
  }

  if (period === "month") {
    return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}`;
  }

  return time;
}

function averageFinite(values) {
  const valid = values.map((value) => n(value)).filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function maxFinite(values) {
  const valid = values.map((value) => n(value)).filter(Number.isFinite);
  return valid.length ? Math.max(...valid) : null;
}

function minFinite(values) {
  const valid = values.map((value) => n(value)).filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : null;
}

function calculateHumidex(tempC, dewpointC) {
  const temp = n(tempC);
  const dew = n(dewpointC);
  if (!Number.isFinite(temp) || !Number.isFinite(dew)) return null;

  const dewKelvin = dew + 273.15;
  const vapourPressure =
    6.11 * Math.exp(5417.753 * (1 / 273.15 - 1 / dewKelvin));
  const humidex = temp + 0.5555 * (vapourPressure - 10);

  if (temp < 20 || humidex < temp + 1) return null;
  return round1(humidex);
}

function calculateHeatIndex(tempC, rhPct) {
  const temp = n(tempC);
  const rh = n(rhPct);
  if (!Number.isFinite(temp) || !Number.isFinite(rh)) return null;

  const tempF = (temp * 9) / 5 + 32;
  let simple =
    0.5 * (tempF + 61 + (tempF - 68) * 1.2 + rh * 0.094);
  simple = (simple + tempF) / 2;

  if (simple < 80) return null;

  let hi =
    -42.379 +
    2.04901523 * tempF +
    10.14333127 * rh -
    0.22475541 * tempF * rh -
    0.00683783 * tempF * tempF -
    0.05481717 * rh * rh +
    0.00122874 * tempF * tempF * rh +
    0.00085282 * tempF * rh * rh -
    0.00000199 * tempF * tempF * rh * rh;

  if (rh < 13 && tempF >= 80 && tempF <= 112) {
    const adjustment =
      ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(tempF - 95)) / 17);
    hi -= adjustment;
  } else if (rh > 85 && tempF >= 80 && tempF <= 87) {
    const adjustment = ((rh - 85) / 10) * ((87 - tempF) / 5);
    hi += adjustment;
  }

  return round1(((hi - 32) * 5) / 9);
}

function calculateWindChill(tempC, windKmh) {
  const temp = n(tempC);
  const wind = n(windKmh);
  if (!Number.isFinite(temp) || !Number.isFinite(wind)) return null;
  if (temp > 0 || wind <= 0) return null;

  if (wind >= 5) {
    const speedFactor = Math.pow(wind, 0.16);
    return round1(
      13.12 +
        0.6215 * temp -
        11.37 * speedFactor +
        0.3965 * temp * speedFactor,
    );
  }

  return round1(temp + ((-1.59 + 0.1345 * temp) / 5) * wind);
}

function estimateWetBulb(tempC, rhPct) {
  const temp = n(tempC);
  const rh = n(rhPct);
  if (!Number.isFinite(temp) || !Number.isFinite(rh)) return null;

  const value =
    temp * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(temp + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * Math.pow(rh, 1.5) * Math.atan(0.023101 * rh) -
    4.686035;

  return round1(value);
}

function estimateShadeWbgt(tempC, rhPct) {
  const temp = n(tempC);
  const wetBulb = estimateWetBulb(tempC, rhPct);
  if (!Number.isFinite(temp) || !Number.isFinite(wetBulb) || temp < 20) {
    return null;
  }

  return round1(0.7 * wetBulb + 0.3 * temp);
}

function humidexMeta(value) {
  const v = n(value);
  if (!Number.isFinite(v)) {
    return {
      label: "Non attivo",
      description: "Compare quando caldo e umidità iniziano a farsi sentire.",
      tone: "neutral",
    };
  }
  if (v < 30) {
    return {
      label: "Disagio lieve",
      description: "Il caldo umido è percepibile, ma in genere crea poco disagio.",
      tone: "good",
    };
  }
  if (v < 40) {
    return {
      label: "Disagio moderato",
      description: "Il caldo può affaticare. Durante attività prolungate fai pause e bevi regolarmente.",
      tone: "watch",
    };
  }
  if (v <= 45) {
    return {
      label: "Forte disagio",
      description: "Evita gli sforzi non necessari e cerca un ambiente più fresco.",
      tone: "high",
    };
  }
  return {
    label: "Condizioni pericolose",
    description: "Il rischio di disturbi da calore aumenta molto. Riduci al minimo gli sforzi e resta al fresco.",
    tone: "danger",
  };
}

function heatIndexMeta(value) {
  const v = n(value);
  if (!Number.isFinite(v)) {
    return {
      label: "Non attivo",
      description: "Compare solo quando la combinazione di caldo e umidità è significativa.",
      tone: "neutral",
    };
  }
  if (v < 27) {
    return {
      label: "Disagio contenuto",
      description: "Il caldo non crea in genere particolari difficoltà.",
      tone: "good",
    };
  }
  if (v < 32.2) {
    return {
      label: "Attenzione",
      description: "Con esposizione prolungata o attività fisica può comparire stanchezza. Fai pause e bevi regolarmente.",
      tone: "watch",
    };
  }
  if (v < 39.4) {
    return {
      label: "Attenzione elevata",
      description: "Il caldo può affaticare molto, soprattutto durante attività fisiche o esposizioni prolungate. Riduci gli sforzi, cerca l’ombra e bevi regolarmente.",
      tone: "high",
    };
  }
  if (v < 51.7) {
    return {
      label: "Pericolo",
      description: "Il rischio di malessere aumenta. Evita gli sforzi nelle ore più calde e cerca un luogo fresco.",
      tone: "danger",
    };
  }
  return {
    label: "Pericolo estremo",
    description: "Condizioni molto pericolose. Evita l’attività fisica e resta in un ambiente fresco.",
    tone: "danger",
  };
}

function windChillMeta(value) {
  const v = n(value);
  if (!Number.isFinite(v)) {
    return {
      label: "Non attivo",
      description: "Compare soltanto con temperatura non superiore a 0 °C e vento presente.",
      tone: "neutral",
    };
  }
  if (v > -10) {
    return {
      label: "Rischio basso",
      description: "Il vento aumenta leggermente la sensazione di freddo.",
      tone: "cool",
    };
  }
  if (v > -28) {
    return {
      label: "Rischio moderato",
      description: "Se resti fuori a lungo, copri bene la pelle e proteggiti dal vento.",
      tone: "watch",
    };
  }
  if (v > -40) {
    return {
      label: "Rischio alto",
      description: "La pelle scoperta può congelare in 10–30 minuti. Copriti completamente.",
      tone: "high",
    };
  }
  if (v > -48) {
    return {
      label: "Rischio molto alto",
      description: "La pelle scoperta può congelare in 5–10 minuti. Limita fortemente il tempo all’aperto.",
      tone: "danger",
    };
  }
  if (v > -55) {
    return {
      label: "Rischio grave",
      description: "La pelle scoperta può congelare in pochi minuti. Evita di restare all’aperto.",
      tone: "danger",
    };
  }
  return {
    label: "Rischio estremo",
    description: "Condizioni esterne pericolose: la pelle scoperta può congelare in meno di 2 minuti.",
    tone: "danger",
  };
}

function uvMeta(value) {
  const v = n(value);
  if (!Number.isFinite(v)) {
    return { label: "Dato non disponibile", tone: "neutral" };
  }
  if (v < 3) return { label: "Basso", tone: "good" };
  if (v < 6) return { label: "Moderato", tone: "watch" };
  if (v < 8) return { label: "Alto", tone: "high" };
  if (v < 11) return { label: "Molto alto", tone: "danger" };
  return { label: "Estremo", tone: "danger" };
}

function wbgtMeta(value) {
  const v = n(value);
  if (!Number.isFinite(v)) {
    return {
      label: "Non attivo",
      description: "Compare quando il caldo può rendere più faticosa l’attività fisica.",
      tone: "neutral",
    };
  }
  if (v < 26) {
    return {
      label: "Stress contenuto",
      description: "Per attività leggere il caldo è in genere gestibile, con normali pause e idratazione.",
      tone: "good",
    };
  }
  if (v < 29) {
    return {
      label: "Attenzione indicativa",
      description: "Durante attività prolungate rallenta, fai pause e bevi regolarmente.",
      tone: "watch",
    };
  }
  if (v < 31) {
    return {
      label: "Stress elevato indicativo",
      description: "Riduci l’intensità degli sforzi e aumenta pause e idratazione.",
      tone: "high",
    };
  }
  return {
    label: "Stress molto elevato indicativo",
    description: "Evita attività intensa nelle ore più calde e cerca un ambiente fresco.",
    tone: "danger",
  };
}

function enrichRow(row) {
  const date = parseLocalTimestamp(row?.t);
  if (!date) return null;

  const temp = n(row?.temp_c);
  const dewpoint = n(row?.dewpoint_c);
  const rh = n(row?.rh_pct);
  const wind = n(row?.wind_kmh);
  const uv = n(row?.uv);
  const solar = n(row?.solar_wm2);

  return {
    ...row,
    timestamp: date.getTime(),
    temp: Number.isFinite(temp) ? temp : null,
    dewpoint: Number.isFinite(dewpoint) ? dewpoint : null,
    rh: Number.isFinite(rh) ? rh : null,
    wind: Number.isFinite(wind) ? wind : null,
    uvValue: Number.isFinite(uv) ? uv : null,
    solar: Number.isFinite(solar) ? solar : null,
    humidex: calculateHumidex(temp, dewpoint),
    heatIndex: calculateHeatIndex(temp, rh),
    windChill: calculateWindChill(temp, wind),
    wbgtShade: estimateShadeWbgt(temp, rh),
  };
}

function isUsableObservation(row) {
  if (!row) return false;
  return [row.temp, row.dewpoint, row.rh, row.wind, row.uvValue].some(
    Number.isFinite,
  );
}

function msUntilNextRefresh(now = new Date()) {
  const next = new Date(now);
  const minute = now.getMinutes();

  if (minute < 20) {
    next.setMinutes(20, 5, 0);
  } else if (minute < 50) {
    next.setMinutes(50, 5, 0);
  } else {
    next.setHours(next.getHours() + 1, 20, 5, 0);
  }

  return Math.max(1000, next.getTime() - now.getTime());
}

function nextRefreshLabel(now = new Date()) {
  const next = new Date(now.getTime() + msUntilNextRefresh(now));
  return `${pad2(next.getHours())}:${pad2(next.getMinutes())}`;
}

async function fetchIntradayFile(iso, { fresh = false } = {}) {
  if (!iso) throw new Error("Data intraday non valida.");

  if (!fresh && HISTORICAL_CACHE.has(iso)) {
    return HISTORICAL_CACHE.get(iso);
  }

  const query = fresh ? `?v=${Date.now()}` : "";
  const response = await fetch(`/data/intraday/${iso}.json${query}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`File intraday ${iso} non disponibile.`);
  }

  const raw = await response.json();
  if (!Array.isArray(raw)) {
    throw new Error(`Formato intraday non valido per ${iso}.`);
  }

  if (!fresh) HISTORICAL_CACHE.set(iso, raw);
  return raw;
}

function nearestHistoricalPoint(rows, targetTimestamp) {
  const target = new Date(targetTimestamp);
  const targetMinutes = target.getHours() * 60 + target.getMinutes();
  let best = null;
  let bestDistance = Infinity;

  for (const raw of rows) {
    const point = enrichRow(raw);
    if (!point || !isUsableObservation(point)) continue;

    const date = new Date(point.timestamp);
    const minutes = date.getHours() * 60 + date.getMinutes();
    const distance = Math.abs(minutes - targetMinutes);

    if (distance < bestDistance && distance <= 30) {
      bestDistance = distance;
      best = point;
    }
  }

  return best;
}

function historicalDatesForCurrent(intradayDates, currentISO) {
  const monthDay = String(currentISO || "").slice(5);
  const currentYear = Number(String(currentISO || "").slice(0, 4));

  return intradayDates.filter((iso) => {
    const year = Number(String(iso).slice(0, 4));
    return iso.slice(5) === monthDay && year < currentYear;
  });
}

function MetricCard({ title, value, unit, meta, footnote, source }) {
  return (
    <article className={`metricCard ${meta?.tone || "neutral"}`}>
      <span className="metricTitle">{title}</span>
      <div className="metricValueRow">
        <strong>{value}</strong>
        {unit ? <span>{unit}</span> : null}
      </div>
      <div className="metricStatus">{meta?.label || "—"}</div>
      <p>{meta?.description || footnote || ""}</p>
      {source?.url ? (
        <a
          className="metricSource"
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Apri la fonte scientifica per ${title}`}
        >
          {source.shortLabel || source.label} ↗
        </a>
      ) : null}

      <style jsx>{`
        .metricCard {
          min-width: 0;
          min-height: 142px;
          padding: 15px;
          border: 1px solid #e5e7eb;
          border-radius: 18px;
          background: linear-gradient(180deg, #ffffff, #fafbfc);
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.045);
          display: grid;
          align-content: center;
          gap: 7px;
          position: relative;
          overflow: hidden;
        }

        .metricCard::before {
          content: "";
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 4px;
          background: #94a3b8;
        }

        .metricCard.good::before {
          background: #16a34a;
        }

        .metricCard.watch::before {
          background: #eab308;
        }

        .metricCard.high::before {
          background: #f97316;
        }

        .metricCard.danger::before {
          background: #dc2626;
        }

        .metricCard.cool::before {
          background: #0284c7;
        }

        .metricTitle {
          font-size: 10px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.57);
          text-transform: uppercase;
          letter-spacing: 0.045em;
        }

        .metricValueRow {
          min-width: 0;
          display: flex;
          align-items: baseline;
          gap: 5px;
        }

        strong {
          min-width: 0;
          font-size: 30px;
          line-height: 1;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.035em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .metricValueRow > span {
          font-size: 13px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.64);
        }

        .metricStatus {
          font-size: 12px;
          font-weight: 950;
          color: #0f172a;
        }

        p {
          min-height: 30px;
          margin: 0;
          font-size: 10px;
          line-height: 1.45;
          font-weight: 700;
          color: rgba(15, 23, 42, 0.54);
        }

        .metricSource {
          justify-self: start;
          width: fit-content;
          margin-top: 1px;
          font-size: 8px;
          line-height: 1.2;
          font-weight: 800;
          color: rgba(15, 23, 42, 0.42);
          text-decoration: none;
          border-bottom: 1px dotted rgba(15, 23, 42, 0.24);
          transition: color 140ms ease, border-color 140ms ease;
        }

        .metricSource:hover,
        .metricSource:focus-visible {
          color: rgba(15, 23, 42, 0.72);
          border-bottom-color: currentColor;
          outline: none;
        }
      `}</style>
    </article>
  );
}

function SummaryCell({ label, value, detail }) {
  return (
    <div className="summaryCell">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>

      <style jsx>{`
        .summaryCell {
          min-width: 0;
          min-height: 78px;
          padding: 11px 13px;
          display: grid;
          align-content: center;
          gap: 3px;
          background: #fbfcfd;
        }

        span {
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
      `}</style>
    </div>
  );
}

function ChartControls({
  selectedIndex,
  onIndexChange,
  selectedPeriod,
  onPeriodChange,
  loading = false,
}) {
  const indexOptions = [
    { key: "humidex", label: "Humidex" },
    { key: "heatIndex", label: "Heat Index" },
    { key: "wbgtShade", label: "WBGT ombra stimato" },
    { key: "windChill", label: "Wind Chill" },
    { key: "uvValue", label: "Indice UV" },
  ];

  const periodOptions = [
    { key: "day", label: "Oggi" },
    { key: "week", label: "Ultimi 7 giorni" },
    { key: "month", label: "Ultimi 30 giorni" },
  ];

  return (
    <div className="chartControls">
      <label>
        <span>Valore mostrato</span>
        <select
          value={selectedIndex}
          onChange={(event) => onIndexChange(event.target.value)}
          disabled={loading}
        >
          {indexOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>Periodo</span>
        <select
          value={selectedPeriod}
          onChange={(event) => onPeriodChange(event.target.value)}
          disabled={loading}
        >
          {periodOptions.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <style jsx>{`
        .chartControls {
          display: flex;
          justify-content: center;
          align-items: end;
          gap: 12px;
          flex-wrap: wrap;
        }

        label {
          min-width: 210px;
          display: grid;
          gap: 6px;
        }

        span {
          font-size: 9px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.56);
          text-transform: uppercase;
          letter-spacing: 0.045em;
          text-align: center;
        }

        select {
          min-height: 42px;
          width: 100%;
          border: 1px solid #dce2e8;
          border-radius: 13px;
          padding: 9px 38px 9px 13px;
          background: #fff;
          color: #0f172a;
          font-family: inherit;
          font-size: 12px;
          font-weight: 900;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.035);
        }

        select:focus {
          outline: 2px solid rgba(15, 23, 42, 0.14);
          outline-offset: 2px;
        }

        select:disabled {
          cursor: wait;
          opacity: 0.65;
        }

        @media (max-width: 560px) {
          .chartControls {
            display: grid;
            grid-template-columns: 1fr;
          }

          label {
            min-width: 0;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}

function biometeoChartConfig(selectedIndex) {
  return {
    humidex: {
      title: "Andamento Humidex",
      unit: "",
      name: "Humidex",
      axisMin: 20,
      axisMax: 50,
      bands: [
        { from: 20, to: 30, label: "Disagio basso", color: "rgba(34, 197, 94, 0.11)" },
        { from: 30, to: 40, label: "Disagio moderato", color: "rgba(234, 179, 8, 0.12)" },
        { from: 40, to: 45, label: "Forte disagio", color: "rgba(249, 115, 22, 0.13)" },
        { from: 45, to: 55, label: "Pericolo", color: "rgba(220, 38, 38, 0.14)" },
      ],
    },
    heatIndex: {
      title: "Andamento Heat Index",
      unit: "°C",
      name: "Heat Index",
      axisMin: 25,
      axisMax: 55,
      bands: [
        { from: 25, to: 27, label: "Stress contenuto", color: "rgba(34, 197, 94, 0.11)" },
        { from: 27, to: 32.2, label: "Attenzione", color: "rgba(234, 179, 8, 0.12)" },
        { from: 32.2, to: 39.4, label: "Attenzione elevata", color: "rgba(249, 115, 22, 0.13)" },
        { from: 39.4, to: 51.7, label: "Pericolo", color: "rgba(220, 38, 38, 0.14)" },
        { from: 51.7, to: 60, label: "Pericolo estremo", color: "rgba(127, 29, 29, 0.18)" },
      ],
    },
    wbgtShade: {
      title: "Andamento WBGT ombra stimato",
      unit: "°C",
      name: "WBGT ombra",
      axisMin: 20,
      axisMax: 34,
      bands: [
        { from: 20, to: 26, label: "Stress contenuto", color: "rgba(34, 197, 94, 0.11)" },
        { from: 26, to: 29, label: "Attenzione", color: "rgba(234, 179, 8, 0.12)" },
        { from: 29, to: 31, label: "Stress elevato", color: "rgba(249, 115, 22, 0.13)" },
        { from: 31, to: 40, label: "Stress molto elevato", color: "rgba(220, 38, 38, 0.14)" },
      ],
    },
    windChill: {
      title: "Andamento Wind Chill",
      unit: "°C",
      name: "Wind Chill",
      axisMin: -60,
      axisMax: 0,
      bands: [
        { from: -70, to: -55, label: "Rischio estremo", color: "rgba(127, 29, 29, 0.18)" },
        { from: -55, to: -40, label: "Rischio molto alto", color: "rgba(220, 38, 38, 0.15)" },
        { from: -40, to: -28, label: "Rischio alto", color: "rgba(249, 115, 22, 0.14)" },
        { from: -28, to: -10, label: "Rischio moderato", color: "rgba(234, 179, 8, 0.12)" },
        { from: -10, to: 0, label: "Rischio basso", color: "rgba(34, 197, 94, 0.11)" },
      ],
    },
    uvValue: {
      title: "Andamento dell’indice UV",
      unit: "UV",
      name: "UV",
      axisMin: 0,
      axisMax: 12,
      bands: [
        { from: 0, to: 3, label: "Basso", color: "rgba(34, 197, 94, 0.11)" },
        { from: 3, to: 6, label: "Moderato", color: "rgba(234, 179, 8, 0.12)" },
        { from: 6, to: 8, label: "Alto", color: "rgba(249, 115, 22, 0.13)" },
        { from: 8, to: 11, label: "Molto alto", color: "rgba(239, 68, 68, 0.13)" },
        { from: 11, to: 16, label: "Estremo", color: "rgba(153, 27, 27, 0.16)" },
      ],
    },
  }[selectedIndex];
}

function BiometeoChart({ rows, selectedIndex, selectedPeriod, loadedDate }) {
  const config = biometeoChartConfig(selectedIndex);
  const pairs = rows.map((row) => [row.timestamp, row[selectedIndex]]);
  const validValues = pairs
    .map((point) => n(point[1]))
    .filter(Number.isFinite);
  const bounds = chartTimeBounds(loadedDate, selectedPeriod);

  const option = useMemo(() => {
    const observedMin = validValues.length
      ? Math.min(...validValues)
      : config.axisMin;
    const observedMax = validValues.length
      ? Math.max(...validValues)
      : config.axisMax;
    const yMin = Math.floor(Math.min(observedMin, config.axisMin));
    const yMax = Math.ceil(Math.max(observedMax, config.axisMax));

    const markAreas = config.bands
      .map((band) => [
        {
          name: band.label,
          yAxis: Math.max(yMin, band.from),
          itemStyle: { color: band.color },
          label: {
            show: true,
            position: "insideRight",
            color: "rgba(15, 23, 42, 0.54)",
            fontSize: 9,
            fontWeight: 700,
          },
        },
        { yAxis: Math.min(yMax, band.to) },
      ])
      .filter((band) => band[0].yAxis < band[1].yAxis);

    const latestPoint = [...pairs]
      .reverse()
      .find((point) => Number.isFinite(n(point?.[1])));

    const series = [
      {
        name: config.name,
        type: "line",
        data: pairs,
        showSymbol: false,
        connectNulls: false,
        smooth: false,
        sampling: "lttb",
        lineStyle: { width: 2.6, color: "#0f172a" },
        itemStyle: { color: "#0f172a" },
        areaStyle: { opacity: 0.025, color: "#0f172a" },
        markArea: {
          silent: true,
          data: markAreas,
        },
        z: 3,
      },
    ];

    if (
      selectedPeriod === "day" &&
      loadedDate === currentRomeISO() &&
      latestPoint
    ) {
      series.push({
        name: "Ultimo dato",
        type: "effectScatter",
        data: [latestPoint],
        symbol: "circle",
        symbolSize: 9,
        showEffectOn: "render",
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
        tooltip: { show: false },
        silent: true,
        zlevel: 10,
        z: 100,
      });
    }

    return {
      animation: true,
      grid: { left: 62, right: 28, top: 54, bottom: 58 },
      title: {
        text: `${config.title} – ${periodLabel(selectedPeriod)}`,
        left: "center",
        top: 8,
        textStyle: {
          fontSize: 17,
          fontWeight: 700,
          color: "#3f3f46",
        },
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: { type: "line" },
        valueFormatter: (value) => {
          const parsed = n(value);
          return Number.isFinite(parsed)
            ? `${parsed.toFixed(1)}${config.unit ? ` ${config.unit}` : ""}`
            : "—";
        },
      },
      xAxis: {
        type: "time",
        min: bounds.min,
        max: bounds.max,
        boundaryGap: false,
        axisLabel: {
          hideOverlap: true,
          formatter: (value) => formatChartTime(value, selectedPeriod),
        },
      },
      yAxis: {
        type: "value",
        name: config.unit,
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: 42,
        min: yMin,
        max: yMax,
        axisLabel: {
          formatter: (value) => Number(value).toFixed(1),
        },
        splitLine: {
          show: true,
          lineStyle: { color: "rgba(148, 163, 184, 0.24)" },
        },
      },
      dataZoom: [
        { type: "inside", filterMode: "none" },
        {
          type: "slider",
          start: 0,
          end: 100,
          bottom: 8,
          height: 20,
          showDetail: false,
        },
      ],
      series,
    };
  }, [bounds.max, bounds.min, config, pairs, selectedPeriod, loadedDate, validValues]);

  if (!validValues.length) {
    return (
      <div className="chartMessage">
        Questo valore non è disponibile nel periodo selezionato perché le
        condizioni necessarie non si sono verificate.
        <style jsx>{`
          .chartMessage {
            min-height: 300px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            font-weight: 800;
            color: rgba(15, 23, 42, 0.6);
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="chartContent">
      <ReactECharts
        option={option}
        style={{ height: 360, width: "100%" }}
        notMerge={true}
        lazyUpdate={true}
      />

      <div className="stressLegend" aria-label="Legenda delle fasce di stress">
        <span className="low">Stress basso</span>
        <span className="moderate">Attenzione</span>
        <span className="high">Stress elevato</span>
        <span className="danger">Condizioni critiche</span>
      </div>

      <style jsx>{`
        .chartContent {
          padding-bottom: 10px;
        }

        .stressLegend {
          display: flex;
          justify-content: center;
          gap: 8px;
          flex-wrap: wrap;
          padding: 0 12px;
        }

        .stressLegend span {
          padding: 5px 9px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 900;
          color: #334155;
          border: 1px solid rgba(148, 163, 184, 0.24);
        }

        .stressLegend .low {
          background: rgba(34, 197, 94, 0.13);
        }

        .stressLegend .moderate {
          background: rgba(234, 179, 8, 0.15);
        }

        .stressLegend .high {
          background: rgba(249, 115, 22, 0.15);
        }

        .stressLegend .danger {
          background: rgba(220, 38, 38, 0.15);
        }
      `}</style>
    </div>
  );
}

export default function Biometeo({ intradayDates = [], latestDate = null }) {
  const [rows, setRows] = useState([]);
  const [loadedDate, setLoadedDate] = useState(latestDate);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nextRefresh, setNextRefresh] = useState("");
  const [selectedIndex, setSelectedIndex] = useState("humidex");
  const [selectedPeriod, setSelectedPeriod] = useState("day");
  const [chartRows, setChartRows] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState("");
  const [historicalReference, setHistoricalReference] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer = null;

    async function loadCurrentData() {
      if (!alive) return;

      setError("");
      const todayISO = currentRomeISO();
      const candidates = Array.from(
        new Set([todayISO, latestDate].filter(Boolean)),
      );

      let loaded = null;
      let resolvedDate = null;
      let lastError = null;

      for (const iso of candidates) {
        try {
          loaded = await fetchIntradayFile(iso, { fresh: true });
          resolvedDate = iso;
          break;
        } catch (fetchError) {
          lastError = fetchError;
        }
      }

      if (!alive) return;

      if (!loaded || !resolvedDate) {
        setRows([]);
        setLoading(false);
        setError(lastError?.message || "Dati intraday non disponibili.");
        return;
      }

      const futureTolerance = 5 * 60 * 1000;
      const now = Date.now();
      const parsedRows = loaded
        .map(enrichRow)
        .filter(isUsableObservation)
        .filter((row) =>
          resolvedDate === todayISO
            ? row.timestamp <= now + futureTolerance
            : true,
        )
        .sort((a, b) => a.timestamp - b.timestamp);

      setRows(parsedRows);
      setLoadedDate(resolvedDate);
      setLoading(false);

      const latest = parsedRows[parsedRows.length - 1];
      if (!latest) {
        setHistoricalReference(null);
        return;
      }

      const historicalDates = historicalDatesForCurrent(
        intradayDates,
        resolvedDate,
      );

      const historicalPoints = await Promise.all(
        historicalDates.map(async (iso) => {
          try {
            const historicalRows = await fetchIntradayFile(iso);
            return nearestHistoricalPoint(historicalRows, latest.timestamp);
          } catch {
            return null;
          }
        }),
      );

      if (!alive) return;

      const validPoints = historicalPoints.filter(Boolean);
      setHistoricalReference({
        years: validPoints.length,
        humidex: averageFinite(validPoints.map((point) => point.humidex)),
        heatIndex: averageFinite(validPoints.map((point) => point.heatIndex)),
        uv: averageFinite(validPoints.map((point) => point.uvValue)),
      });
    }

    function scheduleNext() {
      const delay = msUntilNextRefresh();
      setNextRefresh(nextRefreshLabel());
      timer = window.setTimeout(async () => {
        await loadCurrentData();
        scheduleNext();
      }, delay);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") loadCurrentData();
    }

    loadCurrentData();
    scheduleNext();

    window.addEventListener("focus", loadCurrentData);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      alive = false;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("focus", loadCurrentData);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [intradayDates, latestDate]);

  useEffect(() => {
    let alive = true;

    async function loadChartPeriod() {
      if (!loadedDate) {
        setChartRows([]);
        return;
      }

      if (selectedPeriod === "day") {
        setChartRows(rows);
        setChartLoading(false);
        setChartError("");
        return;
      }

      setChartLoading(true);
      setChartError("");

      const dates = dateRangeISO(
        periodStartISO(loadedDate, selectedPeriod),
        loadedDate,
      );

      const batches = await Promise.all(
        dates.map(async (iso) => {
          if (iso === loadedDate) return rows;

          try {
            const raw = await fetchIntradayFile(iso);
            return raw
              .map(enrichRow)
              .filter(isUsableObservation)
              .sort((a, b) => a.timestamp - b.timestamp);
          } catch {
            return [];
          }
        }),
      );

      if (!alive) return;

      const merged = batches
        .flat()
        .sort((a, b) => a.timestamp - b.timestamp);

      setChartRows(merged);
      setChartLoading(false);
      setChartError(
        merged.length ? "" : "Nessun dato disponibile per il periodo selezionato.",
      );
    }

    loadChartPeriod();

    return () => {
      alive = false;
    };
  }, [loadedDate, rows, selectedPeriod]);

  const latest = rows.length ? rows[rows.length - 1] : null;

  const summary = useMemo(() => {
    const humidexMax = maxFinite(rows.map((row) => row.humidex));
    const heatIndexMax = maxFinite(rows.map((row) => row.heatIndex));
    const windChillMin = minFinite(rows.map((row) => row.windChill));
    const wbgtMax = maxFinite(rows.map((row) => row.wbgtShade));
    const uvMax = maxFinite(rows.map((row) => row.uvValue));
    const discomfortSamples = rows.filter(
      (row) => Number.isFinite(row.humidex) && row.humidex >= 30,
    ).length;

    return {
      humidexMax,
      heatIndexMax,
      windChillMin,
      wbgtMax,
      uvMax,
      discomfortHours: discomfortSamples / 4,
    };
  }, [rows]);

  const cards = latest
    ? [
        {
          title: "Humidex",
          value: fmt(latest.humidex, 1),
          unit: "",
          meta: humidexMeta(latest.humidex),
          source: BIOMETE0_SOURCES.humidex,
        },
        {
          title: "Heat Index",
          value: fmt(latest.heatIndex, 1),
          unit: latest.heatIndex == null ? "" : "°C",
          meta: heatIndexMeta(latest.heatIndex),
          source: BIOMETE0_SOURCES.heatIndex,
        },
        {
          title: "Wind Chill",
          value: fmt(latest.windChill, 1),
          unit: latest.windChill == null ? "" : "°C",
          meta: windChillMeta(latest.windChill),
          source: BIOMETE0_SOURCES.windChill,
        },
        {
          title: "WBGT ombra stimato",
          value: fmt(latest.wbgtShade, 1),
          unit: latest.wbgtShade == null ? "" : "°C",
          meta: wbgtMeta(latest.wbgtShade),
          source: BIOMETE0_SOURCES.wbgt,
        },
        {
          title: "Indice UV",
          value: fmt(latest.uvValue, 1),
          unit: "UV",
          meta: {
            ...uvMeta(latest.uvValue),
            description:
              latest.uvValue >= 3
                ? "Proteggi pelle e occhi: cerca l’ombra, usa abiti adatti e occhiali da sole."
                : "Il livello UV è basso, ma evita comunque esposizioni inutilmente prolungate.",
          },
          source: BIOMETE0_SOURCES.uv,
        },
      ]
    : [];

  const historicalDelta =
    latest && Number.isFinite(latest.humidex) &&
    Number.isFinite(historicalReference?.humidex)
      ? latest.humidex - historicalReference.humidex
      : null;

  return (
    <SiteLayout
      headerProps={{
        title: "Biometeo",
        kicker: "INDICATORI BIOMETEOROLOGICI",
        subtitle:
          "Come caldo, umidità, vento e raggi UV possono influire sul benessere all’aperto.",
        showPeriod: false,
        currentPath: "/biometeo",
      }}
    >
      <main className="pageContent">
        <section className="methodSection topGuide">
          <div className="centeredHead">
            <h2>Cosa indicano questi valori</h2>
            <p>Una guida semplice per capire subito i dati mostrati nella pagina</p>
          </div>

          <div className="methodGrid">
            <article>
              <h3>Humidex</h3>
              <p>
                Dice quanto il caldo sembra più pesante quando l’aria è umida.
                Più sale, più il corpo fatica a disperdere il calore.
              </p>
              <a href={BIOMETE0_SOURCES.humidex.url} target="_blank" rel="noopener noreferrer">
                Definizione ARPAV ↗
              </a>
            </article>
            <article>
              <h3>Heat Index</h3>
              <p>
                Indica la temperatura che il corpo può percepire all’ombra
                combinando caldo e umidità. Non considera il sole diretto.
              </p>
              <a href={BIOMETE0_SOURCES.heatIndex.url} target="_blank" rel="noopener noreferrer">
                Definizione ARPAS ↗
              </a>
            </article>
            <article>
              <h3>Wind Chill</h3>
              <p>
                Mostra quanto il vento fa sentire più freddo rispetto alla
                temperatura reale. Compare soltanto nelle giornate fredde.
              </p>
              <a href={BIOMETE0_SOURCES.windChill.url} target="_blank" rel="noopener noreferrer">
                Definizione ARPAS ↗
              </a>
            </article>
            <article>
              <h3>WBGT ombra stimato</h3>
              <p>
                Stima quanto il caldo può rendere faticosa l’attività fisica.
                Le fasce sono orientative perché il rischio cambia con intensità,
                abbigliamento e abitudine al caldo.
              </p>
              <a href={BIOMETE0_SOURCES.wbgt.url} target="_blank" rel="noopener noreferrer">
                Metodo WBGT CeSNIR ↗
              </a>
            </article>
            <article>
              <h3>Indice UV</h3>
              <p>
                Indica quanto sono forti i raggi ultravioletti che possono
                danneggiare pelle e occhi. Da 3 in su è bene proteggersi.
              </p>
              <a href={BIOMETE0_SOURCES.uv.url} target="_blank" rel="noopener noreferrer">
                Definizione ARPA ↗
              </a>
            </article>
          </div>

          <div className="disclaimer">
            Le definizioni e i criteri generali degli indici sono descritti
            nelle fonti italiane istituzionali e tecnico-scientifiche indicate
            nei link. Il WBGT mostrato qui resta una stima semplificata e le sue
            fasce sono orientative: il rischio reale cambia con attività,
            acclimatazione, abbigliamento e tempo di esposizione. Questi valori
            non sostituiscono indicazioni mediche o professionali.
          </div>
        </section>

        <section className="statusCard">
          <div className="statusHead">
            <div className="statusSpacer" />

            <div className="statusTitle">
              <h2>Condizioni biometeorologiche attuali</h2>
              <p>
                {loadedDate ? formatLongDate(loadedDate) : "Dati in caricamento"}
              </p>
            </div>

            <div className="statusUpdate">
              <span>Ultimo dato</span>
              <strong>{latest ? formatObservationTime(latest.t) : "—"}</strong>
              <small>prossimo controllo {nextRefresh || "—"}</small>
            </div>
          </div>

          {loading && <div className="message">Caricamento dei dati…</div>}
          {!loading && error && <div className="message error">{error}</div>}

          {!loading && !error && latest && (
            <>
              <div className="observationStrip">
                <div>
                  <span>Temperatura</span>
                  <strong>{fmt(latest.temp, 1, " °C")}</strong>
                </div>
                <div>
                  <span>Umidità</span>
                  <strong>{fmt(latest.rh, 0, " %")}</strong>
                </div>
                <div>
                  <span>Vento</span>
                  <strong>{fmt(latest.wind, 1, " km/h")}</strong>
                </div>
                <div>
                  <span>Radiazione</span>
                  <strong>{fmt(latest.solar, 0, " W/m²")}</strong>
                </div>
              </div>

              <div className="metricGrid">
                {cards.map((card) => (
                  <MetricCard key={card.title} {...card} />
                ))}
              </div>
            </>
          )}
        </section>

        {!loading && !error && rows.length > 0 && (
          <section className="summarySection">
            <div className="centeredHead">
              <h2>Riepilogo della giornata</h2>
              <p>Estremi e durata delle condizioni registrate finora</p>
            </div>

            <div className="summaryGrid">
              <SummaryCell
                label="Humidex massimo"
                value={fmt(summary.humidexMax, 1)}
                detail="massimo sui dati disponibili"
              />
              <SummaryCell
                label="Heat Index massimo"
                value={
                  summary.heatIndexMax == null
                    ? "Non attivo"
                    : fmt(summary.heatIndexMax, 1, " °C")
                }
                detail="massimo giornaliero"
              />
              <SummaryCell
                label="WBGT ombra massimo"
                value={
                  summary.wbgtMax == null
                    ? "Non attivo"
                    : fmt(summary.wbgtMax, 1, " °C")
                }
                detail="stima semplificata"
              />
              <SummaryCell
                label="Indice UV massimo"
                value={fmt(summary.uvMax, 1)}
                detail={uvMeta(summary.uvMax).label}
              />
              <SummaryCell
                label="Wind Chill minimo"
                value={
                  summary.windChillMin == null
                    ? "Non attivo"
                    : fmt(summary.windChillMin, 1, " °C")
                }
                detail="minimo giornaliero"
              />
              <SummaryCell
                label="Ore con Humidex ≥30"
                value={fmt(summary.discomfortHours, 1, " h")}
                detail="stima da intervalli di 15 minuti"
              />
              <SummaryCell
                label="Riferimento storico"
                value={
                  historicalDelta == null
                    ? "—"
                    : `${historicalDelta > 0 ? "+" : ""}${historicalDelta.toFixed(1)}`
                }
                detail={
                  historicalReference?.years
                    ? `Humidex vs ${historicalReference.years} anni alla stessa ora`
                    : "nessun anno confrontabile"
                }
              />
            </div>
          </section>
        )}

        {!loading && !error && rows.length > 0 && (
          <section className="chartSection">
            <div className="centeredHead">
              <h2>Andamento biometeorologico</h2>
              <p>
                Scegli il valore e il periodo: lo sfondo passa dal verde al
                rosso quando le condizioni diventano più impegnative
              </p>
            </div>

            <ChartControls
              selectedIndex={selectedIndex}
              onIndexChange={setSelectedIndex}
              selectedPeriod={selectedPeriod}
              onPeriodChange={setSelectedPeriod}
              loading={chartLoading}
            />

            <div className="chartWrap">
              {chartLoading ? (
                <div className="chartLoading">
                  Caricamento dei dati del periodo selezionato…
                </div>
              ) : chartError ? (
                <div className="chartLoading error">{chartError}</div>
              ) : (
                <BiometeoChart
                  rows={chartRows}
                  selectedIndex={selectedIndex}
                  selectedPeriod={selectedPeriod}
                  loadedDate={loadedDate}
                />
              )}
            </div>
          </section>
        )}

      </main>

      <style jsx>{`
        .pageContent {
          margin-top: 18px;
          display: grid;
          gap: 18px;
        }

        .statusCard,
        .summarySection,
        .chartSection,
        .methodSection {
          border: 1px solid #e4e7eb;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 9px 28px rgba(15, 23, 42, 0.055);
          overflow: hidden;
        }

        .statusHead {
          min-height: 88px;
          padding: 15px 18px;
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 16px;
          border-bottom: 1px solid #eef0f2;
          background: linear-gradient(180deg, #ffffff, #fbfcfd);
        }

        .statusTitle {
          grid-column: 2;
          text-align: center;
        }

        .statusTitle h2,
        .centeredHead h2 {
          margin: 0;
          font-size: 21px;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.02em;
        }

        .statusTitle p,
        .centeredHead p {
          margin: 5px 0 0;
          font-size: 11px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.55);
          text-transform: capitalize;
        }

        .statusUpdate {
          grid-column: 3;
          justify-self: end;
          min-width: 156px;
          padding: 9px 12px;
          border: 1px solid #e4e7eb;
          border-radius: 14px;
          background: #fff;
          display: grid;
          gap: 2px;
          text-align: center;
        }

        .statusUpdate span {
          font-size: 8px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.5);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .statusUpdate strong {
          font-size: 17px;
          font-weight: 950;
          color: #0f172a;
        }

        .statusUpdate small {
          font-size: 8.5px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.48);
        }

        .message {
          min-height: 230px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          font-size: 12px;
          font-weight: 850;
          text-align: center;
          color: rgba(15, 23, 42, 0.65);
        }

        .message.error {
          color: #b91c1c;
        }

        .observationStrip {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          border-bottom: 1px solid #eef0f3;
          background: #fbfcfd;
        }

        .observationStrip > div {
          min-width: 0;
          padding: 11px 14px;
          display: grid;
          gap: 3px;
          text-align: center;
          border-right: 1px solid #eef0f3;
        }

        .observationStrip > div:last-child {
          border-right: 0;
        }

        .observationStrip span {
          font-size: 8.5px;
          font-weight: 950;
          color: rgba(15, 23, 42, 0.5);
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }

        .observationStrip strong {
          font-size: 14px;
          font-weight: 950;
          color: #0f172a;
        }

        .metricGrid {
          padding: 16px 18px 18px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
          gap: 12px;
        }

        .summarySection,
        .chartSection,
        .methodSection {
          padding: 17px 18px 18px;
        }

        .centeredHead {
          text-align: center;
          margin-bottom: 13px;
        }

        .summaryGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1px;
          border: 1px solid #e8ebef;
          border-radius: 16px;
          overflow: hidden;
          background: #eef0f3;
        }

        .chartWrap {
          margin-top: 12px;
          border: 1px solid #edf0f3;
          border-radius: 17px;
          background: #fff;
          overflow: hidden;
        }

        .chartLoading {
          min-height: 330px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          text-align: center;
          font-size: 12px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.62);
        }

        .chartLoading.error {
          color: #b91c1c;
        }

        .topGuide {
          order: -1;
        }

        .methodGrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
          gap: 10px;
        }

        .methodGrid article {
          min-width: 0;
          padding: 13px;
          border: 1px solid #e7eaee;
          border-radius: 15px;
          background: #fbfcfd;
        }

        .methodGrid h3 {
          margin: 0;
          font-size: 13px;
          font-weight: 950;
          color: #0f172a;
        }

        .methodGrid p {
          margin: 6px 0 0;
          font-size: 10px;
          line-height: 1.55;
          font-weight: 700;
          color: rgba(15, 23, 42, 0.58);
        }

        .methodGrid a {
          display: inline-block;
          margin-top: 8px;
          font-size: 9px;
          line-height: 1.3;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.58);
          text-decoration: underline;
          text-decoration-color: rgba(15, 23, 42, 0.22);
          text-underline-offset: 3px;
        }

        .methodGrid a:hover,
        .methodGrid a:focus-visible {
          color: #0f172a;
          text-decoration-color: currentColor;
        }

        .disclaimer {
          margin-top: 12px;
          padding: 12px 14px;
          border: 1px solid #e5e7eb;
          border-radius: 14px;
          background: #f8fafc;
          font-size: 10px;
          line-height: 1.55;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.62);
          text-align: center;
        }

        @media (max-width: 1000px) {
          .metricGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .summaryGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .methodGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 680px) {
          .statusCard,
          .summarySection,
          .chartSection,
          .methodSection {
            border-radius: 18px;
          }

          .statusHead {
            grid-template-columns: 1fr;
            padding: 14px 11px;
            gap: 10px;
          }

          .statusSpacer {
            display: none;
          }

          .statusTitle,
          .statusUpdate {
            grid-column: 1;
          }

          .statusUpdate {
            justify-self: center;
            width: min(240px, 100%);
            box-sizing: border-box;
          }

          .statusTitle h2,
          .centeredHead h2 {
            font-size: 18px;
          }

          .observationStrip {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .observationStrip > div:nth-child(2) {
            border-right: 0;
          }

          .observationStrip > div:nth-child(-n + 2) {
            border-bottom: 1px solid #eef0f3;
          }

          .metricGrid {
            padding: 12px 10px 14px;
            grid-template-columns: 1fr;
          }

          .summarySection,
          .chartSection,
          .methodSection {
            padding: 15px 10px 16px;
          }

          .methodGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </SiteLayout>
  );
}