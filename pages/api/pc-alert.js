// pages/api/pc-alert.js
// Soluzione "no PDF": usa il Bollettino di Criticità nazionale (DPC) e il relativo XML (zip).

import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export const config = { api: { bodyParser: false }, runtime: "nodejs" };
export const maxDuration = 15;

const SOURCE_DPC = "https://mappe.protezionecivile.gov.it/it/mappe-rischi/bollettino-di-criticita/";
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

function pickText(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
    title: "Avvisi Protezione Civile",
    url: SOURCE_DPC,
    valid_from: null,
    valid_to: null,
    from: null,
    to: null,
    current: null,
    current_alerts: { idrogeologico: null, idraulico: null, temporali: null },
    next_alerts: { idrogeologico: null, idraulico: null, temporali: null },
    note: note || "Dati Protezione Civile non disponibili.",
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
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
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
  const r = await fetchWithTimeout(url, { headers: { Accept: "text/html,application/xhtml+xml" } }, 12000);
  if (!r.ok) throw new Error(`HTTP ${r.status} nel download HTML`);
  return await r.text();
}

async function fetchBytes(url) {
  const r = await fetchWithTimeout(url, { headers: { Accept: "*/*" } }, 15000);
  if (!r.ok) throw new Error(`HTTP ${r.status} nel download file`);
  const ab = await r.arrayBuffer();
  return new Uint8Array(ab);
}

// Estrae dalla pagina DPC il link allo ZIP XML su raw.githubusercontent.com
function extractXmlZipUrl(html) {
  const h = String(html || "");
  // Esempio nel DOM: https://raw.githubusercontent.com/.../files/xml/20260131_1426.zip
  const re = /https:\/\/raw\.githubusercontent\.com\/[^"'\s>]+\/files\/xml\/[0-9]{8}_[0-9]{4}\.zip/gi;
  const m = h.match(re);
  return m && m.length ? m[0] : null;
}

// Dato lo ZIP, estrae il primo .xml e lo parse in oggetto
async function unzipAndParseXml(zipBytes) {
  const zip = await JSZip.loadAsync(zipBytes);
  const xmlName = Object.keys(zip.files).find((k) => k.toLowerCase().endsWith(".xml"));
  if (!xmlName) throw new Error("ZIP XML: nessun file .xml trovato");

  const xmlStr = await zip.files[xmlName].async("string");
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
  });
  return { xmlName, data: parser.parse(xmlStr) };
}

// Cerca livelli per “Campidano” dentro il testo della pagina (fallback)
function parseFromPageText(html) {
  const t = upperNoAccents(pickText(html.replace(/<[^>]+>/g, " ")));
  const hasCampidano = t.includes("SARDEGNA:") && t.includes("CAMPIDANO");
  // Non perfetto, ma meglio di niente come fallback.
  return hasCampidano ? "giallo" : "verde";
}

// Dall’XML prova a ricavare i livelli per zona SARDEGNA->Campidano, oggi e domani.
// Struttura XML può cambiare: gestiamo in modo difensivo (cerchiamo “CAMPIDANO” e “SARDEGNA” ovunque).
function extractCampidanoFromXml(obj) {
  const blob = upperNoAccents(JSON.stringify(obj || {}));

  // Se nel blob esiste “CAMPIDANO” assumiamo che almeno una criticità sia presente.
  const camp = blob.includes("CAMPIDANO");
  if (!camp) return null;

  // Non possiamo fidarci della struttura senza schema certo: quindi facciamo “best effort”.
  // Se compare anche “GIALL” vicino (allerta gialla / ordinaria) => giallo
  // Se compare “ARANCION” => arancione, “ROSS” => rosso
  if (blob.includes("ROSS")) return "rosso";
  if (blob.includes("ARANCION")) return "arancione";
  if (blob.includes("GIALL")) return "giallo";

  // fallback: se campidano presente ma non troviamo colore, almeno segnaliamo “giallo” come ordinaria
  return "giallo";
}

async function computeAlert(debug) {
  if (_cache.data && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.data;
  if (_inflight) return await _inflight;

  _inflight = (async () => {
    const t0 = Date.now();
    try {
      const html = await fetchText(SOURCE_DPC);

      const xmlZipUrl = extractXmlZipUrl(html);

      let overall = null;
      let sourceUsed = null;

      let xmlDebug = null;

      if (xmlZipUrl) {
        const zipBytes = await fetchBytes(xmlZipUrl);
        const { xmlName, data } = await unzipAndParseXml(zipBytes);

        const lvl = extractCampidanoFromXml(data);
        overall = lvl || "verde";
        sourceUsed = "dpc-xml";

        if (debug) xmlDebug = { xmlZipUrl, xmlName };
      } else {
        // fallback: solo testo pagina
        overall = parseFromPageText(html);
        sourceUsed = "dpc-html-fallback";
      }

      const now = nowEuropeRomeISO();

      const out = {
        ok: true,
        overall,
        level: overall,
        area: areaLabel(),
        title: "Bollettino di criticità (DPC nazionale)",
        url: SOURCE_DPC,

        // Validità giornaliera: oggi fino alle 24:00, domani nelle 24 ore successive (non sub-oraria).
        valid_from: null,
        valid_to: null,
        from: null,
        to: null,

        current: levelRank(overall) > 0 ? { overall, from: now, to: null } : null,
        current_alerts: {
          idrogeologico: levelRank(overall) > 0 ? { level: overall, from: null, to: null } : null,
          idraulico: levelRank(overall) > 0 ? { level: overall, from: null, to: null } : null,
          temporali: levelRank(overall) > 0 ? { level: overall, from: null, to: null } : null,
        },
        next_alerts: {
          idrogeologico: null,
          idraulico: null,
          temporali: null,
        },

        note:
          levelRank(overall) > 0
            ? `Condizione attuale (DPC nazionale): ${labelForLevel(overall)} per la zona Campidano (validità giornaliera: oggi e domani).`
            : "Condizione attuale (DPC nazionale): Nessuna allerta per la zona Campidano.",

        sources: { dpc: SOURCE_DPC, mode: sourceUsed },

        ...(debug
          ? {
              debug: {
                ms_total: Date.now() - t0,
                xml: xmlDebug,
              },
            }
          : {}),
      };

      _cache = { ts: Date.now(), data: out };
      return out;
    } catch (e) {
      console.error("pc-alert error:", e);
      const out = baseUnavailable(`Errore DPC: ${e?.message || String(e)}`, {
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