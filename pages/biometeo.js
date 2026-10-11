import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import SiteLayout from "../components/SiteLayout";
import { readDailyLive } from "../lib/liveData";
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
  uv: {
    label: "ARPAS Sardegna – Indice UV",
    shortLabel: "ARPAS",
    url: "https://www.sar.sardegna.it/documentazione/bio/indiceUV.asp",
  },
};
export async function getStaticProps() {
  const dailyRows = await readDailyLive();
  const intradayDates = dailyRows
    .map((row) => String(row?.date || ""))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return {
    props: {
      intradayDates,
      latestDate: intradayDates.length
        ? intradayDates[intradayDates.length - 1]
        : null,
    },
    revalidate: 60,
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
  if (period === "yesterday") return addDaysISO(endISO, -1);
  if (period === "week") return addDaysISO(endISO, -6);
  if (period === "month") return addDaysISO(endISO, -29);
  return endISO;
}
function periodLabel(period) {
  if (period === "yesterday") return "ieri";
  if (period === "week") return "ultimi 7 giorni";
  if (period === "month") return "ultimi 30 giorni";
  return "oggi";
}
function chartTimeBounds(endISO, period) {
  const start = dateFromISO(periodStartISO(endISO, period));
  const end = dateFromISO(
    period === "yesterday" ? endISO : addDaysISO(endISO, 1),
  );
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
  if (simple < 80) {
    return round1(((simple - 32) * 5) / 9);
  }
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
  if (!Number.isFinite(temp) || !Number.isFinite(wind) || wind <= 0) return null;
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
function humidexMeta(value) {
  const v = n(value);
  if (!Number.isFinite(v)) {
    return {
      label: "Dato non disponibile",
      description:
        "Il calcolo richiede temperatura e punto di rugiada validi.",
      tone: "neutral",
    };
  }
  if (v < 27) {
    return {
      label: "Disagio assente",
      description: "Non sono indicate condizioni rilevanti di disagio da caldo umido.",
      tone: "good",
    };
  }
  if (v < 30) {
    return {
      label: "Disagio debole",
      description: "Il caldo umido inizia a essere percepibile dalle persone più sensibili.",
      tone: "watch",
    };
  }
  if (v < 35) {
    return {
      label: "Disagio debole/moderato",
      description:
        "Il caldo può iniziare ad affaticare durante attività prolungate. Fai pause e bevi regolarmente.",
      tone: "watch",
    };
  }
  if (v < 40) {
    return {
      label: "Disagio moderato/intenso",
      description:
        "Riduci gli sforzi prolungati, cerca l’ombra e bevi regolarmente.",
      tone: "high",
    };
  }
  if (v < 45) {
    return {
      label: "Disagio intenso",
      description:
        "Evita gli sforzi non necessari e cerca un ambiente più fresco.",
      tone: "danger",
    };
  }
  return {
    label: "Disagio molto intenso",
    description:
      "Condizioni molto impegnative. Riduci al minimo gli sforzi e resta in un ambiente fresco.",
    tone: "danger",
  };
}
function heatIndexMeta(value) {
  const v = n(value);
  if (!Number.isFinite(v)) {
    return {
      label: "Dato non disponibile",
      description: "Il calcolo richiede temperatura e umidità relativa valide.",
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
      label: "Dato non disponibile",
      description: "Il calcolo richiede temperatura e raffica di vento valide.",
      tone: "neutral",
    };
  }
  if (v >= 20) {
    return {
      label: "Effetto minimo",
      description: "La raffica modifica poco la sensazione termica rispetto alla temperatura osservata.",
      tone: "good",
    };
  }
  if (v >= 10) {
    return {
      label: "Raffreddamento lieve",
      description: "La raffica rende la temperatura percepita leggermente più bassa.",
      tone: "cool",
    };
  }
  if (v >= 0) {
    return {
      label: "Raffreddamento moderato",
      description: "La raffica accentua in modo sensibile la perdita di calore corporeo.",
      tone: "watch",
    };
  }
  if (v >= -27) {
    return {
      label: "Freddo intenso",
      description: "La combinazione tra temperatura e raffica produce una sensazione di freddo marcata.",
      tone: "high",
    };
  }
  return {
    label: "Rischio elevato",
    description: "La combinazione tra freddo e raffiche può diventare pericolosa per esposizioni prolungate.",
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
function enrichRow(row) {
  const date = parseLocalTimestamp(row?.t);
  if (!date) return null;
  const temp = n(row?.temp_c);
  const dewpoint = n(row?.dewpoint_c);
  const rh = n(row?.rh_pct);
  const wind = n(row?.wind_kmh);
  const gustCandidates = [
    row?.wind_gust_kmh,
    row?.gust_kmh,
    row?.windgust_kmh,
    row?.gust,
    row?.wind_gust,
  ].map(n);
  const gust = gustCandidates.find((value) => Number.isFinite(value));
  const uv = n(row?.uv);
  const solar = n(row?.solar_wm2);
  const windForChill = Number.isFinite(gust) ? gust : wind;
  return {
    ...row,
    timestamp: date.getTime(),
    temp: Number.isFinite(temp) ? temp : null,
    dewpoint: Number.isFinite(dewpoint) ? dewpoint : null,
    rh: Number.isFinite(rh) ? rh : null,
    wind: Number.isFinite(wind) ? wind : null,
    gust: Number.isFinite(gust) ? gust : null,
    uvValue: Number.isFinite(uv) ? uv : null,
    solar: Number.isFinite(solar) ? solar : null,
    humidex: calculateHumidex(temp, dewpoint),
    heatIndex: calculateHeatIndex(temp, rh),
    windChill: calculateWindChill(temp, windForChill),
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
async function fetchIntradayFile(iso, { fresh = false } = {}) {
  if (!iso) throw new Error("Data intraday non valida.");
  if (!fresh && HISTORICAL_CACHE.has(iso)) {
    return HISTORICAL_CACHE.get(iso);
  }
  const query = `?v=${Date.now()}`;
  const response = await fetch(
    `https://raw.githubusercontent.com/max-collinas1/climate-collinas1/main/public/data/intraday/${encodeURIComponent(iso)}.json${query}`,
    {
      cache: "no-store",
    },
  );
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
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function latestDelta(currentValue, previousValue) {
  const current = n(currentValue);
  const previous = n(previousValue);
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  return current - previous;
}
function signedValue(value, decimals = 1, suffix = "") {
  const parsed = n(value);
  if (!Number.isFinite(parsed)) return "—";
  const sign = parsed > 0 ? "+" : parsed < 0 ? "-" : "";
  return `${sign}${Math.abs(parsed).toFixed(decimals)}${suffix}`;
}
function deltaTone(value) {
  const parsed = n(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "steady";
  return parsed > 0 ? "up" : "down";
}
function scalePercent(value, min, max) {
  const parsed = n(value);
  if (!Number.isFinite(parsed)) return null;
  if (max <= min) return 0;
  return ((clamp(parsed, min, max) - min) / (max - min)) * 100;
}
function indexScaleSettings(key) {
  if (key === "humidex") {
    return {
      gradient:
        "linear-gradient(90deg, #4ade80 0%, #84cc16 18%, #facc15 42%, #fb923c 70%, #ef4444 100%)",
      ticks: [
        { value: 20, label: "20" },
        { value: 30, label: "30" },
        { value: 35, label: "35" },
        { value: 40, label: "40" },
        { value: 45, label: "45+" },
      ],
    };
  }
  if (key === "heatIndex") {
    return {
      gradient:
        "linear-gradient(90deg, #4ade80 0%, #a3e635 12%, #facc15 30%, #fb923c 58%, #ef4444 100%)",
      ticks: [
        { value: 27, label: "27" },
        { value: 32.2, label: "32" },
        { value: 39.4, label: "39" },
        { value: 51.7, label: "52+" },
      ],
    };
  }
  if (key === "windChill") {
    return {
      gradient:
        "linear-gradient(90deg, #38bdf8 0%, #60a5fa 20%, #4ade80 46%, #facc15 72%, #ef4444 100%)",
      ticks: [
        { value: -20, label: "-20" },
        { value: 0, label: "0" },
        { value: 10, label: "10" },
        { value: 20, label: "20" },
        { value: 40, label: "40" },
      ],
    };
  }
  return {
    gradient:
      "linear-gradient(90deg, #4ade80 0%, #a3e635 26%, #facc15 50%, #fb923c 74%, #ef4444 100%)",
    ticks: [
      { value: 0, label: "0" },
      { value: 3, label: "3" },
      { value: 6, label: "6" },
      { value: 8, label: "8" },
      { value: 11, label: "11+" },
    ],
  };
}
function findExtreme(rows, accessor, mode = "max") {
  let best = null;
  for (const row of rows) {
    const raw = typeof accessor === "function" ? accessor(row) : row?.[accessor];
    const value = n(raw);
    if (!Number.isFinite(value)) continue;
    if (!best) {
      best = { row, value };
      continue;
    }
    if (mode === "max" ? value > best.value : value < best.value) {
      best = { row, value };
    }
  }
  return best;
}
function IconBadge({ text, tone = "neutral", large = false }) {
  return (
    <span className={`iconBadge ${tone} ${large ? "large" : ""}`}>
      {text}
      <style jsx>{`
        .iconBadge {
          width: 42px;
          height: 42px;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 950;
          letter-spacing: -0.02em;
          border: 1px solid transparent;
          flex-shrink: 0;
        }
        .iconBadge.large {
          width: 54px;
          height: 54px;
          border-radius: 16px;
          font-size: 18px;
        }
        @media (max-width: 760px) {
          .iconBadge {
            width: 34px;
            height: 34px;
            border-radius: 11px;
            font-size: 11px;
          }
          .iconBadge.large {
            width: 40px;
            height: 40px;
            border-radius: 12px;
            font-size: 14px;
          }
        }
        .iconBadge.neutral {
          background: #eef2ff;
          color: #1d4ed8;
          border-color: #dbeafe;
        }
        .iconBadge.warm {
          background: #fff7ed;
          color: #ea580c;
          border-color: #fed7aa;
        }
        .iconBadge.hot {
          background: #fff1f2;
          color: #e11d48;
          border-color: #fecdd3;
        }
        .iconBadge.cool {
          background: #eff6ff;
          color: #2563eb;
          border-color: #bfdbfe;
        }
        .iconBadge.sun {
          background: #fffbeb;
          color: #d97706;
          border-color: #fde68a;
        }
      `}</style>
    </span>
  );
}
function InfoMetric({ icon, iconTone, title, value, detail, delta, decimals = 1, suffix = "" }) {
  const tone = deltaTone(delta);
  return (
    <div className="infoMetric">
      <div className="metricLead">
        <IconBadge text={icon} tone={iconTone} />
        <div>
          <span>{title}</span>
          <strong>{value}</strong>
        </div>
      </div>
      <div className={`metricDelta ${tone}`}>
        <em>{signedValue(delta, decimals, suffix)}</em>
        <small>{detail}</small>
      </div>
      <style jsx>{`
        .infoMetric {
          min-width: 0;
          padding: 0 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .metricLead {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .metricLead > div {
          min-width: 0;
          display: grid;
          gap: 3px;
        }
        span {
          font-size: 12px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.56);
        }
        strong {
          font-size: 18px;
          line-height: 1;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.02em;
        }
        .metricDelta {
          display: grid;
          gap: 2px;
          justify-items: end;
          text-align: right;
          min-width: 78px;
        }
        em {
          font-style: normal;
          font-size: 13px;
          font-weight: 950;
        }
        small {
          font-size: 10px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.45);
        }
        .metricDelta.up em {
          color: #dc2626;
        }
        .metricDelta.down em {
          color: #16a34a;
        }
        .metricDelta.steady em {
          color: #64748b;
        }
      `}</style>
    </div>
  );
}
function StatusPill({ tone = "neutral", children }) {
  return (
    <span className={`statusPill ${tone}`}>
      {children}
      <style jsx>{`
        .statusPill {
          width: fit-content;
          min-height: 34px;
          padding: 7px 14px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 900;
          line-height: 1;
        }
        .statusPill.good {
          background: #dcfce7;
          color: #166534;
        }
        .statusPill.watch {
          background: #fef3c7;
          color: #92400e;
        }
        .statusPill.high {
          background: #fed7aa;
          color: #9a3412;
        }
        .statusPill.danger {
          background: #fee2e2;
          color: #991b1b;
        }
        .statusPill.cool {
          background: #dbeafe;
          color: #1d4ed8;
        }
        .statusPill.neutral {
          background: #e2e8f0;
          color: #334155;
        }
        @media (max-width: 760px) {
          .statusPill {
            min-height: 26px;
            padding: 5px 10px;
            font-size: 11px;
          }
        }
      `}</style>
    </span>
  );
}
function BiometeoIndexRow({
  icon,
  iconTone,
  title,
  subtitle,
  value,
  unit,
  meta,
  configKey,
  config,
}) {
  const settings = indexScaleSettings(configKey);
  const marker = scalePercent(value, config.axisMin, config.axisMax);
  const showValue = Number.isFinite(n(value));
  return (
    <article className={`indexRow ${meta?.tone || "neutral"}`}>
      <div className="indexInfo">
        <IconBadge text={icon} tone={iconTone} />
        <div className="indexInfoText">
          <div className="indexTopLine">
            <h3>{title}</h3>
            <div className="valueInline">
              <strong>{showValue ? fmt(value, 1) : "—"}</strong>
              {showValue && unit ? <span>{unit}</span> : null}
            </div>
          </div>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="indexStatus">
        <StatusPill tone={meta?.tone || "neutral"}>{meta?.label || "Dato non disponibile"}</StatusPill>
        <p>{meta?.description || "Dato non disponibile per le condizioni attuali."}</p>
      </div>
      <div className="indexScaleWrap">
        <div className="indexScaleFrame">
          <div className="indexScale" style={{ backgroundImage: settings.gradient }}>
            {marker != null ? <span className="indexMarker" style={{ left: `${marker}%` }} /> : null}
          </div>
          <div className="indexTicks">
            {settings.ticks.map((tick, index) => (
              <span
                key={`${configKey}-${tick.label}`}
                className={index === 0 ? "first" : index === settings.ticks.length - 1 ? "last" : "mid"}
                style={{ left: `${scalePercent(tick.value, config.axisMin, config.axisMax) ?? 0}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <style jsx>{`
        .indexRow {
          min-width: 0;
          padding: 18px;
          border: 1px solid #e6ebf0;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.045);
          display: grid;
          grid-template-columns: minmax(280px, 1.2fr) minmax(250px, 0.95fr) minmax(320px, 1fr);
          align-items: center;
          gap: 18px;
        }
        .indexInfo {
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .indexInfoText {
          min-width: 0;
          flex: 1;
          display: grid;
          gap: 6px;
        }
        .indexTopLine {
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }
        h3 {
          margin: 0;
          font-size: 18px;
          line-height: 1.05;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.02em;
        }
        .valueInline {
          min-width: 118px;
          display: inline-flex;
          align-items: baseline;
          justify-content: flex-end;
          gap: 6px;
          flex-shrink: 0;
        }
        .valueInline strong {
          font-size: 28px;
          line-height: 1;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.04em;
        }
        .valueInline span {
          font-size: 14px;
          line-height: 1;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.62);
        }
        .indexInfo p {
          margin: 0;
          font-size: 12px;
          line-height: 1.45;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.54);
        }
        .indexStatus {
          min-width: 0;
          min-height: 72px;
          padding-left: 18px;
          border-left: 1px solid #edf1f4;
          display: grid;
          align-content: center;
          gap: 8px;
        }
        .indexStatus p {
          margin: 0;
          font-size: 12px;
          line-height: 1.45;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.58);
        }
        .indexScaleWrap {
          min-width: 0;
        }
        .indexScaleFrame {
          padding: 0 8px;
          display: grid;
          gap: 10px;
        }
        .indexScale {
          position: relative;
          height: 22px;
          border-radius: 999px;
          overflow: hidden;
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
        }
        .indexMarker {
          position: absolute;
          top: 50%;
          width: 20px;
          height: 20px;
          border-radius: 999px;
          transform: translate(-50%, -50%);
          background: #0f172a;
          border: 3px solid rgba(255, 255, 255, 0.95);
          box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18);
        }
        .indexTicks {
          position: relative;
          height: 18px;
        }
        .indexTicks span {
          position: absolute;
          font-size: 10px;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.62);
          white-space: nowrap;
          line-height: 1;
        }
        .indexTicks span.mid {
          transform: translateX(-50%);
        }
        .indexTicks span.first {
          transform: translateX(0);
        }
        .indexTicks span.last {
          transform: translateX(-100%);
        }
        @media (max-width: 1280px) {
          .indexRow {
            grid-template-columns: 1fr;
            gap: 14px;
          }
          .indexStatus {
            min-height: 0;
            padding-left: 0;
            border-left: 0;
            border-top: 1px solid #edf1f4;
            padding-top: 14px;
          }
        }
        @media (max-width: 760px) {
          .indexRow {
            padding: 10px;
            gap: 8px;
            border-radius: 18px;
          }
          .indexInfo {
            gap: 10px;
          }
          .indexInfoText {
            gap: 3px;
          }
          .indexTopLine {
            align-items: baseline;
            flex-direction: row;
            gap: 8px;
          }
          h3 {
            font-size: 16px;
          }
          .valueInline {
            min-width: 0;
            justify-content: flex-end;
            gap: 4px;
          }
          .valueInline strong {
            font-size: 22px;
          }
          .valueInline span {
            font-size: 11px;
          }
          .indexInfo p {
            font-size: 10px;
            line-height: 1.25;
          }
          .indexStatus {
            padding-top: 8px;
            gap: 5px;
          }
          .indexStatus p {
            font-size: 10px;
            line-height: 1.3;
          }
          .indexScaleFrame {
            padding: 0;
            gap: 6px;
          }
          .indexScale {
            height: 16px;
          }
          .indexMarker {
            width: 16px;
            height: 16px;
            border-width: 2px;
          }
          .indexTicks {
            height: 12px;
          }
          .indexTicks span {
            font-size: 8px;
          }
        }
      `}</style>
    </article>
  );
}
function DailyRecapItem({ title, value, detail }) {
  return (
    <div className="dailyRecapItem">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <style jsx>{`
        .dailyRecapItem {
          min-width: 0;
          padding: 0 16px;
          display: grid;
          gap: 4px;
          align-content: center;
          border-left: 1px solid #edf1f4;
        }
        .dailyRecapItem:first-child {
          border-left: 0;
        }
        span {
          font-size: 11px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.54);
        }
        strong {
          font-size: 17px;
          line-height: 1;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.02em;
        }
        small {
          font-size: 10px;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.47);
        }
        @media (max-width: 760px) {
          .dailyRecapItem {
            padding: 12px 0;
            border-left: 0;
            border-top: 1px solid #edf1f4;
          }
          .dailyRecapItem:first-child {
            border-top: 0;
          }
        }
      `}</style>
    </div>
  );
}
function GuideCard({ icon, iconTone, title, description, source }) {
  return (
    <article className="guideCard">
      <div className="guideHead">
        <IconBadge text={icon} tone={iconTone} />
        <h3>{title}</h3>
      </div>
      <p>{description}</p>
      <a href={source.url} target="_blank" rel="noopener noreferrer">
        Approfondisci ↗
      </a>
      <style jsx>{`
        .guideCard {
          min-width: 0;
          padding: 16px;
          border: 1px solid #e8edf2;
          border-radius: 18px;
          background: #fbfdff;
          display: grid;
          gap: 12px;
        }
        .guideHead {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        h3 {
          margin: 0;
          font-size: 17px;
          font-weight: 950;
          color: #0f172a;
          letter-spacing: -0.02em;
        }
        p {
          margin: 0;
          font-size: 12px;
          line-height: 1.55;
          font-weight: 750;
          color: rgba(15, 23, 42, 0.58);
        }
        a {
          width: fit-content;
          font-size: 12px;
          font-weight: 900;
          color: #2563eb;
          text-decoration: none;
        }
        @media (max-width: 760px) {
          .guideCard {
            padding: 10px 11px;
            border-radius: 15px;
            gap: 7px;
          }
          .guideHead {
            gap: 9px;
          }
          h3 {
            font-size: 15px;
          }
          p {
            font-size: 10px;
            line-height: 1.35;
          }
          a {
            font-size: 10px;
          }
        }
      `}</style>
    </article>
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
    { key: "windChill", label: "Wind Chill" },
    { key: "uvValue", label: "Indice UV" },
  ];
  const periodOptions = [
    { key: "day", label: "Oggi" },
    { key: "yesterday", label: "Ieri" },
    { key: "week", label: "Ultimi 7 giorni" },
    { key: "month", label: "Ultimi 30 giorni" },
  ];
  return (
    <div className="chartControls">
      <label>
        <span>Indice selezionato</span>
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
            gap: 8px;
          }
          label {
            min-width: 0;
            width: 100%;
            gap: 4px;
          }
          span {
            font-size: 8px;
          }
          select {
            min-height: 36px;
            border-radius: 11px;
            padding-top: 7px;
            padding-bottom: 7px;
            font-size: 11px;
          }
        }
      `}</style>
    </div>
  );
}
function makeBiometeoToolbox({ filename, isMobile, onSave }) {
  return {
    feature: {
      restore: { title: "Ripristina" },
      mySaveAsImage: {
        show: true,
        title: "Salva grafico",
        icon: "path://M512 96c17.7 0 32 14.3 32 32v448.6l137.4-137.3c12.5-12.5 32.8-12.5 45.3 0s12.5 32.8 0 45.3l-192 192c-12.5 12.5-32.8 12.5-45.3 0l-192-192c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0L480 576.6V128c0-17.7 14.3-32 32-32zM192 768c0-17.7 14.3-32 32-32h576c17.7 0 32 14.3 32 32v96c0 17.7-14.3 32-32 32H224c-17.7 0-32-14.3-32-32v-96z",
        onclick: onSave,
      },
    },
    left: isMobile ? 6 : 10,
    top: isMobile ? 4 : 6,
    itemSize: isMobile ? 14 : 17,
    itemGap: isMobile ? 7 : 9,
    iconStyle: {
      borderColor: "#64748b",
      borderWidth: 1.3,
    },
    emphasis: {
      iconStyle: {
        borderColor: "#2563eb",
      },
    },
  };
}
function biometeoChartConfig(selectedIndex) {
  return {
    humidex: {
      title: "Indice Humidex",
      unit: "°C",
      name: "Humidex",
      axisMin: 20,
      axisMax: 50,
      bands: [
        { from: -50, to: 27, label: "Disagio assente", color: "rgba(187, 247, 208, 0.45)" },
        { from: 27, to: 30, label: "Disagio debole", color: "rgba(253, 230, 138, 0.4)" },
        { from: 30, to: 35, label: "Debole/moderato", color: "rgba(252, 211, 77, 0.33)" },
        { from: 35, to: 40, label: "Moderato/intenso", color: "rgba(253, 186, 116, 0.36)" },
        { from: 40, to: 45, label: "Disagio intenso", color: "rgba(252, 165, 165, 0.34)" },
        { from: 45, to: 70, label: "Molto intenso", color: "rgba(254, 202, 202, 0.42)" },
      ],
    },
    heatIndex: {
      title: "Indice Heat Index",
      unit: "°C",
      name: "Heat Index",
      axisMin: 25,
      axisMax: 55,
      bands: [
        { from: 25, to: 27, label: "Stress contenuto", color: "rgba(187, 247, 208, 0.45)" },
        { from: 27, to: 32.2, label: "Attenzione", color: "rgba(253, 230, 138, 0.42)" },
        { from: 32.2, to: 39.4, label: "Attenzione elevata", color: "rgba(253, 186, 116, 0.38)" },
        { from: 39.4, to: 51.7, label: "Pericolo", color: "rgba(252, 165, 165, 0.36)" },
        { from: 51.7, to: 60, label: "Pericolo estremo", color: "rgba(254, 202, 202, 0.44)" },
      ],
    },
    windChill: {
      title: "Indice Windchill",
      unit: "°C",
      name: "Wind Chill",
      axisMin: -20,
      axisMax: 40,
      bands: [
        { from: -20, to: 0, label: "Freddo intenso", color: "rgba(191, 219, 254, 0.55)" },
        { from: 0, to: 10, label: "Raffreddamento moderato", color: "rgba(186, 230, 253, 0.45)" },
        { from: 10, to: 20, label: "Raffreddamento lieve", color: "rgba(187, 247, 208, 0.38)" },
        { from: 20, to: 30, label: "Effetto lieve", color: "rgba(253, 230, 138, 0.34)" },
        { from: 30, to: 40, label: "Effetto minimo", color: "rgba(254, 215, 170, 0.3)" },
      ],
    },
    uvValue: {
      title: "Indice UV",
      unit: "UV",
      name: "UV",
      axisMin: 0,
      axisMax: 12,
      bands: [
        { from: 0, to: 3, label: "Basso", color: "rgba(187, 247, 208, 0.45)" },
        { from: 3, to: 6, label: "Moderato", color: "rgba(253, 230, 138, 0.42)" },
        { from: 6, to: 8, label: "Alto", color: "rgba(253, 186, 116, 0.38)" },
        { from: 8, to: 11, label: "Molto alto", color: "rgba(252, 165, 165, 0.36)" },
        { from: 11, to: 16, label: "Estremo", color: "rgba(254, 202, 202, 0.44)" },
      ],
    },
  }[selectedIndex];
}
function BiometeoChart({ rows, selectedIndex, selectedPeriod, loadedDate }) {
  const chartRef = useRef(null);
  const config = biometeoChartConfig(selectedIndex);
  const pairs = rows.map((row) => [row.timestamp, row[selectedIndex]]);
  const validValues = pairs
    .map((point) => n(point[1]))
    .filter(Number.isFinite);
  const bounds = chartTimeBounds(loadedDate, selectedPeriod);
  const isMobile = typeof window !== "undefined" ? window.innerWidth <= 680 : false;
  const latestPointForExport = [...pairs]
    .reverse()
    .find((point) => Number.isFinite(n(point?.[1])));
  const saveChartImage = () => {
    const instance = chartRef.current?.getEchartsInstance?.();
    if (!instance) return;
    const hasLatestPoint =
      selectedPeriod === "day" &&
      loadedDate === currentRomeISO() &&
      latestPointForExport;
    if (hasLatestPoint) {
      instance.setOption({
        series: [
          {
            id: "latestPoint",
            data: [],
          },
        ],
      });
    }
    window.requestAnimationFrame(() => {
      const dataUrl = instance.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        excludeComponents: ["toolbox"],
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `meteo-collinas-${selectedIndex}-${selectedPeriod}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      if (hasLatestPoint) {
        instance.setOption({
          series: [
            {
              id: "latestPoint",
              data: [latestPointForExport],
            },
          ],
        });
      }
    });
  };
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
            color: isMobile ? "rgba(51, 65, 85, 0.62)" : "rgba(51, 65, 85, 0.88)",
            fontSize: isMobile ? 8 : 10,
            fontWeight: 800,
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
        lineStyle: { width: 2.8, color: "#1e293b" },
        itemStyle: { color: "#1e293b" },
        areaStyle: { opacity: 0.05, color: "rgba(59, 130, 246, 0.18)" },
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
        id: "latestPoint",
        name: "Ultimo dato",
        type: "effectScatter",
        data: [latestPoint],
        symbol: "circle",
        symbolSize: 7,
        showEffectOn: "render",
        rippleEffect: {
          brushType: "stroke",
          scale: 3,
          period: 1.8,
          number: 2,
        },
        itemStyle: {
          color: "#ef4444",
          borderColor: "#ffffff",
          borderWidth: 2,
          shadowBlur: 7,
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
      grid: isMobile
        ? { left: 38, right: 10, top: 42, bottom: 32 }
        : { left: 64, right: 34, top: 56, bottom: 52 },
      title: {
        text: `${config.title} – ${periodLabel(selectedPeriod)}`,
        left: "center",
        top: isMobile ? 8 : 10,
        textStyle: {
          fontSize: isMobile ? 12 : 18,
          fontWeight: 800,
          color: isMobile ? "rgba(15, 23, 42, 0.76)" : "#0f172a",
        },
      },
      toolbox: makeBiometeoToolbox({
        filename: `meteo-collinas-${selectedIndex}-${selectedPeriod}`,
        isMobile,
        onSave: saveChartImage,
      }),
      tooltip: {
        trigger: "axis",
        confine: true,
        axisPointer: { type: "line", lineStyle: { color: "rgba(51, 65, 85, 0.35)" } },
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
        axisLine: {
          lineStyle: { color: "rgba(148, 163, 184, 0.45)" },
        },
        axisTick: { show: false },
        axisLabel: {
          hideOverlap: true,
          color: isMobile ? "rgba(71, 85, 105, 0.66)" : "#64748b",
          fontSize: isMobile ? 9 : 11,
          formatter: (value) => formatChartTime(value, selectedPeriod),
        },
      },
      yAxis: {
        type: "value",
        name: config.unit,
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: isMobile ? 22 : 42,
        nameTextStyle: {
          color: isMobile ? "rgba(71, 85, 105, 0.66)" : "#64748b",
          fontSize: isMobile ? 9 : 12,
          fontWeight: 700,
        },
        min: yMin,
        max: yMax,
        axisLine: {
          show: false,
        },
        axisTick: { show: false },
        axisLabel: {
          color: isMobile ? "rgba(71, 85, 105, 0.66)" : "#64748b",
          fontSize: isMobile ? 9 : 11,
          formatter: (value) => Number(value).toFixed(1),
        },
        splitLine: {
          show: true,
          lineStyle: { color: "rgba(148, 163, 184, 0.34)" },
        },
      },
      series,
    };
  }, [bounds.max, bounds.min, config, isMobile, pairs, selectedPeriod, loadedDate, validValues, latestPointForExport]);
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
      <div className="chartCanvas">
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ height: "100%", width: "100%" }}
          notMerge={true}
          lazyUpdate={true}
        />
      </div>
      <style jsx>{`
        .chartCanvas {
          height: 350px;
        }
        @media (max-width: 680px) {
          .chartCanvas {
            height: 220px;
          }
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
  const [selectedIndex, setSelectedIndex] = useState("humidex");
  const [selectedPeriod, setSelectedPeriod] = useState("day");
  const [chartRows, setChartRows] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState("");
  useEffect(() => {
    let alive = true;
    let timer = null;
    async function loadCurrentData() {
      if (!alive) return;
      setError("");
      const todayISO = currentRomeISO();
      const candidates = Array.from(new Set([todayISO, latestDate].filter(Boolean)));
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
          resolvedDate === todayISO ? row.timestamp <= now + futureTolerance : true,
        )
        .sort((a, b) => a.timestamp - b.timestamp);
      setRows(parsedRows);
      setLoadedDate(resolvedDate);
      setLoading(false);
    }
    function scheduleNext() {
      const delay = msUntilNextRefresh();
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
      if (selectedPeriod === "yesterday") {
        const yesterdayISO = addDaysISO(loadedDate, -1);
        try {
          const raw = await fetchIntradayFile(yesterdayISO);
          const parsed = raw
            .map(enrichRow)
            .filter(isUsableObservation)
            .sort((a, b) => a.timestamp - b.timestamp);
          if (!alive) return;
          setChartRows(parsed);
          setChartLoading(false);
          setChartError(parsed.length ? "" : "Nessun dato disponibile per la giornata di ieri.");
        } catch {
          if (!alive) return;
          setChartRows([]);
          setChartLoading(false);
          setChartError("I dati della giornata di ieri non sono disponibili.");
        }
        return;
      }
      const dates = dateRangeISO(periodStartISO(loadedDate, selectedPeriod), loadedDate);
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
      const merged = batches.flat().sort((a, b) => a.timestamp - b.timestamp);
      setChartRows(merged);
      setChartLoading(false);
      setChartError(merged.length ? "" : "Nessun dato disponibile per il periodo selezionato.");
    }
    loadChartPeriod();
    return () => {
      alive = false;
    };
  }, [loadedDate, rows, selectedPeriod]);
  const latest = rows.length ? rows[rows.length - 1] : null;
  const currentMeta = useMemo(() => {
    if (!latest) return null;
    return {
      humidex: humidexMeta(latest.humidex),
      heatIndex: heatIndexMeta(latest.heatIndex),
      windChill: windChillMeta(latest.windChill),
      uv: {
        ...uvMeta(latest.uvValue),
        description:
          latest.uvValue >= 3
            ? "Protezione consigliata nelle ore centrali della giornata."
            : "Livello basso, ma evita esposizioni prolungate se non necessarie.",
      },
    };
  }, [latest]);
  const indexRows = latest && currentMeta
    ? [
        {
          icon: "H",
          iconTone: "warm",
          title: "Humidex",
          subtitle: "Indice di disagio dovuto a caldo e umidità",
          value: latest.humidex,
          unit: "°C",
          meta: currentMeta.humidex,
          configKey: "humidex",
          config: biometeoChartConfig("humidex"),
        },
        {
          icon: "HI",
          iconTone: "hot",
          title: "Heat Index",
          subtitle: "Indice di calore percepito",
          value: latest.heatIndex,
          unit: "°C",
          meta: currentMeta.heatIndex,
          configKey: "heatIndex",
          config: biometeoChartConfig("heatIndex"),
        },
        {
          icon: "WC",
          iconTone: "cool",
          title: "Wind Chill",
          subtitle: "Indice di raffreddamento da vento",
          value: latest.windChill,
          unit: "°C",
          meta: currentMeta.windChill,
          configKey: "windChill",
          config: biometeoChartConfig("windChill"),
        },
        {
          icon: "UV",
          iconTone: "sun",
          title: "Indice UV",
          subtitle: "Rischio di esposizione ai raggi ultravioletti",
          value: latest.uvValue,
          unit: "UV",
          meta: currentMeta.uv,
          configKey: "uvValue",
          config: biometeoChartConfig("uvValue"),
        },
      ]
    : [];
  return (
    <SiteLayout
      headerProps={{
        title: "Biometeo",
        kicker: "INDICATORI BIOMETEOROLOGICI",
        subtitle:
          "Questa pagina raccoglie gli indici biometeorologici calcolati in tempo reale dalla stazione di Collinas. Puoi confrontare Humidex, Heat Index, Wind Chill e Indice UV e seguirne l’andamento nel corso della giornata o dei periodi recenti.",
        showPeriod: false,
        currentPath: "/biometeo",
      }}
    >
      <main className="pageContent">
        {!loading && !error && latest ? (
          <section className="indexListSection">
            <div className="indexList">
              {indexRows.map((item) => (
                <BiometeoIndexRow key={item.title} {...item} />
              ))}
            </div>
          </section>
        ) : null}
        {!loading && !error && rows.length > 0 ? (
          <section className="chartShell">
            <div className="chartControlsWrap">
              <ChartControls
                selectedIndex={selectedIndex}
                onIndexChange={setSelectedIndex}
                selectedPeriod={selectedPeriod}
                onPeriodChange={setSelectedPeriod}
                loading={chartLoading}
              />
            </div>
            <div className="chartPanel">
              {chartLoading ? (
                <div className="chartLoading">Caricamento dei dati del periodo selezionato…</div>
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
        ) : null}
        <section className="guideSection">
          <div className="sectionHead centered">
            <h2>Come leggere gli indici</h2>
          </div>
          <div className="guideGrid">
            <GuideCard
              icon="H"
              iconTone="warm"
              title="Humidex"
              description="Combina temperatura e umidità per stimare il disagio da caldo nelle attività all’aperto."
              source={BIOMETE0_SOURCES.humidex}
            />
            <GuideCard
              icon="HI"
              iconTone="hot"
              title="Heat Index"
              description="Indica quanto il caldo può essere percepito dal corpo umano in presenza di umidità elevata."
              source={BIOMETE0_SOURCES.heatIndex}
            />
            <GuideCard
              icon="WC"
              iconTone="cool"
              title="Wind Chill"
              description="Stima la sensazione termica usando la temperatura dell’aria e le raffiche di vento disponibili."
              source={BIOMETE0_SOURCES.windChill}
            />
            <GuideCard
              icon="UV"
              iconTone="sun"
              title="Indice UV"
              description="Misura l’intensità della radiazione ultravioletta e aiuta a valutare il livello di protezione necessario."
              source={BIOMETE0_SOURCES.uv}
            />
          </div>
        </section>
      </main>
      <style jsx>{`
        .pageContent {
          margin-top: 18px;
          display: grid;
          gap: 18px;
        }
        .indexListSection,
        .chartShell,
        .guideSection {
          border: 1px solid #e5ebf0;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.97);
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.05);
          overflow: hidden;
        }
        .indexListSection {
          padding: 14px;
        }
        .indexList {
          display: grid;
          gap: 12px;
        }
        .chartShell {
          padding: 18px;
          display: grid;
          gap: 14px;
        }
        .chartControlsWrap {
          padding: 2px 0 0;
        }
        .chartPanel {
          border: 1px solid #ebf0f4;
          border-radius: 20px;
          background: #ffffff;
          overflow: hidden;
        }
        .chartLoading,
        .message {
          min-height: 260px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          text-align: center;
          font-size: 13px;
          font-weight: 850;
          color: rgba(15, 23, 42, 0.62);
        }
        .message.compact {
          min-height: 70px;
        }
        .chartLoading.error,
        .message.error {
          color: #b91c1c;
        }
        .guideSection {
          padding: 18px;
          display: grid;
          gap: 14px;
        }
        .guideGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        .sectionHead.centered {
          text-align: center;
        }
        @media (max-width: 1180px) {
          .guideGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 760px) {
          .pageContent {
            gap: 10px;
          }
          .indexListSection {
            padding: 8px;
            border-radius: 18px;
          }
          .indexList {
            gap: 8px;
          }
          .chartShell {
            padding: 10px 8px;
            border-radius: 18px;
            gap: 8px;
          }
          .chartControlsWrap {
            padding-top: 0;
          }
          .chartPanel {
            border-radius: 15px;
          }
          .guideSection {
            padding: 10px 8px;
            border-radius: 18px;
            gap: 8px;
          }
          .guideGrid {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .sectionHead h2 {
            font-size: 18px;
          }
          :global(.siteHero .heroLeft) {
            width: 100%;
            max-width: none;
          }
          :global(.siteHero .subline) {
            width: 100%;
            max-width: none;
            font-size: 11px;
            line-height: 1.35;
          }
        }
      `}</style>
    </SiteLayout>
  );
}