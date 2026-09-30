import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DATA_DIR = path.join(ROOT, "public", "data");
const JSON_OUT = path.join(DATA_DIR, "protezione-civile.json");
const TODAY_IMG_OUT = path.join(DATA_DIR, "protezione-civile-oggi.jpg");
const TOMORROW_IMG_OUT = path.join(DATA_DIR, "protezione-civile-domani.jpg");

const OFFICIAL_URL = "https://www.sardegnaambiente.it/protezionecivile/";
const MAPS_URL =
  "https://www.sardegnaambiente.it/index.php?xsl=2685&s=20&v=9&c=12428&nodesc=3&n=9&bx=2&idr=1&dx=2&rl=1";
const BULLETINS_URL =
  "https://www.sardegnaambiente.it/index.php?xsl=2273&s=20&v=9&nodesc=1&c=7092";
const ZONE_CODE = "SARD-C";
const ZONE_NAME = "Bacini Montevecchio-Pischilappiu";

const HEADERS = {
  "user-agent": "MeteoCollinas/1.0 (+weather station website)",
  accept: "text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*",
};

const LEVEL_SCORE = {
  unknown: -1,
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
};

const LEVEL_LABEL = {
  green: "Nessuna criticità",
  yellow: "Allerta gialla",
  orange: "Allerta arancione",
  red: "Allerta rossa",
  unknown: "Stato non disponibile",
};

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&agrave;/g, "à")
    .replace(/&egrave;/g, "è")
    .replace(/&igrave;/g, "ì")
    .replace(/&ograve;/g, "ò")
    .replace(/&ugrave;/g, "ù");
}

function stripTags(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absoluteUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

async function fetchResponse(url, accept = HEADERS.accept) {
  const response = await fetch(url, {
    headers: {
      ...HEADERS,
      accept,
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${url}`);
  }

  return response;
}

function findImage(html, marker, baseUrl) {
  const tags = html.match(/<img\b[^>]*>/gi) || [];

  for (const tag of tags) {
    if (!tag.toLowerCase().includes(marker.toLowerCase())) continue;

    const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!srcMatch) continue;

    const url = absoluteUrl(baseUrl, decodeHtml(srcMatch[1]));
    if (!url) continue;

    const index = html.indexOf(tag);
    const before = html.slice(Math.max(0, index - 1600), index);
    const dateMatches = Array.from(
      stripTags(before).matchAll(/\b(\d{2}[./-]\d{2}[./-]\d{4})\b/g),
    );

    const date = dateMatches.length
      ? dateMatches[dateMatches.length - 1][1].replace(/[./]/g, "-")
      : null;

    return {
      remoteUrl: url,
      date,
    };
  }

  return null;
}

function findLatestCriticalityDocument(html, baseUrl) {
  const links = Array.from(
    html.matchAll(
      /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  );

  for (const match of links) {
    const title = stripTags(match[2]);

    if (!/(?:bollettino|avviso)\s+di\s+criticit/i.test(title)) continue;

    const dateMatch = title.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (!dateMatch) continue;

    const url = absoluteUrl(baseUrl, decodeHtml(match[1]));
    if (!url) continue;

    return {
      title,
      url,
      date: `${dateMatch[3]}-${String(dateMatch[2]).padStart(2, "0")}-${String(
        dateMatch[1],
      ).padStart(2, "0")}`,
      type: /^\s*avviso\s+di\s+criticit/i.test(title) ? "alert" : "bulletin",
    };
  }

  return null;
}

function parseDateTimeItalian(day, month, year, hour, minute) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const hh = Number(hour);
  const mm = Number(minute);

  if (
    !Number.isInteger(y) ||
    !Number.isInteger(m) ||
    !Number.isInteger(d) ||
    !Number.isInteger(hh) ||
    !Number.isInteger(mm) ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > 31 ||
    hh < 0 ||
    hh > 23 ||
    mm < 0 ||
    mm > 59
  ) {
    return null;
  }

  const localAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const offsetMs = (timestamp) => {
    const parts = formatter.formatToParts(new Date(timestamp));
    const get = (type) =>
      Number(parts.find((part) => part.type === type)?.value);

    return (
      Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour"),
        get("minute"),
        get("second"),
        0,
      ) - timestamp
    );
  };

  let utcTimestamp = localAsUtc - offsetMs(localAsUtc);
  utcTimestamp = localAsUtc - offsetMs(utcTimestamp);

  const result = new Date(utcTimestamp);
  return Number.isFinite(result.getTime()) ? result.toISOString() : null;
}

function normalizeCriticalityText(value = "") {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\u0000/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNamedDateTime(text, label) {
  const pattern = new RegExp(
    `${label}\\s*[:\-]?\\s*(\\d{1,2})[./-](\\d{1,2})[./-](\\d{4})\\s*(?:alle?\\s+ore\\s*)?(\\d{1,2})[:.](\\d{2})`,
    "i",
  );
  const match = pattern.exec(normalizeCriticalityText(text));

  if (!match) return null;

  return parseDateTimeItalian(
    match[1],
    match[2],
    match[3],
    match[4],
    match[5],
  );
}

function extractBulletinValidity(text = "") {
  const normalized = normalizeCriticalityText(text);
  const validFrom = extractNamedDateTime(
    normalized,
    "Inizio\\s+validit(?:à|a)",
  );
  const validTo = extractNamedDateTime(
    normalized,
    "Fine\\s+validit(?:à|a)",
  );
  const alertFrom = extractNamedDateTime(
    normalized,
    "Inizio\\s+(?:validit(?:à|a)\\s+)?avviso",
  );
  const alertTo = extractNamedDateTime(
    normalized,
    "Fine\\s+(?:validit(?:à|a)\\s+)?avviso",
  );

  if (validFrom && validTo) {
    return { validFrom, validTo, alertFrom, alertTo };
  }

  const pair = /Inizio\s+validit(?:à|a)\s*[:\-]?\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*(\d{1,2})[:.](\d{2})[\s\S]{0,180}?Fine\s+validit(?:à|a)\s*[:\-]?\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\s*(\d{1,2})[:.](\d{2})/i.exec(
    normalized,
  );

  if (!pair) {
    return { validFrom, validTo, alertFrom, alertTo };
  }

  return {
    validFrom:
      validFrom ||
      parseDateTimeItalian(pair[1], pair[2], pair[3], pair[4], pair[5]),
    validTo:
      validTo ||
      parseDateTimeItalian(pair[6], pair[7], pair[8], pair[9], pair[10]),
    alertFrom,
    alertTo,
  };
}

function parsePpm(buffer) {
  let index = 0;

  const skipWhitespaceAndComments = () => {
    while (index < buffer.length) {
      const value = buffer[index];

      if (value === 35) {
        while (index < buffer.length && buffer[index] !== 10) index += 1;
        continue;
      }

      if (value === 9 || value === 10 || value === 13 || value === 32) {
        index += 1;
        continue;
      }

      break;
    }
  };

  const readToken = () => {
    skipWhitespaceAndComments();
    const start = index;

    while (index < buffer.length) {
      const value = buffer[index];
      if (
        value === 9 ||
        value === 10 ||
        value === 13 ||
        value === 32 ||
        value === 35
      ) {
        break;
      }
      index += 1;
    }

    return buffer.subarray(start, index).toString("ascii");
  };

  const magic = readToken();
  const width = Number(readToken());
  const height = Number(readToken());
  const maxValue = Number(readToken());

  if (magic !== "P6" || !width || !height || maxValue !== 255) {
    throw new Error("Formato PPM non riconosciuto");
  }

  skipWhitespaceAndComments();
  const pixels = buffer.subarray(index);
  const expected = width * height * 3;

  if (pixels.length < expected) {
    throw new Error("Immagine PPM incompleta");
  }

  return {
    width,
    height,
    pixels: pixels.subarray(0, expected),
  };
}

function parseBboxXml(xml = "") {
  const pageMatch = String(xml).match(
    /<page\b[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/i,
  );

  if (!pageMatch) {
    throw new Error("Dimensioni pagina PDF non trovate");
  }

  const words = [];
  const wordRegex =
    /<word\b[^>]*xMin="([\d.]+)"[^>]*yMin="([\d.]+)"[^>]*xMax="([\d.]+)"[^>]*yMax="([\d.]+)"[^>]*>([\s\S]*?)<\/word>/gi;

  let match;
  while ((match = wordRegex.exec(xml))) {
    words.push({
      xMin: Number(match[1]),
      yMin: Number(match[2]),
      xMax: Number(match[3]),
      yMax: Number(match[4]),
      text: decodeHtml(match[5]).replace(/<[^>]+>/g, "").trim(),
    });
  }

  return {
    width: Number(pageMatch[1]),
    height: Number(pageMatch[2]),
    words,
  };
}

function normalizeWord(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .trim()
    .toLowerCase();
}

function wordCenterY(word) {
  return (word.yMin + word.yMax) / 2;
}

function officialPixelLevel(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max - min;

  if (saturation < 45 || max < 70) return null;

  if (r >= 150 && g <= 115 && b <= 115 && r >= g * 1.45) {
    return "red";
  }

  if (
    r >= 170 &&
    g >= 65 &&
    g <= 185 &&
    b <= 115 &&
    r >= g * 1.15
  ) {
    return "orange";
  }

  if (
    r >= 170 &&
    g >= 145 &&
    b <= 125 &&
    Math.abs(r - g) <= 115
  ) {
    return "yellow";
  }

  if (
    g >= 70 &&
    g >= r * 1.25 &&
    g >= b * 1.25 &&
    r <= 135 &&
    b <= 135
  ) {
    return "green";
  }

  return null;
}

function levelFromCounts(counts, minimum = 1) {
  if ((counts.red || 0) >= minimum) return "red";
  if ((counts.orange || 0) >= minimum) return "orange";
  if ((counts.yellow || 0) >= minimum) return "yellow";
  if ((counts.green || 0) >= minimum) return "green";
  return "unknown";
}

function scanRowColors(image, page, yCenterPt, xStartPt, xEndPt, radiusPt) {
  const scaleX = image.width / page.width;
  const scaleY = image.height / page.height;
  const x0 = Math.max(0, Math.floor(xStartPt * scaleX));
  const x1 = Math.min(image.width - 1, Math.ceil(xEndPt * scaleX));
  const y0 = Math.max(0, Math.floor((yCenterPt - radiusPt) * scaleY));
  const y1 = Math.min(image.height - 1, Math.ceil((yCenterPt + radiusPt) * scaleY));
  const counts = { green: 0, yellow: 0, orange: 0, red: 0 };

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const offset = (y * image.width + x) * 3;
      const level = officialPixelLevel(
        image.pixels[offset],
        image.pixels[offset + 1],
        image.pixels[offset + 2],
      );

      if (level) counts[level] += 1;
    }
  }

  const width = Math.max(1, x1 - x0 + 1);
  const minimum = Math.max(8, Math.floor(width * 0.06));

  return {
    level: levelFromCounts(counts, minimum),
    counts,
  };
}

function findColorBands(image, page, xStartPt, xEndPt, yStartPt, yEndPt) {
  const scaleX = image.width / page.width;
  const scaleY = image.height / page.height;
  const x0 = Math.max(0, Math.floor(xStartPt * scaleX));
  const x1 = Math.min(image.width - 1, Math.ceil(xEndPt * scaleX));
  const y0 = Math.max(0, Math.floor(yStartPt * scaleY));
  const y1 = Math.min(image.height - 1, Math.ceil(yEndPt * scaleY));
  const width = Math.max(1, x1 - x0 + 1);
  const rowMinimum = Math.max(5, Math.floor(width * 0.025));
  const activeRows = [];

  for (let y = y0; y <= y1; y += 1) {
    const counts = { green: 0, yellow: 0, orange: 0, red: 0 };

    for (let x = x0; x <= x1; x += 1) {
      const offset = (y * image.width + x) * 3;
      const level = officialPixelLevel(
        image.pixels[offset],
        image.pixels[offset + 1],
        image.pixels[offset + 2],
      );
      if (level) counts[level] += 1;
    }

    const colored = counts.green + counts.yellow + counts.orange + counts.red;
    if (colored >= rowMinimum) activeRows.push({ y, counts });
  }

  const bands = [];

  for (const row of activeRows) {
    const last = bands[bands.length - 1];

    if (!last || row.y > last.yEnd + 1) {
      bands.push({
        yStart: row.y,
        yEnd: row.y,
        counts: { ...row.counts },
      });
      continue;
    }

    last.yEnd = row.y;
    for (const key of Object.keys(last.counts)) {
      last.counts[key] += row.counts[key] || 0;
    }
  }

  return bands
    .filter((band) => band.yEnd - band.yStart + 1 >= 2)
    .map((band) => {
      const centerPx = (band.yStart + band.yEnd) / 2;
      const centerPt = centerPx / scaleY;
      const heightPx = band.yEnd - band.yStart + 1;
      const minimum = Math.max(12, Math.floor(width * heightPx * 0.01));

      return {
        centerPt,
        level: levelFromCounts(band.counts, minimum),
        counts: band.counts,
      };
    })
    .filter((band) => band.level !== "unknown");
}

function scanRiskCellColors(image, page, xStartPt, xEndPt, yTopPt, yBottomPt) {
  const scaleX = image.width / page.width;
  const scaleY = image.height / page.height;
  const x0 = Math.max(0, Math.floor(xStartPt * scaleX));
  const x1 = Math.min(image.width - 1, Math.ceil(xEndPt * scaleX));
  const y0 = Math.max(0, Math.floor(yTopPt * scaleY));
  const y1 = Math.min(image.height - 1, Math.ceil(yBottomPt * scaleY));
  const counts = { green: 0, yellow: 0, orange: 0, red: 0 };

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const offset = (y * image.width + x) * 3;
      const level = officialPixelLevel(
        image.pixels[offset],
        image.pixels[offset + 1],
        image.pixels[offset + 2],
      );

      if (level) counts[level] += 1;
    }
  }

  const area = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
  const minimum = Math.max(18, Math.floor(area * 0.008));

  return {
    level: levelFromCounts(counts, minimum),
    counts,
  };
}

function extractZoneRiskLevels(page, image, zoneCode = ZONE_CODE) {
  const normalizedZoneCode = normalizeWord(zoneCode);
  const zoneCandidates = page.words.filter(
    (word) => normalizeWord(word.text) === normalizedZoneCode,
  );

  if (!zoneCandidates.length) {
    throw new Error(`${zoneCode} non trovato nel bollettino`);
  }

  const zoneWord = zoneCandidates[0];
  const zoneY = wordCenterY(zoneWord);
  const rowTargets = [
    { key: "hydrogeological", target: "idrogeologico" },
    { key: "hydraulic", target: "idraulico" },
    { key: "thunderstorms", target: "temporali" },
    { key: "snow", target: "neve" },
  ];

  const rows = [];

  for (const item of rowTargets) {
    const candidates = page.words
      .filter(
        (word) =>
          normalizeWord(word.text) === item.target &&
          word.xMin > zoneWord.xMax &&
          Math.abs(wordCenterY(word) - zoneY) <= 48,
      )
      .sort(
        (a, b) =>
          Math.abs(wordCenterY(a) - zoneY) -
          Math.abs(wordCenterY(b) - zoneY),
      );

    if (!candidates.length) {
      if (item.key === "snow") continue;
      throw new Error(`Riga ${item.target} non trovata per ${zoneCode}`);
    }

    const word = candidates[0];
    rows.push({ key: item.key, word, y: wordCenterY(word) });
  }

  rows.sort((a, b) => a.y - b.y);

  const riskRows = rows.filter((row) => row.key !== "snow");
  if (riskRows.length !== 3) {
    throw new Error(`Righe di rischio incomplete per ${zoneCode}`);
  }

  const labelRight = Math.max(...rows.map(({ word }) => word.xMax));
  const xStart = labelRight + 10;
  const xEnd = Math.max(xStart + 35, page.width * 0.56);
  const levels = {};

  for (const row of riskRows) {
    const index = rows.findIndex((candidate) => candidate.key === row.key);
    const previous = rows[index - 1] || null;
    const next = rows[index + 1] || null;

    const previousGap = previous ? row.y - previous.y : next ? next.y - row.y : 12;
    const nextGap = next ? next.y - row.y : previous ? row.y - previous.y : 12;

    let yTop = row.y - previousGap * 0.44;
    let yBottom = row.y + nextGap * 0.44;

    const inset = Math.min(2.2, Math.max(0.7, (yBottom - yTop) * 0.12));
    yTop += inset;
    yBottom -= inset;

    let sampled = scanRiskCellColors(
      image,
      page,
      xStart,
      xEnd,
      yTop,
      yBottom,
    );

    if (sampled.level === "unknown") {
      sampled = scanRowColors(image, page, row.y, xStart, xEnd, 5.5);
    }

    if (sampled.level === "unknown") {
      sampled = scanRowColors(
        image,
        page,
        row.y + Math.min(2.5, nextGap * 0.18),
        xStart,
        xEnd,
        3.8,
      );
    }

    if (sampled.level === "unknown") {
      sampled = scanRowColors(
        image,
        page,
        row.y - Math.min(2.5, previousGap * 0.18),
        xStart,
        xEnd,
        3.8,
      );
    }

    levels[row.key] = sampled.level;
  }

  return {
    hydrogeological: levels.hydrogeological || "unknown",
    hydraulic: levels.hydraulic || "unknown",
    thunderstorms: levels.thunderstorms || "unknown",
  };
}

function maxLevel(levels = []) {
  const normalized = levels.map((level) =>
    Object.prototype.hasOwnProperty.call(LEVEL_SCORE, level) ? level : "unknown",
  );

  for (const level of ["red", "orange", "yellow"]) {
    if (normalized.includes(level)) return level;
  }

  if (normalized.length && normalized.every((level) => level === "green")) {
    return "green";
  }

  return "unknown";
}

function riskNamesFromLevels(levels) {
  const names = [];

  if ((LEVEL_SCORE[levels.hydrogeological] ?? -1) > 0) {
    names.push("Rischio idrogeologico");
  }

  if ((LEVEL_SCORE[levels.hydraulic] ?? -1) > 0) {
    names.push("Rischio idraulico");
  }

  if ((LEVEL_SCORE[levels.thunderstorms] ?? -1) > 0) {
    names.push("Temporali");
  }

  return names;
}

async function analyzeCriticalityPdf(document) {
  const url = document?.url;
  if (!url) throw new Error("URL del bollettino non disponibile");

  const response = await fetchResponse(url, "application/pdf,*/*;q=0.8");
  const bytes = Buffer.from(await response.arrayBuffer());
  const finalUrl = response.url || url;
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "meteo-collinas-criticita-"),
  );
  const pdfPath = path.join(tempDir, "bollettino.pdf");
  const ppmPrefix = path.join(tempDir, "pagina");
  const ppmPath = `${ppmPrefix}.ppm`;

  let normalizedText = "";
  let validity = {
    validFrom: null,
    validTo: null,
    alertFrom: null,
    alertTo: null,
  };
  let riskLevels = {
    hydrogeological: "unknown",
    hydraulic: "unknown",
    thunderstorms: "unknown",
  };

  try {
    await fs.writeFile(pdfPath, bytes);

    try {
      const { stdout: text } = await execFileAsync(
        "pdftotext",
        ["-layout", "-enc", "UTF-8", pdfPath, "-"],
        { maxBuffer: 20 * 1024 * 1024 },
      );

      normalizedText = normalizeCriticalityText(text);
      validity = extractBulletinValidity(normalizedText);
    } catch (error) {
      console.warn("Testo del bollettino non estraibile:", error.message);
      normalizedText = normalizeCriticalityText(bytes.toString("latin1"));
      validity = extractBulletinValidity(normalizedText);
    }

    try {
      const { stdout: bboxXml } = await execFileAsync(
        "pdftotext",
        ["-bbox-layout", pdfPath, "-"],
        { maxBuffer: 20 * 1024 * 1024 },
      );

      await execFileAsync(
        "pdftoppm",
        ["-f", "1", "-l", "1", "-singlefile", "-r", "110", pdfPath, ppmPrefix],
        { maxBuffer: 20 * 1024 * 1024 },
      );

      const image = parsePpm(await fs.readFile(ppmPath));
      const page = parseBboxXml(String(bboxXml || ""));
      riskLevels = extractZoneRiskLevels(page, image, ZONE_CODE);
    } catch (error) {
      console.warn("Colori del bollettino non estraibili:", error.message);
    }

    const allUnknown = Object.values(riskLevels).every(
      (level) => level === "unknown",
    );

    const knownLevels = Object.values(riskLevels).filter((level) =>
      ["green", "yellow", "orange", "red"].includes(level),
    );

    if (document?.type === "bulletin") {
      if (allUnknown) {
        riskLevels = {
          hydrogeological: "green",
          hydraulic: "green",
          thunderstorms: "green",
        };
      } else if (knownLevels.length && knownLevels.every((level) => level === "green")) {
        riskLevels = {
          hydrogeological:
            riskLevels.hydrogeological === "unknown" ? "green" : riskLevels.hydrogeological,
          hydraulic: riskLevels.hydraulic === "unknown" ? "green" : riskLevels.hydraulic,
          thunderstorms:
            riskLevels.thunderstorms === "unknown" ? "green" : riskLevels.thunderstorms,
        };
      }
    }

    const level = maxLevel(Object.values(riskLevels));
    const useAlertValidity =
      level !== "green" &&
      level !== "unknown" &&
      validity.alertFrom &&
      validity.alertTo;

    return {
      sourceUrl: finalUrl,
      text: normalizedText,
      level,
      label: LEVEL_LABEL[level] || LEVEL_LABEL.unknown,
      validFrom: useAlertValidity ? validity.alertFrom : validity.validFrom,
      validTo: useAlertValidity ? validity.alertTo : validity.validTo,
      bulletinValidFrom: validity.validFrom,
      bulletinValidTo: validity.validTo,
      alertValidFrom: validity.alertFrom,
      alertValidTo: validity.alertTo,
      riskLevels,
      risks: riskNamesFromLevels(riskLevels),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function buildUnknownAdvisory(document = null) {
  return {
    title: document?.title || "Bollettino di criticità non disponibile",
    url: document?.url || BULLETINS_URL,
    date: document?.date || null,
    level: "unknown",
    label: LEVEL_LABEL.unknown,
    validFrom: null,
    validTo: null,
    riskLevels: {
      hydrogeological: "unknown",
      hydraulic: "unknown",
      thunderstorms: "unknown",
    },
    risks: [],
    riskHydrogeological: null,
    riskHydraulic: null,
    riskThunderstorms: null,
    appliesToZone: null,
    detailSourceUrl: document?.url || BULLETINS_URL,
  };
}

function pageConfirmsNoCriticalityNotice(html = "") {
  const text = stripTags(html).toLowerCase();
  return (
    text.includes("nessun avviso emesso") ||
    text.includes("nessun avviso di criticità emesso") ||
    text.includes("nessun avviso di criticita' emesso")
  );
}

function pageHasCriticalityAlertForDate(html = "", dateKey = null) {
  if (!dateKey) return false;

  const links = Array.from(
    html.matchAll(
      /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  );

  for (const match of links) {
    const title = stripTags(match[2]);
    if (!/^\s*avviso\s+di\s+criticit/i.test(title)) continue;

    const dateMatch = title.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (!dateMatch) continue;

    const normalized = `${dateMatch[3]}-${String(dateMatch[2]).padStart(2, "0")}-${String(
      dateMatch[1],
    ).padStart(2, "0")}`;

    if (normalized === dateKey) return true;
  }

  return false;
}

function fallbackBulletinValidity(dateKey) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return { validFrom: null, validTo: null };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));

  return {
    validFrom: parseDateTimeItalian(day, month, year, 14, 0),
    validTo: parseDateTimeItalian(
      nextDay.getUTCDate(),
      nextDay.getUTCMonth() + 1,
      nextDay.getUTCFullYear(),
      23,
      59,
    ),
  };
}

function buildGreenAdvisory(document = null, date = null, analysis = null) {
  const fallbackValidity = fallbackBulletinValidity(document?.date || date);
  const validFrom =
    analysis?.validFrom ||
    analysis?.bulletinValidFrom ||
    fallbackValidity.validFrom;
  const validTo =
    analysis?.validTo ||
    analysis?.bulletinValidTo ||
    fallbackValidity.validTo;

  return {
    title: "Nessun avviso di criticità attivo",
    url: document?.url || BULLETINS_URL,
    date: document?.date || date || null,
    level: "green",
    label: LEVEL_LABEL.green,
    validFrom,
    validTo,
    bulletinValidFrom: analysis?.bulletinValidFrom || validFrom,
    bulletinValidTo: analysis?.bulletinValidTo || validTo,
    alertValidFrom: null,
    alertValidTo: null,
    riskLevels: {
      hydrogeological: "green",
      hydraulic: "green",
      thunderstorms: "green",
    },
    risks: [],
    riskHydrogeological: false,
    riskHydraulic: false,
    riskThunderstorms: false,
    appliesToZone: true,
    detailSourceUrl: document?.url || BULLETINS_URL,
  };
}

function buildAdvisory(document, analysis) {
  const validToMs = Date.parse(analysis.validTo || "");
  const expired = Number.isFinite(validToMs) && Date.now() > validToMs;

  if (expired) {
    return buildUnknownAdvisory(document);
  }

  const levels = analysis.riskLevels;

  return {
    title: document.title,
    url: analysis.sourceUrl || document.url,
    date: document.date,
    level: analysis.level,
    label: analysis.label,
    validFrom: analysis.validFrom,
    validTo: analysis.validTo,
    bulletinValidFrom: analysis.bulletinValidFrom,
    bulletinValidTo: analysis.bulletinValidTo,
    alertValidFrom: analysis.alertValidFrom,
    alertValidTo: analysis.alertValidTo,
    riskLevels: levels,
    risks: analysis.risks,
    riskHydrogeological:
      (LEVEL_SCORE[levels.hydrogeological] ?? -1) > 0 ? true : false,
    riskHydraulic:
      (LEVEL_SCORE[levels.hydraulic] ?? -1) > 0 ? true : false,
    riskThunderstorms:
      (LEVEL_SCORE[levels.thunderstorms] ?? -1) > 0 ? true : false,
    appliesToZone: true,
    detailSourceUrl: analysis.sourceUrl || document.url,
  };
}

async function downloadImage(remoteUrl, destination) {
  const response = await fetchResponse(
    remoteUrl,
    "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  );
  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length < 1000) {
    throw new Error(`Immagine troppo piccola: ${remoteUrl}`);
  }

  try {
    const previousBytes = await fs.readFile(destination);
    if (previousBytes.equals(bytes)) return false;
  } catch {}

  await fs.writeFile(destination, bytes);
  return true;
}

async function readPrevious() {
  try {
    return JSON.parse(await fs.readFile(JSON_OUT, "utf8"));
  } catch {
    return null;
  }
}

function stablePayloadForComparison(value) {
  if (!value || typeof value !== "object") return null;
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.updatedAt;
  delete copy.checkedAt;
  return copy;
}

function sameMeaningfulPayload(a, b) {
  return (
    JSON.stringify(stablePayloadForComparison(a)) ===
    JSON.stringify(stablePayloadForComparison(b))
  );
}

function romeDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDaysToDateKey(dateKey, days) {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(
    Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]) + Number(days || 0),
      12,
      0,
      0,
    ),
  );

  return date.toISOString().slice(0, 10);
}

function officialDateToKey(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);

  if (match) return `${match[3]}-${match[2]}-${match[1]}`;

  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? text : null;
}

function keyToItalianDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function reconcileOfficialMaps(todaySource, tomorrowSource) {
  const currentKey = romeDateKey();
  const nextKey = addDaysToDateKey(currentKey, 1);
  const todaySourceKey = officialDateToKey(todaySource?.date);
  const tomorrowSourceKey = officialDateToKey(tomorrowSource?.date);

  if (todaySourceKey === currentKey) {
    return {
      today: {
        ...todaySource,
        date: keyToItalianDate(currentKey),
        pending: false,
        rolledFromPreviousBulletin: false,
      },
      tomorrow:
        tomorrowSourceKey === nextKey
          ? {
              ...tomorrowSource,
              date: keyToItalianDate(nextKey),
              pending: false,
              rolledFromPreviousBulletin: false,
            }
          : {
              remoteUrl: null,
              date: keyToItalianDate(nextKey),
              pending: true,
              rolledFromPreviousBulletin: false,
              note: "In attesa della mappa di domani dal nuovo bollettino della Protezione Civile.",
            },
      sourceState: "current",
    };
  }

  if (tomorrowSourceKey === currentKey) {
    return {
      today: {
        ...tomorrowSource,
        date: keyToItalianDate(currentKey),
        pending: false,
        rolledFromPreviousBulletin: true,
        note: "Mappa odierna ricavata dalla previsione per il giorno successivo del bollettino precedente.",
      },
      tomorrow: {
        remoteUrl: null,
        date: keyToItalianDate(nextKey),
        pending: true,
        rolledFromPreviousBulletin: false,
        note: "In attesa del bollettino odierno, normalmente pubblicato nel pomeriggio.",
      },
      sourceState: "waiting-new-bulletin",
    };
  }

  return {
    today: {
      remoteUrl: null,
      date: keyToItalianDate(currentKey),
      pending: true,
      rolledFromPreviousBulletin: false,
      note: "La mappa odierna non è ancora disponibile dalla fonte ufficiale.",
    },
    tomorrow: {
      remoteUrl: null,
      date: keyToItalianDate(nextKey),
      pending: true,
      rolledFromPreviousBulletin: false,
      note: "La mappa di domani non è ancora disponibile dalla fonte ufficiale.",
    },
    sourceState: "stale",
  };
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const previous = await readPrevious();

  let mapsResponse;
  let mapsHtml;

  try {
    mapsResponse = await fetchResponse(MAPS_URL);
    mapsHtml = await mapsResponse.text();
  } catch (error) {
    console.error("Impossibile leggere la pagina ufficiale delle mappe:", error.message);

    if (previous) return;
    process.exitCode = 1;
    return;
  }

  const sourceToday = findImage(
    mapsHtml,
    "sito_oggi_230_120.jpg",
    mapsResponse.url,
  );
  const sourceTomorrow = findImage(
    mapsHtml,
    "sito_domani_230_120.jpg",
    mapsResponse.url,
  );

  if (!sourceToday?.remoteUrl || !sourceTomorrow?.remoteUrl) {
    console.error("Le mappe ufficiali oggi/domani non sono state trovate.");

    if (previous) return;
    process.exitCode = 1;
    return;
  }

  const reconciled = reconcileOfficialMaps(sourceToday, sourceTomorrow);

  let bulletinDocument = null;
  let advisory = null;
  let bulletinsReachable = false;
  let noCriticalityNotice = false;
  let currentDateHasAlert = false;
  let bulletinAnalysis = null;

  try {
    const bulletinsResponse = await fetchResponse(BULLETINS_URL);
    const bulletinsHtml = await bulletinsResponse.text();
    const currentDate = romeDateKey();
    bulletinsReachable = true;
    noCriticalityNotice = pageConfirmsNoCriticalityNotice(bulletinsHtml);
    currentDateHasAlert = pageHasCriticalityAlertForDate(
      bulletinsHtml,
      currentDate,
    );

    bulletinDocument = findLatestCriticalityDocument(
      bulletinsHtml,
      bulletinsResponse.url,
    );

    const currentDocumentIsGreenBulletin =
      bulletinDocument?.date === currentDate &&
      bulletinDocument?.type === "bulletin" &&
      !currentDateHasAlert;

    if (currentDocumentIsGreenBulletin) {
      advisory = buildGreenAdvisory(
        bulletinDocument,
        currentDate,
        null,
      );
    } else if (bulletinDocument?.url) {
      try {
        bulletinAnalysis = await analyzeCriticalityPdf(bulletinDocument);
        advisory = buildAdvisory(bulletinDocument, bulletinAnalysis);
      } catch (error) {
        console.warn("Avviso di criticità non analizzabile:", error.message);
      }
    }
  } catch (error) {
    console.warn("Pagina dei bollettini non leggibile:", error.message);
  }

  if (
    bulletinsReachable &&
    noCriticalityNotice &&
    (!advisory || advisory.level === "unknown")
  ) {
    advisory = buildGreenAdvisory(
      bulletinDocument,
      romeDateKey(),
      bulletinAnalysis,
    );
  }

  if (!advisory) {
    advisory = buildUnknownAdvisory(bulletinDocument);
  }

  let todayImageChanged = false;
  let tomorrowImageChanged = false;

  if (reconciled.today?.remoteUrl) {
    todayImageChanged = await downloadImage(
      reconciled.today.remoteUrl,
      TODAY_IMG_OUT,
    );
  }

  if (reconciled.tomorrow?.remoteUrl) {
    tomorrowImageChanged = await downloadImage(
      reconciled.tomorrow.remoteUrl,
      TOMORROW_IMG_OUT,
    );
  }

  const payload = {
    zoneCode: ZONE_CODE,
    zoneName: ZONE_NAME,
    updatedAt: previous?.updatedAt || null,
    checkedAt: new Date().toISOString(),
    sourceUrl: MAPS_URL,
    bulletinSourceUrl: BULLETINS_URL,
    automatic: true,
    method: "official-maps-and-criticality-bulletin",
    sourceState: reconciled.sourceState,
    sourceDates: {
      officialToday: sourceToday.date || null,
      officialTomorrow: sourceTomorrow.date || null,
    },
    today: {
      ...reconciled.today,
      mapUrl: reconciled.today?.remoteUrl
        ? "/data/protezione-civile-oggi.jpg"
        : null,
      sourceImage: reconciled.today?.remoteUrl || null,
    },
    tomorrow: {
      ...reconciled.tomorrow,
      mapUrl: reconciled.tomorrow?.remoteUrl
        ? "/data/protezione-civile-domani.jpg"
        : null,
      sourceImage: reconciled.tomorrow?.remoteUrl || null,
    },
    advisory,
  };

  const meaningfulChanged =
    todayImageChanged ||
    tomorrowImageChanged ||
    !previous ||
    !sameMeaningfulPayload(previous, payload);

  if (meaningfulChanged) {
    payload.updatedAt = payload.checkedAt;
  }

  await fs.writeFile(
    JSON_OUT,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );

  console.log(
    meaningfulChanged
      ? "Protezione Civile aggiornata."
      : "Controllo Protezione Civile eseguito: nessuna variazione reale.",
  );
  console.log("Oggi:", payload.today.date || "—");
  console.log("Domani:", payload.tomorrow.date || "—");
  console.log("Criticità SARD-C:", payload.advisory.level);
  console.log("Idrogeologico:", payload.advisory.riskLevels.hydrogeological);
  console.log("Idraulico:", payload.advisory.riskLevels.hydraulic);
  console.log("Temporali:", payload.advisory.riskLevels.thunderstorms);
}

await main();