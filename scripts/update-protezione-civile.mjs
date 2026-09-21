// scripts/update-protezione-civile.mjs
//
// Metodo semplice e robusto:
// - NON legge PDF
// - NON usa pdf-parse
// - NON usa Python
// - legge direttamente la home ufficiale della Protezione Civile Sardegna
// - individua le mappe ufficiali "oggi" e "domani"
// - salva localmente le due immagini nel sito
// - legge l'ultimo Avviso di Criticità visibile nella pagina e ne ricava
//   il livello generale (ordinaria=gialla, moderata=arancione, elevata=rossa)
//
// Output:
//   public/data/protezione-civile.json
//   public/data/protezione-civile-oggi.jpg
//   public/data/protezione-civile-domani.jpg
//
// Le mappe ufficiali restano il riferimento territoriale per SARD-C.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const DATA_DIR = path.join(ROOT, "public", "data");
const JSON_OUT = path.join(DATA_DIR, "protezione-civile.json");
const TODAY_IMG_OUT = path.join(DATA_DIR, "protezione-civile-oggi.jpg");
const TOMORROW_IMG_OUT = path.join(DATA_DIR, "protezione-civile-domani.jpg");

const OFFICIAL_URL = "https://www.sardegnaambiente.it/protezionecivile/";
const ZONE_CODE = "SARD-C";
const ZONE_NAME = "Bacini Montevecchio-Pischilappiu";

const HEADERS = {
  "user-agent": "MeteoCollinas/1.0 (+weather station website)",
  accept: "text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*",
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
    const before = html.slice(Math.max(0, index - 1200), index);

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

function parseAlertLevel(title = "") {
  const text = stripTags(title).toLowerCase();

  if (
    text.includes("elevata") ||
    text.includes("rossa") ||
    text.includes("rosso")
  ) {
    return { level: "red", label: "Allerta rossa" };
  }

  if (
    text.includes("moderata") ||
    text.includes("arancione")
  ) {
    return { level: "orange", label: "Allerta arancione" };
  }

  if (
    text.includes("ordinaria") ||
    text.includes("gialla") ||
    text.includes("giallo")
  ) {
    return { level: "yellow", label: "Allerta gialla" };
  }

  return { level: "unknown", label: "Avviso pubblicato" };
}


function findMatchingPressRelease(html, baseUrl, preferredDate = null) {
  const links = Array.from(
    html.matchAll(
      /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  );

  for (const match of links) {
    const title = stripTags(match[2]);

    if (!/comunicato\s+stampa/i.test(title)) continue;

    if (
      preferredDate &&
      !title.includes(preferredDate.split("-").reverse().join("/")) &&
      !title.includes(preferredDate.split("-").reverse().join("."))
    ) {
      continue;
    }

    return {
      title,
      url: absoluteUrl(baseUrl, decodeHtml(match[1])) || OFFICIAL_URL,
    };
  }

  return null;
}

function parseDateTimeItalian(day, month, year, hour, minute) {
  const local = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0,
    0,
  );

  return Number.isFinite(local.getTime()) ? local.toISOString() : null;
}

function monthNumberItalian(value = "") {
  const months = {
    gennaio: 1,
    febbraio: 2,
    marzo: 3,
    aprile: 4,
    maggio: 5,
    giugno: 6,
    luglio: 7,
    agosto: 8,
    settembre: 9,
    ottobre: 10,
    novembre: 11,
    dicembre: 12,
  };

  return months[String(value).toLowerCase()] || null;
}

function normalizeHourMinute(hour, minute = "00") {
  return {
    hour: String(hour).padStart(2, "0"),
    minute: String(minute || "00").padStart(2, "0"),
  };
}

function extractValidityFromText(value = "") {
  const text = stripTags(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const directPatterns = [
    /dalle\s+ore\s+(\d{1,2})(?:[:.](\d{2}))?\s+(?:del(?:\s+giorno)?\s+)?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})[\s\S]{0,420}?(?:sino|fino)\s+alle\s+ore\s+(\d{1,2})(?:[:.](\d{2}))?\s+(?:del(?:\s+giorno)?\s+)?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i,

    /dalle\s+(\d{1,2})(?:[:.](\d{2}))?\s+(?:del(?:\s+giorno)?\s+)?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})[\s\S]{0,420}?(?:sino|fino|alle)\s+(?:ore\s+)?(\d{1,2})(?:[:.](\d{2}))?\s+(?:del(?:\s+giorno)?\s+)?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i,
  ];

  for (const regex of directPatterns) {
    const match = regex.exec(text);
    if (!match) continue;

    const startTime = normalizeHourMinute(match[1], match[2]);
    const endTime = normalizeHourMinute(match[6], match[7]);

    const validFrom = parseDateTimeItalian(
      match[3],
      match[4],
      match[5],
      startTime.hour,
      startTime.minute,
    );

    const validTo = parseDateTimeItalian(
      match[8],
      match[9],
      match[10],
      endTime.hour,
      endTime.minute,
    );

    if (validFrom && validTo) {
      return { validFrom, validTo };
    }
  }

  // Caso molto comune nei comunicati:
  // "dalle ore 12 e sino alle ore 18 del 20/09/2026"
  const sharedNumericDate = /dalle\s+ore\s+(\d{1,2})(?:[:.](\d{2}))?[\s\S]{0,120}?(?:sino|fino)\s+alle\s+ore\s+(\d{1,2})(?:[:.](\d{2}))?[\s\S]{0,120}?(?:del(?:\s+giorno)?\s+)?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i.exec(
    text,
  );

  if (sharedNumericDate) {
    const startTime = normalizeHourMinute(
      sharedNumericDate[1],
      sharedNumericDate[2],
    );
    const endTime = normalizeHourMinute(
      sharedNumericDate[3],
      sharedNumericDate[4],
    );

    const validFrom = parseDateTimeItalian(
      sharedNumericDate[5],
      sharedNumericDate[6],
      sharedNumericDate[7],
      startTime.hour,
      startTime.minute,
    );

    const validTo = parseDateTimeItalian(
      sharedNumericDate[5],
      sharedNumericDate[6],
      sharedNumericDate[7],
      endTime.hour,
      endTime.minute,
    );

    if (validFrom && validTo) {
      return { validFrom, validTo };
    }
  }

  // Variante testuale:
  // "dalle ore 12 e sino alle ore 18 di domenica 20 settembre 2026"
  const sharedTextDate = /dalle\s+ore\s+(\d{1,2})(?:[:.](\d{2}))?[\s\S]{0,140}?(?:sino|fino)\s+alle\s+ore\s+(\d{1,2})(?:[:.](\d{2}))?[\s\S]{0,140}?(?:di\s+)?(?:luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)?\s*(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})/i.exec(
    text,
  );

  if (sharedTextDate) {
    const month = monthNumberItalian(sharedTextDate[6]);

    if (month) {
      const startTime = normalizeHourMinute(
        sharedTextDate[1],
        sharedTextDate[2],
      );
      const endTime = normalizeHourMinute(
        sharedTextDate[3],
        sharedTextDate[4],
      );

      const validFrom = parseDateTimeItalian(
        sharedTextDate[5],
        month,
        sharedTextDate[7],
        startTime.hour,
        startTime.minute,
      );

      const validTo = parseDateTimeItalian(
        sharedTextDate[5],
        month,
        sharedTextDate[7],
        endTime.hour,
        endTime.minute,
      );

      if (validFrom && validTo) {
        return { validFrom, validTo };
      }
    }
  }

  // Ultimo fallback: una sola data e due ore vicine.
  const dateMatch = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(text);
  const hoursMatch = /dalle\s+ore\s+(\d{1,2})(?:[:.](\d{2}))?[\s\S]{0,180}?(?:sino|fino)\s+alle\s+ore\s+(\d{1,2})(?:[:.](\d{2}))?/i.exec(
    text,
  );

  if (dateMatch && hoursMatch) {
    const startTime = normalizeHourMinute(hoursMatch[1], hoursMatch[2]);
    const endTime = normalizeHourMinute(hoursMatch[3], hoursMatch[4]);

    const validFrom = parseDateTimeItalian(
      dateMatch[1],
      dateMatch[2],
      dateMatch[3],
      startTime.hour,
      startTime.minute,
    );

    const validTo = parseDateTimeItalian(
      dateMatch[1],
      dateMatch[2],
      dateMatch[3],
      endTime.hour,
      endTime.minute,
    );

    if (validFrom && validTo) {
      return { validFrom, validTo };
    }
  }

  return { validFrom: null, validTo: null };
}

function extractRisksFromText(value = "") {
  const text = stripTags(value).toLowerCase();
  const risks = [];

  const add = (condition, label) => {
    if (condition && !risks.includes(label)) risks.push(label);
  };

  add(
    text.includes("rischio idrogeologico per temporali"),
    "Rischio idrogeologico per temporali",
  );
  add(
    !text.includes("rischio idrogeologico per temporali") &&
      text.includes("rischio idrogeologico"),
    "Rischio idrogeologico",
  );
  add(text.includes("rischio idraulico"), "Rischio idraulico");
  add(
    (
      text.includes("temporali") ||
      text.includes("temporalesc") ||
      text.includes("fenomeni temporaleschi")
    ) &&
      !risks.some((risk) => risk.toLowerCase().includes("temporali")),
    "Temporali",
  );

  return risks;
}

function extractAffectedZone(value = "") {
  const text = stripTags(value).toLowerCase();

  return (
    text.includes("sard-c") ||
    text.includes("montevecchio-pischilappiu") ||
    text.includes("montevecchio pischilappiu") ||
    text.includes("montevecchio-pischinappiu")
  );
}

async function enrichAdvisory(advisory, homeHtml, baseUrl) {
  if (!advisory) return null;

  const candidates = [
    {
      title: advisory.title,
      url: advisory.url,
    },
  ];

  const pressRelease = findMatchingPressRelease(
    homeHtml,
    baseUrl,
    advisory.date,
  );

  if (pressRelease?.url) {
    candidates.push(pressRelease);
  }

  let detailsText = "";

  for (const candidate of candidates) {
    if (!candidate?.url) continue;

    try {
      const response = await fetchResponse(candidate.url, "text/html,*/*");
      const html = await response.text();
      detailsText += ` ${stripTags(html)}`;
    } catch (error) {
      console.warn(
        `Dettagli avviso non leggibili: ${candidate.url}`,
        error.message,
      );
    }
  }

  const validity = extractValidityFromText(detailsText);
  const detailedRisks = extractRisksFromText(
    `${advisory.title} ${detailsText}`,
  );

  const finalRisks =
    detailedRisks.length ? detailedRisks : advisory.risks;

  const riskText = finalRisks.join(" ").toLowerCase();

  return {
    ...advisory,
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    risks: finalRisks,
    riskHydrogeological: riskText.includes("idrogeologic")
      ? true
      : null,
    riskHydraulic: riskText.includes("idraulic")
      ? true
      : null,
    riskThunderstorms: riskText.includes("temporal")
      ? true
      : null,
    appliesToZone: extractAffectedZone(detailsText),
    detailSourceUrl:
      pressRelease?.url || advisory.url || OFFICIAL_URL,
  };
}

function findLatestCriticalNotice(html, baseUrl) {
  const links = Array.from(
    html.matchAll(
      /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    ),
  );

  for (const match of links) {
    const title = stripTags(match[2]);

    if (!/avviso\s+di\s+criticit/i.test(title)) continue;

    const href = absoluteUrl(baseUrl, decodeHtml(match[1]));
    const levelInfo = parseAlertLevel(title);

    const dateMatch = title.match(
      /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/,
    );

    const date = dateMatch
      ? `${dateMatch[3]}-${String(dateMatch[2]).padStart(2, "0")}-${String(
          dateMatch[1],
        ).padStart(2, "0")}`
      : null;

    const risks = [];
    const low = title.toLowerCase();

    if (low.includes("temporal")) risks.push("Temporali");
    if (low.includes("idrogeolog")) risks.push("Rischio idrogeologico");
    if (low.includes("idraulic")) risks.push("Rischio idraulico");

    return {
      title,
      url: href || OFFICIAL_URL,
      date,
      level: levelInfo.level,
      label: levelInfo.label,
      risks,
    };
  }

  return null;
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

  await fs.writeFile(destination, bytes);
}

async function readPrevious() {
  try {
    return JSON.parse(await fs.readFile(JSON_OUT, "utf8"));
  } catch {
    return null;
  }
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

  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match) {
    return text;
  }

  return null;
}

function keyToItalianDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function reconcileOfficialMaps(todaySource, tomorrowSource) {
  const currentKey = romeDateKey();
  const nextKey = addDaysToDateKey(currentKey, 1);

  const todaySourceKey = officialDateToKey(todaySource?.date);
  const tomorrowSourceKey = officialDateToKey(tomorrowSource?.date);

  // Caso normale: il portale ha già pubblicato il bollettino odierno.
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
              note:
                "In attesa della mappa di domani dal nuovo bollettino della Protezione Civile.",
            },
      sourceState: "current",
    };
  }

  // Prima della pubblicazione del nuovo bollettino:
  // la mappa che il portale chiama ancora "domani" è in realtà OGGI.
  if (tomorrowSourceKey === currentKey) {
    return {
      today: {
        ...tomorrowSource,
        date: keyToItalianDate(currentKey),
        pending: false,
        rolledFromPreviousBulletin: true,
        note:
          "Mappa odierna ricavata dalla previsione per il giorno successivo del bollettino precedente.",
      },
      tomorrow: {
        remoteUrl: null,
        date: keyToItalianDate(nextKey),
        pending: true,
        rolledFromPreviousBulletin: false,
        note:
          "In attesa del bollettino odierno, normalmente pubblicato nel pomeriggio.",
      },
      sourceState: "waiting-new-bulletin",
    };
  }

  // Dati troppo vecchi: non etichettiamo mai una vecchia mappa come "Oggi".
  return {
    today: {
      remoteUrl: null,
      date: keyToItalianDate(currentKey),
      pending: true,
      rolledFromPreviousBulletin: false,
      note:
        "La mappa odierna non è ancora disponibile dalla fonte ufficiale.",
    },
    tomorrow: {
      remoteUrl: null,
      date: keyToItalianDate(nextKey),
      pending: true,
      rolledFromPreviousBulletin: false,
      note:
        "La mappa di domani non è ancora disponibile dalla fonte ufficiale.",
    },
    sourceState: "stale",
  };
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const previous = await readPrevious();

  let pageResponse;
  let html;

  try {
    pageResponse = await fetchResponse(OFFICIAL_URL);
    html = await pageResponse.text();
  } catch (error) {
    console.error("Impossibile leggere la pagina ufficiale:", error.message);

    if (previous) {
      console.log("Mantengo l'ultimo aggiornamento valido.");
      return;
    }

    process.exitCode = 1;
    return;
  }

  const sourceToday = findImage(
    html,
    "sito_oggi_230_120.jpg",
    pageResponse.url,
  );

  const sourceTomorrow = findImage(
    html,
    "sito_domani_230_120.jpg",
    pageResponse.url,
  );

  const basicAdvisory = findLatestCriticalNotice(
    html,
    pageResponse.url,
  );

  const advisory = await enrichAdvisory(
    basicAdvisory,
    html,
    pageResponse.url,
  );

  if (!sourceToday?.remoteUrl || !sourceTomorrow?.remoteUrl) {
    console.error(
      "Le mappe ufficiali oggi/domani non sono state trovate nella pagina.",
    );

    if (previous) {
      console.log("Mantengo l'ultimo aggiornamento valido.");
      return;
    }

    process.exitCode = 1;
    return;
  }

  const reconciled = reconcileOfficialMaps(
    sourceToday,
    sourceTomorrow,
  );

  if (reconciled.today?.remoteUrl) {
    await downloadImage(
      reconciled.today.remoteUrl,
      TODAY_IMG_OUT,
    );
  }

  if (reconciled.tomorrow?.remoteUrl) {
    await downloadImage(
      reconciled.tomorrow.remoteUrl,
      TOMORROW_IMG_OUT,
    );
  }

  const payload = {
    zoneCode: ZONE_CODE,
    zoneName: ZONE_NAME,
    updatedAt: new Date().toISOString(),
    sourceUrl: OFFICIAL_URL,
    automatic: true,
    method: "official-homepage-maps",
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
    advisory: advisory || null,
  };

  await fs.writeFile(
    JSON_OUT,
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );

  console.log("Protezione Civile aggiornata.");
  console.log(
    "Stato sorgente:",
    payload.sourceState,
  );
  console.log(
    "Oggi:",
    payload.today.date || "data non letta",
    payload.today.pending ? "(in attesa)" : "",
  );
  console.log(
    "Domani:",
    payload.tomorrow.date || "data non letta",
    payload.tomorrow.pending ? "(in attesa)" : "",
  );

  if (payload.advisory) {
    console.log(
      "Ultimo avviso:",
      payload.advisory.label,
      "-",
      payload.advisory.title,
    );
  } else {
    console.log("Nessun Avviso di Criticità individuato nella home.");
  }
}

await main();