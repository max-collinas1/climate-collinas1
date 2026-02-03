// pages/api/pc-alert.js
// Protezione Civile Sardegna: RSS (idrogeologico) -> PDF ACR/BCR -> estrazione testo -> livello per zona SARD-B.
// IMPORTANTISSIMO: nei PDF spesso compare la "FASE OPERATIVA" (ATTENZIONE/PREALLARME/ALLARME) e non il colore.
// Mappa: ATTENZIONE->giallo, PREALLARME->arancione, ALLARME->rosso.

import { XMLParser } from "fast-xml-parser";

export const config = { api: { bodyParser: false }, runtime: "nodejs" };
export const maxDuration = 15;

const FEED_IDRO =
  "https://www.sardegnaambiente.it/servizi/allertediprotezionecivile/rss/idrogeologico.xml";

const TARGET_ZONE = "SARD-B";
const ZONE_LABEL = {
  "SARD-A": "Gallura",
  "SARD-B": "Campidano",
  "SARD-C": "Montevecchio Pischinappiu",
  "SARD-D": "Flumendosa Flumineddu",
  "SARD-E": "Tirso",
  "SARD-F": "Iglesiente",
  "SARD-G": "Logudoro",
  "SARD-H": "Sarcidano Barbagia di Seulo",
};

const CACHE_TTL_MS = 3 * 60 * 1000;
let _cache = { ts: 0, data: null };
let _inflight = null;

function areaLabel() {
  return `Collinas (${ZONE_LABEL[TARGET_ZONE] || TARGET_ZONE} - ${TARGET_ZONE})`;
}

function upperNoAccents(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[ÀÁÂÃÄÅ]/g, "A")
    .replace(/[ÈÉÊË]/g, "E")
    .replace(/[ÌÍÎÏ]/g, "I")
    .replace(/[ÒÓÔÕÖ]/g, "O")
    .replace(/[ÙÚÛÜ]/g, "U");
}

function normalizeSpaces(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function levelRank(lvl) {
  const L = String(lvl || "verde").toLowerCase();
  if (L === "rosso") return 3;
  if (L === "arancione") return 2;
  if (L === "giallo") return 1;
  return 0;
}

function labelForLevel(lvl) {
  const L = String(lvl || "verde").toLowerCase();
  if (L === "giallo") return "Allerta gialla";
  if (L === "arancione") return "Allerta arancione";
  if (L === "rosso") return "Allerta rossa";
  return "Nessuna allerta";
}

function baseUnavailable(note, extra = {}) {
  return {
    ok: false,
    overall: null,
    level: null,
    area: areaLabel(),
    title: "Allerta Protezione Civile Sardegna",
    url: FEED_IDRO,
    valid_from: null,
    valid_to: null,
    current: null,
    next: null,
    current_alerts: { idrogeologico: null, idraulico: null, temporali: null },
    next_alerts: { idrogeologico: null, idraulico: null, temporali: null },
    note: note || "Dati Protezione Civile Sardegna non disponibili.",
    ...extra,
  };
}

function nowEuropeRomeISO() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ac.signal,
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (pc-alert-bot)",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        ...(opts.headers || {}),
      },
    });
    return r;
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url) {
  const r = await fetchWithTimeout(
    url,
    { headers: { Accept: "application/xml,text/xml,text/html,*/*" } },
    15000
  );
  if (!r.ok) throw new Error(`HTTP ${r.status} fetch ${url}`);
  return await r.text();
}

async function fetchBytes(url) {
  // forza https se possibile
  const u = String(url || "").replace(/^http:\/\//i, "https://");
  const r = await fetchWithTimeout(
    u,
    { headers: { Accept: "application/pdf,*/*" } },
    20000
  );
  if (!r.ok) throw new Error(`HTTP ${r.status} download PDF`);
  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}

function parseXml(xmlStr) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });
  return parser.parse(xmlStr);
}

function extractLatestPdfFromRss(rssObj) {
  const item = rssObj?.rss?.channel?.item;
  if (!item) return null;
  const first = Array.isArray(item) ? item[0] : item;

  const title = String(first?.title || "").trim();
  const link = String(first?.link || "").trim();
  if (!link || !link.toLowerCase().endsWith(".pdf")) return null;

  return { title, link };
}

// Mappa “fase operativa” -> colore
function phaseToLevel(winUpper) {
  // ordine dal più severo
  if (winUpper.includes("ALLARME")) return "rosso";
  if (winUpper.includes("PREALLARME")) return "arancione";
  // alcune fonti usano "ATTENZIONE RINFORZATA" (di solito più severa di attenzione)
  if (winUpper.includes("ATTENZIONE RINFORZATA")) return "arancione";
  if (winUpper.includes("ATTENZIONE")) return "giallo";
  return null;
}

// Estrae le date/ore principali dal testo (se presenti)
function extractValidityFromText(fullText) {
  const T = normalizeSpaces(fullText);

  // esempio nel tuo head:
  // "Inizio validità: 02.02.2026 14:00  Fine validità: 03.02.2026 23:59"
  const m1 = T.match(/Inizio\s+validit[aà]\s*:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{4}\s+[0-9]{2}:[0-9]{2})/i);
  const m2 = T.match(/Fine\s+validit[aà]\s*:\s*([0-9]{2}\.[0-9]{2}\.[0-9]{4}\s+[0-9]{2}:[0-9]{2})/i);

  return {
    valid_from: m1 ? m1[1] : null,
    valid_to: m2 ? m2[1] : null,
  };
}

// Trova livello della zona cercando SARD-B / CAMPIDANO e dentro la finestra cerca ALLARME/PREALLARME/ATTENZIONE
function findZoneLevelInText(text) {
  const ZCODE = upperNoAccents(TARGET_ZONE); // SARD-B
  const ZNAME = upperNoAccents(ZONE_LABEL[TARGET_ZONE] || ""); // CAMPIDANO

  const T = upperNoAccents(normalizeSpaces(text));
  const idx = Math.max(T.indexOf(ZCODE), ZNAME ? T.indexOf(ZNAME) : -1);
  if (idx < 0) return null;

  // finestra ampia: la colonna "Fase Operativa" di solito sta dopo
  const win = T.slice(Math.max(0, idx - 800), Math.min(T.length, idx + 2200));

  // qui NON cerchiamo "giallo" ecc, ma la fase operativa
  const lvl = phaseToLevel(win);
  if (!lvl) return null;

  return { level: lvl, snippet: win.slice(0, 700) };
}

async function extractTextFromPdf(pdfBytes, maxPages = 2) {
  // path corretto per Next/Turbopack lato server
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf");

  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    disableWorker: true,
  });
  const pdf = await loadingTask.promise;

  const n = Math.min(pdf.numPages, maxPages);
  const parts = [];

  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const pageText = (tc.items || [])
      .map((it) => (it && it.str ? String(it.str) : ""))
      .join(" ");
    parts.push(pageText);
  }

  try {
    await pdf.destroy();
  } catch {}

  return parts.join("\n");
}

async function computeAlert(debug) {
  if (_cache.data && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.data;
  if (_inflight) return await _inflight;

  _inflight = (async () => {
    const t0 = Date.now();
    try {
      // 1) RSS
      const rssText = await fetchText(FEED_IDRO);
      const rssObj = parseXml(rssText);
      const latest = extractLatestPdfFromRss(rssObj);

      if (!latest) {
        const out = baseUnavailable("RSS raggiunto ma non trovo un link PDF nell’item più recente.", debug ? {
          debug: { ms_total: Date.now() - t0, feed: FEED_IDRO }
        } : {});
        _cache = { ts: Date.now(), data: out };
        return out;
      }

      // 2) PDF
      const pdfBytes = await fetchBytes(latest.link);

      // 3) testo PDF (di solito la tabella zone è in pagina 1)
      const pdfText = await extractTextFromPdf(pdfBytes, 2);

      // 4) validità
      const validity = extractValidityFromText(pdfText);

      // 5) livello zona
      const found = findZoneLevelInText(pdfText);
      if (!found) {
        const out = baseUnavailable(
          "PDF letto (testo presente), ma non trovo una fase operativa (ATTENZIONE/PREALLARME/ALLARME) agganciata a SARD-B/Campidano nel testo estratto.",
          debug
            ? {
                debug: {
                  ms_total: Date.now() - t0,
                  pdf: { title: latest.title, url: latest.link },
                  text_head: pdfText.slice(0, 1200),
                },
              }
            : {}
        );
        _cache = { ts: Date.now(), data: out };
        return out;
      }

      const overall = found.level;
      const now = nowEuropeRomeISO();

      // Il tuo feed è “idrogeologico”, ma l’utente vuole “allerta gialla/arancione/rossa” in home.
      // Qui facciamo la cosa onesta: usiamo il livello massimo indicato per la zona (fase operativa),
      // e lo mettiamo almeno su idrogeologico. Gli altri rischi li popoliamo solo se in futuro
      // aggiungi parsing della tabella per colonna rischio.
      const current_alerts = {
        idrogeologico: { level: overall, from: validity.valid_from, to: validity.valid_to },
        idraulico: null,
        temporali: null,
      };

      const out = {
        ok: true,
        overall,
        level: overall,
        area: areaLabel(),
        title: latest.title || "Avviso di criticità regionale",
        url: String(latest.link || "").replace(/^http:\/\//i, "https://"),

        valid_from: validity.valid_from,
        valid_to: validity.valid_to,

        current: levelRank(overall) > 0 ? { overall, from: now, to: null } : null,
        next: null,

        current_alerts,
        next_alerts: { idrogeologico: null, idraulico: null, temporali: null },

        note:
          levelRank(overall) > 0
            ? `Condizione attuale (PC Sardegna, PDF ACR/BCR): ${labelForLevel(overall)} (fase operativa) per ${ZONE_LABEL[TARGET_ZONE]}.`
            : `Condizione attuale (PC Sardegna, PDF ACR/BCR): Nessuna allerta per ${ZONE_LABEL[TARGET_ZONE]}.`,

        sources: { mode: "rss->pdf->pdfjs", feed: FEED_IDRO, pdf: latest.link },

        ...(debug
          ? {
              debug: {
                ms_total: Date.now() - t0,
                pdf: { title: latest.title, url: latest.link },
                match_snippet: found.snippet,
                validity,
              },
            }
          : {}),
      };

      _cache = { ts: Date.now(), data: out };
      return out;
    } catch (e) {
      const out = baseUnavailable(`Errore PC Sardegna: ${e?.message || String(e)}`, {
        stack: process.env.NODE_ENV === "development" ? e?.stack || null : null,
      });
      _cache = { ts: Date.now(), data: out };
      return out;
    } finally {
      _inflight = null;
    }
  })();

  return await _inflight;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  const debug = String(req.query?.debug || "") === "1";

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, note: "Method Not Allowed" });
    }
    const data = await computeAlert(debug);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(200).json(baseUnavailable(`Eccezione: ${e?.message || String(e)}`));
  }
}