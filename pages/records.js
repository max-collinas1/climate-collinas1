import Link from "next/link";
import { Fragment, useMemo, useState } from "react";
import SiteLayout from "../components/SiteLayout";
import { readDailyLive, readRecordsLive } from "../lib/liveData";

export async function getStaticProps() {
  const rawRecords = await readRecordsLive();
  const dailyRows = await readDailyLive();
  const records = enhanceRecordsWithDaily(rawRecords, dailyRows);

  return {
    props: { records },
    revalidate: 60,
  };
}
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

const SEASONS = {
  DJF: { label: "Inverno", months: [12, 1, 2] },
  MAM: { label: "Primavera", months: [3, 4, 5] },
  JJA: { label: "Estate", months: [6, 7, 8] },
  SON: { label: "Autunno", months: [9, 10, 11] },
};

function seasonMeta(year, month) {
  const y = Number(year);
  const m = Number(month);

  if (m === 12) {
    const seasonYear = y + 1;
    return {
      key: "DJF",
      seasonYear,
      label: `Inverno ${y}/${seasonYear}`,
      daysExpected: daysInMonth(y, 12) + daysInMonth(seasonYear, 1) + daysInMonth(seasonYear, 2),
    };
  }

  if (m === 1 || m === 2) {
    return {
      key: "DJF",
      seasonYear: y,
      label: `Inverno ${y - 1}/${y}`,
      daysExpected: daysInMonth(y - 1, 12) + daysInMonth(y, 1) + daysInMonth(y, 2),
    };
  }

  if (m >= 3 && m <= 5) {
    return {
      key: "MAM",
      seasonYear: y,
      label: `Primavera ${y}`,
      daysExpected: daysInMonth(y, 3) + daysInMonth(y, 4) + daysInMonth(y, 5),
    };
  }

  if (m >= 6 && m <= 8) {
    return {
      key: "JJA",
      seasonYear: y,
      label: `Estate ${y}`,
      daysExpected: daysInMonth(y, 6) + daysInMonth(y, 7) + daysInMonth(y, 8),
    };
  }

  return {
    key: "SON",
    seasonYear: y,
    label: `Autunno ${y}`,
    daysExpected: daysInMonth(y, 9) + daysInMonth(y, 10) + daysInMonth(y, 11),
  };
}

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

function makeEmptyAgg(year, month = null, daysExpectedOverride = NaN) {
  return {
    year,
    month,
    daysExpected: Number.isFinite(daysExpectedOverride)
      ? daysExpectedOverride
      : month
        ? daysInMonth(year, month)
        : daysInYear(year),
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
  const seasonalAgg = new Map();
  const yearlyAgg = new Map();

  for (const row of dailyRows || []) {
    const dt = parseDailyDate(row);
    if (!dt || !dt.year || !dt.month) continue;

    const yy = String(dt.year);
    const mm = String(dt.month).padStart(2, "0");
    const ym = `${yy}-${mm}`;
    const season = seasonMeta(dt.year, dt.month);
    const seasonAggKey = `${season.key}-${season.seasonYear}`;

    if (!monthlyAgg.has(ym)) {
      monthlyAgg.set(ym, makeEmptyAgg(dt.year, dt.month));
    }

    if (!yearlyAgg.has(yy)) {
      yearlyAgg.set(yy, makeEmptyAgg(dt.year));
    }

    if (!seasonalAgg.has(seasonAggKey)) {
      const agg = makeEmptyAgg(season.seasonYear, null, season.daysExpected);
      agg.season = season.key;
      agg.seasonYear = season.seasonYear;
      agg.seasonLabel = season.label;
      seasonalAgg.set(seasonAggKey, agg);
    }

    const mAgg = monthlyAgg.get(ym);
    const yAgg = yearlyAgg.get(yy);
    const sAgg = seasonalAgg.get(seasonAggKey);

    mAgg.daysSeen.add(dt.date);
    yAgg.daysSeen.add(dt.date);
    sAgg.daysSeen.add(dt.date);

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

    for (const agg of [mAgg, sAgg, yAgg]) {
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

  function aggToRow(agg, extra = {}) {
    const coverage = agg.daysExpected > 0 ? agg.daysSeen.size / agg.daysExpected : NaN;
    return {
      ...extra,
      coverage,
      tmaxMean: avg(agg.tmax),
      tmean: avg(agg.tmean),
      tminMean: avg(agg.tmin),
      trangeMean: avg(agg.trange),
      rainTotal: sum(agg.rain),
      rainDaysOver1: agg.rain.filter((v) => Number.isFinite(v) && v > 1).length,
      rainDaysOver10: agg.rain.filter((v) => Number.isFinite(v) && v > 10).length,
      rainDaysOver20: agg.rain.filter((v) => Number.isFinite(v) && v > 20).length,
      rainDaysOver50: agg.rain.filter((v) => Number.isFinite(v) && v > 50).length,
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
    };
  }

  const monthlyRows = Array.from(monthlyAgg.values()).map((agg) =>
    aggToRow(agg, { year: agg.year, month: agg.month })
  );

  const seasonalRows = Array.from(seasonalAgg.values()).map((agg) =>
    aggToRow(agg, {
      year: agg.seasonYear,
      seasonYear: agg.seasonYear,
      season: agg.season,
      seasonLabel: agg.seasonLabel,
    })
  );

  const yearlyRows = Array.from(yearlyAgg.values()).map((agg) =>
    aggToRow(agg, { year: agg.year })
  );

  function buildRankScope(rows) {
    return {
      tmax_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.tmaxMean, r.coverage))),
      tmax_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.tmaxMean, r.coverage))),
      tmean_high: sortHigh(rows.map((r) => makeRankRow(r, r.tmean, r.coverage))),
      tmean_low: sortLow(rows.map((r) => makeRankRow(r, r.tmean, r.coverage))),
      tmin_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.tminMean, r.coverage))),
      tmin_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.tminMean, r.coverage))),
      trange_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.trangeMean, r.coverage))),
      trange_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.trangeMean, r.coverage))),
      rain_total_high: sortHigh(rows.map((r) => makeRankRow(r, r.rainTotal, r.coverage))),
      rain_total_low: sortLow(rows.map((r) => makeRankRow(r, r.rainTotal, r.coverage))),
      rain_days_over_1mm_high: sortHigh(rows.map((r) => makeRankRow(r, r.rainDaysOver1, r.coverage))),
      rain_days_over_1mm_low: sortLow(rows.map((r) => makeRankRow(r, r.rainDaysOver1, r.coverage))),
      rain_days_over_10mm_high: sortHigh(rows.map((r) => makeRankRow(r, r.rainDaysOver10, r.coverage))),
      rain_days_over_20mm_high: sortHigh(rows.map((r) => makeRankRow(r, r.rainDaysOver20, r.coverage))),
      rain_days_over_50mm_high: sortHigh(rows.map((r) => makeRankRow(r, r.rainDaysOver50, r.coverage))),
      wind_avg_high: sortHigh(rows.map((r) => makeRankRow(r, r.windMean, r.coverage))),
      wind_avg_low: sortLow(rows.map((r) => makeRankRow(r, r.windMean, r.coverage))),
      gust_mean_high: sortHigh(rows.map((r) => makeRankRow(r, r.gustMean, r.coverage))),
      gust_mean_low: sortLow(rows.map((r) => makeRankRow(r, r.gustMean, r.coverage))),
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

  const monthlyByMonth = {};
  for (let m = 1; m <= 12; m += 1) {
    const mm = String(m).padStart(2, "0");
    monthlyByMonth[mm] = buildRankScope(monthlyRows.filter((r) => Number(r.month) === m));
  }

  const seasonalBySeason = {};
  for (const seasonKey of Object.keys(SEASONS)) {
    seasonalBySeason[seasonKey] = buildRankScope(
      seasonalRows.filter((r) => r.season === seasonKey)
    );
  }

  return {
    monthly: { by_month: monthlyByMonth },
    seasonal: { by_season: seasonalBySeason },
    yearly: buildRankScope(yearlyRows),
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
        seasonal: { by_season: {} },
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

  base.seasonal = {
    ...(base.seasonal || {}),
    by_season: {
      ...(base.seasonal?.by_season || {}),
    },
  };

  for (const seasonKey of Object.keys(SEASONS)) {
    base.seasonal.by_season[seasonKey] = scopeMergePreferExisting(
      base.seasonal.by_season[seasonKey] || {},
      computed.seasonal.by_season[seasonKey] || {}
    );
  }

  base.yearly = scopeMergePreferExisting(base.yearly || {}, computed.yearly || {});

  return base;
}
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

function getSeasonalScope(records, seasonSel) {
  return records?.seasonal?.by_season?.[seasonSel] || null;
}
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

function getSeasonalCards(cat, scope) {
  const cards = {
    temp: [
      ...inGroup("Valori termici stagionali più alti", "tempHigh", [
        makeCard("Temperatura media massima stagionale più alta", pickFirstArray(scope, ["tmax_mean_high"]), "°C", 1, "temperature", "", { tone: "tempHigh" }),
        makeCard("Temperatura media stagionale più alta", pickFirstArray(scope, ["tmean_high"]), "°C", 1, "temperature", "", { tone: "tempHigh" }),
        makeCard("Temperatura media minima stagionale più alta", pickFirstArray(scope, ["tmin_mean_high"]), "°C", 1, "temperature", "", { tone: "tempHigh" }),
      ]),
      ...inGroup("Valori termici stagionali più bassi", "tempLow", [
        makeCard("Temperatura media massima stagionale più bassa", pickFirstArray(scope, ["tmax_mean_low"]), "°C", 1, "temperature", "", { tone: "tempLow" }),
        makeCard("Temperatura media stagionale più bassa", pickFirstArray(scope, ["tmean_low"]), "°C", 1, "temperature", "", { tone: "tempLow" }),
        makeCard("Temperatura media minima stagionale più bassa", pickFirstArray(scope, ["tmin_mean_low"]), "°C", 1, "temperature", "", { tone: "tempLow" }),
      ]),
      ...inGroup("Escursione termica stagionale", "tempRangeHigh", [
        makeCard("Escursione termica media stagionale più alta", pickFirstArray(scope, ["trange_mean_high"]), "°C", 1, "temperature", "", { tone: "tempRangeHigh" }),
        makeCard("Escursione termica media stagionale più bassa", pickFirstArray(scope, ["trange_mean_low"]), "°C", 1, "temperature", "", { tone: "tempRangeLow" }),
      ]),
    ],
    precip: [
      ...inGroup("Totali pluviometrici stagionali", "rainHigh", [
        makeCard("Precipitazioni stagionali più elevate", pickFirstArray(scope, ["rain_total_high"]), "mm", 1, "rain", "", { tone: "rainHigh" }),
        makeCard("Precipitazioni stagionali più basse", pickFirstArray(scope, ["rain_total_low"]), "mm", 1, "rain", "", { tone: "rainLow" }),
      ]),
      ...inGroup("Giorni con precipitazioni", "rainHigh", [
        makeCard("Stagioni con più giorni piovosi > 1 mm", pickFirstArray(scope, ["rain_days_over_1mm_high"]), "gg", 0, "rain", "", { tone: "rainHigh" }),
        makeCard("Stagioni con meno giorni piovosi > 1 mm", pickFirstArray(scope, ["rain_days_over_1mm_low"]), "gg", 0, "rain", "", { tone: "rainLow" }),
        makeCard("Giorni con precipitazioni > 10 mm", pickFirstArray(scope, ["rain_days_over_10mm_high"]), "gg", 0, "rain", "", { tone: "rainHigh" }),
        makeCard("Giorni con precipitazioni > 20 mm", pickFirstArray(scope, ["rain_days_over_20mm_high"]), "gg", 0, "rain", "", { tone: "rainHigh" }),
        makeCard("Giorni con precipitazioni > 50 mm", pickFirstArray(scope, ["rain_days_over_50mm_high"]), "gg", 0, "rain", "", { tone: "rainHigh" }),
      ]),
    ],
    wind: [
      ...inGroup("Vento stagionale", "windHigh", [
        makeCard("Vento medio stagionale più alto", pickFirstArray(scope, ["wind_avg_high"]), "km/h", 1, "wind", "", { tone: "windHigh" }),
        makeCard("Vento medio stagionale più basso", pickFirstArray(scope, ["wind_avg_low"]), "km/h", 1, "wind", "", { tone: "windLow" }),
        makeCard("Raffiche medie stagionali più alte", pickFirstArray(scope, ["gust_mean_high"]), "km/h", 1, "wind", "", { tone: "windHigh" }),
        makeCard("Raffiche medie stagionali più basse", pickFirstArray(scope, ["gust_mean_low"]), "km/h", 1, "wind", "", { tone: "windLow" }),
      ]),
    ],
    press: [
      ...inGroup("Pressione stagionale più alta", "pressHigh", [
        makeCard("Pressione massima media più alta", pickFirstArray(scope, ["press_max_mean_high"]), "hPa", 1, "pressure", "", { tone: "pressHigh" }),
        makeCard("Pressione media più alta", pickFirstArray(scope, ["press_mean_high"]), "hPa", 1, "pressure", "", { tone: "pressHigh" }),
        makeCard("Pressione minima media più alta", pickFirstArray(scope, ["press_min_mean_high"]), "hPa", 1, "pressure", "", { tone: "pressHigh" }),
      ]),
      ...inGroup("Pressione stagionale più bassa", "pressLow", [
        makeCard("Pressione massima media più bassa", pickFirstArray(scope, ["press_max_mean_low"]), "hPa", 1, "pressure", "", { tone: "pressLow" }),
        makeCard("Pressione media più bassa", pickFirstArray(scope, ["press_mean_low"]), "hPa", 1, "pressure", "", { tone: "pressLow" }),
        makeCard("Pressione minima media più bassa", pickFirstArray(scope, ["press_min_mean_low"]), "hPa", 1, "pressure", "", { tone: "pressLow" }),
      ]),
    ],
    rh: [
      ...inGroup("Umidità stagionale più alta", "humHigh", [
        makeCard("Umidità massima media più alta", pickFirstArray(scope, ["rh_max_mean_high"]), "%", 0, "humidity", "", { tone: "humHigh" }),
        makeCard("Umidità media più alta", pickFirstArray(scope, ["rh_mean_high"]), "%", 0, "humidity", "", { tone: "humHigh" }),
        makeCard("Umidità minima media più alta", pickFirstArray(scope, ["rh_min_mean_high"]), "%", 0, "humidity", "", { tone: "humHigh" }),
      ]),
      ...inGroup("Umidità stagionale più bassa", "humLow", [
        makeCard("Umidità massima media più bassa", pickFirstArray(scope, ["rh_max_mean_low"]), "%", 0, "humidity", "", { tone: "humLow" }),
        makeCard("Umidità media più bassa", pickFirstArray(scope, ["rh_mean_low"]), "%", 0, "humidity", "", { tone: "humLow" }),
        makeCard("Umidità minima media più bassa", pickFirstArray(scope, ["rh_min_mean_low"]), "%", 0, "humidity", "", { tone: "humLow" }),
      ]),
    ],
    rad: [
      ...inGroup("UV e radiazione stagionale più alta", "radHigh", [
        makeCard("UV medio stagionale più alto", pickFirstArray(scope, ["uv_mean_high"]), "", 1, "radiation", "", { tone: "radHigh" }),
        makeCard("Radiazione media stagionale più alta", pickFirstArray(scope, ["solar_mean_high"]), "W/m²", 0, "radiation", "", { tone: "radHigh" }),
      ]),
      ...inGroup("UV e radiazione stagionale più bassa", "radLow", [
        makeCard("UV medio stagionale più basso", pickFirstArray(scope, ["uv_mean_low"]), "", 1, "radiation", "", { tone: "radLow" }),
        makeCard("Radiazione media stagionale più bassa", pickFirstArray(scope, ["solar_mean_low"]), "W/m²", 0, "radiation", "", { tone: "radLow" }),
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
function getSeasonLabel(row) {
  if (row?.seasonLabel) return row.seasonLabel;
  const key = row?.season;
  const seasonYear = Number(row?.seasonYear || row?.year);
  if (!key || !Number.isFinite(seasonYear)) return "—";
  if (key === "DJF") return `Inverno ${seasonYear - 1}/${seasonYear}`;
  return `${SEASONS[key]?.label || key} ${seasonYear}`;
}

function getSeasonHref(row) {
  const key = String(row?.season || "").toLowerCase();
  const seasonYear = Number(row?.seasonYear || row?.year);
  if (!key || !Number.isFinite(seasonYear)) return "/stagioni";
  return `/stagioni/${seasonYear}/${key}`;
}

function MiniRankTable({ rows, unit, digits = 1, kind, topN = 20, arpasMode = "", showPeriod = false }) {
  const list = takeTop(rows, topN);
  const has = list.length > 0;
  const whenLabel = kind === "daily" ? "Giorno" : kind === "monthly" ? "Mese" : kind === "seasonal" ? "Stagione" : "Anno";

  return (
    <table className="miniTable">
      <thead>
        <tr>
          <th className="thRank">#</th>
          <th className="thVal">Valore</th>
          <th className="thWhen">{whenLabel}</th>
        </tr>
      </thead>
      <tbody>
        {has ? (
          list.map((r, idx) => {
            const vStr = `${fmt(r.value, digits)}${unit ? ` ${unit}` : ""}`;
            const isArpas = hasArpasPriority(r, kind, arpasMode);
            const arpasNote = getArpasNote(r, kind, arpasMode);
            const periodLabel = showPeriod ? getPeriodLabel(r) : "";
            const rankClass = idx < 3 ? `rankBadge rankBadge-${idx + 1}` : "rankBadge";

            if (kind === "daily") {
              return (
                <tr key={`${r.date}-${idx}`}>
                  <td className="tdRank"><span className={rankClass}>{idx + 1}</span></td>
                  <td className="tdVal">{vStr}</td>
                  <td className="tdWhen">
                    <Link href={`/giorni/${r.date}`} className="rowLink" title="Apri dettaglio giornaliero">
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
                  <td className="tdRank"><span className={rankClass}>{idx + 1}</span></td>
                  <td className="tdVal">
                    <span className={isArpas ? "arpasValue" : ""} title={isArpas ? arpasNote : ""}>
                      {vStr}
                    </span>
                    {isArpas ? <span className="arpasMiniNote">{arpasNote}</span> : null}
                  </td>
                  <td className="tdWhen">
                    <Link href={`/mesi/${yy}/${mm}`} className="rowLink" title="Apri dettaglio mensile">
                      {ymLabel(yy, Number(mm))}
                    </Link>
                  </td>
                </tr>
              );
            }

            if (kind === "seasonal") {
              return (
                <tr key={`${r.season || "season"}-${r.seasonYear || r.year}-${idx}`}>
                  <td className="tdRank"><span className={rankClass}>{idx + 1}</span></td>
                  <td className="tdVal">{vStr}</td>
                  <td className="tdWhen">
                    <Link href={getSeasonHref(r)} className="rowLink" title="Apri dettaglio stagionale">
                      {getSeasonLabel(r)}
                    </Link>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={`${r.year}-${idx}`}>
                <td className="tdRank"><span className={rankClass}>{idx + 1}</span></td>
                <td className="tdVal">
                  <span className={isArpas ? "arpasValue" : ""} title={isArpas ? arpasNote : ""}>
                    {vStr}
                  </span>
                  {periodLabel ? <span className="periodMiniNote">{periodLabel}</span> : null}
                  {isArpas ? <span className="arpasMiniNote">{arpasNote}</span> : null}
                </td>
                <td className="tdWhen">
                  <Link href={`/anni/${r.year}`} className="rowLink" title="Apri dettaglio annuale">
                    {r.year}
                  </Link>
                </td>
              </tr>
            );
          })
        ) : (
          <tr>
            <td colSpan={3} className="tdEmpty">Nessun dato disponibile.</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function toneIcon(tone) {
  const icons = {
    tempHigh: "↑",
    tempLow: "↓",
    tempRangeHigh: "↕",
    tempRangeLow: "↕",
    rainHigh: "↧",
    rainLow: "↥",
    windHigh: "≈",
    windLow: "≈",
    pressHigh: "↑",
    pressLow: "↓",
    humHigh: "◆",
    humLow: "◇",
    radHigh: "☀",
    radLow: "☀",
    neutral: "•",
  };
  return icons[tone] || icons.neutral;
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
        <div className="cardIcon" aria-hidden="true">{toneIcon(tone)}</div>
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
      {sections.map((section, sectionIndex) => (
        <Fragment key={`${section.title || "group"}-${sectionIndex}`}>
          {section.title ? <SectionDivider title={section.title} tone={section.tone} /> : null}
          <div className="cardGrid">
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
      ))}
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
    <>
      <div className="monthPick monthPickDesktop">
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

      <div className="monthPickMobile">
        <select className="monthSelMobile" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Seleziona mese">
          {allowAll ? <option value="all">Tutti i mesi</option> : null}
          {Array.from({ length: 12 }, (_, i) => {
            const mm = String(i + 1).padStart(2, "0");
            return (
              <option key={mm} value={mm}>
                {monthFullFromMM(mm)}
              </option>
            );
          })}
        </select>
      </div>
    </>
  );
}

function SeasonPicker({ value, onChange }) {
  return (
    <div className="seasonPick">
      {Object.entries(SEASONS).map(([key, info]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={value === key ? `seasonBtn seasonBtnOn seasonBtn-${key}` : `seasonBtn seasonBtn-${key}`}
        >
          <span className="seasonSymbol" aria-hidden="true">
            {key === "DJF" ? "❄" : key === "MAM" ? "✿" : key === "JJA" ? "☀" : "◆"}
          </span>
          {info.label}
        </button>
      ))}
    </div>
  );
}

function SidebarCatButton({ active, children, onClick, symbol }) {
  return (
    <button type="button" onClick={onClick} className={active ? "sideCatBtn sideCatBtnOn" : "sideCatBtn"}>
      <span className="sideCatIcon" aria-hidden="true">{symbol}</span>
      <span>{children}</span>
    </button>
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
export default function RecordsPage({ records }) {
  const [tab, setTab] = useState("daily");
  const [yearSel, setYearSel] = useState("all");
  const [monthSel, setMonthSel] = useState("all");
  const [catDaily, setCatDaily] = useState("temp");
  const [catMonthly, setCatMonthly] = useState("temp");
  const [catSeasonal, setCatSeasonal] = useState("temp");
  const [catYearly, setCatYearly] = useState("temp");
  const [mmMonthly, setMmMonthly] = useState("01");
  const [seasonSel, setSeasonSel] = useState("JJA");

  const topN = useMemo(() => {
    const v = Number(records?.top_n);
    return Number.isFinite(v) && v > 0 ? v : 20;
  }, [records]);

  const yearsAvail = useMemo(() => {
    const ys = records?.daily?.by_year ? Object.keys(records.daily.by_year) : [];
    return ys.sort((a, b) => Number(b) - Number(a));
  }, [records]);

  const dailyScope = useMemo(() => getDailyScope(records, yearSel, monthSel), [records, yearSel, monthSel]);
  const monthlyScope = useMemo(() => getMonthlyScope(records, mmMonthly), [records, mmMonthly]);
  const seasonalScope = useMemo(() => getSeasonalScope(records, seasonSel), [records, seasonSel]);
  const yearlyScope = records?.yearly || null;

  const dailyCards = useMemo(() => getDailyCards(catDaily, dailyScope), [catDaily, dailyScope]);
  const monthlyCards = useMemo(() => getMonthlyCards(catMonthly, monthlyScope), [catMonthly, monthlyScope]);
  const seasonalCards = useMemo(() => getSeasonalCards(catSeasonal, seasonalScope), [catSeasonal, seasonalScope]);
  const yearlyCards = useMemo(() => getYearlyCards(catYearly, yearlyScope), [catYearly, yearlyScope]);

  if (!records) {
    return (
      <SiteLayout
        headerProps={{
          title: "Record",
          kicker: (
            <span className="recordHeroKicker">
              ARCHIVIO RECORD<br />METEOROLOGICI
            </span>
          ),
          subtitle: (
            <span className="recordHeroSubtitle">
              I principali estremi dell’archivio della stazione di Collinas, organizzati per scala temporale e parametro. Le classifiche mensili, stagionali e annuali considerano periodi con copertura dati almeno pari al 95% quando disponibile o calcolabile.
            </span>
          ),
          currentPath: "/records",
          showPeriod: false,
        }}
      >
        <div className="wrap">
          <section className="emptyBox">
            File <code>data/record.json</code> non trovato. Crealo manualmente.
          </section>
          <style jsx>{baseCss}</style>
        </div>
      </SiteLayout>
    );
  }

  const catConfig = [
    ["temp", "Temperature", "°"],
    ["precip", "Precipitazioni", "↧"],
    ["wind", "Vento", "≈"],
    ["press", "Pressione", "◴"],
    ["rh", "Umidità", "◆"],
    ["rad", "Radiazione", "☀"],
  ];

  const activeCat = tab === "daily" ? catDaily : tab === "monthly" ? catMonthly : tab === "seasonal" ? catSeasonal : catYearly;
  const setActiveCat = tab === "daily" ? setCatDaily : tab === "monthly" ? setCatMonthly : tab === "seasonal" ? setCatSeasonal : setCatYearly;
  const activeCards = tab === "daily" ? dailyCards : tab === "monthly" ? monthlyCards : tab === "seasonal" ? seasonalCards : yearlyCards;
  const activeKind = tab === "daily" ? "daily" : tab === "monthly" ? "monthly" : tab === "seasonal" ? "seasonal" : "yearly";

  return (
    <SiteLayout
      headerProps={{
        title: "Record",
        kicker: (
          <span className="recordHeroKicker">
            ARCHIVIO RECORD<br />METEOROLOGICI
          </span>
        ),
        subtitle: (
          <span className="recordHeroSubtitle">
            I principali estremi dell’archivio della stazione di Collinas, organizzati per scala temporale e parametro. Le classifiche mensili, stagionali e annuali considerano periodi con copertura dati almeno pari al 95% quando disponibile o calcolabile.
          </span>
        ),
        currentPath: "/records",
        showPeriod: false,
      }}
    >
      <div className="wrap">
        <div className="mainHeader mainHeaderMetaOnly">
          <div className="updatedChip">
            <span>Aggiornato</span>
            <b>{fmtGeneratedAt(records.generated_at)}</b>
          </div>
        </div>

        <section className="recordsShell">
          <aside className="recordsSidebar">
            <div className="sidebarTitle">
              <span className="sidebarTitleIcon" aria-hidden="true">▥</span>
              <span>Filtri record</span>
            </div>

            {tab === "daily" ? (
              <>
                <div className="sideSection">
                  <div className="sideLabel">Anno</div>
                  <YearPicker value={yearSel} onChange={setYearSel} years={yearsAvail} />
                </div>
                <div className="sideSection">
                  <div className="sideLabel">Mese</div>
                  <MonthPicker value={monthSel} onChange={setMonthSel} allowAll />
                </div>
              </>
            ) : null}

            {tab === "monthly" ? (
              <div className="sideSection">
                <div className="sideLabel">Mese</div>
                <MonthPicker value={mmMonthly} onChange={setMmMonthly} allowAll={false} />
              </div>
            ) : null}

            {tab === "seasonal" ? (
              <div className="sideSection">
                <div className="sideLabel">Stagione</div>
                <SeasonPicker value={seasonSel} onChange={setSeasonSel} />
              </div>
            ) : null}

            <div className="sideSection sideSectionParams">
              <div className="sideLabel">Parametro</div>
              <div className="sideCatList">
                {catConfig.map(([key, label, symbol]) => (
                  <SidebarCatButton
                    key={key}
                    active={activeCat === key}
                    onClick={() => setActiveCat(key)}
                    symbol={symbol}
                  >
                    {label}
                  </SidebarCatButton>
                ))}
              </div>
            </div>
          </aside>

          <main className="recordsMain">
            <div className="tabs tabsWide">
              <TabButton active={tab === "daily"} onClick={() => setTab("daily")}>Giornalieri</TabButton>
              <TabButton active={tab === "monthly"} onClick={() => setTab("monthly")}>Mensili</TabButton>
              <TabButton active={tab === "seasonal"} onClick={() => setTab("seasonal")}>Stagionali</TabButton>
              <TabButton active={tab === "yearly"} onClick={() => setTab("yearly")}>Annuali</TabButton>
            </div>

            {activeCards.length ? (
              <RecordsGrid cards={activeCards} kind={activeKind} topN={topN} />
            ) : (
              <section className="emptyBox">Nessun dato disponibile per questa selezione.</section>
            )}
          </main>
        </section>

        <style jsx>{baseCss}</style>
      </div>
    </SiteLayout>
  );
}

const baseCss = `
  .recordHeroKicker {
    display: inline-block;
    text-align: center;
    line-height: 1.28;
  }

  :global(body) {
    background: #f7f9fc;
  }

  .wrap {
    width: 100%;
    max-width: none;
    box-sizing: border-box;
    margin: 0;
    padding: 18px 0 54px;
  }

  .recordsShell {
    margin-top: 14px;
    display: grid;
    grid-template-columns: 220px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  .recordsSidebar {
    position: sticky;
    top: 16px;
    border: 1px solid #e6eaf0;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 14px 34px rgba(15, 23, 42, 0.055);
    padding: 18px 16px;
  }

  .sidebarTitle {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 17px;
    font-weight: 950;
    color: #111827;
    margin-bottom: 18px;
  }

  .sidebarTitleIcon {
    display: inline-flex;
    width: 32px;
    height: 32px;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: #fff1f2;
    color: #dc2626;
    font-size: 18px;
  }

  .sideSection + .sideSection {
    margin-top: 20px;
  }

  .sideSectionParams {
    padding-top: 18px;
    border-top: 1px solid #eef1f5;
  }

  .sideLabel {
    margin-bottom: 9px;
    font-size: 12px;
    font-weight: 950;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #475569;
  }

  :global(.recordHeroSubtitle) {
    display: block;
    width: min(100%, 1040px);
    margin: 8px auto 0;
    padding: 0 14px;
    box-sizing: border-box;
    text-align: center;
    color: #64748b;
    font-size: 13px;
    line-height: 1.5;
    font-weight: 650;
  }

  .recordsMain {
    min-width: 0;
  }

  .mainHeader {
    display: flex;
    align-items: flex-start;
    justify-content: flex-end;
    margin: 8px 2px 8px;
  }

  .mainHeaderMetaOnly {
    min-height: 0;
  }

  .updatedChip {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 9px 12px;
    border: 1px solid #e7ebf0;
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
    color: #64748b;
    font-size: 10px;
  }

  .updatedChip b {
    color: #0f172a;
    font-size: 12px;
  }

  .tabs {
    display: flex;
    gap: 0;
  }

  .tabsWide {
    width: 100%;
    border: 1px solid #e6eaf0;
    border-radius: 14px;
    background: #fff;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.035);
  }

  .tabBtn {
    position: relative;
    flex: 1 1 0;
    min-height: 48px;
    padding: 10px 12px;
    border: 0;
    border-right: 1px solid #eef1f5;
    background: #fff;
    color: #475569;
    font-weight: 900;
    font-size: 13px;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }

  .tabBtn:last-child {
    border-right: 0;
  }

  .tabBtn:hover {
    background: #f8fafc;
    color: #111827;
  }

  .tabBtnOn {
    background: #fff5f5;
    color: #dc2626;
  }

  .tabBtnOn::after {
    content: "";
    position: absolute;
    left: 18%;
    right: 18%;
    bottom: 0;
    height: 3px;
    border-radius: 999px 999px 0 0;
    background: #dc2626;
  }

  .yearSel {
    width: 100%;
    height: 42px;
    padding: 0 12px;
    border: 1px solid #e2e8f0;
    border-radius: 11px;
    background: #fff;
    color: #111827;
    font-weight: 850;
    font-size: 13px;
    outline: none;
  }

  .yearSel:focus {
    border-color: #94a3b8;
    box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.12);
  }

  .monthPick {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 7px;
  }

  .monthPickMobile {
    display: none;
  }

  .monthSelMobile {
    width: 100%;
    height: 42px;
    padding: 0 12px;
    border: 1px solid #e2e8f0;
    border-radius: 11px;
    background: #fff;
    color: #111827;
    font-weight: 850;
    font-size: 13px;
    outline: none;
  }

  .monthSelMobile:focus {
    border-color: #94a3b8;
    box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.12);
  }

  .mBtn {
    min-width: 0;
    padding: 8px 5px;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #fff;
    color: #475569;
    font-weight: 850;
    font-size: 11px;
    cursor: pointer;
    transition: all 130ms ease;
  }

  .mBtn:hover {
    border-color: #cbd5e1;
    background: #f8fafc;
  }

  .mBtnOn {
    border-color: #dc2626;
    background: #dc2626;
    color: #fff;
    box-shadow: 0 6px 14px rgba(220, 38, 38, 0.15);
  }

  .seasonPick,
  .sideCatList {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .seasonBtn,
  .sideCatBtn {
    width: 100%;
    min-height: 42px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 11px;
    border: 1px solid #e2e8f0;
    border-radius: 11px;
    background: #fff;
    color: #334155;
    font-size: 13px;
    font-weight: 850;
    text-align: left;
    cursor: pointer;
    transition: all 130ms ease;
  }

  .seasonBtn:hover,
  .sideCatBtn:hover {
    background: #f8fafc;
    border-color: #cbd5e1;
    transform: translateY(-1px);
  }

  .seasonSymbol,
  .sideCatIcon {
    width: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    line-height: 1;
  }

  .seasonBtn-DJF .seasonSymbol { color: #2563eb; }
  .seasonBtn-MAM .seasonSymbol { color: #16a34a; }
  .seasonBtn-JJA .seasonSymbol { color: #f59e0b; }
  .seasonBtn-SON .seasonSymbol { color: #ea580c; }

  .seasonBtnOn {
    border-color: #dc2626;
    background: #dc2626;
    color: #fff;
    box-shadow: 0 8px 18px rgba(220, 38, 38, 0.16);
  }

  .seasonBtnOn .seasonSymbol {
    color: #fff;
  }

  .sideCatBtnOn {
    border-color: rgba(220, 38, 38, 0.28);
    background: #fff1f2;
    color: #dc2626;
  }

  .sideCatBtnOn .sideCatIcon {
    color: #dc2626;
  }

  .recordsSections {
    margin-top: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .sectionDivider {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 8px 2px 0;
  }

  .sectionDivider::before,
  .sectionDivider::after {
    content: "";
    height: 1px;
    flex: 1;
    background: #e7ebf0;
  }

  .sectionDivider span {
    color: #334155;
    font-size: 12px;
    font-weight: 950;
    letter-spacing: 0.055em;
    text-transform: uppercase;
    white-space: nowrap;
    text-align: center;
  }

  .sectionTone-tempHigh span,
  .sectionTone-tempRangeHigh span { color: #b91c1c; }
  .sectionTone-tempLow span,
  .sectionTone-tempRangeLow span { color: #3730a3; }
  .sectionTone-rainHigh span { color: #0369a1; }
  .sectionTone-rainLow span { color: #92400e; }
  .sectionTone-windHigh span,
  .sectionTone-windLow span { color: #6d28d9; }
  .sectionTone-pressHigh span,
  .sectionTone-pressLow span { color: #0f766e; }
  .sectionTone-humHigh span,
  .sectionTone-humLow span { color: #047857; }
  .sectionTone-radHigh span,
  .sectionTone-radLow span { color: #d97706; }

  .cardGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
  }

  .card {
    position: relative;
    overflow: hidden;
    border: 1px solid #e7ebf0;
    border-radius: 16px;
    background: #fff;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.045);
  }

  .card::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
    background: #cbd5e1;
  }

  .cardTone-tempHigh::before { background: #dc2626; }
  .cardTone-tempLow::before { background: #4338ca; }
  .cardTone-tempRangeHigh::before { background: #e11d48; }
  .cardTone-tempRangeLow::before { background: #64748b; }
  .cardTone-rainHigh::before { background: #0284c7; }
  .cardTone-rainLow::before { background: #a16207; }
  .cardTone-windHigh::before,
  .cardTone-windLow::before { background: #7c3aed; }
  .cardTone-pressHigh::before,
  .cardTone-pressLow::before { background: #0f766e; }
  .cardTone-humHigh::before,
  .cardTone-humLow::before { background: #059669; }
  .cardTone-radHigh::before,
  .cardTone-radLow::before { background: #d97706; }

  .cardHead {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 60px;
    padding: 11px 12px 9px 14px;
    border-bottom: 1px solid #f0f2f5;
  }

  .cardIcon {
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 11px;
    background: #f8fafc;
    color: #475569;
    font-size: 18px;
    font-weight: 950;
  }

  .cardTone-tempHigh .cardIcon,
  .cardTone-tempRangeHigh .cardIcon { background: #fff1f2; color: #dc2626; }
  .cardTone-tempLow .cardIcon,
  .cardTone-tempRangeLow .cardIcon { background: #eef2ff; color: #4338ca; }
  .cardTone-rainHigh .cardIcon { background: #eff6ff; color: #0284c7; }
  .cardTone-rainLow .cardIcon { background: #fffbeb; color: #a16207; }
  .cardTone-windHigh .cardIcon,
  .cardTone-windLow .cardIcon { background: #f5f3ff; color: #7c3aed; }
  .cardTone-pressHigh .cardIcon,
  .cardTone-pressLow .cardIcon { background: #f0fdfa; color: #0f766e; }
  .cardTone-humHigh .cardIcon,
  .cardTone-humLow .cardIcon { background: #ecfdf5; color: #059669; }
  .cardTone-radHigh .cardIcon,
  .cardTone-radLow .cardIcon { background: #fffbeb; color: #d97706; }

  .cardTitle {
    font-weight: 950;
    font-size: 14px;
    line-height: 1.25;
    color: #0f172a;
  }

  .cardBody {
    padding: 2px 9px 8px 11px;
  }

  .miniTable {
    width: 100%;
    border-collapse: collapse;
    table-layout: auto;
  }

  .miniTable thead th {
    padding: 7px 4px 5px;
    border-bottom: 1px solid #eef1f5;
    color: #64748b;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 900;
  }

  .thRank {
    width: 34px;
    text-align: left;
  }

  .thVal {
    width: 31%;
    text-align: left;
  }

  .thWhen {
    text-align: right;
  }

  .miniTable tbody td {
    padding: 6px 4px;
    border-bottom: 1px solid #f1f3f6;
    font-size: 11px;
    line-height: 1.2;
    vertical-align: middle;
  }

  .miniTable tbody tr:last-child td {
    border-bottom: 0;
  }

  .miniTable tbody tr:hover td {
    background: #fafbfc;
  }

  .tdRank {
    width: 34px;
  }

  .rankBadge {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: #f1f5f9;
    color: #475569;
    font-size: 10px;
    font-weight: 950;
  }

  .rankBadge-1 {
    background: #facc15;
    color: #78350f;
  }

  .rankBadge-2 {
    background: #e2e8f0;
    color: #475569;
  }

  .rankBadge-3 {
    background: #fdba74;
    color: #7c2d12;
  }

  .tdVal {
    font-weight: 950;
    color: #111827;
    text-align: left;
  }

  .miniTable tbody tr:first-child .tdVal {
    color: #dc2626;
  }

  .tdWhen {
    color: #64748b;
    text-align: right;
    font-weight: 750;
    white-space: nowrap;
  }

  .tdEmpty {
    padding: 14px 6px !important;
    text-align: center;
    color: #64748b;
    font-weight: 750;
  }

  .rowLink {
    color: #475569;
    text-decoration: none;
    font-weight: 850;
    white-space: nowrap;
  }

  .rowLink:hover {
    color: #dc2626;
    text-decoration: underline;
  }

  .arpasValue {
    position: relative;
    display: inline-block;
    text-decoration: underline;
    text-decoration-color: #dc2626;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
  }

  .arpasMiniNote,
  .periodMiniNote {
    display: block;
    margin-top: 3px;
    color: #94a3b8;
    font-size: 9px;
    line-height: 1.2;
    font-weight: 750;
  }

  .emptyBox {
    margin-top: 14px;
    border: 1px solid #e7ebf0;
    border-radius: 16px;
    background: #fff;
    padding: 24px;
    text-align: center;
    color: #475569;
    font-weight: 850;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.045);
  }

  code {
    background: #f1f5f9;
    padding: 2px 6px;
    border-radius: 7px;
  }

  @media (max-width: 1280px) {
    .cardGrid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 1100px) {
    .recordsShell {
      grid-template-columns: 210px minmax(0, 1fr);
      gap: 14px;
    }

    .cardGrid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .mainHeader {
      flex-direction: column;
    }
  }

  @media (max-width: 820px) {
    .recordsShell {
      grid-template-columns: 1fr;
    }

    .recordsSidebar {
      position: static;
    }

    .seasonPick,
    .sideCatList {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .monthPick {
      grid-template-columns: repeat(7, minmax(0, 1fr));
    }

    .sideSectionParams {
      padding-top: 14px;
    }
  }

  @media (max-width: 640px) {
    .wrap {
      width: 100%;
      max-width: none;
      padding: 12px 0 32px;
    }

    .recordsShell {
      gap: 8px;
      margin-top: 8px;
    }

    .recordsSidebar {
      order: 1;
      padding: 10px 10px;
      border-radius: 15px;
    }

    .recordsMain {
      order: 2;
    }

    .sidebarTitle {
      margin-bottom: 10px;
      font-size: 15px;
    }

    .sidebarTitleIcon {
      width: 26px;
      height: 26px;
      font-size: 15px;
      border-radius: 8px;
    }

    .sideSection + .sideSection {
      margin-top: 10px;
    }

    .sideSectionParams {
      padding-top: 10px;
    }

    .sideLabel {
      margin-bottom: 6px;
      font-size: 11px;
    }

    :global(.recordHeroSubtitle) {
      width: 100%;
      margin-top: 6px;
      padding: 0 10px;
      font-size: 12px;
      line-height: 1.4;
      text-align: center;
    }

    .mainHeader {
      width: 100%;
      margin: 8px 0 6px;
    }

    .updatedChip {
      width: 100%;
      box-sizing: border-box;
      margin-top: 0;
      padding: 6px 9px;
    }

    .tabsWide {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      overflow: visible;
      border: 0;
      gap: 5px;
      background: transparent;
      box-shadow: none;
    }

    .tabBtn {
      min-height: 38px;
      padding: 7px 9px;
      border: 1px solid #e2e8f0 !important;
      border-radius: 10px;
      background: #fff;
      font-size: 12px;
    }

    .tabBtnOn {
      border-color: #dc2626 !important;
      background: #fff1f2;
    }

    .tabBtnOn::after {
      display: none;
    }

    .seasonPick,
    .sideCatList {
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }

    .seasonBtn,
    .sideCatBtn {
      min-height: 34px;
      padding: 6px 8px;
      gap: 7px;
      font-size: 11px;
      border-radius: 10px;
    }

    .seasonSymbol,
    .sideCatIcon {
      width: 20px;
      font-size: 14px;
    }

    .monthPickDesktop {
      display: none;
    }

    .monthPickMobile {
      display: block;
    }

    .yearSel,
    .monthSelMobile {
      height: 36px;
      padding: 0 10px;
      font-size: 12px;
      border-radius: 10px;
    }

    .recordsSections {
      margin-top: 8px;
      gap: 7px;
    }

    .sectionDivider {
      margin: 3px 2px 0;
      gap: 7px;
    }

    .cardGrid {
      grid-template-columns: 1fr;
      gap: 7px;
    }

    .card {
      border-radius: 14px;
    }

    .cardHead {
      min-height: 48px;
      padding: 7px 9px 6px 11px;
      gap: 8px;
    }

    .cardIcon {
      width: 28px;
      height: 28px;
      border-radius: 9px;
      font-size: 14px;
    }

    .cardTitle {
      font-size: 12px;
      line-height: 1.14;
    }

    .cardBody {
      padding: 1px 8px 3px 9px;
    }

    .miniTable thead th {
      padding: 5px 4px 4px;
      font-size: 9px;
    }

    .miniTable tbody td {
      font-size: 11px;
      padding: 6px 4px;
      line-height: 1.12;
    }

    .thRank,
    .tdRank {
      width: 30px;
    }

    .thVal {
      width: 35%;
    }

    .thWhen {
      width: 41%;
    }

    .tdVal {
      padding-right: 7px;
      white-space: nowrap;
    }

    .tdWhen {
      padding-left: 7px;
      white-space: nowrap;
    }

    .rankBadge {
      width: 18px;
      height: 18px;
      font-size: 9px;
    }

    .sectionDivider span {
      font-size: 10px;
      white-space: normal;
    }
  }
`;