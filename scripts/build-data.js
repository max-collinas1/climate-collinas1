// ==================== build-data.js (FULL) ====================
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");

const ROOT = process.cwd();

const IN_DIR = path.join(ROOT, "data_raw", "clean");
const OUT_DAILY = path.join(ROOT, "data", "daily.json");
const OUT_INTRADAY_DIR = path.join(ROOT, "public", "data", "intraday");

// ==================== config ====================
const CARDINAL_STEP_DEG = 22.5; // 16 venti
const RAIN_TICK_MM = 0.2;

// watch debounce (ms)
const WATCH_DEBOUNCE_MS = 600;

// qualità medie giornaliere (15-min)
const QH_PER_DAY = 96; // 24h * 4
const MIN_COVERAGE = 0.9; // 90%
const MIN_SAMPLES_FOR_MEAN = Math.ceil(QH_PER_DAY * MIN_COVERAGE); // 87

// copertura minima per statistiche sensibili
const MIN_COVERAGE_STATS = 0.95;
const MIN_SAMPLES_FOR_STATS = Math.ceil(
  QH_PER_DAY * MIN_COVERAGE_STATS
); // 92

// Priorità delle sorgenti:
// Weather Underground automatico = provvisorio
// WeatherLink manuale = ufficiale e prioritario
const SOURCE_PRIORITY_AUTO = 10;
const SOURCE_PRIORITY_MANUAL = 100;

// ==================== utils ====================
function listFiles(dir) {
  const out = [];

  if (!fs.existsSync(dir)) {
    return out;
  }

  function walk(currentDir) {
    for (const name of fs.readdirSync(currentDir)) {
      if (!name || name.startsWith(".")) {
        continue;
      }

      const full = path.join(currentDir, name);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        walk(full);
      } else {
        const lowerName = name.toLowerCase();

        if (
          lowerName.endsWith(".csv") ||
          lowerName.endsWith(".txt")
        ) {
          out.push(full);
        }
      }
    }
  }

  walk(dir);

  return out.sort((a, b) => a.localeCompare(b));
}

function ensureDir(directoryPath) {
  fs.mkdirSync(directoryPath, {
    recursive: true,
  });
}

function clearIntradayJson(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return;
  }

  for (const fileName of fs.readdirSync(directoryPath)) {
    if (fileName.toLowerCase().endsWith(".json")) {
      fs.unlinkSync(
        path.join(directoryPath, fileName)
      );
    }
  }
}

function normKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\u00b0/g, "")
    .replace(/[().]/g, "")
    .replace(/[%]/g, "pct")
    .replace(/w\/?m2/g, "wm2")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sniffDelimiter(text) {
  const firstLine =
    String(text || "")
      .split(/\r?\n/)
      .find((line) => line.trim() !== "") || "";

  const count = (character) =>
    (
      firstLine.match(
        new RegExp(`\\${character}`, "g")
      ) || []
    ).length;

  const commas = count(",");
  const semicolons = count(";");
  const tabs = count("\t");

  if (
    semicolons > commas &&
    semicolons > tabs
  ) {
    return ";";
  }

  if (
    tabs > commas &&
    tabs > semicolons
  ) {
    return "\t";
  }

  return ",";
}

// Parser robusto anche con unità:
// 76%, 1013.2 hPa, 12.3 °C, ecc.
function toNum(value) {
  if (
    value === "" ||
    value === null ||
    value === undefined
  ) {
    return NaN;
  }

  let text = String(value).trim();

  if (!text) {
    return NaN;
  }

  if (
    text === "-" ||
    text === "—"
  ) {
    return NaN;
  }

  text = text
    .replaceAll("%", "")
    .replaceAll("°C", "")
    .replaceAll("°", "")
    .replaceAll("km/h", "")
    .replaceAll("mm/h", "")
    .replaceAll("mm", "")
    .replaceAll("hPa", "")
    .replaceAll("W/m²", "")
    .replaceAll("W/m2", "")
    .trim();

  const number = Number(
    text.replace(",", ".")
  );

  return Number.isFinite(number)
    ? number
    : NaN;
}

function numOrNull(value) {
  const number = toNum(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function meanMin(
  values,
  minCount = MIN_SAMPLES_FOR_MEAN
) {
  const finiteValues = (values || []).filter(
    Number.isFinite
  );

  if (finiteValues.length < minCount) {
    return null;
  }

  return (
    finiteValues.reduce(
      (sum, value) => sum + value,
      0
    ) / finiteValues.length
  );
}

// Media dei soli valori > 0.
// Se non esistono valori positivi restituisce null.
function meanPositive(values) {
  const finiteValues = (values || []).filter(
    (value) =>
      Number.isFinite(value) &&
      value > 0
  );

  if (!finiteValues.length) {
    return null;
  }

  return (
    finiteValues.reduce(
      (sum, value) => sum + value,
      0
    ) / finiteValues.length
  );
}

function minv(values) {
  const finiteValues = (values || []).filter(
    Number.isFinite
  );

  if (!finiteValues.length) {
    return null;
  }

  return Math.min(...finiteValues);
}

function maxv(values) {
  const finiteValues = (values || []).filter(
    Number.isFinite
  );

  if (!finiteValues.length) {
    return null;
  }

  return Math.max(...finiteValues);
}

function normalizeDate(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "";
  }

  const text = String(value).trim();

  if (!text) {
    return "";
  }

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(text)
  ) {
    return text;
  }

  const italianDate = text.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/
  );

  if (italianDate) {
    const day = String(
      italianDate[1]
    ).padStart(2, "0");

    const month = String(
      italianDate[2]
    ).padStart(2, "0");

    const year = italianDate[3];

    return `${year}-${month}-${day}`;
  }

  /*
   * Supporto alle date seriali Excel.
   *
   * Esempio:
   * 46175 -> 2026-06-02
   */
  if (/^\d+(?:\.0+)?$/.test(text)) {
    const serial = Number(text);

    if (
      Number.isFinite(serial) &&
      serial >= 20000 &&
      serial <= 80000
    ) {
      const milliseconds =
        Date.UTC(1899, 11, 30) +
        Math.floor(serial) * 86400000;

      const date = new Date(milliseconds);

      const year =
        date.getUTCFullYear();

      const month = String(
        date.getUTCMonth() + 1
      ).padStart(2, "0");

      const day = String(
        date.getUTCDate()
      ).padStart(2, "0");

      return `${year}-${month}-${day}`;
    }
  }

  return text;
}

function normalizeTime(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "";
  }

  const text = String(value).trim();

  if (text === "OVR") {
    return "OVR";
  }

  const ampm = text.match(
    /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i
  );

  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2]);
    const meridiem =
      ampm[3].toUpperCase();

    if (
      meridiem === "PM" &&
      hour !== 12
    ) {
      hour += 12;
    }

    if (
      meridiem === "AM" &&
      hour === 12
    ) {
      hour = 0;
    }

    return (
      `${String(hour).padStart(2, "0")}:` +
      `${String(minute).padStart(2, "0")}`
    );
  }

  const hourMinute = text.match(
    /^(\d{1,2}):(\d{2})(?::\d{2})?$/
  );

  if (hourMinute) {
    const hour = String(
      hourMinute[1]
    ).padStart(2, "0");

    const minute = String(
      hourMinute[2]
    ).padStart(2, "0");

    return `${hour}:${minute}`;
  }

  const numericTime = Number(text);

  if (
    Number.isFinite(numericTime) &&
    numericTime >= 0 &&
    numericTime < 1
  ) {
    const totalMinutes = Math.round(
      numericTime * 24 * 60
    );

    const hour = String(
      Math.floor(totalMinutes / 60)
    ).padStart(2, "0");

    const minute = String(
      totalMinutes % 60
    ).padStart(2, "0");

    return `${hour}:${minute}`;
  }

  return text;
}

function isValidTimeToken(time) {
  return (
    time === "OVR" ||
    /^\d{2}:\d{2}$/.test(
      String(time || "")
    )
  );
}

function isObsRow(row) {
  return (
    row.time &&
    row.time !== "OVR" &&
    isValidTimeToken(row.time)
  );
}

function isOvrRow(row) {
  return (
    row.time === "OVR" &&
    row.key
  );
}

function sourceMeta(filePath) {
  const relativePath = path
    .relative(IN_DIR, filePath)
    .split(path.sep)
    .join("/");

  const isAuto =
    relativePath === "auto" ||
    relativePath.startsWith("auto/");

  return {
    type: isAuto
      ? "auto"
      : "manual",

    priority: isAuto
      ? SOURCE_PRIORITY_AUTO
      : SOURCE_PRIORITY_MANUAL,

    file: relativePath,
  };
}

function withSourceMeta(
  row,
  meta,
  rowOrder
) {
  return {
    ...row,

    _source_type:
      meta.type,

    _source_priority:
      meta.priority,

    _source_file:
      meta.file,

    _source_order:
      rowOrder,
  };
}

function rowWins(
  nextRow,
  currentRow
) {
  if (!currentRow) {
    return true;
  }

  const nextPriority = Number(
    nextRow?._source_priority ?? 0
  );

  const currentPriority = Number(
    currentRow?._source_priority ?? 0
  );

  if (
    nextPriority !== currentPriority
  ) {
    return (
      nextPriority >
      currentPriority
    );
  }

  return (
    Number(
      nextRow?._source_order ?? 0
    ) >=
    Number(
      currentRow?._source_order ?? 0
    )
  );
}

// ==================== header mapping ====================
const HEADER_MAP = new Map([
  ["date", "date"],
  ["time", "time"],

  ["temp_c", "temp_c"],
  ["dewpoint_c", "dewpoint_c"],
  ["rh_pct", "rh_pct"],

  ["wind_dir_txt", "wind_dir_txt"],
  ["wind_kmh", "wind_kmh"],
  ["gust_kmh", "gust_kmh"],
  ["wind_dir_deg", "wind_dir_deg"],

  ["press_hpa", "press_hpa"],
  ["rain_rate_mmph", "rain_rate_mmph"],
  ["rain_acc_mm", "rain_acc_mm"],

  ["uv", "uv"],
  ["solar_wm2", "solar_wm2"],

  ["key", "key"],
  ["value", "value"],
]);

function mapHeaders(object) {
  const output = {};

  for (
    const [key, value]
    of Object.entries(object)
  ) {
    const normalizedKey =
      normKey(key);

    const mapped =
      HEADER_MAP.get(normalizedKey);

    if (mapped) {
      output[mapped] = value;
    } else {
      output[normalizedKey] = value;
    }
  }

  return output;
}

// ==================== lettura CSV ====================
const DEFAULT_COLUMNS_NO_HEADER = [
  "date",
  "time",
  "temp_c",
  "dewpoint_c",
  "rh_pct",
  "wind_dir_txt",
  "wind_kmh",
  "gust_kmh",
  "press_hpa",
  "rain_rate_mmph",
  "rain_acc_mm",
  "uv",
  "solar_wm2",
  "key",
  "value",
];

function isNoHeaderParsedWrong(
  parsedRows
) {
  if (
    !parsedRows ||
    !parsedRows.length
  ) {
    return false;
  }

  const first = parsedRows[0];
  const keys = Object.keys(first || {});

  if (!keys.length) {
    return false;
  }

  const firstKey = String(
    keys[0] || ""
  ).trim();

  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      firstKey
    )
  ) {
    return true;
  }

  const normalizedKeys =
    keys.map(normKey);

  const hasDate =
    normalizedKeys.includes("date");

  const hasTime =
    normalizedKeys.includes("time");

  if (!hasDate || !hasTime) {
    if (
      keys.some((key) =>
        /^\d{4}-\d{2}-\d{2}$/.test(
          String(key).trim()
        )
      )
    ) {
      return true;
    }
  }

  return false;
}

function normalizeWideOverrideKey(
  header
) {
  const key = normKey(header);

  const aliases = {
    gust_max: "gustmax",
    max_gust: "gustmax",
    raffica_massima: "gustmax",

    wind_dir_mean:
      "wind_dir_mean_deg",

    wind_direction_mean:
      "wind_dir_mean_deg",

    direzione_media_vento:
      "wind_dir_mean_deg",

    rain_total:
      "rain_total_mm",

    precipitation_total:
      "rain_total_mm",

    pioggia_totale:
      "rain_total_mm",

    rain_rate_max:
      "rainrate_max",

    rain_r_max:
      "rainrate_max",

    rain_rate_mmph_max:
      "rainrate_max",

    intensita_massima:
      "rainrate_max",

    t_max:
      "tmax",

    temp_max:
      "tmax",

    temperature_max:
      "tmax",

    t_min:
      "tmin",

    temp_min:
      "tmin",

    temperature_min:
      "tmin",
  };

  return aliases[key] || key;
}

function isWideOverrideMatrix(
  matrix
) {
  if (
    !Array.isArray(matrix) ||
    matrix.length < 3
  ) {
    return false;
  }

  const firstCell = String(
    matrix?.[0]?.[0] ?? ""
  )
    .trim()
    .toUpperCase();

  if (firstCell !== "OVR") {
    return false;
  }

  const headers = (
    matrix[1] || []
  ).map(normKey);

  return headers.includes("date");
}

function readWideOverrides(
  matrix,
  meta
) {
  const headers = (
    matrix[1] || []
  ).map(normalizeWideOverrideKey);

  const dateIndex =
    headers.indexOf("date");

  if (dateIndex < 0) {
    return [];
  }

  const output = [];
  let order = 0;

  for (
    const cells
    of matrix.slice(2)
  ) {
    const date = normalizeDate(
      cells?.[dateIndex]
    );

    if (!date) {
      continue;
    }

    for (
      let index = 0;
      index < headers.length;
      index++
    ) {
      if (index === dateIndex) {
        continue;
      }

      const key = headers[index];

      if (!key) {
        continue;
      }

      let rawValue =
        cells?.[index];

      /*
       * Nei riepiloghi WeatherLink:
       * una pioggia vuota viene considerata
       * pari a zero.
       *
       * In questo modo una giornata asciutta
       * ufficiale sostituisce il dato provvisorio WU.
       */
      if (
        (
          rawValue === null ||
          rawValue === undefined ||
          String(rawValue).trim() === ""
        ) &&
        (
          key === "rain_total_mm" ||
          key === "rainrate_max"
        )
      ) {
        rawValue = 0;
      }

      /*
       * Gli altri campi vuoti non sostituiscono
       * i valori automatici.
       */
      if (
        rawValue === null ||
        rawValue === undefined ||
        String(rawValue).trim() === ""
      ) {
        continue;
      }

      output.push(
        withSourceMeta(
          {
            date,
            time: "OVR",
            key,
            value: rawValue,
          },
          meta,
          order++
        )
      );
    }
  }

  return output;
}

function readCsv(filePath) {
  const text = fs.readFileSync(
    filePath,
    "utf8"
  );

  const delimiter =
    sniffDelimiter(text);

  const meta =
    sourceMeta(filePath);

  /*
   * Prima lettura senza intestazioni:
   * serve per riconoscere i riepiloghi
   * WeatherLink con prima riga OVR.
   */
  const matrix = parse(text, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
  });

  if (
    isWideOverrideMatrix(matrix)
  ) {
    return readWideOverrides(
      matrix,
      meta
    );
  }

  /*
   * Lettura ordinaria dei CSV intraday.
   */
  let rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter,
    relax_column_count: true,
    relax_quotes: true,
  });

  if (
    isNoHeaderParsedWrong(rows)
  ) {
    rows = parse(text, {
      columns:
        DEFAULT_COLUMNS_NO_HEADER,

      skip_empty_lines: true,
      trim: true,
      delimiter,
      relax_column_count: true,
      relax_quotes: true,
    });
  }

  return rows.map(
    (row, index) =>
      withSourceMeta(
        mapHeaders(row),
        meta,
        index
      )
  );
}

function mergeObsByPriority(rows) {
  const byTime = new Map();

  for (const row of rows || []) {
    if (!isObsRow(row)) {
      continue;
    }

    const time =
      String(row.time);

    const current =
      byTime.get(time);

    if (
      rowWins(row, current)
    ) {
      byTime.set(time, row);
    }
  }

  return Array.from(
    byTime.values()
  ).sort(
    (a, b) =>
      String(a.time).localeCompare(
        String(b.time)
      )
  );
}

function buildOverrideMaps(rows) {
  const chosen = new Map();

  for (const row of rows || []) {
    if (!isOvrRow(row)) {
      continue;
    }

    const key =
      normKey(row.key);

    if (!key) {
      continue;
    }

    const current =
      chosen.get(key);

    if (
      rowWins(row, current)
    ) {
      chosen.set(key, row);
    }
  }

  const overrideNum = {};
  const overrideStr = {};

  for (
    const [key, row]
    of chosen.entries()
  ) {
    const rawValue =
      row.value === null ||
      row.value === undefined
        ? ""
        : String(row.value).trim();

    overrideStr[key] =
      rawValue;

    const numericValue =
      toNum(rawValue);

    if (
      Number.isFinite(
        numericValue
      )
    ) {
      overrideNum[key] =
        numericValue;
    }
  }

  return {
    overrideNum,
    overrideStr,
  };
}

// ==================== meteo helpers ====================

// Ordine corretto in senso orario meteorologico.
function cardinalToDeg(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase();

  if (!raw) {
    return null;
  }

  const aliases = {
    NORTH: "N",
    SOUTH: "S",
    EAST: "E",
    WEST: "W",
  };

  const direction =
    aliases[raw] || raw;

  const directions = [
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

  const index =
    directions.indexOf(direction);

  if (index === -1) {
    return null;
  }

  return (
    index *
    CARDINAL_STEP_DEG
  );
}

function circularMeanDegMin(
  degrees,
  minCount = MIN_SAMPLES_FOR_MEAN
) {
  const values = (
    degrees || []
  ).filter(Number.isFinite);

  if (
    values.length < minCount
  ) {
    return null;
  }

  let cosineSum = 0;
  let sineSum = 0;

  for (const degree of values) {
    const radians =
      (degree * Math.PI) / 180;

    cosineSum +=
      Math.cos(radians);

    sineSum +=
      Math.sin(radians);
  }

  const meanRadians = Math.atan2(
    sineSum / values.length,
    cosineSum / values.length
  );

  let meanDegrees =
    (meanRadians * 180) / Math.PI;

  if (meanDegrees < 0) {
    meanDegrees += 360;
  }

  return meanDegrees;
}

/*
 * PRECIPITAZIONI
 *
 * Non viene usato direttamente rain_rate_mmph
 * del file sorgente.
 *
 * 1. Si calcolano i delta di rain_acc_mm.
 * 2. I delta rappresentano i mm ogni 15 minuti.
 * 3. Il rain rate viene ricavato come delta × 4.
 */
function rainDeltasFromAcc(
  observations,
  tickMm = RAIN_TICK_MM
) {
  const deltas = [];
  let previous = NaN;

  for (
    let index = 0;
    index < observations.length;
    index++
  ) {
    const accumulatedRain =
      toNum(
        observations[index]
          .rain_acc_mm
      );

    let delta = 0;

    if (
      !Number.isFinite(
        accumulatedRain
      )
    ) {
      delta = 0;
    } else if (
      !Number.isFinite(previous)
    ) {
      /*
       * Il primo valore valido della giornata
       * viene usato come baseline.
       */
      delta = 0;
      previous =
        accumulatedRain;
    } else {
      const difference =
        accumulatedRain - previous;

      if (difference >= 0) {
        delta = difference;
      } else {
        /*
         * Il contatore si è azzerato.
         */
        delta =
          accumulatedRain;
      }

      previous =
        accumulatedRain;
    }

    if (
      !Number.isFinite(delta) ||
      delta < 0
    ) {
      delta = 0;
    }

    /*
     * Arrotondamento al passo del pluviometro.
     */
    delta =
      Math.floor(
        delta / tickMm + 1e-9
      ) * tickMm;

    deltas.push(delta);
  }

  return deltas;
}

function rollingMaxSum(
  values,
  windowSize
) {
  const count =
    (values || []).length;

  if (!count) {
    return null;
  }

  const window = Math.min(
    windowSize,
    count
  );

  let sum = 0;

  for (
    let index = 0;
    index < window;
    index++
  ) {
    sum += values[index];
  }

  let maximum = sum;

  for (
    let index = window;
    index < count;
    index++
  ) {
    sum +=
      values[index] -
      values[index - window];

    if (sum > maximum) {
      maximum = sum;
    }
  }

  return maximum;
}

function pickOverrideNumber(
  overrideNum,
  ...keys
) {
  for (const key of keys) {
    if (
      Number.isFinite(
        overrideNum[key]
      )
    ) {
      return overrideNum[key];
    }
  }

  return null;
}

function pickOverrideDirDeg(
  overrideNum,
  overrideStr,
  ...keys
) {
  for (const key of keys) {
    if (
      Number.isFinite(
        overrideNum[key]
      )
    ) {
      return overrideNum[key];
    }
  }

  for (const key of keys) {
    const value =
      overrideStr[key];

    if (
      typeof value === "string" &&
      value.trim()
    ) {
      const direction =
        cardinalToDeg(value);

      if (
        Number.isFinite(direction)
      ) {
        return direction;
      }

      const numeric =
        toNum(value);

      if (
        Number.isFinite(numeric)
      ) {
        return numeric;
      }
    }
  }

  return null;
}

// ==================== build ====================
let isBuilding = false;

function buildOnce() {
  if (isBuilding) {
    return;
  }

  isBuilding = true;

  const started = Date.now();

  try {
    ensureDir(
      path.join(ROOT, "data")
    );

    ensureDir(
      OUT_INTRADAY_DIR
    );

    clearIntradayJson(
      OUT_INTRADAY_DIR
    );

    const files =
      listFiles(IN_DIR);

    if (!files.length) {
      console.log(
        "Nessun file CSV trovato in",
        IN_DIR
      );

      isBuilding = false;
      return;
    }

    console.log(
      "\n[build-data] Input files:"
    );

    for (const filePath of files) {
      const meta =
        sourceMeta(filePath);

      console.log(
        ` - ${meta.file} ` +
        `[${meta.type}, priorità ${meta.priority}]`
      );
    }

    let allRows = [];

    for (const filePath of files) {
      allRows = allRows.concat(
        readCsv(filePath)
      );
    }

    for (const row of allRows) {
      row.date =
        normalizeDate(row.date);

      row.time =
        normalizeTime(row.time);

      /*
       * Se manca la direzione numerica,
       * viene ricavata dalla direzione testuale.
       */
      if (
        !Number.isFinite(
          toNum(row.wind_dir_deg)
        )
      ) {
        const fromCardinal =
          cardinalToDeg(
            row.wind_dir_txt
          );

        if (
          Number.isFinite(
            fromCardinal
          )
        ) {
          row.wind_dir_deg =
            fromCardinal;
        }
      }
    }

    const byDate = new Map();

    for (const row of allRows) {
      const date = String(
        row.date || ""
      ).trim();

      if (!date) {
        continue;
      }

      if (!byDate.has(date)) {
        byDate.set(date, []);
      }

      byDate.get(date).push(row);
    }

    const sortedDates =
      Array.from(
        byDate.keys()
      ).sort(
        (a, b) =>
          a.localeCompare(b)
      );

    console.log(
      "[build-data] Giorni trovati:",
      sortedDates.length,
      sortedDates[0],
      "->",
      sortedDates[
        sortedDates.length - 1
      ]
    );

    const daily = [];

    for (const date of sortedDates) {
      const rows =
        byDate.get(date);

      /*
       * Se per lo stesso quarto d'ora
       * esistono dati automatici WU
       * e dati manuali WeatherLink,
       * prevalgono quelli manuali.
       */
      const observations =
        mergeObsByPriority(rows);

      /*
       * Gli override WeatherLink manuali
       * hanno priorità sugli override
       * e sui calcoli automatici WU.
       */
      const {
        overrideNum,
        overrideStr,
      } = buildOverrideMaps(rows);

      const hasObservations =
        observations.length > 0;

      const temperatureValues =
        hasObservations
          ? observations.map((row) =>
              toNum(row.temp_c)
            )
          : [];

      const dewpointValues =
        hasObservations
          ? observations.map((row) =>
              toNum(row.dewpoint_c)
            )
          : [];

      const humidityValues =
        hasObservations
          ? observations.map((row) =>
              toNum(row.rh_pct)
            )
          : [];

      const windValues =
        hasObservations
          ? observations.map((row) =>
              toNum(row.wind_kmh)
            )
          : [];

      const gustValues =
        hasObservations
          ? observations.map((row) =>
              toNum(row.gust_kmh)
            )
          : [];

      const pressureValues =
        hasObservations
          ? observations.map((row) =>
              toNum(row.press_hpa)
            )
          : [];

      const directionValues =
        hasObservations
          ? observations.map((row) =>
              toNum(row.wind_dir_deg)
            )
          : [];

      const uvValues =
        hasObservations
          ? observations.map((row) =>
              toNum(row.uv)
            )
          : [];

      const solarValues =
        hasObservations
          ? observations.map((row) =>
              toNum(row.solar_wm2)
            )
          : [];

      const humidityCount =
        humidityValues.filter(
          Number.isFinite
        ).length;

      const pressureCount =
        pressureValues.filter(
          Number.isFinite
        ).length;

      const uvCount =
        uvValues.filter(
          Number.isFinite
        ).length;

      const solarCount =
        solarValues.filter(
          Number.isFinite
        ).length;

      const humidityStatsOk =
        humidityCount >=
        MIN_SAMPLES_FOR_STATS;

      const pressureStatsOk =
        pressureCount >=
        MIN_SAMPLES_FOR_STATS;

      const uvStatsOk =
        uvCount >=
        MIN_SAMPLES_FOR_STATS;

      const solarStatsOk =
        solarCount >=
        MIN_SAMPLES_FOR_STATS;

      /*
       * Valori provvisori calcolati da WU.
       * Verranno sostituiti dagli override
       * WeatherLink, quando disponibili.
       */
      const calculatedTmin =
        minv(temperatureValues);

      const calculatedTmax =
        maxv(temperatureValues);

      const temperatureMean =
        meanMin(
          temperatureValues
        );

      const dewpointMean =
        meanMin(
          dewpointValues
        );

      const humidityMean =
        meanMin(
          humidityValues
        );

      const windAverage =
        meanMin(windValues);

      const pressureAverage =
        meanMin(
          pressureValues
        );

      const humidityMin =
        humidityStatsOk
          ? minv(humidityValues)
          : null;

      const humidityMax =
        humidityStatsOk
          ? maxv(humidityValues)
          : null;

      const windMax =
        maxv(windValues);

      const calculatedGustMax =
        maxv(gustValues);

      const pressureMin =
        pressureStatsOk
          ? minv(pressureValues)
          : null;

      const pressureMax =
        pressureStatsOk
          ? maxv(pressureValues)
          : null;

      const calculatedDirectionMean =
        circularMeanDegMin(
          directionValues
        );

      // ==================== precipitazioni ====================
      let rainDeltas15 = [];
      let rainRates15 = [];
      let calculatedRainTotal = null;
      let calculatedRainRateMax = null;

      if (hasObservations) {
        rainDeltas15 =
          rainDeltasFromAcc(
            observations,
            RAIN_TICK_MM
          );

        calculatedRainTotal =
          rainDeltas15.reduce(
            (sum, value) =>
              sum + value,
            0
          );

        rainRates15 =
          rainDeltas15.map(
            (delta) => delta * 4
          );

        calculatedRainRateMax =
          maxv(rainRates15);
      }

      const overriddenRainTotal =
        pickOverrideNumber(
          overrideNum,
          "rain_total",
          "rain_total_mm"
        );

      const rainTotal =
        overriddenRainTotal !== null
          ? overriddenRainTotal
          : calculatedRainTotal;

      const rain15mMax =
        hasObservations
          ? maxv(rainDeltas15)
          : null;

      const rain30mMax =
        hasObservations
          ? rollingMaxSum(
              rainDeltas15,
              2
            )
          : null;

      const rain1hMax =
        hasObservations
          ? rollingMaxSum(
              rainDeltas15,
              4
            )
          : null;

      const rain3hMax =
        hasObservations
          ? rollingMaxSum(
              rainDeltas15,
              12
            )
          : null;

      const rain6hMax =
        hasObservations
          ? rollingMaxSum(
              rainDeltas15,
              24
            )
          : null;

      const rain12hMax =
        hasObservations
          ? rollingMaxSum(
              rainDeltas15,
              48
            )
          : null;

      const rain24hMax =
        hasObservations
          ? rollingMaxSum(
              rainDeltas15,
              96
            )
          : null;

      const uvMax =
        uvStatsOk
          ? maxv(uvValues)
          : null;

      const solarMax =
        solarStatsOk
          ? maxv(solarValues)
          : null;

      const uvMeanPositive =
        uvStatsOk
          ? meanPositive(uvValues)
          : null;

      const solarMeanPositive =
        solarStatsOk
          ? meanPositive(
              solarValues
            )
          : null;

      // ==================== override WeatherLink ====================
      const overriddenTmin =
        pickOverrideNumber(
          overrideNum,
          "tmin",
          "t_min",
          "temp_min"
        );

      const overriddenTmax =
        pickOverrideNumber(
          overrideNum,
          "tmax",
          "t_max",
          "temp_max"
        );

      const overriddenGustMax =
        pickOverrideNumber(
          overrideNum,
          "gustmax",
          "gust_max",
          "max_gust"
        );

      const tmin =
        overriddenTmin !== null
          ? overriddenTmin
          : calculatedTmin;

      const tmax =
        overriddenTmax !== null
          ? overriddenTmax
          : calculatedTmax;

      const gustMax =
        overriddenGustMax !== null
          ? overriddenGustMax
          : calculatedGustMax;

      const overriddenRainRateMax =
        pickOverrideNumber(
          overrideNum,
          "rainrate_max",
          "rain_rate_max",
          "rain_r_max",
          "rain_rate_mmph_max"
        );

      let rainRateMax =
        overriddenRainRateMax !== null
          ? overriddenRainRateMax
          : calculatedRainRateMax;

      const overriddenDirectionMean =
        pickOverrideDirDeg(
          overrideNum,
          overrideStr,
          "wind_dir_mean_deg",
          "wind_dir_mean",
          "wind_dir_mean_direction",
          "direction",
          "dir_mean"
        );

      const windDirectionMean =
        overriddenDirectionMean !== null
          ? overriddenDirectionMean
          : calculatedDirectionMean;

      /*
       * Se il totale della pioggia è zero,
       * anche il rain rate massimo deve essere zero.
       */
      if (
        !(
          Number.isFinite(rainTotal) &&
          rainTotal > 0
        )
      ) {
        rainRateMax = 0;
      }

      daily.push({
        date,

        tmin,
        tmax,
        gust_max: gustMax,

        rainrate_max:
          rainRateMax,

        wind_dir_mean_deg:
          windDirectionMean,

        tmean:
          temperatureMean,

        dewpoint_mean:
          dewpointMean,

        rh_mean:
          humidityMean,

        rh_min:
          humidityMin,

        rh_max:
          humidityMax,

        wind_avg:
          windAverage,

        wind_max:
          windMax,

        press_avg:
          pressureAverage,

        press_min:
          pressureMin,

        press_max:
          pressureMax,

        uv_max:
          uvMax,

        solar_max:
          solarMax,

        uv_mean_pos:
          uvMeanPositive,

        solar_mean_pos:
          solarMeanPositive,

        rain_total:
          rainTotal,

        rain_15m_max:
          rain15mMax,

        rain_30m_max:
          rain30mMax,

        rain_1h_max:
          rain1hMax,

        rain_3h_max:
          rain3hMax,

        rain_6h_max:
          rain6hMax,

        rain_12h_max:
          rain12hMax,

        rain_24h_max:
          rain24hMax,

        has_obs:
          hasObservations,

        obs_count:
          observations.length,

        mean_min_samples:
          MIN_SAMPLES_FOR_MEAN,

        stats_min_samples:
          MIN_SAMPLES_FOR_STATS,

        coverage_stats: {
          rh_ok:
            humidityStatsOk,

          press_ok:
            pressureStatsOk,

          uv_ok:
            uvStatsOk,

          solar_ok:
            solarStatsOk,

          rh_count:
            humidityCount,

          press_count:
            pressureCount,

          uv_count:
            uvCount,

          solar_count:
            solarCount,
        },
      });

      /*
       * I file intraday continuano a contenere
       * un record ogni 15 minuti.
       *
       * Il rain rate viene ricavato dai delta
       * dell'accumulo pluviometrico.
       */
      const intraday = observations.map(
        (row, index) => ({
          t:
            `${date} ` +
            `${String(row.time).slice(0, 5)}`,

          temp_c:
            numOrNull(row.temp_c),

          dewpoint_c:
            numOrNull(
              row.dewpoint_c
            ),

          rh_pct:
            numOrNull(row.rh_pct),

          wind_dir_txt:
            row.wind_dir_txt === "" ||
            row.wind_dir_txt == null
              ? null
              : String(
                  row.wind_dir_txt
                ),

          wind_dir_deg:
            numOrNull(
              row.wind_dir_deg
            ),

          wind_kmh:
            numOrNull(row.wind_kmh),

          gust_kmh:
            numOrNull(row.gust_kmh),

          press_hpa:
            numOrNull(
              row.press_hpa
            ),

          uv:
            numOrNull(row.uv),

          solar_wm2:
            numOrNull(
              row.solar_wm2
            ),

          rain_15m_mm:
            Number.isFinite(
              rainDeltas15[index]
            )
              ? rainDeltas15[index]
              : null,

          rain_acc_mm:
            numOrNull(
              row.rain_acc_mm
            ),

          rain_rate_mmph:
            Number.isFinite(
              rainRates15[index]
            )
              ? rainRates15[index]
              : null,
        })
      );

      fs.writeFileSync(
        path.join(
          OUT_INTRADAY_DIR,
          `${date}.json`
        ),
        JSON.stringify(intraday)
      );
    }

    fs.writeFileSync(
      OUT_DAILY,
      JSON.stringify(
        daily,
        null,
        2
      )
    );

    const elapsed =
      Date.now() - started;

    console.log(
      `[build-data] OK: ${daily.length} giorni ` +
      `-> ${OUT_DAILY} (${elapsed} ms)`
    );
  } catch (error) {
    console.error(
      "[build-data] ERRORE:",
      error
    );
  } finally {
    isBuilding = false;
  }
}

// ==================== watch ====================
function watchAndRebuild() {
  if (!fs.existsSync(IN_DIR)) {
    console.log(
      "[watch] Cartella non trovata:",
      IN_DIR
    );

    process.exit(1);
  }

  console.log(
    "[watch] Attivo su:",
    IN_DIR
  );

  console.log(
    "[watch] Ogni modifica CSV/TXT " +
    "rigenera daily.json e intraday/*.json"
  );

  let timer = null;

  const schedule = () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(
      () => buildOnce(),
      WATCH_DEBOUNCE_MS
    );
  };

  const watchers = new Map();

  function watchDir(directoryPath) {
    if (
      watchers.has(directoryPath)
    ) {
      return;
    }

    const watcher = fs.watch(
      directoryPath,
      {
        persistent: true,
      },
      () => {
        schedule();
      }
    );

    watchers.set(
      directoryPath,
      watcher
    );

    for (
      const name
      of fs.readdirSync(
        directoryPath
      )
    ) {
      if (
        !name ||
        name.startsWith(".")
      ) {
        continue;
      }

      const full = path.join(
        directoryPath,
        name
      );

      try {
        if (
          fs
            .statSync(full)
            .isDirectory()
        ) {
          watchDir(full);
        }
      } catch (_) {
        // Ignora file rimossi durante la scansione.
      }
    }
  }

  watchDir(IN_DIR);

  setInterval(() => {
    try {
      const stack = [IN_DIR];

      while (stack.length) {
        const directoryPath =
          stack.pop();

        if (
          !watchers.has(
            directoryPath
          )
        ) {
          watchDir(
            directoryPath
          );
        }

        for (
          const name
          of fs.readdirSync(
            directoryPath
          )
        ) {
          if (
            !name ||
            name.startsWith(".")
          ) {
            continue;
          }

          const full = path.join(
            directoryPath,
            name
          );

          try {
            if (
              fs
                .statSync(full)
                .isDirectory()
            ) {
              stack.push(full);
            }
          } catch (_) {
            // Ignora file rimossi durante la scansione.
          }
        }
      }
    } catch (_) {
      // Evita di interrompere il watch.
    }
  }, 2000);

  buildOnce();
}

// ==================== entry ====================
const args =
  process.argv.slice(2);

if (
  args.includes("--watch") ||
  args.includes("-w")
) {
  watchAndRebuild();
} else {
  buildOnce();
}
