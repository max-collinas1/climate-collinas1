// scripts/update-protezione-civile.mjs
//
// Aggiornamento automatico degli avvisi della Protezione Civile Sardegna.
// Nessun Python: usa Node.js, già usato dal progetto.
//
// Output:
//   public/data/protezione-civile.json
//
// Fonte:
//   Protezione Civile Regione Sardegna
//
// Logica:
// - consulta la pagina ufficiale "Bollettini e avvisi per rischio idrogeologico";
// - cerca i documenti più recenti;
// - segue i link e analizza i PDF ufficiali;
// - estrae la zona SARD-C (Montevecchio-Pischilappiu);
// - ricava livello, validità e rischi;
// - distingue stato attuale e stato successivo;
// - se il portale ha un problema temporaneo NON distrugge l'ultimo JSON valido.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import pdfParse from "pdf-parse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "public", "data", "protezione-civile.json");

const ZONE_CODE = "SARD-C";
const ZONE_NAME = "Bacini Montevecchio-Pischilappiu";

const OFFICIAL_HOME = "https://www.sardegnaambiente.it/protezionecivile/";
const HYDRO_PAGE_BASE =
  "https://www.sardegnaambiente.it/index.php?c=7092&nodesc=1&s=20&v=9&xsl=2273";

const USER_AGENT =
  "MeteoCollinas/1.0 (automatic public civil-protection bulletin reader)";

const LEVEL_PRIORITY = {
  green: 0,
  yellow: 1,
  orange: 2,
  red: 3,
};

const LEVEL_LABELS = {
  green: "Nessuna allerta",
  yellow: "Allerta gialla",
  orange: "Allerta arancione",
  red: "Allerta rossa",
  unknown: "Da verificare",
};

function normalizeSpaces(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function fold(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isoLocal(date) {
  return date.toISOString();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/pdf,*/*",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} per ${url}`);
  }

  return {
    response,
    text: await response.text(),
  };
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/pdf,*/*",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} per ${url}`);
  }

  return {
    response,
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

function absoluteUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function htmlLinks(html, baseUrl) {
  const result = [];
  const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(regex)) {
    const href = absoluteUrl(baseUrl, match[1]);
    if (!href) continue;

    const label = normalizeSpaces(
      match[2]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&"),
    );

    result.push({ href, label });
  }

  return result;
}

function hydroArchiveUrl(date) {
  return (
    `${HYDRO_PAGE_BASE}` +
    `&gg=${pad2(date.getDate())}` +
    `&m=${pad2(date.getMonth() + 1)}` +
    `&y=${date.getFullYear()}`
  );
}

async function recentDocumentPages() {
  const now = new Date();
  const pages = [];

  // Controlla mese corrente + mese precedente:
  // copre bene avvisi emessi a cavallo di fine mese.
  for (const offset of [0, -1]) {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 15);
    const url = hydroArchiveUrl(date);

    try {
      const { response, text } = await fetchText(url);
      const links = htmlLinks(text, response.url);

      for (const item of links) {
        const label = fold(item.label);

        if (
          label.includes("avviso di critic") ||
          label.includes("bollettino di critic")
        ) {
          pages.push({
            title: item.label,
            url: item.href,
          });
        }
      }
    } catch (error) {
      console.warn(`Archivio non leggibile: ${url}`, error.message);
    }
  }

  // Priorità agli avvisi veri e propri rispetto ai bollettini ordinari.
  pages.sort((a, b) => {
    const aAlert = fold(a.title).includes("avviso di critic") ? 1 : 0;
    const bAlert = fold(b.title).includes("avviso di critic") ? 1 : 0;
    return bAlert - aAlert;
  });

  return Array.from(
    new Map(pages.map((item) => [item.url, item])).values(),
  ).slice(0, 20);
}

async function pdfLinksFromPage(page) {
  if (/\.pdf(?:$|\?)/i.test(page.url)) {
    return [page.url];
  }

  const { response, text } = await fetchText(page.url);
  const links = htmlLinks(text, response.url);

  const pdfs = links
    .filter((item) => /\.pdf(?:$|\?)/i.test(item.href))
    .filter((item) => {
      const haystack = fold(`${item.label} ${item.href}`);
      return (
        haystack.includes("critic") ||
        haystack.includes("avviso") ||
        haystack.includes("acr_") ||
        haystack.includes("bcr_") ||
        haystack.includes("idro")
      );
    })
    .map((item) => item.href);

  return Array.from(new Set(pdfs));
}

async function extractPdfText(url) {
  const { buffer } = await fetchBuffer(url);
  const parsed = await pdfParse(buffer);
  const text = normalizeSpaces(parsed?.text || "");

  if (text.length < 100) {
    throw new Error("PDF privo di testo utile");
  }

  return text;
}

function zoneBlock(text) {
  const flat = normalizeSpaces(text);
  const folded = fold(flat);

  const candidates = [
    /montevecchio\s*[- ]\s*pischi(?:l|n)appiu\s+sard-c/i,
    /\bsard-c\b/i,
  ];

  let match = null;

  for (const regex of candidates) {
    match = regex.exec(folded);
    if (match) break;
  }

  if (!match) return null;

  const start = Math.max(0, match.index - 250);
  const after = folded.slice(match.index + match[0].length);

  const nextZoneMatch = /\bsard-[a-g]\b/i.exec(after);
  const end = nextZoneMatch
    ? match.index + match[0].length + nextZoneMatch.index
    : Math.min(flat.length, match.index + 3000);

  return flat.slice(start, end);
}

function levelFromText(value) {
  const text = fold(value);

  if (text.includes("rossa") || text.includes("rosso") || text.includes("elevata")) {
    return "red";
  }

  if (text.includes("arancione") || text.includes("moderata")) {
    return "orange";
  }

  if (
    text.includes("gialla") ||
    text.includes("giallo") ||
    text.includes("ordinaria")
  ) {
    return "yellow";
  }

  if (
    text.includes("verde") ||
    text.includes("assenza di criticita") ||
    text.includes("nessuna criticita")
  ) {
    return "green";
  }

  return "unknown";
}

function risksFromText(value) {
  const text = fold(value);
  const risks = [];

  const add = (condition, label) => {
    if (condition && !risks.includes(label)) risks.push(label);
  };

  add(text.includes("tempor"), "Temporali");
  add(text.includes("idrogeolog"), "Rischio idrogeologico");
  add(text.includes("idraulic"), "Rischio idraulico");
  add(text.includes("vento") || text.includes("venti"), "Vento");
  add(text.includes("maregg"), "Mareggiate");
  add(text.includes("neve"), "Neve");

  return risks;
}

function dateFromItalian(day, month, year, hour = 0, minute = 0) {
  const result = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour) - 2,
      Number(minute),
      0,
    ),
  );

  return result;
}

function validityFromText(value) {
  const text = normalizeSpaces(value);

  const patterns = [
    /(?:dalle|inizio\s+validit[aà][^\d]{0,40})\s*(?:ore\s*)?(\d{1,2})[:.](\d{2})[^\d]{0,50}(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})[\s\S]{0,250}?(?:alle|fine\s+validit[aà][^\d]{0,40}|fino\s+alle)\s*(?:ore\s*)?(\d{1,2})[:.](\d{2})[^\d]{0,50}(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i,
    /(\d{1,2})[:.](\d{2})[^\d]{0,50}(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})[\s\S]{0,220}?(\d{1,2})[:.](\d{2})[^\d]{0,50}(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/i,
  ];

  for (const regex of patterns) {
    const match = regex.exec(text);
    if (!match) continue;

    const start = dateFromItalian(
      match[3],
      match[4],
      match[5],
      match[1],
      match[2],
    );

    const end = dateFromItalian(
      match[8],
      match[9],
      match[10],
      match[6],
      match[7],
    );

    if (
      Number.isFinite(start.getTime()) &&
      Number.isFinite(end.getTime()) &&
      end > start
    ) {
      return { start, end };
    }
  }

  // fallback: prende le prime due coppie ora+data
  const pairRegex =
    /(\d{1,2})[:.](\d{2})[^\d]{0,30}(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/g;

  const pairs = Array.from(text.matchAll(pairRegex)).slice(0, 2);

  if (pairs.length === 2) {
    const start = dateFromItalian(
      pairs[0][3],
      pairs[0][4],
      pairs[0][5],
      pairs[0][1],
      pairs[0][2],
    );

    const end = dateFromItalian(
      pairs[1][3],
      pairs[1][4],
      pairs[1][5],
      pairs[1][1],
      pairs[1][2],
    );

    if (end > start) return { start, end };
  }

  return null;
}

async function collectAlerts() {
  const pages = await recentDocumentPages();
  const alerts = [];
  const seenPdfs = new Set();

  for (const page of pages) {
    let pdfs = [];

    try {
      pdfs = await pdfLinksFromPage(page);
    } catch (error) {
      console.warn(`Pagina documento non leggibile: ${page.url}`, error.message);
      continue;
    }

    for (const pdfUrl of pdfs) {
      if (seenPdfs.has(pdfUrl)) continue;
      seenPdfs.add(pdfUrl);

      try {
        const text = await extractPdfText(pdfUrl);
        const block = zoneBlock(text);

        if (!block) continue;

        const validity = validityFromText(text);
        if (!validity) continue;

        let level = levelFromText(block);

        if (level === "unknown") {
          level = levelFromText(page.title);
        }

        if (level === "unknown") continue;

        alerts.push({
          level,
          validFrom: validity.start,
          validTo: validity.end,
          risks: risksFromText(`${block} ${page.title}`),
          sourceUrl: pdfUrl,
          sourceTitle: page.title,
        });
      } catch (error) {
        console.warn(`PDF ignorato: ${pdfUrl}`, error.message);
      }
    }
  }

  return alerts.sort((a, b) => b.validFrom - a.validFrom);
}

function highestAlert(alerts) {
  if (!alerts.length) return null;

  return alerts.reduce((best, current) => {
    const currentScore = LEVEL_PRIORITY[current.level] ?? -1;
    const bestScore = LEVEL_PRIORITY[best.level] ?? -1;

    if (currentScore > bestScore) return current;
    if (currentScore < bestScore) return best;

    return current.validFrom > best.validFrom ? current : best;
  });
}

function alertPayload(alert, fallbackLabel, fallbackNote) {
  if (!alert) {
    return {
      level: "green",
      label: fallbackLabel,
      validFrom: null,
      validTo: null,
      risks: [],
      note: fallbackNote,
    };
  }

  return {
    level: alert.level,
    label: LEVEL_LABELS[alert.level] || "Da verificare",
    validFrom: isoLocal(alert.validFrom),
    validTo: isoLocal(alert.validTo),
    risks: alert.risks,
    note: alert.sourceTitle,
    sourceDocument: alert.sourceUrl,
  };
}

function buildPayload(alerts) {
  const now = new Date();
  const horizon = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const active = alerts.filter(
    (alert) => alert.validFrom <= now && now < alert.validTo,
  );

  const future = alerts
    .filter(
      (alert) =>
        alert.validFrom > now &&
        alert.validFrom <= horizon,
    )
    .sort((a, b) => a.validFrom - b.validFrom);

  const current = highestAlert(active);
  const next = future[0] || null;

  return {
    zoneCode: ZONE_CODE,
    zoneName: ZONE_NAME,
    updatedAt: now.toISOString(),
    sourceUrl: OFFICIAL_HOME,
    automatic: true,
    current: alertPayload(
      current,
      "Nessuna allerta rilevata",
      "Nessun avviso attivo per SARD-C rilevato nelle pubblicazioni consultate.",
    ),
    next: alertPayload(
      next,
      "Nessuna allerta successiva rilevata",
      "Nessun nuovo avviso per SARD-C rilevato nelle prossime 48 ore.",
    ),
  };
}

async function readPrevious() {
  try {
    return JSON.parse(await fs.readFile(OUTPUT, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const previous = await readPrevious();

  let alerts;

  try {
    alerts = await collectAlerts();
  } catch (error) {
    console.error("Errore durante la lettura delle fonti ufficiali:", error);

    if (previous) {
      console.log("Mantengo l'ultimo JSON valido.");
      return;
    }

    process.exitCode = 1;
    return;
  }

  if (!alerts.length && previous?.automatic) {
    console.log(
      "Nessun documento parsabile: mantengo l'ultimo JSON valido per sicurezza.",
    );
    return;
  }

  const payload = buildPayload(alerts);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;

  await fs.mkdir(path.dirname(OUTPUT), { recursive: true });

  let oldText = "";

  try {
    oldText = await fs.readFile(OUTPUT, "utf8");
  } catch {
    // file ancora non presente
  }

  if (oldText === serialized) {
    console.log("Nessuna variazione.");
    return;
  }

  await fs.writeFile(OUTPUT, serialized, "utf8");

  console.log(`Aggiornato: ${OUTPUT}`);
  console.log(
    `Attuale: ${payload.current.label} | Successivo: ${payload.next.label}`,
  );
}

await main();