import fs from "fs";
import path from "path";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import SiteLayout from "../components/SiteLayout";

const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

const TIMEZONE = "Europe/Rome";
const HISTORICAL_CACHE = new Map();

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

function formatChartTime(timestamp) {
  const date = new Date(timestamp);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
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
      description: "Visualizzato da 20 °C quando aumenta la sensazione di caldo.",
      tone: "neutral",
    };
  }
  if (v < 30) {
    return {
      label: "Disagio lieve",
      description: "Condizioni generalmente tollerabili.",
      tone: "good",
    };
  }
  if (v < 40) {
    return {
      label: "Disagio moderato",
      description: "Possibile affaticamento durante attività prolungate.",
      tone: "watch",
    };
  }
  if (v <= 45) {
    return {
      label: "Forte disagio",
      description: "Ridurre gli sforzi non necessari.",
      tone: "high",
    };
  }
  return {
    label: "Condizioni pericolose",
    description: "Rischio elevato di disturbi da calore.",
    tone: "danger",
  };
}

function heatIndexMeta(value) {
  const v = n(value);
  if (!Number.isFinite(v)) {
    return {
      label: "Non attivo",
      description: "Il Heat Index non è applicabile nelle condizioni attuali.",
      tone: "neutral",
    };
  }
  if (v < 32.2) {
    return {
      label: "Cautela",
      description: "Affaticamento possibile con esposizione prolungata.",
      tone: "watch",
    };
  }
  if (v < 39.4) {
    return {
      label: "Cautela elevata",
      description: "Possibili crampi o esaurimento da calore.",
      tone: "high",
    };
  }
  if (v < 51.7) {
    return {
      label: "Pericolo",
      description: "Esaurimento da calore probabile con esposizione prolungata.",
      tone: "danger",
    };
  }
  return {
    label: "Pericolo estremo",
    description: "Colpo di calore altamente probabile.",
    tone: "danger",
  };
}

function windChillMeta(value) {
  const v = n(value);
  if (!Number.isFinite(v)) {
    return {
      label: "Non attivo",
      description: "Calcolato con temperatura non superiore a 0 °C e vento presente.",
      tone: "neutral",
    };
  }
  if (v > -10) {
    return {
      label: "Freddo percepito",
      description: "Raffreddamento moderato della pelle esposta.",
      tone: "cool",
    };
  }
  if (v > -28) {
    return {
      label: "Molto freddo",
      description: "Aumenta il rischio con esposizione prolungata.",
      tone: "high",
    };
  }
  return {
    label: "Freddo pericoloso",
    description: "Proteggere rapidamente la pelle esposta.",
    tone: "danger",
  };
}

function dewpointMeta(value) {
  const v = n(value);
  if (!Number.isFinite(v)) {
    return { label: "Dato non disponibile", tone: "neutral" };
  }
  if (v < 10) return { label: "Aria secca", tone: "cool" };
  if (v < 16) return { label: "Gradevole", tone: "good" };
  if (v < 19) return { label: "Moderatamente umida", tone: "watch" };
  if (v < 22) return { label: "Umida", tone: "high" };
  if (v < 25) return { label: "Afosa", tone: "high" };
  return { label: "Molto afosa", tone: "danger" };
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
      description: "La stima viene mostrata nelle condizioni calde.",
      tone: "neutral",
    };
  }
  if (v < 26) {
    return {
      label: "Stress contenuto",
      description: "Valore ambientale generalmente moderato.",
      tone: "good",
    };
  }
  if (v < 29) {
    return {
      label: "Attenzione",
      description: "Ridurre durata e intensità degli sforzi prolungati.",
      tone: "watch",
    };
  }
  if (v < 31) {
    return {
      label: "Stress elevato",
      description: "Sono necessarie pause frequenti e idratazione.",
      tone: "high",
    };
  }
  return {
    label: "Stress molto elevato",
    description: "Evitare attività fisica intensa nelle ore più calde.",
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

function MetricCard({ title, value, unit, meta, footnote }) {
  return (
    <article className={`metricCard ${meta?.tone || "neutral"}`}>
      <span className="metricTitle">{title}</span>
      <div className="metricValueRow">
        <strong>{value}</strong>
        {unit ? <span>{unit}</span> : null}
      </div>
      <div className="metricStatus">{meta?.label || "—"}</div>
      <p>{meta?.description || footnote || ""}</p>

      <style jsx>{`
        .metricCard {
          min-width: 0;
          min-height: 168px;
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

function IndexSelector({ value, onChange }) {
  const options = [
    { key: "humidex", label: "Humidex" },
    { key: "heatIndex", label: "Heat Index" },
    { key: "wbgtShade", label: "WBGT ombra stimato" },
    { key: "dewpoint", label: "Punto di rugiada" },
    { key: "uvValue", label: "Indice UV" },
  ];

  return (
    <div className="selector" role="group" aria-label="Indice visualizzato">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={value === option.key ? "active" : ""}
          onClick={() => onChange(option.key)}
        >
          {option.label}
        </button>
      ))}

      <style jsx>{`
        .selector {
          display: flex;
          justify-content: center;
          gap: 7px;
          flex-wrap: wrap;
        }

        button {
          min-height: 36px;
          border: 1px solid #dfe4ea;
          border-radius: 999px;
          padding: 8px 13px;
          background: #fff;
          color: rgba(15, 23, 42, 0.68);
          font-family: inherit;
          font-size: 10px;
          font-weight: 900;
          cursor: pointer;
        }

        button:hover,
        button.active {
          border-color: #94a3b8;
          background: #0f172a;
          color: #fff;
        }
      `}</style>
    </div>
  );
}

function BiometeoChart({ rows, selectedIndex }) {
  const config = {
    humidex: { title: "Andamento Humidex", unit: "", name: "Humidex" },
    heatIndex: {
      title: "Andamento Heat Index",
      unit: "°C",
      name: "Heat Index",
    },
    wbgtShade: {
      title: "Andamento WBGT ombra stimato",
      unit: "°C",
      name: "WBGT ombra",
    },
    dewpoint: {
      title: "Andamento del punto di rugiada",
      unit: "°C",
      name: "Punto di rugiada",
    },
    uvValue: { title: "Andamento dell’indice UV", unit: "UV", name: "UV" },
  }[selectedIndex];

  const pairs = rows.map((row) => [row.timestamp, row[selectedIndex]]);
  const validValues = pairs
    .map((point) => n(point[1]))
    .filter(Number.isFinite);

  const option = useMemo(() => {
    const minValue = validValues.length ? Math.min(...validValues) : 0;
    const maxValue = validValues.length ? Math.max(...validValues) : 1;
    const padding = Math.max(1, (maxValue - minValue) * 0.12);

    return {
      animation: true,
      grid: { left: 62, right: 24, top: 54, bottom: 58 },
      title: {
        text: config.title,
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
        axisLabel: {
          hideOverlap: true,
          formatter: (value) => formatChartTime(value),
        },
      },
      yAxis: {
        type: "value",
        name: config.unit,
        nameLocation: "middle",
        nameRotate: 90,
        nameGap: 42,
        min: selectedIndex === "uvValue" ? 0 : Math.floor(minValue - padding),
        max: Math.ceil(maxValue + padding),
        axisLabel: {
          formatter: (value) => Number(value).toFixed(1),
        },
        splitLine: { show: true },
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
      series: [
        {
          name: config.name,
          type: "line",
          data: pairs,
          showSymbol: false,
          connectNulls: false,
          smooth: false,
          sampling: "lttb",
          lineStyle: { width: 2.4 },
          areaStyle: { opacity: 0.08 },
        },
      ],
    };
  }, [config.name, config.title, config.unit, pairs, selectedIndex, validValues]);

  if (!validValues.length) {
    return (
      <div className="chartMessage">
        Questo indice non è applicabile nelle condizioni registrate oggi.
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
    <ReactECharts
      option={option}
      style={{ height: 360, width: "100%" }}
      notMerge={true}
      lazyUpdate={true}
    />
  );
}

export default function Biometeo({ intradayDates = [], latestDate = null }) {
  const [rows, setRows] = useState([]);
  const [loadedDate, setLoadedDate] = useState(latestDate);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastCheck, setLastCheck] = useState(null);
  const [nextRefresh, setNextRefresh] = useState("");
  const [selectedIndex, setSelectedIndex] = useState("humidex");
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
        setLastCheck(new Date());
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
      setLastCheck(new Date());

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
        dewpoint: averageFinite(validPoints.map((point) => point.dewpoint)),
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
        },
        {
          title: "Heat Index",
          value: fmt(latest.heatIndex, 1),
          unit: latest.heatIndex == null ? "" : "°C",
          meta: heatIndexMeta(latest.heatIndex),
        },
        {
          title: "Wind Chill",
          value: fmt(latest.windChill, 1),
          unit: latest.windChill == null ? "" : "°C",
          meta: windChillMeta(latest.windChill),
        },
        {
          title: "WBGT ombra stimato",
          value: fmt(latest.wbgtShade, 1),
          unit: latest.wbgtShade == null ? "" : "°C",
          meta: wbgtMeta(latest.wbgtShade),
        },
        {
          title: "Punto di rugiada",
          value: fmt(latest.dewpoint, 1),
          unit: "°C",
          meta: {
            ...dewpointMeta(latest.dewpoint),
            description: "Indicatore della quantità effettiva di vapore nell’aria.",
          },
        },
        {
          title: "Indice UV",
          value: fmt(latest.uvValue, 1),
          unit: "UV",
          meta: {
            ...uvMeta(latest.uvValue),
            description:
              latest.uvValue >= 3
                ? "È raccomandata la protezione solare durante l’esposizione."
                : "Rischio UV attualmente contenuto.",
          },
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
          "Disagio fisiologico e stress termico calcolati dalle osservazioni della stazione.",
        showPeriod: false,
        currentPath: "/biometeo",
      }}
    >
      <main className="pageContent">
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
              <SummaryCell
                label="Ultimo controllo"
                value={
                  lastCheck
                    ? `${pad2(lastCheck.getHours())}:${pad2(lastCheck.getMinutes())}`
                    : "—"
                }
                detail="aggiornamenti programmati alle :20 e :50"
              />
            </div>
          </section>
        )}

        {!loading && !error && rows.length > 0 && (
          <section className="chartSection">
            <div className="centeredHead">
              <h2>Andamento biometeorologico</h2>
              <p>Dati osservati ogni 15 minuti nel corso della giornata</p>
            </div>

            <IndexSelector value={selectedIndex} onChange={setSelectedIndex} />

            <div className="chartWrap">
              <BiometeoChart rows={rows} selectedIndex={selectedIndex} />
            </div>
          </section>
        )}

        <section className="methodSection">
          <div className="centeredHead">
            <h2>Come leggere gli indicatori</h2>
            <p>Gli indici descrivono aspetti diversi del disagio fisiologico</p>
          </div>

          <div className="methodGrid">
            <article>
              <h3>Humidex</h3>
              <p>
                Combina temperatura e punto di rugiada. È mostrato quando la
                temperatura raggiunge almeno 20 °C e l’umidità aumenta
                effettivamente la sensazione di caldo.
              </p>
            </article>
            <article>
              <h3>Heat Index</h3>
              <p>
                Temperatura apparente in ombra e con vento debole. Non
                rappresenta il carico aggiuntivo della radiazione solare diretta.
              </p>
            </article>
            <article>
              <h3>Wind Chill</h3>
              <p>
                Raffreddamento percepito sulla pelle esposta. È calcolato solo
                con temperatura non superiore a 0 °C e vento presente.
              </p>
            </article>
            <article>
              <h3>WBGT ombra stimato</h3>
              <p>
                Stima semplificata basata su temperatura e umidità. Non
                sostituisce una misura effettuata con termometro a globo in
                ambito lavorativo, sportivo o sanitario.
              </p>
            </article>
          </div>

          <div className="disclaimer">
            Questi indicatori descrivono l’ambiente esterno e non tengono conto
            di età, stato di salute, abbigliamento, acclimatazione, attività
            fisica o esposizione individuale. Non costituiscono una valutazione
            medica né una certificazione del rischio professionale.
          </div>
        </section>
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
          grid-template-columns: repeat(3, minmax(0, 1fr));
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
          border: 1px solid #e8ebef;
          border-radius: 16px;
          overflow: hidden;
          background: #fff;
        }

        .summaryGrid :global(.summaryCell) {
          border-right: 1px solid #eef0f3;
          border-bottom: 1px solid #eef0f3;
        }

        .summaryGrid :global(.summaryCell:nth-child(4n)) {
          border-right: 0;
        }

        .summaryGrid :global(.summaryCell:nth-last-child(-n + 4)) {
          border-bottom: 0;
        }

        .chartWrap {
          margin-top: 12px;
          border: 1px solid #edf0f3;
          border-radius: 17px;
          background: #fff;
          overflow: hidden;
        }

        .methodGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
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

          .summaryGrid :global(.summaryCell:nth-child(4n)) {
            border-right: 1px solid #eef0f3;
          }

          .summaryGrid :global(.summaryCell:nth-child(2n)) {
            border-right: 0;
          }

          .summaryGrid :global(.summaryCell:nth-last-child(-n + 4)) {
            border-bottom: 1px solid #eef0f3;
          }

          .summaryGrid :global(.summaryCell:nth-last-child(-n + 2)) {
            border-bottom: 0;
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