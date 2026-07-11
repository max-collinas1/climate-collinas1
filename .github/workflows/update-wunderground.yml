import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const API_URL =
  "https://api.weather.com/v2/pws/observations/all/1day";

const AUTO_DIR = path.join(
  ROOT,
  "data_raw",
  "clean",
  "auto"
);

const STATION_ID = String(
  process.env.WU_STATION_ID || "ICOLLI48"
).trim();

const API_KEY = String(
  process.env.WU_API_KEY || ""
).trim();

const START_DATE = String(
  process.env.WU_START_DATE || "0000-00-00"
).trim();

/*
 * Weather Underground può fornire osservazioni ogni 5 minuti.
 *
 * Per ogni quarto d'ora viene scelta l'osservazione più vicina,
 * purché la distanza non superi 8 minuti.
 *
 * Uno slot futuro non viene mai creato in anticipo.
 * Per esempio, se l'ultima osservazione disponibile è alle 11:07,
 * può essere completato lo slot delle 11:00, ma non quello delle 11:15.
 */
const MAX_DISTANCE_SECONDS = 8 * 60;

const CSV_COLUMNS = [
  "date",
  "time",
  "temp_c",
  "dewpoint_c",
  "rh_pct",
  "wind_dir_txt",
  "wind_kmh",
  "gust_kmh",
  "wind_dir_deg",
  "press_hpa",
  "rain_rate_mmph",
  "rain_acc_mm",
  "uv",
  "solar_wm2",
  "key",
  "value",
];

function finite(...values) {
  for (const value of values) {
    if (
      value === null ||
      value === undefined ||
      value === ""
    ) {
      continue;
    }

    const number = Number(value);

    if (Number.isFinite(number)) {
      return number;
    }
  }

  return null;
}

function meanFinite(...values) {
  const numbers = values
    .filter(
      (value) =>
        value !== null &&
        value !== undefined &&
        value !== ""
    )
    .map(Number)
    .filter(Number.isFinite);

  if (!numbers.length) {
    return null;
  }

  return (
    numbers.reduce(
      (sum, value) => sum + value,
      0
    ) / numbers.length
  );
}

function round(value, decimals = 1) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return null;
  }

  const factor = 10 ** decimals;

  return (
    Math.round(
      (number + Number.EPSILON) * factor
    ) / factor
  );
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function cardinal16(degrees) {
  const number = Number(degrees);

  if (!Number.isFinite(number)) {
    return "";
  }

  const labels = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];

  const normalized =
    ((number % 360) + 360) % 360;

  return labels[
    Math.round(normalized / 22.5) % 16
  ];
}

function parseLocalTime(value) {
  const match = String(value || "").match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/
  );

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);

  if (
    !Number.isInteger(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    seconds:
      hour * 3600 +
      minute * 60 +
      second,
  };
}

function normalizeObservation(observation) {
  const local = parseLocalTime(
    observation?.obsTimeLocal
  );

  if (!local) {
    return null;
  }

  const metric = observation?.metric || {};

  const pressure = finite(
    metric.pressureAvg,
    meanFinite(
      metric.pressureMax,
      metric.pressureMin
    ),
    metric.pressureMax,
    metric.pressureMin,
    metric.pressure
  );

  const windDirection = finite(
    observation?.winddirAvg,
    observation?.winddir,
    observation?.windDirection
  );

  return {
    date: local.date,
    seconds: local.seconds,

    epoch:
      finite(observation?.epoch) ??
      local.seconds,

    temp_c: finite(
      metric.tempAvg,
      metric.temp,
      metric.tempHigh,
      metric.tempLow
    ),

    dewpoint_c: finite(
      metric.dewptAvg,
      metric.dewpointAvg,
      metric.dewpt,
      metric.dewpoint
    ),

    rh_pct: finite(
      observation?.humidityAvg,
      observation?.humidity,
      observation?.humidityHigh,
      observation?.humidityLow
    ),

    wind_dir_deg: windDirection,

    wind_kmh: finite(
      metric.windspeedAvg,
      metric.windSpeedAvg,
      metric.windSpeed,
      metric.windspeed
    ),

    gust_kmh: finite(
      metric.windgustHigh,
      metric.windGustHigh,
      metric.windgustAvg,
      metric.windGust,
      metric.windgust
    ),

    press_hpa: pressure,

    rain_rate_mmph: finite(
      metric.precipRate,
      metric.precipRateAvg
    ),

    /*
     * Accumulo progressivo giornaliero Weather Underground.
     *
     * La conversione dei valori WU ai passi pluviometrici da 0,2 mm
     * resta affidata a build-data.js e non viene modificata qui.
     */
    rain_acc_mm: finite(
      metric.precipTotal,
      metric.precipTotalToday
    ),

    uv: finite(
      observation?.uvHigh,
      observation?.uvAvg,
      observation?.uv
    ),

    solar_wm2: finite(
      observation?.solarRadiationHigh,
      observation?.solarRadiationAvg,
      observation?.solarRadiation
    ),
  };
}

function selectQuarterHourRows(
  observations
) {
  const byDate = new Map();

  for (const raw of observations) {
    const observation =
      normalizeObservation(raw);

    if (
      !observation ||
      observation.date < START_DATE
    ) {
      continue;
    }

    if (!byDate.has(observation.date)) {
      byDate.set(
        observation.date,
        []
      );
    }

    byDate
      .get(observation.date)
      .push(observation);
  }

  const result = new Map();

  for (
    const [date, dayObservations]
    of byDate.entries()
  ) {
    dayObservations.sort(
      (a, b) =>
        a.seconds - b.seconds ||
        a.epoch - b.epoch
    );

    /*
     * Questo limite impedisce di creare uno slot che non è ancora
     * realmente trascorso.
     */
    const latestObservationSeconds =
      dayObservations.reduce(
        (maximum, observation) =>
          Math.max(
            maximum,
            observation.seconds
          ),
        -Infinity
      );

    if (
      !Number.isFinite(
        latestObservationSeconds
      )
    ) {
      continue;
    }

    const used = new Set();
    const rows = [];

    for (
      let targetSeconds = 0;
      targetSeconds < 24 * 3600;
      targetSeconds += 15 * 60
    ) {
      /*
       * Non viene generato in anticipo uno slot futuro.
       *
       * Esempio:
       * ultima osservazione 23:37
       * target 23:45
       * lo slot viene lasciato in attesa della corsa successiva.
       */
      if (
        targetSeconds >
        latestObservationSeconds
      ) {
        break;
      }

      let bestIndex = -1;
      let bestDistance = Infinity;

      for (
        let index = 0;
        index < dayObservations.length;
        index++
      ) {
        if (used.has(index)) {
          continue;
        }

        const candidate =
          dayObservations[index];

        const distance = Math.abs(
          candidate.seconds -
            targetSeconds
        );

        if (
          distance >
          MAX_DISTANCE_SECONDS
        ) {
          continue;
        }

        const candidateIsAfter =
          candidate.seconds >=
          targetSeconds;

        const currentBestIsAfter =
          bestIndex >= 0
            ? dayObservations[
                bestIndex
              ].seconds >= targetSeconds
            : false;

        /*
         * Viene preferita:
         * 1. l'osservazione più vicina;
         * 2. a parità di distanza, quella successiva allo slot.
         */
        if (
          distance < bestDistance ||
          (
            distance === bestDistance &&
            candidateIsAfter &&
            !currentBestIsAfter
          )
        ) {
          bestDistance = distance;
          bestIndex = index;
        }
      }

      if (bestIndex < 0) {
        continue;
      }

      used.add(bestIndex);

      const observation =
        dayObservations[bestIndex];

      const hour = Math.floor(
        targetSeconds / 3600
      );

      const minute = Math.floor(
        (targetSeconds % 3600) / 60
      );

      const time =
        `${pad2(hour)}:${pad2(minute)}`;

      rows.push({
        date,
        time,

        temp_c: round(
          observation.temp_c,
          1
        ),

        dewpoint_c: round(
          observation.dewpoint_c,
          1
        ),

        rh_pct: round(
          observation.rh_pct,
          1
        ),

        wind_dir_txt: cardinal16(
          observation.wind_dir_deg
        ),

        wind_kmh: round(
          observation.wind_kmh,
          1
        ),

        gust_kmh: round(
          observation.gust_kmh,
          1
        ),

        wind_dir_deg: round(
          observation.wind_dir_deg,
          1
        ),

        press_hpa: round(
          observation.press_hpa,
          2
        ),

        rain_rate_mmph: round(
          observation.rain_rate_mmph,
          2
        ),

        rain_acc_mm: round(
          observation.rain_acc_mm,
          2
        ),

        uv: round(
          observation.uv,
          1
        ),

        solar_wm2: round(
          observation.solar_wm2,
          1
        ),

        key: "",
        value: "",
      });
    }

    if (rows.length) {
      result.set(date, rows);
    }
  }

  return result;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (
    let index = 0;
    index < line.length;
    index++
  ) {
    const character = line[index];

    if (character === '"') {
      if (
        inQuotes &&
        line[index + 1] === '"'
      ) {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (
      character === "," &&
      !inQuotes
    ) {
      cells.push(current);
      current = "";
    } else {
      current += character;
    }
  }

  cells.push(current);

  return cells;
}

function readExistingCsv(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.trim() !== ""
    );

  if (lines.length < 2) {
    return [];
  }

  const headers =
    parseCsvLine(lines[0]);

  const rows = [];

  for (
    const line
    of lines.slice(1)
  ) {
    const values =
      parseCsvLine(line);

    const row = {};

    headers.forEach(
      (header, index) => {
        row[header] =
          values[index] ?? "";
      }
    );

    if (
      row.date &&
      row.time
    ) {
      rows.push(row);
    }
  }

  return rows;
}

function isPresentValue(value) {
  return !(
    value === null ||
    value === undefined ||
    value === ""
  );
}

/*
 * Se uno slot esiste già, i nuovi valori disponibili lo aggiornano.
 * Un valore nuovo mancante non cancella un valore già archiviato.
 */
function mergeCsvRows(
  existingRow,
  newRow
) {
  if (!existingRow) {
    return {
      ...newRow,
    };
  }

  const merged = {
    ...existingRow,
  };

  for (const column of CSV_COLUMNS) {
    const newValue =
      newRow[column];

    if (
      column === "date" ||
      column === "time" ||
      isPresentValue(newValue)
    ) {
      merged[column] =
        newValue;
    }
  }

  return merged;
}

function csvCell(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  const text = String(value);

  if (!/[",\n\r]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll(
    '"',
    '""'
  )}"`;
}

function csvText(rows) {
  const lines = [
    CSV_COLUMNS.join(","),
  ];

  for (const row of rows) {
    lines.push(
      CSV_COLUMNS.map(
        (column) =>
          csvCell(row[column])
      ).join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}

function mergeAndWriteDate(
  date,
  newRows
) {
  const year = date.slice(0, 4);

  const directory = path.join(
    AUTO_DIR,
    year
  );

  const filePath = path.join(
    directory,
    `${date}.csv`
  );

  fs.mkdirSync(directory, {
    recursive: true,
  });

  const merged = new Map();

  for (
    const row
    of readExistingCsv(filePath)
  ) {
    merged.set(
      `${row.date} ${row.time}`,
      row
    );
  }

  for (const newRow of newRows) {
    const key =
      `${newRow.date} ${newRow.time}`;

    const existingRow =
      merged.get(key);

    merged.set(
      key,
      mergeCsvRows(
        existingRow,
        newRow
      )
    );
  }

  const rows = Array.from(
    merged.values()
  )
    .filter(
      (row) =>
        row.date === date &&
        /^\d{2}:\d{2}$/.test(
          String(row.time)
        )
    )
    .sort(
      (a, b) =>
        String(a.time).localeCompare(
          String(b.time)
        )
    );

  const next = csvText(rows);

  const previous =
    fs.existsSync(filePath)
      ? fs.readFileSync(
          filePath,
          "utf8"
        )
      : "";

  if (next !== previous) {
    fs.writeFileSync(
      filePath,
      next,
      "utf8"
    );

    return {
      changed: true,
      filePath,
      count: rows.length,
    };
  }

  return {
    changed: false,
    filePath,
    count: rows.length,
  };
}

async function fetchWithRetry(
  url,
  attempts = 3
) {
  let lastError = null;

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt++
  ) {
    const controller =
      new AbortController();

    const timeout = setTimeout(
      () => controller.abort(),
      25_000
    );

    try {
      const response = await fetch(
        url,
        {
          headers: {
            Accept:
              "application/json",
          },
          signal:
            controller.signal,
        }
      );

      if (response.status === 204) {
        return {
          observations: [],
        };
      }

      if (!response.ok) {
        const body =
          await response.text();

        const error = new Error(
          `Weather Underground API: HTTP ${response.status} ${body.slice(
            0,
            300
          )}`
        );

        if (
          response.status < 500 &&
          response.status !== 429
        ) {
          throw error;
        }

        lastError = error;
      } else {
        return await response.json();
      }
    } catch (error) {
      lastError = error;

      if (attempt === attempts) {
        break;
      }
    } finally {
      clearTimeout(timeout);
    }

    await new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          attempt * 2000
        )
    );
  }

  throw (
    lastError ||
    new Error(
      "Impossibile contattare Weather Underground."
    )
  );
}

async function main() {
  if (!API_KEY) {
    throw new Error(
      "Variabile WU_API_KEY assente. Inserisci la chiave nei GitHub Actions Secrets."
    );
  }

  if (!STATION_ID) {
    throw new Error(
      "Variabile WU_STATION_ID assente."
    );
  }

  const url = new URL(API_URL);

  url.searchParams.set(
    "stationId",
    STATION_ID
  );

  url.searchParams.set(
    "format",
    "json"
  );

  url.searchParams.set(
    "units",
    "m"
  );

  url.searchParams.set(
    "numericPrecision",
    "decimal"
  );

  url.searchParams.set(
    "apiKey",
    API_KEY
  );

  console.log(
    `[WU] Stazione: ${STATION_ID}`
  );

  console.log(
    `[WU] Data iniziale archivio automatico: ${START_DATE}`
  );

  const payload =
    await fetchWithRetry(url);

  const observations =
    Array.isArray(
      payload?.observations
    )
      ? payload.observations
      : [];

  console.log(
    `[WU] Osservazioni ricevute: ${observations.length}`
  );

  /*
   * L'endpoint delle ultime 24 ore comprende normalmente anche
   * la parte finale del giorno precedente.
   *
   * Di conseguenza, una corsa dopo mezzanotte può completare
   * gli slot delle 23:45 rimasti temporaneamente mancanti.
   */
  const rowsByDate =
    selectQuarterHourRows(
      observations
    );

  if (!rowsByDate.size) {
    console.log(
      "[WU] Nessun nuovo dato utile da salvare."
    );

    return;
  }

  let changedFiles = 0;

  for (
    const [date, rows]
    of Array.from(
      rowsByDate.entries()
    ).sort()
  ) {
    const result =
      mergeAndWriteDate(
        date,
        rows
      );

    const relative =
      path.relative(
        ROOT,
        result.filePath
      );

    console.log(
      `[WU] ${date}: ${result.count} campioni da 15 minuti -> ${relative}${
        result.changed
          ? " (aggiornato)"
          : " (invariato)"
      }`
    );

    if (result.changed) {
      changedFiles += 1;
    }
  }

  console.log(
    `[WU] File modificati: ${changedFiles}`
  );
}

main().catch((error) => {
  console.error(
    `[WU] ERRORE: ${
      error?.message || error
    }`
  );

  process.exitCode = 1;
});
