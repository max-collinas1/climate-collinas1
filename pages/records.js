import fs from "fs";
import path from "path";
import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import SiteLayout from "../components/SiteLayout";
import SiteHeader from "../components/SiteHeader";

// -------------------- data load --------------------
function readJsonFile(relPath, fallback) {
  const filePath = path.join(process.cwd(), relPath);
  if (!fs.existsSync(filePath)) return fallback;

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readRecords() {
  return readJsonFile(path.join("data", "record.json"), null);
}

function readDaily() {
  const rows = readJsonFile(path.join("data", "daily.json"), []);
  return Array.isArray(rows) ? rows : [];
}

export async function getStaticProps() {
  const rawRecords = readRecords();
  const dailyRows = readDaily();
  const records = enhanceRecordsWithDaily(rawRecords, dailyRows);

  return { props: { records } };
}

// -------------------- helpers --------------------
function n(x) {
  if (x === null || x === undefined || x === "") return NaN;

  if (typeof x === "string") {
    const cleaned = x.trim().replace(",", ".");
    if (!cleaned) return NaN;
    const v = Number(cleaned);
    return Number.isFinite(v) ? v : NaN;
  }

  const v = Number(x);
  return Number.isFinite(v) ? v : NaN;
}

function fmt(x, d = 1) {
  const v = n(x);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(d);
}

function fmtDateIT(yyyyMMdd) {
  if (yyyyMMdd === null || yyyyMMdd === undefined || yyyyMMdd === "") return "—";

  const s = String(yyyyMMdd).trim();
  if (s.length < 10) return s || "—";

  const y = s.slice(0, 4);
  const m = s.slice(5, 7);
  const d = s.slice(8, 10);

  if (!/^\d{4}$/.test(y) || !/^\d{2}$/.test(m) || !/^\d{2}$/.test(d)) {
    return s;
  }

  return `${d}/${m}/${y}`;
}

function fmtGeneratedAt(iso) {
  if (!iso || typeof iso !== "string") return "—";

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
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

function hasArray(v) {
  return Array.isArray(v) && v.length > 0;
}

function normalizeKey(k) {
  return String(k || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getValueByAliases(row, aliases) {
  if (!row || typeof row !== "object") return NaN;

  for (const key of aliases) {
    const v = n(row?.[key]);
    if (Number.isFinite(v)) return v;
  }

  const normalized = {};
  for (const key of Object.keys(row)) {
    normalized[normalizeKey(key)] = row[key];
  }

  for (const key of aliases) {
    const v = n(normalized[normalizeKey(key)]);
    if (Number.isFinite(v)) return v;
  }

  return NaN;
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

function pickFirstValue(row, keys) {
  if (!row || typeof row !== "object") return "";

  for (const key of keys) {
    const v = row?.[key];
    if (v !== null && v !== undefined && v !== "") return v;
  }

  return "";
}

function getPeriodLabel(row) {
  if (!row || typeof row !== "object") return "";

  const explicitPeriod = pickFirstValue(row, [
    "period",
    "periodo",
    "range",
    "date_range",
    "dateRange",
    "spell_period",
    "spellPeriod",
    "dry_spell_period",
    "drySpellPeriod",
    "wet_spell_period",
    "wetSpellPeriod",
    "rain_spell_period",
    "rainSpellPeriod",
  ]);

  if (explicitPeriod) return String(explicitPeriod);

  const start = pickFirstValue(row, [
    "start",
    "from",
    "dal",
    "date_start",
    "start_date",
    "startDate",
    "period_start",
    "periodStart",
    "spell_start",
    "spellStart",
    "dry_spell_start",
    "drySpellStart",
    "wet_spell_start",
    "wetSpellStart",
    "rain_spell_start",
    "rainSpellStart",
  ]);

  const end = pickFirstValue(row, [
    "end",
    "to",
    "al",
    "date_end",
    "end_date",
    "endDate",
    "period_end",
    "periodEnd",
    "spell_end",
    "spellEnd",
    "dry_spell_end",
    "drySpellEnd",
    "wet_spell_end",
    "wetSpellEnd",
    "rain_spell_end",
    "rainSpellEnd",
  ]);

  if (start && end) return `dal ${fmtDateIT(start)} al ${fmtDateIT(end)}`;
  if (start) return `dal ${fmtDateIT(start)}`;
  if (end) return `fino al ${fmtDateIT(end)}`;

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
    if (hasArray(v)) return v;
  }

  return [];
}

function makeCard(title, rows, unit, digits, paramKey, arpasMode = "", opts = {}) {
  return {
    title,
    rows: Array.isArray(rows) ? rows : [],
    unit,
    digits,
    paramKey,
    arpasMode,
    tone: opts.tone || "neutral",
    group: opts.group || "",
    groupTone: opts.groupTone || opts.tone || "neutral",
    showPeriod: !!opts.showPeriod,
    skipCoverageFilter: !!opts.skipCoverageFilter,
  };
}

function inGroup(group, groupTone, cards) {
  return cards.map((card) => ({
    ...card,
    group,
    groupTone: groupTone || card.groupTone || card.tone || "neutral",
  }));
}

// -------------------- computed records from daily.json --------------------
const FIELD_ALIASES = {
  tmax: [
    "tmax",
    "t_max",
    "temp_max",
    "tempmax",
    "temperature_max",
    "max_temp",
    "outTempHigh",
    "out_temp_high",
    "hi_temp",
    "high_temp",
    "high_temperature",
    "temperatureHigh",
    "temperature_high",
  ],
  tmean: [
    "tmean",
    "tavg",
    "t_avg",
    "temp_mean",
    "temp_avg",
    "tempmean",
    "tempavg",
    "temperature_mean",
    "temperature_avg",
    "mean_temp",
    "avg_temp",
    "outTemp",
    "out_temp",
    "temperature",
  ],
  tmin: [
    "tmin",
    "t_min",
    "temp_min",
    "tempmin",
    "temperature_min",
    "min_temp",
    "outTempLow",
    "out_temp_low",
    "low_temp",
    "low_temperature",
    "temperatureLow",
    "temperature_low",
  ],
  trange: [
    "trange",
    "t_range",
    "temp_range",
    "temperature_range",
    "thermal_range",
    "escursione",
    "escursione_termica",
  ],
  rain: [
    "rain",
    "rain_total",
    "rainfall",
    "rain_mm",
    "precip",
    "precipitation",
    "precip_total",
    "daily_rain",
    "pioggia",
  ],
  windMean: [
    "wind_avg",
    "wind_mean",
    "wind",
    "wind_speed_avg",
    "windSpeedAvg",
    "wind_speed_mean",
    "avg_wind",
    "average_wind",
    "mean_wind",
    "windAvg",
    "windMean",
  ],
  gustMean: [
    "gust_mean",
    "gust_avg",
    "gust",
    "wind_gust_avg",
    "windGustAvg",
    "wind_gust_mean",
    "avg_gust",
    "average_gust",
    "mean_gust",
    "gustAvg",
    "gustMean",
    "gust_max",
    "gustMax",
    "wind_gust_max",
  ],
  pressMax: [
    "press_max",
    "pressure_max",
    "barom_max",
    "barometer_max",
    "max_pressure",
    "maxPressure",
    "pressureHigh",
    "pressure_high",
    "barometerHigh",
    "barometer_high",
    "baromHigh",
    "barom_high",
  ],
  pressMean: [
    "press_mean",
    "press_avg",
    "pressure_mean",
    "pressure_avg",
    "barom_mean",
    "barom_avg",
    "barometer_mean",
    "barometer_avg",
    "mean_pressure",
    "avg_pressure",
    "pressure",
    "barometer",
    "barom",
  ],
  pressMin: [
    "press_min",
    "pressure_min",
    "barom_min",
    "barometer_min",
    "min_pressure",
    "minPressure",
    "pressureLow",
    "pressure_low",
    "barometerLow",
    "barometer_low",
    "baromLow",
    "barom_low",
  ],
  rhMax: [
    "rh_max",
    "humidity_max",
    "hum_max",
    "relative_humidity_max",
    "max_humidity",
    "maxHumidity",
    "humidityHigh",
    "humidity_high",
    "rhHigh",
    "rh_high",
  ],
  rhMean: [
    "rh_mean",
    "rh_avg",
    "humidity_mean",
    "humidity_avg",
    "hum_mean",
    "hum_avg",
    "relative_humidity_mean",
    "humidity",
    "rh",
    "humidityAvg",
    "humidity_avg",
    "rhAvg",
    "rh_avg",
  ],
  rhMin: [
    "rh_min",
    "humidity_min",
    "hum_min",
    "relative_humidity_min",
    "min_humidity",
    "minHumidity",
    "humidityLow",
    "humidity_low",
    "rhLow",
    "rh_low",
  ],
  uvMean: [
    "uv_mean",
    "uv_avg",
    "uv",
    "uv_index_mean",
    "uv_index_avg",
    "uvIndexMean",
    "uvIndexAvg",
    "uvMean",
    "uvAvg",
    "uv_max",
    "uvMax",
    "uv_index",
  ],
  solarMean: [
    "solar_mean",
    "solar_avg",
    "solar",
    "solar_rad_mean",
    "solar_rad_avg",
    "solar_radiation_mean",
    "solar_radiation_avg",
    "radiation_mean",
    "radiation_avg",
    "solarRadiation",
    "solarRadiationAvg",
    "solarRadiationMean",
    "solar_max",
    "solarMax",
    "radiation_max",
    "radiazione",
    "radiazione_media",
  ],
};

function parseDailyDate(row) {
  const raw = row?.date || row?.data || row?.day || row?.giorno;
  if (!raw) return null;

  const s = String(raw).trim();

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return {
      year: Number(iso[1]),
      month: Number(iso[2]),
      day: Number(iso[3]),
      date: `${iso[1]}-${iso[2]}-${iso[3]}`,
    };
  }

  const it = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (it) {
    return {
      year: Number(it[3]),
      month: Number(it[2]),
      day: Number(it[1]),
      date: `${it[3]}-${it[2]}-${it[1]}`,
    };
  }

  return null;
}

function daysInMonth(year, month) {
  return new Date(Number(year), Number(month), 0).getDate();
}

function daysInYear(year) {
  const y = Number(year);
  return new Date(y, 1, 29).getMonth() === 1 ? 366 : 365;
}

function avg(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return NaN;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function sum(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return NaN;
  return valid.reduce((a, b) => a + b, 0);
}

function pushFinite(arr, value) {
  if (Number.isFinite(value)) arr.push(value);
}

function makeRankRow(base, value, coverage = NaN) {
  const row = {
    ...base,
    value,
  };

  if (Number.isFinite(coverage)) {
    row.coverage = coverage;
  }

  return row;
}

function sortHigh(arr) {
  return arr
    .filter((r) => Number.isFinite(n(r.value)))
    .sort((a, b) => n(b.value) - n(a.value));
}

function sortLow(arr) {
  return arr
    .filter((r) => Number.isFinite(n(r.value)))
    .sort((a, b) => n(a.value) - n(b.value));
}

function scopeMergePreferExisting(existing = {}, computed = {}) {
  const out = { ...(computed || {}) };

  for (const key of Object.keys(existing || {})) {
    const existingValue = existing[key];
    const computedValue = computed?.[key];

    if (Array.isArray(existingValue)) {
      out[key] = existingValue.length ? existingValue : computedValue || [];
    } else if (
      existingValue &&
      typeof existingValue === "object" &&
      !Array.isArray(existingValue) &&
      computedValue &&
      typeof computedValue === "object" &&
      !Array.isArray(computedValue)
    ) {
      out[key] = scopeMergePreferExisting(existingValue, computedValue);
    } else if (existingValue !== undefined && existingValue !== null && existingValue !== "") {
      out[key] = existingValue;
    } else {
      out[key] = computedValue;
    }
  }

  return out;
}

function makeEmptyAgg(year, month = null) {
  return {
    year,
    month,
    daysExpected: month ? daysInMonth(year, month) : daysInYear(year),
    daysSeen: new Set(),
    tmax: [],
    tmean: [],
    tmin: [],
    trange: [],
    rain: [],
    windMean: [],
    gustMean: [],
    pressMax: [],
    pressMean: [],
    pressMin: [],
    rhMax: [],
    rhMean: [],
    rhMin: [],
    uvMean: [],
    solarMean: [],
  };
}

function computeRecordsFromDaily(dailyRows) {
  const monthlyAgg = new Map();
  const yearlyAgg = new Map();

  for (const row of dailyRows || []) {
    const dt = parseDailyDate(row);
    if (!dt || !dt.year || !dt.month) continue;

    const yy = String(dt.year);
    const mm = String(dt.month).padStart(2, "0");
    const ym = `${yy}-${mm}`;

    if (!monthlyAgg.has(ym)) {
      monthlyAgg.set(ym, makeEmptyAgg(dt.year, dt.month));
    }

    if (!yearlyAgg.has(yy)) {
      yearlyAgg.set(yy, makeEmptyAgg(dt.year));
    }

    const mAgg = monthlyAgg.get(ym);
    const yAgg = yearlyAgg.get(yy);

    mAgg.daysSeen.add(dt.date);
    yAgg.daysSeen.add(dt.date);

    const vals = {
      tmax: getValueByAliases(row, FIELD_ALIASES.tmax),
      tmean: getValueByAliases(row, FIELD_ALIASES.tmean),
      tmin: getValueByAliases(row, FIELD_ALIASES.tmin),
      trange: getValueByAliases(row, FIELD_ALIASES.trange),
      rain: getValueByAliases(row, FIELD_ALIASES.rain),
      windMean: getValueByAliases(row, FIELD_ALIASES.windMean),
      gustMean: getValueByAliases(row, FIELD_ALIASES.gustMean),
      pressMax: getValueByAliases(row, FIELD_ALIASES.pressMax),
      pressMean: getValueByAliases(row, FIELD_ALIASES.pressMean),
      pressMin: getValueByAliases(row, FIELD_ALIASES.pressMin),
      rhMax: getValueByAliases(row, FIELD_ALIASES.rhMax),
      rhMean: getValueByAliases(row, FIELD_ALIASES.rhMean),
      rhMin: getValueByAliases(row, FIELD_ALIASES.rhMin),
      uvMean: getValueByAliases(row, FIELD_ALIASES.uvMean),
      solarMean: getValueByAliases(row, FIELD_ALIASES.solarMean),
    };

    if (!Number.isFinite(vals.trange) && Number.isFinite(vals.tmax) && Number.isFinite(vals.tmin)) {
      vals.trange = vals.tmax - vals.tmin;
    }

    for (const agg of [mAgg, yAgg]) {
      pushFinite(agg.tmax, vals.tmax);
      pushFinite(agg.tmean, vals.tmean);
      pushFinite(agg.tmin, vals.tmin);
      pushFinite(agg.trange, vals.trange);
      pushFinite(agg.rain, vals.rain);
      pushFinite(agg.windMean, vals.windMean);
      pushFinite(agg.gustMean, vals.gustMean);
      pushFinite(agg.pressMax, vals.pressMax);
      pushFinite(agg.pressMean, vals.pressMean);
      pushFinite(agg.pressMin, vals.pressMin);
      pushFinite(agg.rhMax, vals.rhMax);
      pushFinite(agg.rhMean, vals.rhMean);
      pushFinite(agg.rhMin, vals.rhMin);
      pushFinite(agg.uvMean, vals.uvMean);
      pushFinite(agg.solarMean, vals.solarMean);
    }
  }

  const monthlyRows = [];

  for (const agg of monthlyAgg.values()) {
    const coverage = agg.daysSeen.size / agg.daysExpected;

    monthlyRows.push({
      year: agg.year,
      month: agg.month,
      coverage,

      tmaxMean: avg(agg.tmax),
      tmean: avg(agg.tmean),
      tminMean: avg(agg.tmin),
      trangeMean: avg(agg.trange),

      rainTotal: sum(agg.rain),
      rainDaysOver1: agg.rain.filter((v) => Number.isFinite(v) && v > 1).length,

      windMean: avg(agg.windMean),
      gustMean: avg(agg.gustMean),

      pressMaxMean: avg(agg.pressMax),
      pressMean: avg(agg.pressMean),
      pressMinMean: avg(agg.pressMin),

      rhMaxMean: avg(agg.rhMax),
      rhMean: avg(agg.rhMean),
      rhMinMean: avg(agg.rhMin),

      uvMean: avg(agg.uvMean),
      solarMean: avg(agg.solarMean),
    });
  }

  const yearlyRows = [];

  for (const agg of yearlyAgg.values()) {
    const coverage = agg.daysSeen.size / agg.daysExpected;

    yearlyRows.push({
      year: agg.year,
      coverage,

      tmaxMean: avg(agg.tmax),
      tmean: avg(agg.tmean),
      tminMean: avg(agg.tmin),
      trangeMean: avg(agg.trange),

      pressMaxMean: avg(agg.pressMax),
      pressMean: avg(agg.pressMean),
      pressMinMean: avg(agg.pressMin),

      rhMaxMean: avg(agg.rhMax),
      rhMean: avg(agg.rhMean),
      rhMinMean: avg(agg.rhMin),

      uvMean: avg(agg.uvMean),
      solarMean: avg(agg.solarMean),
    });
  }

  const monthlyByMonth = {};

  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, "0");
    const rows = monthlyRows.filter((r) => Number(r.month) === m);

    monthlyByMonth[mm] = {
      tmax_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.tmaxMean, r.coverage))),
      tmax_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.tmaxMean, r.coverage))),
      tmean_high: sortHigh(rows.map((r) => makeRankRow(r, r.tmean, r.coverage))),
      tmean_low: sortLow(rows.map((r) => makeRankRow(r, r.tmean, r.coverage))),
      tmin_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.tminMean, r.coverage))),
      tmin_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.tminMean, r.coverage))),
      trange_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.trangeMean, r.coverage))),
      trange_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.trangeMean, r.coverage))),

      rain_days_over_1mm_high: sortHigh(rows.map((r) => makeRankRow(r, r.rainDaysOver1, r.coverage))),
      rain_days_over_1mm_low: sortLow(rows.map((r) => makeRankRow(r, r.rainDaysOver1, r.coverage))),

      wind_avg_high: sortHigh(rows.map((r) => makeRankRow(r, r.windMean, r.coverage))),
      gust_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.gustMean, r.coverage))),

      press_max_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.pressMaxMean, r.coverage))),
      press_max_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.pressMaxMean, r.coverage))),
      press_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.pressMean, r.coverage))),
      press_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.pressMean, r.coverage))),
      press_min_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.pressMinMean, r.coverage))),
      press_min_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.pressMinMean, r.coverage))),

      rh_max_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.rhMaxMean, r.coverage))),
      rh_max_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.rhMaxMean, r.coverage))),
      rh_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.rhMean, r.coverage))),
      rh_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.rhMean, r.coverage))),
      rh_min_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.rhMinMean, r.coverage))),
      rh_min_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.rhMinMean, r.coverage))),

      uv_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.uvMean, r.coverage))),
      uv_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.uvMean, r.coverage))),
      solar_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.solarMean, r.coverage))),
      solar_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.solarMean, r.coverage))),
    };
  }

  const yearly = {
    tmax_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.tmaxMean, r.coverage))),
    tmax_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.tmaxMean, r.coverage))),
    tmean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.tmean, r.coverage))),
    tmean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.tmean, r.coverage))),
    tmin_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.tminMean, r.coverage))),
    tmin_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.tminMean, r.coverage))),
    trange_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.trangeMean, r.coverage))),
    trange_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.trangeMean, r.coverage))),

    press_max_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.pressMaxMean, r.coverage))),
    press_max_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.pressMaxMean, r.coverage))),
    press_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.pressMean, r.coverage))),
    press_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.pressMean, r.coverage))),
    press_min_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.pressMinMean, r.coverage))),
    press_min_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.pressMinMean, r.coverage))),

    rh_max_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.rhMaxMean, r.coverage))),
    rh_max_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.rhMaxMean, r.coverage))),
    rh_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.rhMean, r.coverage))),
    rh_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.rhMean, r.coverage))),
    rh_min_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.rhMinMean, r.coverage))),
    rh_min_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.rhMinMean, r.coverage))),

    uv_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.uvMean, r.coverage))),
    uv_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.uvMean, r.coverage))),
    solar_mean_high: sortHigh(yearlyRows.map((r) => makeRankRow(r, r.solarMean, r.coverage))),
    solar_mean_low: sortLow(yearlyRows.map((r) => makeRankRow(r, r.solarMean, r.coverage))),
  };

  return {
    monthly: {
      by_month: monthlyByMonth,
    },
    yearly,
  };
}

function enhanceRecordsWithDaily(rawRecords, dailyRows) {
  if (!rawRecords && (!Array.isArray(dailyRows) || dailyRows.length === 0)) {
    return null;
  }

  const base = rawRecords
    ? JSON.parse(JSON.stringify(rawRecords))
    : {
        generated_at: new Date().toISOString(),
        top_n: 20,
        daily: {},
        monthly: { by_month: {} },
        yearly: {},
      };

  const computed = computeRecordsFromDaily(dailyRows);

  base.monthly = {
    ...(base.monthly || {}),
    by_month: {
      ...(base.monthly?.by_month || {}),
    },
  };

  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, "0");
    base.monthly.by_month[mm] = scopeMergePreferExisting(
      base.monthly.by_month[mm] || {},
      computed.monthly.by_month[mm] || {}
    );
  }

  base.yearly = scopeMergePreferExisting(base.yearly || {}, computed.yearly || {});

  return base;
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
      ...inGroup("Valori termici", "tempHigh", [
        makeCard("Temperature massime giornaliere più alte", scope?.tmax_abs_high || scope?.tmax_mean_high, "°C", 1, "temperature", "", { tone: "tempHigh" }),
        makeCard("Temperature medie giornaliere più alte", scope?.tmean_high, "°C", 1, "temperature", "", { tone: "tempHigh" }),
        makeCard("Temperature minime giornaliere più alte", scope?.tmin_abs_high || scope?.tmin_mean_high, "°C", 1, "temperature", "", { tone: "tempHigh" }),
        makeCard("Temperature massime giornaliere più basse", scope?.tmax_abs_low || scope?.tmax_mean_low, "°C", 1, "temperature", "", { tone: "tempLow" }),
        makeCard("Temperature medie giornaliere più basse", scope?.tmean_low, "°C", 1, "temperature", "", { tone: "tempLow" }),
        makeCard("Temperature minime giornaliere più basse", scope?.tmin_abs_low || scope?.tmin_mean_low, "°C", 1, "temperature", "", { tone: "tempLow" }),
      ]),
      ...inGroup("Escursione termica", "tempRangeHigh", [
        makeCard("Escursione termica giornaliera più alta", scope?.trange_high, "°C", 1, "temperature", "", { tone: "tempRangeHigh" }),
        makeCard("Escursione termica giornaliera più bassa", scope?.trange_low, "°C", 1, "temperature", "", { tone: "tempRangeLow" }),
      ]),
    ],

    precip: [
      ...inGroup("Accumulo giornaliero", "rainHigh", [
        makeCard("Precipitazioni massime", scope?.rain_total_high, "mm", 1, "rain", "", { tone: "rainHigh" }),
      ]),
      ...inGroup("Intensità e accumuli brevi", "rainHigh", [
        makeCard("Rain rate massimo", scope?.rainrate_max_high, "mm/h", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Pioggia massima 15 min", scope?.rain_15m_high, "mm", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Pioggia massima 30 min", scope?.rain_30m_high, "mm", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Pioggia massima 1 ora", scope?.rain_1h_high, "mm", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Pioggia massima 6 ore", scope?.rain_6h_high, "mm", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Pioggia massima 12 ore", scope?.rain_12h_high, "mm", 1, "rain", "", { tone: "rainHigh" }),
      ]),
    ],

    wind: [
      ...inGroup("Vento e raffiche", "windHigh", [
        makeCard("Raffiche massime", scope?.gust_max_high, "km/h", 1, "wind", "", { tone: "windHigh" }),
        makeCard("Raffiche medie più alte", scope?.gust_mean_high, "km/h", 1, "wind", "", { tone: "windHigh" }),
        makeCard("Vento medio più alto", scope?.wind_avg_high, "km/h", 1, "wind", "", { tone: "windHigh" }),
        makeCard("Vento massimo più alto", scope?.wind_max_high, "km/h", 1, "wind", "", { tone: "windHigh" }),
      ]),
    ],

    press: [
      ...inGroup("Valori di pressione", "pressHigh", [
        makeCard("Pressione minima", scope?.press_min_low, "hPa", 1, "pressure", "", { tone: "pressLow" }),
        makeCard("Pressione massima", scope?.press_max_high, "hPa", 1, "pressure", "", { tone: "pressHigh" }),
      ]),
      ...inGroup("Variazioni di pressione", "pressLow", [
        makeCard("Calo pressione", scope?.press_drop_nextday_high, "hPa", 1, "pressure", "", { tone: "pressLow" }),
        makeCard("Aumento pressione", scope?.press_rise_prevday_high, "hPa", 1, "pressure", "", { tone: "pressHigh" }),
      ]),
    ],

    rh: [
      ...inGroup("Umidità relativa", "humHigh", [
        makeCard("Umidità minima", scope?.rh_min_low, "%", 0, "humidity", "", { tone: "humLow" }),
        makeCard("Umidità massima", scope?.rh_max_high, "%", 0, "humidity", "", { tone: "humHigh" }),
        makeCard("Umidità media più alta", scope?.rh_mean_high, "%", 0, "humidity", "", { tone: "humHigh" }),
      ]),
    ],

    rad: [
      ...inGroup("Radiazione e UV", "radHigh", [
        makeCard("UV massimo", scope?.uv_max_high, "", 1, "radiation", "", { tone: "radHigh" }),
        makeCard("Radiazione massima", scope?.solar_max_high, "W/m²", 0, "radiation", "", { tone: "radHigh" }),
      ]),
    ],
  };

  return (cards[cat] || []).filter((c) => c.rows.length > 0);
}

function getMonthlyCards(cat, scope) {
  const cards = {
    temp: [
      ...inGroup("Valori termici mensili più alti", "tempHigh", [
        makeCard(
          "Temperature massime più alte",
          pickFirstArray(scope, ["tmax_mean_high", "tmax_avg_high", "monthly_tmax_mean_high", "tmax_abs_high"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempHigh" }
        ),
        makeCard(
          "Temperature medie più alte",
          pickFirstArray(scope, ["tmean_high", "tmean_avg_high", "tavg_high", "monthly_tmean_high"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempHigh" }
        ),
        makeCard(
          "Temperature minime più alte",
          pickFirstArray(scope, ["tmin_mean_high", "tmin_avg_high", "monthly_tmin_mean_high", "tmin_abs_high"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempHigh" }
        ),
      ]),
      ...inGroup("Valori termici mensili più bassi", "tempLow", [
        makeCard(
          "Temperature massime più basse",
          pickFirstArray(scope, ["tmax_mean_low", "tmax_avg_low", "monthly_tmax_mean_low", "tmax_abs_low"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempLow" }
        ),
        makeCard(
          "Temperature medie più basse",
          pickFirstArray(scope, ["tmean_low", "tmean_avg_low", "tavg_low", "monthly_tmean_low"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempLow" }
        ),
        makeCard(
          "Temperature minime più basse",
          pickFirstArray(scope, ["tmin_mean_low", "tmin_avg_low", "monthly_tmin_mean_low", "tmin_abs_low"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempLow" }
        ),
      ]),
      ...inGroup("Escursione termica mensile", "tempRangeHigh", [
        makeCard(
          "Escursione termica più alta",
          pickFirstArray(scope, ["trange_mean_high", "trange_high", "monthly_trange_mean_high"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempRangeHigh" }
        ),
        makeCard(
          "Escursione termica più bassa",
          pickFirstArray(scope, ["trange_mean_low", "trange_low", "monthly_trange_mean_low"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempRangeLow" }
        ),
      ]),
    ],

    precip: [
      ...inGroup("Totali mensili", "rainHigh", [
        makeCard(
          "Precipitazioni mensili più alte",
          pickFirstArray(scope, ["rain_total_high", "monthly_rain_total_high", "precip_total_high"]),
          "mm",
          1,
          "rain",
          "rain_total",
          { tone: "rainHigh" }
        ),
        makeCard(
          "Precipitazioni mensili più basse",
          pickFirstArray(scope, ["rain_total_low", "monthly_rain_total_low", "precip_total_low"]),
          "mm",
          1,
          "rain",
          "rain_total",
          { tone: "rainLow" }
        ),
      ]),
      ...inGroup("Giorni piovosi mensili", "rainHigh", [
        makeCard(
          "Mesi con più giorni piovosi > 1 mm",
          pickFirstArray(scope, ["rain_days_over_1mm_high", "rain_days_gt_1mm_high", "rain_days_high", "wet_days_high", "days_rain_gt_1mm_high", "monthly_rain_days_gt_1mm_high"]),
          "gg",
          0,
          "rain",
          "",
          { tone: "rainHigh", skipCoverageFilter: true }
        ),
        makeCard(
          "Mesi con meno giorni piovosi > 1 mm",
          pickFirstArray(scope, ["rain_days_over_1mm_low", "rain_days_gt_1mm_low", "rain_days_low", "wet_days_low", "days_rain_gt_1mm_low", "monthly_rain_days_gt_1mm_low"]),
          "gg",
          0,
          "rain",
          "",
          { tone: "rainLow", skipCoverageFilter: true }
        ),
      ]),
      ...inGroup("Intensità e accumuli brevi", "rainHigh", [
        makeCard("Rain rate massimo", pickFirstArray(scope, ["rainrate_max_high", "rain_rate_high", "monthly_rainrate_max_high"]), "mm/h", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Pioggia massima 15 min", pickFirstArray(scope, ["rain_15m_high", "monthly_rain_15m_high"]), "mm", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Pioggia massima 30 min", pickFirstArray(scope, ["rain_30m_high", "monthly_rain_30m_high"]), "mm", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Pioggia massima 1 ora", pickFirstArray(scope, ["rain_1h_high", "monthly_rain_1h_high"]), "mm", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Pioggia massima 6 ore", pickFirstArray(scope, ["rain_6h_high", "monthly_rain_6h_high"]), "mm", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Pioggia massima 12 ore", pickFirstArray(scope, ["rain_12h_high", "monthly_rain_12h_high"]), "mm", 1, "rain", "", { tone: "rainHigh" }),
      ]),
    ],

    wind: [
      ...inGroup("Vento mensile", "windHigh", [
        makeCard(
          "Vento medio mensile più alto",
          pickFirstArray(scope, ["wind_avg_high", "wind_mean_high", "monthly_wind_mean_high"]),
          "km/h",
          1,
          "wind",
          "",
          { tone: "windHigh" }
        ),
        makeCard(
          "Raffiche medie mensili più alte",
          pickFirstArray(scope, ["gust_mean_high", "gust_avg_high", "monthly_gust_mean_high"]),
          "km/h",
          1,
          "wind",
          "",
          { tone: "windHigh" }
        ),
      ]),
    ],

    press: [
      ...inGroup("Pressione mensile più alta", "pressHigh", [
        makeCard(
          "Pressione massima più alta",
          pickFirstArray(scope, ["press_max_mean_high", "press_mean_max_high", "monthly_press_max_mean_high", "pressure_max_mean_high"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressHigh" }
        ),
        makeCard(
          "Pressione media più alta",
          pickFirstArray(scope, ["press_mean_high", "press_avg_high", "monthly_press_mean_high", "pressure_mean_high"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressHigh" }
        ),
        makeCard(
          "Pressione minima più alta",
          pickFirstArray(scope, ["press_min_mean_high", "press_mean_min_high", "monthly_press_min_mean_high", "pressure_min_mean_high"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressHigh" }
        ),
      ]),
      ...inGroup("Pressione mensile più bassa", "pressLow", [
        makeCard(
          "Pressione massima più bassa",
          pickFirstArray(scope, ["press_max_mean_low", "press_mean_max_low", "monthly_press_max_mean_low", "pressure_max_mean_low"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressLow" }
        ),
        makeCard(
          "Pressione media più bassa",
          pickFirstArray(scope, ["press_mean_low", "press_avg_low", "monthly_press_mean_low", "pressure_mean_low"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressLow" }
        ),
        makeCard(
          "Pressione minima più bassa",
          pickFirstArray(scope, ["press_min_mean_low", "press_mean_min_low", "monthly_press_min_mean_low", "pressure_min_mean_low"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressLow" }
        ),
      ]),
    ],

    rh: [
      ...inGroup("Umidità mensile più alta", "humHigh", [
        makeCard(
          "Umidità massima più alta",
          pickFirstArray(scope, ["rh_max_mean_high", "rh_mean_max_high", "monthly_rh_max_mean_high", "humidity_max_mean_high"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humHigh" }
        ),
        makeCard(
          "Umidità media più alta",
          pickFirstArray(scope, ["rh_mean_high", "rh_avg_high", "monthly_rh_mean_high", "humidity_mean_high"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humHigh" }
        ),
        makeCard(
          "Umidità minima più alta",
          pickFirstArray(scope, ["rh_min_mean_high", "rh_mean_min_high", "monthly_rh_min_mean_high", "humidity_min_mean_high"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humHigh" }
        ),
      ]),
      ...inGroup("Umidità mensile più bassa", "humLow", [
        makeCard(
          "Umidità massima più bassa",
          pickFirstArray(scope, ["rh_max_mean_low", "rh_mean_max_low", "monthly_rh_max_mean_low", "humidity_max_mean_low"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humLow" }
        ),
        makeCard(
          "Umidità media più bassa",
          pickFirstArray(scope, ["rh_mean_low", "rh_avg_low", "monthly_rh_mean_low", "humidity_mean_low"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humLow" }
        ),
        makeCard(
          "Umidità minima più bassa",
          pickFirstArray(scope, ["rh_min_mean_low", "rh_mean_min_low", "monthly_rh_min_mean_low", "humidity_min_mean_low"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humLow" }
        ),
      ]),
    ],

    rad: [
      ...inGroup("UV e radiazione mensile più alta", "radHigh", [
        makeCard(
          "UV medio mensile più alto",
          pickFirstArray(scope, ["uv_mean_high", "uv_avg_high", "monthly_uv_mean_high"]),
          "",
          1,
          "radiation",
          "",
          { tone: "radHigh" }
        ),
        makeCard(
          "Radiazione media mensile più alta",
          pickFirstArray(scope, ["solar_mean_high", "solar_avg_high", "radiation_mean_high", "monthly_solar_mean_high", "monthly_radiation_mean_high"]),
          "W/m²",
          0,
          "radiation",
          "",
          { tone: "radHigh" }
        ),
      ]),
      ...inGroup("UV e radiazione mensile più bassa", "radLow", [
        makeCard(
          "UV medio mensile più basso",
          pickFirstArray(scope, ["uv_mean_low", "uv_avg_low", "monthly_uv_mean_low"]),
          "",
          1,
          "radiation",
          "",
          { tone: "radLow" }
        ),
        makeCard(
          "Radiazione media mensile più bassa",
          pickFirstArray(scope, ["solar_mean_low", "solar_avg_low", "radiation_mean_low", "monthly_solar_mean_low", "monthly_radiation_mean_low"]),
          "W/m²",
          0,
          "radiation",
          "",
          { tone: "radLow" }
        ),
      ]),
    ],
  };

  return (cards[cat] || [])
    .map((c) => ({
      ...c,
      rows: c.skipCoverageFilter
        ? c.rows
        : filterRowsByCoverage(c.rows, c.paramKey, 0.95, c.arpasMode),
    }))
    .filter((c) => c.rows.length > 0);
}

function getYearlyCards(cat, scope) {
  const cards = {
    temp: [
      ...inGroup("Valori termici annuali più alti", "tempHigh", [
        makeCard(
          "Temperatura media massima annuale più alta",
          pickFirstArray(scope, ["tmax_mean_high", "tmax_avg_high", "tmax_ann_mean_high", "annual_tmax_mean_high"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempHigh" }
        ),
        makeCard(
          "Temperatura media assoluta annuale più alta",
          pickFirstArray(scope, ["tmean_high", "tmean_avg_high", "tavg_high", "tmean_ann_high", "annual_tmean_high"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempHigh" }
        ),
        makeCard(
          "Temperatura media minima annuale più alta",
          pickFirstArray(scope, ["tmin_mean_high", "tmin_avg_high", "tmin_ann_mean_high", "annual_tmin_mean_high"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempHigh" }
        ),
      ]),
      ...inGroup("Valori termici annuali più bassi", "tempLow", [
        makeCard(
          "Temperatura media massima annuale più bassa",
          pickFirstArray(scope, ["tmax_mean_low", "tmax_avg_low", "tmax_ann_mean_low", "annual_tmax_mean_low"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempLow" }
        ),
        makeCard(
          "Temperatura media assoluta annuale più bassa",
          pickFirstArray(scope, ["tmean_low", "tmean_avg_low", "tavg_low", "tmean_ann_low", "annual_tmean_low"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempLow" }
        ),
        makeCard(
          "Temperatura media minima annuale più bassa",
          pickFirstArray(scope, ["tmin_mean_low", "tmin_avg_low", "tmin_ann_mean_low", "annual_tmin_mean_low"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempLow" }
        ),
      ]),
      ...inGroup("Escursione termica annuale", "tempRangeHigh", [
        makeCard(
          "Escursione termica media annuale più alta",
          pickFirstArray(scope, ["trange_mean_high", "trange_high", "annual_trange_high", "annual_mean_trange_high"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempRangeHigh" }
        ),
        makeCard(
          "Escursione termica media annuale più bassa",
          pickFirstArray(scope, ["trange_mean_low", "trange_low", "annual_trange_low", "annual_mean_trange_low"]),
          "°C",
          1,
          "temperature",
          "",
          { tone: "tempRangeLow" }
        ),
      ]),
      ...inGroup("Frequenza termica", "tempHigh", [
        makeCard(
          "Giorni con Tmax > 35°C",
          pickFirstArray(scope, ["tmax_days_over_35_high", "tmax_days_gt_35_high", "days_tmax_gt_35_high", "days_tmax_over_35_high", "annual_tmax_days_gt_35_high", "hot_days_35_high", "very_hot_days_high"]),
          "gg",
          0,
          "temperature",
          "",
          { tone: "tempHigh", skipCoverageFilter: true }
        ),
        makeCard(
          "Giorni con Tmax > 30°C",
          pickFirstArray(scope, ["tmax_days_over_30_high", "tmax_days_gt_30_high", "days_tmax_gt_30_high", "days_tmax_over_30_high", "annual_tmax_days_gt_30_high", "hot_days_30_high", "summer_days_high"]),
          "gg",
          0,
          "temperature",
          "",
          { tone: "tempHigh", skipCoverageFilter: true }
        ),
        makeCard(
          "Giorni con Tmax < 5°C",
          pickFirstArray(scope, ["tmax_days_below_5_high", "tmax_days_lt_5_high", "days_tmax_lt_5_high", "days_tmax_below_5_high", "annual_tmax_days_lt_5_high", "cold_tmax_days_high"]),
          "gg",
          0,
          "temperature",
          "",
          { tone: "tempLow", skipCoverageFilter: true }
        ),
        makeCard(
          "Giorni con Tmin > 20°C",
          pickFirstArray(scope, ["tmin_days_over_20_high", "tmin_days_gt_20_high", "days_tmin_gt_20_high", "days_tmin_over_20_high", "annual_tmin_days_gt_20_high", "tropical_nights_high", "tropical_night_days_high"]),
          "gg",
          0,
          "temperature",
          "",
          { tone: "tempHigh", skipCoverageFilter: true }
        ),
        makeCard(
          "Giorni con Tmin < 0°C",
          pickFirstArray(scope, ["tmin_days_below_0_high", "tmin_days_lt_0_high", "days_tmin_lt_0_high", "days_tmin_below_0_high", "annual_tmin_days_lt_0_high", "frost_days_high", "freezing_days_high"]),
          "gg",
          0,
          "temperature",
          "",
          { tone: "tempLow", skipCoverageFilter: true }
        ),
      ]),
    ],

    precip: [
      ...inGroup("Totali pluviometrici", "rainHigh", [
        makeCard(
          "Precipitazioni totali annue più elevate",
          pickFirstArray(scope, ["rain_total_high", "annual_rain_total_high", "precip_total_high"]),
          "mm",
          1,
          "rain",
          "rain_total",
          { tone: "rainHigh" }
        ),
        makeCard(
          "Precipitazioni totali annue più basse",
          pickFirstArray(scope, ["rain_total_low", "annual_rain_total_low", "precip_total_low"]),
          "mm",
          1,
          "rain",
          "rain_total",
          { tone: "rainLow" }
        ),
      ]),
      ...inGroup("Giorni con precipitazioni", "rainHigh", [
        makeCard(
          "Anni con giorni più piovosi > 1 mm",
          pickFirstArray(scope, ["rain_days_over_1mm_high", "rain_days_gt_1mm_high", "rain_days_high", "wet_days_high", "days_rain_gt_1mm_high"]),
          "gg",
          0,
          "rain",
          "",
          { tone: "rainHigh", skipCoverageFilter: true }
        ),
        makeCard(
          "Anni con giorni meno piovosi > 1 mm",
          pickFirstArray(scope, ["rain_days_over_1mm_low", "rain_days_gt_1mm_low", "rain_days_low", "wet_days_low", "days_rain_gt_1mm_low"]),
          "gg",
          0,
          "rain",
          "",
          { tone: "rainLow", skipCoverageFilter: true }
        ),
        makeCard(
          "Giorni con precipitazioni >10 mm",
          pickFirstArray(scope, ["rain_days_over_10mm_high", "rain_days_gt_10mm_high", "days_rain_gt_10mm_high", "days_precip_gt_10mm_high", "annual_rain_days_gt_10mm_high", "heavy_rain_days_10mm_high"]),
          "gg",
          0,
          "rain",
          "",
          { tone: "rainHigh", skipCoverageFilter: true }
        ),
        makeCard(
          "Giorni con precipitazioni >20 mm",
          pickFirstArray(scope, ["rain_days_over_20mm_high", "rain_days_gt_20mm_high", "days_rain_gt_20mm_high", "days_precip_gt_20mm_high", "annual_rain_days_gt_20mm_high", "heavy_rain_days_20mm_high"]),
          "gg",
          0,
          "rain",
          "",
          { tone: "rainHigh", skipCoverageFilter: true }
        ),
        makeCard(
          "Giorni con precipitazioni >50 mm",
          pickFirstArray(scope, ["rain_days_over_50mm_high", "rain_days_gt_50mm_high", "days_rain_gt_50mm_high", "days_precip_gt_50mm_high", "annual_rain_days_gt_50mm_high", "very_heavy_rain_days_50mm_high"]),
          "gg",
          0,
          "rain",
          "",
          { tone: "rainHigh", skipCoverageFilter: true }
        ),
      ]),
      ...inGroup("Accumuli massimi su più giorni", "rainHigh", [
        makeCard(
          "Accumulo massimo su 2 giorni consecutivi",
          pickFirstArray(scope, ["rain_max_2d_high", "rainMax2dHigh", "max_rain_2d_high", "rain_2d_high"]),
          "mm",
          1,
          "rain",
          "",
          { tone: "rainHigh", showPeriod: true, skipCoverageFilter: true }
        ),
        makeCard(
          "Accumulo massimo su 3 giorni consecutivi",
          pickFirstArray(scope, ["rain_max_3d_high", "rainMax3dHigh", "max_rain_3d_high", "rain_3d_high"]),
          "mm",
          1,
          "rain",
          "",
          { tone: "rainHigh", showPeriod: true, skipCoverageFilter: true }
        ),
        makeCard(
          "Accumulo massimo su 5 giorni consecutivi",
          pickFirstArray(scope, ["rain_max_5d_high", "rainMax5dHigh", "max_rain_5d_high", "rain_5d_high"]),
          "mm",
          1,
          "rain",
          "",
          { tone: "rainHigh", showPeriod: true, skipCoverageFilter: true }
        ),
      ]),
      ...inGroup("Periodi consecutivi", "rainLow", [
        makeCard(
          "Anni con periodo più lungo senza precipitazioni",
          pickFirstArray(scope, ["max_dry_spell_high", "dry_spell_high", "longest_dry_spell_high", "max_dry_days_high", "longest_dry_days_high", "consecutive_dry_days_high"]),
          "gg",
          0,
          "rain",
          "",
          { tone: "rainLow", showPeriod: true, skipCoverageFilter: true }
        ),
        makeCard(
          "Anni con periodo più breve senza precipitazioni",
          pickFirstArray(scope, ["max_dry_spell_low", "dry_spell_low", "longest_dry_spell_low", "max_dry_days_low", "longest_dry_days_low", "consecutive_dry_days_low"]),
          "gg",
          0,
          "rain",
          "",
          { tone: "rainHigh", showPeriod: true, skipCoverageFilter: true }
        ),
        makeCard(
          "Periodo più lungo consecutivo con piogge >1 mm",
          pickFirstArray(scope, ["max_wet_spell_over_1mm_high", "wet_spell_over_1mm_high", "longest_wet_spell_over_1mm_high", "longest_wet_spell_gt_1mm_high", "max_consecutive_rain_days_over_1mm_high", "consecutive_rain_days_over_1mm_high", "consecutive_wet_days_high", "longest_wet_days_high"]),
          "gg",
          0,
          "rain",
          "",
          { tone: "rainHigh", showPeriod: true, skipCoverageFilter: true }
        ),
      ]),
      ...inGroup("Intensità pluviometrica", "rainHigh", [
        makeCard(
          "Rain Rate più elevato annuo",
          pickFirstArray(scope, ["rainrate_max_high", "annual_rainrate_max_high", "rain_rate_high"]),
          "mm/h",
          1,
          "rain",
          "",
          { tone: "rainHigh" }
        ),
      ]),
    ],

    wind: [
      ...inGroup("Vento medio", "windHigh", [
        makeCard("Media annua più elevata", pickFirstArray(scope, ["wind_avg_high", "wind_mean_high", "annual_wind_mean_high"]), "km/h", 1, "wind", "", { tone: "windHigh" }),
        makeCard("Media annua più bassa", pickFirstArray(scope, ["wind_avg_low", "wind_mean_low", "annual_wind_mean_low"]), "km/h", 1, "wind", "", { tone: "windLow" }),
      ]),
      ...inGroup("Raffiche", "windHigh", [
        makeCard("Media annua raffiche più elevata", pickFirstArray(scope, ["gust_mean_high", "annual_gust_mean_high", "gust_avg_high"]), "km/h", 1, "wind", "", { tone: "windHigh" }),
        makeCard("Media annua raffiche più bassa", pickFirstArray(scope, ["gust_mean_low", "annual_gust_mean_low", "gust_avg_low"]), "km/h", 1, "wind", "", { tone: "windLow" }),
      ]),
    ],

    press: [
      ...inGroup("Pressione annuale più alta", "pressHigh", [
        makeCard(
          "Pressione massima più alta",
          pickFirstArray(scope, ["press_max_mean_high", "press_mean_max_high", "annual_press_max_mean_high", "pressure_max_mean_high"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressHigh" }
        ),
        makeCard(
          "Pressione media più alta",
          pickFirstArray(scope, ["press_mean_high", "press_avg_high", "annual_press_mean_high", "pressure_mean_high"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressHigh" }
        ),
        makeCard(
          "Pressione minima più alta",
          pickFirstArray(scope, ["press_min_mean_high", "press_mean_min_high", "annual_press_min_mean_high", "pressure_min_mean_high"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressHigh" }
        ),
      ]),
      ...inGroup("Pressione annuale più bassa", "pressLow", [
        makeCard(
          "Pressione massima più bassa",
          pickFirstArray(scope, ["press_max_mean_low", "press_mean_max_low", "annual_press_max_mean_low", "pressure_max_mean_low"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressLow" }
        ),
        makeCard(
          "Pressione media più bassa",
          pickFirstArray(scope, ["press_mean_low", "press_avg_low", "annual_press_mean_low", "pressure_mean_low"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressLow" }
        ),
        makeCard(
          "Pressione minima più bassa",
          pickFirstArray(scope, ["press_min_mean_low", "press_mean_min_low", "annual_press_min_mean_low", "pressure_min_mean_low"]),
          "hPa",
          1,
          "pressure",
          "",
          { tone: "pressLow" }
        ),
      ]),
    ],

    rh: [
      ...inGroup("Umidità annuale più alta", "humHigh", [
        makeCard(
          "Umidità massima più alta",
          pickFirstArray(scope, ["rh_max_mean_high", "rh_mean_max_high", "annual_rh_max_mean_high", "humidity_max_mean_high"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humHigh" }
        ),
        makeCard(
          "Umidità media più alta",
          pickFirstArray(scope, ["rh_mean_high", "rh_avg_high", "annual_rh_mean_high", "humidity_mean_high"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humHigh" }
        ),
        makeCard(
          "Umidità minima più alta",
          pickFirstArray(scope, ["rh_min_mean_high", "rh_mean_min_high", "annual_rh_min_mean_high", "humidity_min_mean_high"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humHigh" }
        ),
      ]),
      ...inGroup("Umidità annuale più bassa", "humLow", [
        makeCard(
          "Umidità massima più bassa",
          pickFirstArray(scope, ["rh_max_mean_low", "rh_mean_max_low", "annual_rh_max_mean_low", "humidity_max_mean_low"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humLow" }
        ),
        makeCard(
          "Umidità media più bassa",
          pickFirstArray(scope, ["rh_mean_low", "rh_avg_low", "annual_rh_mean_low", "humidity_mean_low"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humLow" }
        ),
        makeCard(
          "Umidità minima più bassa",
          pickFirstArray(scope, ["rh_min_mean_low", "rh_mean_min_low", "annual_rh_min_mean_low", "humidity_min_mean_low"]),
          "%",
          0,
          "humidity",
          "",
          { tone: "humLow" }
        ),
      ]),
    ],

    rad: [
      ...inGroup("UV e radiazione annuale più alta", "radHigh", [
        makeCard(
          "UV medio annuale più alto",
          pickFirstArray(scope, ["uv_mean_high", "uv_avg_high", "annual_uv_mean_high"]),
          "",
          1,
          "radiation",
          "",
          { tone: "radHigh" }
        ),
        makeCard(
          "Radiazione media annuale più alta",
          pickFirstArray(scope, ["solar_mean_high", "solar_avg_high", "radiation_mean_high", "annual_solar_mean_high", "annual_radiation_mean_high"]),
          "W/m²",
          0,
          "radiation",
          "",
          { tone: "radHigh" }
        ),
      ]),
      ...inGroup("UV e radiazione annuale più bassa", "radLow", [
        makeCard(
          "UV medio annuale più basso",
          pickFirstArray(scope, ["uv_mean_low", "uv_avg_low", "annual_uv_mean_low"]),
          "",
          1,
          "radiation",
          "",
          { tone: "radLow" }
        ),
        makeCard(
          "Radiazione media annuale più bassa",
          pickFirstArray(scope, ["solar_mean_low", "solar_avg_low", "radiation_mean_low", "annual_solar_mean_low", "annual_radiation_mean_low"]),
          "W/m²",
          0,
          "radiation",
          "",
          { tone: "radLow" }
        ),
      ]),
    ],
  };

  return (cards[cat] || [])
    .map((c) => ({
      ...c,
      rows: c.skipCoverageFilter
        ? c.rows
        : filterRowsByCoverage(c.rows, c.paramKey, 0.95, c.arpasMode),
    }))
    .filter((c) => c.rows.length > 0);
}

// -------------------- components --------------------
function MiniRankTable({ rows, unit, digits = 1, kind, topN = 20, arpasMode = "", showPeriod = false }) {
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
            const periodLabel = showPeriod ? getPeriodLabel(r) : "";

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
                  {periodLabel ? <span className="periodMiniNote">{periodLabel}</span> : null}
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

function SectionDivider({ title, tone = "neutral" }) {
  const toneClass = `sectionTone-${tone || "neutral"}`;

  return (
    <div className={`sectionDivider ${toneClass}`}>
      <span>{title}</span>
    </div>
  );
}

function Card({ title, tone = "neutral", children }) {
  const toneClass = `cardTone-${tone || "neutral"}`;

  return (
    <div className={`card ${toneClass}`}>
      <div className="cardHead">
        <div className="cardTitle">{title}</div>
      </div>
      <div className="cardBody">{children}</div>
    </div>
  );
}

function splitCardGroups(cards) {
  const sections = [];

  for (const card of cards) {
    const title = card.group || "";
    const last = sections[sections.length - 1];

    if (!last || last.title !== title) {
      sections.push({
        title,
        tone: card.groupTone || card.tone || "neutral",
        cards: [card],
      });
    } else {
      last.cards.push(card);
    }
  }

  return sections;
}

function RecordsGrid({ cards, kind, topN }) {
  const sections = splitCardGroups(cards);

  return (
    <section className="recordsSections">
      {sections.map((section, sectionIndex) => {
        const countClass = `cardGridCount-${Math.min(section.cards.length, 3)}`;

        return (
          <Fragment key={`${section.title || "group"}-${sectionIndex}`}>
            {section.title ? <SectionDivider title={section.title} tone={section.tone} /> : null}

            <div className={`cardGrid ${countClass}`}>
              {section.cards.map((c, i) => (
                <Card key={`${c.title}-${i}`} title={c.title} tone={c.tone}>
                  <MiniRankTable
                    rows={c.rows}
                    unit={c.unit}
                    digits={c.digits}
                    kind={kind}
                    topN={topN}
                    arpasMode={c.arpasMode}
                    showPeriod={c.showPeriod}
                  />
                </Card>
              ))}
            </div>
          </Fragment>
        );
      })}
    </section>
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
  const monthlyCards = useMemo(() => getMonthlyCards(catMonthly, monthlyScope), [catMonthly, monthlyScope]);
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
              dettaglio del giorno, del mese o dell’anno corrispondente. I record
              giornalieri, mensili e annuali vengono mostrati considerando solo
              periodi con copertura dati almeno pari al 95%, quando la copertura è
              disponibile o calcolabile dai dati giornalieri. Nelle classifiche
              annuali sono inclusi anche gli indici di frequenza termica e
              pluviometrica, come giorni molto caldi, notti tropicali, gelate,
              giorni con piogge intense, accumuli massimi su più giorni consecutivi
              e periodi consecutivi secchi o piovosi. Per le precipitazioni mensili
              e annuali, quando presenti, vengono mantenuti in evidenza anche i
              valori corretti o integrati con dato ARPAS.
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
            <RecordsGrid cards={dailyCards} kind="daily" topN={topN} />
          ) : (
            <section className="emptyBox">Nessun dato disponibile per questa selezione.</section>
          )
        ) : null}

        {tab === "monthly" ? (
          monthlyCards.length ? (
            <RecordsGrid cards={monthlyCards} kind="monthly" topN={topN} />
          ) : (
            <section className="emptyBox">Nessun dato disponibile per questa selezione.</section>
          )
        ) : null}

        {tab === "yearly" ? (
          yearlyCards.length ? (
            <RecordsGrid cards={yearlyCards} kind="yearly" topN={topN} />
          ) : (
            <section className="emptyBox">Nessun dato disponibile per questa selezione.</section>
          )
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

  .recordsSections {
    margin-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .cardGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
  }

  .cardGridCount-1 {
    grid-template-columns: minmax(0, calc((100% - 24px) / 3));
    justify-content: center;
  }

  .cardGridCount-2 {
    grid-template-columns: repeat(2, minmax(0, calc((100% - 24px) / 3)));
    justify-content: center;
  }

  .sectionDivider {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 18px 0 2px;
  }

  .sectionDivider::before,
  .sectionDivider::after {
    content: "";
    height: 2px;
    flex: 1;
    border-radius: 999px;
    background: #e5e7eb;
  }

  .sectionDivider span {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 160px;
    padding: 7px 18px;
    border-radius: 999px;
    background: #fff;
    border: 1px solid #e5e7eb;
    color: #111827;
    font-size: 12px;
    font-weight: 950;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    box-shadow: 0 8px 22px rgba(15, 23, 42, 0.06);
    white-space: nowrap;
  }

  .sectionTone-tempHigh::before,
  .sectionTone-tempHigh::after,
  .sectionTone-tempRangeHigh::before,
  .sectionTone-tempRangeHigh::after {
    background: linear-gradient(90deg, transparent, rgba(185, 28, 28, 0.55), transparent);
  }

  .sectionTone-tempLow::before,
  .sectionTone-tempLow::after,
  .sectionTone-tempRangeLow::before,
  .sectionTone-tempRangeLow::after {
    background: linear-gradient(90deg, transparent, rgba(55, 48, 163, 0.55), transparent);
  }

  .sectionTone-rainHigh::before,
  .sectionTone-rainHigh::after {
    background: linear-gradient(90deg, transparent, rgba(3, 105, 161, 0.55), transparent);
  }

  .sectionTone-rainLow::before,
  .sectionTone-rainLow::after {
    background: linear-gradient(90deg, transparent, rgba(146, 64, 14, 0.55), transparent);
  }

  .sectionTone-windHigh::before,
  .sectionTone-windHigh::after,
  .sectionTone-windLow::before,
  .sectionTone-windLow::after {
    background: linear-gradient(90deg, transparent, rgba(126, 34, 206, 0.55), transparent);
  }

  .sectionTone-pressHigh::before,
  .sectionTone-pressHigh::after,
  .sectionTone-pressLow::before,
  .sectionTone-pressLow::after {
    background: linear-gradient(90deg, transparent, rgba(15, 118, 110, 0.55), transparent);
  }

  .sectionTone-humHigh::before,
  .sectionTone-humHigh::after,
  .sectionTone-humLow::before,
  .sectionTone-humLow::after {
    background: linear-gradient(90deg, transparent, rgba(4, 120, 87, 0.55), transparent);
  }

  .sectionTone-radHigh::before,
  .sectionTone-radHigh::after,
  .sectionTone-radLow::before,
  .sectionTone-radLow::after {
    background: linear-gradient(90deg, transparent, rgba(217, 119, 6, 0.55), transparent);
  }

  .sectionTone-tempHigh span,
  .sectionTone-tempRangeHigh span {
    border-color: rgba(185, 28, 28, 0.24);
    color: #991b1b;
  }

  .sectionTone-tempLow span,
  .sectionTone-tempRangeLow span {
    border-color: rgba(55, 48, 163, 0.24);
    color: #312e81;
  }

  .sectionTone-rainHigh span {
    border-color: rgba(3, 105, 161, 0.24);
    color: #075985;
  }

  .sectionTone-rainLow span {
    border-color: rgba(146, 64, 14, 0.24);
    color: #78350f;
  }

  .sectionTone-windHigh span,
  .sectionTone-windLow span {
    border-color: rgba(126, 34, 206, 0.24);
    color: #581c87;
  }

  .sectionTone-pressHigh span,
  .sectionTone-pressLow span {
    border-color: rgba(15, 118, 110, 0.24);
    color: #134e4a;
  }

  .sectionTone-humHigh span,
  .sectionTone-humLow span {
    border-color: rgba(4, 120, 87, 0.24);
    color: #065f46;
  }

  .sectionTone-radHigh span,
  .sectionTone-radLow span {
    border-color: rgba(217, 119, 6, 0.24);
    color: #92400e;
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

  .cardTone-tempHigh .cardHead {
    background: #b91c1c;
  }

  .cardTone-tempLow .cardHead {
    background: #3730a3;
  }

  .cardTone-tempRangeHigh .cardHead {
    background: #be123c;
  }

  .cardTone-tempRangeLow .cardHead {
    background: #475569;
  }

  .cardTone-rainHigh .cardHead {
    background: #0369a1;
  }

  .cardTone-rainLow .cardHead {
    background: #92400e;
  }

  .cardTone-windHigh .cardHead {
    background: #7e22ce;
  }

  .cardTone-windLow .cardHead {
    background: #6d28d9;
  }

  .cardTone-pressHigh .cardHead {
    background: #0f766e;
  }

  .cardTone-pressLow .cardHead {
    background: #155e75;
  }

  .cardTone-humHigh .cardHead {
    background: #047857;
  }

  .cardTone-humLow .cardHead {
    background: #b45309;
  }

  .cardTone-radHigh .cardHead {
    background: #d97706;
  }

  .cardTone-radLow .cardHead {
    background: #57534e;
  }

  .cardTone-neutral .cardHead {
    background: #111;
  }

  .cardTone-tempHigh {
    border-color: rgba(185, 28, 28, 0.24);
  }

  .cardTone-tempLow {
    border-color: rgba(55, 48, 163, 0.24);
  }

  .cardTone-rainHigh {
    border-color: rgba(3, 105, 161, 0.24);
  }

  .cardTone-rainLow {
    border-color: rgba(146, 64, 14, 0.24);
  }

  .cardTone-windHigh,
  .cardTone-windLow {
    border-color: rgba(126, 34, 206, 0.24);
  }

  .cardTone-pressHigh,
  .cardTone-pressLow {
    border-color: rgba(15, 118, 110, 0.24);
  }

  .cardTone-humHigh,
  .cardTone-humLow {
    border-color: rgba(4, 120, 87, 0.22);
  }

  .cardTone-radHigh,
  .cardTone-radLow {
    border-color: rgba(217, 119, 6, 0.24);
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

  .periodMiniNote {
    display: block;
    margin-top: 4px;
    font-size: 11px;
    line-height: 1.25;
    color: #94a3b8;
    font-weight: 800;
    letter-spacing: 0;
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

    .cardGrid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .cardGridCount-1 {
      grid-template-columns: minmax(0, calc((100% - 12px) / 2));
      justify-content: center;
    }

    .cardGridCount-2 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      justify-content: center;
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

    .cardGrid,
    .cardGridCount-1,
    .cardGridCount-2 {
      grid-template-columns: 1fr;
      justify-content: stretch;
    }

    .sectionDivider {
      gap: 10px;
      margin: 16px 0 0;
    }

    .sectionDivider span {
      min-width: 0;
      padding: 7px 12px;
      font-size: 10px;
      letter-spacing: 0.06em;
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