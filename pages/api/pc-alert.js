// pages/api/pc-alert.js
// PC Sardegna: RSS -> PDF -> testo -> fase operativa + orari "Inizio/Fine avviso"
// Usa SEMPRE alert_from/alert_to se presenti (sono gli orari reali dell'allerta).

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
    status: "none",
    overall: null,
    level: null,
    area: areaLabel(),
    title: "Allerta Protezione Civile Sardegna",
    url: FEED_IDRO,
    valid_from: null,
    valid_to: null,
    from: null,
    to: null,
    current: null,
    next: null,
    current_alerts: { idrogeologico: null, idraulico: null, temporali: null },
    next_alerts: { idrogeologico: null, idraulico: null, temporali: null },
    note: note || "Dati Protezione Civile Sardegna non disponibili.",
    ...extra,
  };
}

function toRomeISO(dt) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(dt).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

// Parse "dd.mm.yyyy hh:mm" or "dd/mm/yyyy hh:mm" -> Date (UTC-based, usata per confronti relativi)
function parseDateTimeLoose(s) {
  const m = String(s || "")
    .trim()
    .match(/^(\d{2})[./](\d{2})[./](\d{4})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;

  const dd = m[1],
    mm = m[2],
    yyyy = m[3],
    HH = m[4],
    MI = m[5];

  return new Date(`${yyyy}-${mm}-${dd}T${HH}:${MI}:00Z`);
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
  const u = String(url || "").replace(/^http:\/\//i, "https://");
  const r = await fetchWithTimeout(u, { headers: { Accept: "application/pdf,*/*" } }, 20000);
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

function phaseToLevel(winUpper) {
  if (winUpper.includes("ALLARME")) return "rosso";
  if (winUpper.includes("PREALLARME")) return "arancione";
  if (winUpper.includes("ATTENZIONE RINFORZATA")) return "arancione";
  if (winUpper.includes("ATTENZIONE")) return "giallo";
  return null;
}

function extractTimesFromText(fullText) {
  const T = normalizeSpaces(fullText);

  const mValidFrom = T.match(
    /Inizio\s+validit[aà]\s*:\s*([0-9]{2}[./][0-9]{2}[./][0-9]{4}\s+[0-9]{2}:[0-9]{2})/i
  );
  const mValidTo = T.match(
    /Fine\s+validit[aà]\s*:\s*([0-9]{2}[./][0-9]{2}[./][0-9]{4}\s+[0-9]{2}:[0-9]{2})/i
  );

  const mAvvFrom = T.match(
    /Inizio\s+avviso\s*:\s*([0-9]{2}[./][0-9]{2}[./][0-9]{4}\s+[0-9]{2}:[0-9]{2})/i
  );
  const mAvvTo = T.match(
    /Fine\s+avviso\s*:\s*([0-9]{2}[./][0-9]{2}[./][0-9]{4}\s+[0-9]{2}:[0-9]{2})/i
  );

  return {
    valid_from: mValidFrom ? mValidFrom[1] : null,
    valid_to: mValidTo ? mValidTo[1] : null,
    alert_from: mAvvFrom ? mAvvFrom[1] : null,
    alert_to: mAvvTo ? mAvvTo[1] : null,
  };
}

function findZonePhaseLevelInText(text) {
  const ZCODE = upperNoAccents(TARGET_ZONE);
  const ZNAME = upperNoAccents(ZONE_LABEL[TARGET_ZONE] || "");

  const T = upperNoAccents(normalizeSpaces(text));
  const idx = Math.max(T.indexOf(ZCODE), ZNAME ? T.indexOf(ZNAME) : -1);
  if (idx < 0) return null;

  const win = T.slice(Math.max(0, idx - 800), Math.min(T.length, idx + 2500));
  const lvl = phaseToLevel(win);
  if (!lvl) return null;

  return { level: lvl, snippet: win.slice(0, 900) };
}

async function extractTextFromPdf(pdfBytes, maxPages = 2) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
  const loadingTask = pdfjs.getDocument({ data: pdfBytes, disableWorker: true });
  const pdf = await loadingTask.promise;

  const n = Math.min(pdf.numPages, maxPages);
  const parts = [];
  for (let p = 1; p <= n; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const pageText = (tc.items || []).map((it) => (it?.str ? String(it.str) : "")).join(" ");
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

      const pdfBytes = await fetchBytes(latest.link);
      const pdfText = await extractTextFromPdf(pdfBytes, 2);

      const times = extractTimesFromText(pdfText);
      const found = findZonePhaseLevelInText(pdfText);

      if (!found) {
        const out = baseUnavailable(
          "PDF letto, ma non trovo la fase operativa (ATTENZIONE/PREALLARME/ALLARME) per SARD-B/Campidano nel testo estratto.",
          debug
            ? {
                debug: {
                  ms_total: Date.now() - t0,
                  pdf: { title: latest.title, url: latest.link },
                  text_head: normalizeSpaces(pdfText).slice(0, 1400),
                },
              }
            : {}
        );
        _cache = { ts: Date.now(), data: out };
        return out;
      }

      const level = found.level;

      // ORARI: priorità a Inizio/Fine avviso
      const fromStrRaw = times.alert_from || times.valid_from;
      const toStrRaw = times.alert_to || times.valid_to;

      const fromStr = fromStrRaw ? fromStrRaw.replace(/\//g, ".") : null;
      const toStr = toStrRaw ? toStrRaw.replace(/\//g, ".") : null;

      const fromDate = fromStr ? parseDateTimeLoose(fromStr) : null;
      const toDate = toStr ? parseDateTimeLoose(toStr) : null;

      const now = new Date();
      const nowISO = toRomeISO(now);

      const isActive =
        fromDate && toDate ? now.getTime() >= fromDate.getTime() && now.getTime() <= toDate.getTime() : false;
      const isUpcoming = fromDate ? now.getTime() < fromDate.getTime() : false;

      const status = isActive ? "current" : isUpcoming ? "next" : "none";

      const alertObj =
        levelRank(level) > 0 ? { level, from: fromStr || null, to: toStr || null } : null;

      const out = {
        ok: true,
        status,

        // Mostra il livello anche se "next" (allerta prevista)
        overall: status === "none" ? "verde" : level,
        level: status === "none" ? "verde" : level,

        area: areaLabel(),
        title: latest.title || "Avviso di criticità regionale",
        url: String(latest.link || "").replace(/^http:\/\//i, "https://"),

        valid_from: times.valid_from ? times.valid_from.replace(/\//g, ".") : null,
        valid_to: times.valid_to ? times.valid_to.replace(/\//g, ".") : null,

        from: fromStr,
        to: toStr,

        // Qui correggiamo il tuo errore: current.from deve essere l'INIZIO AVVISO (o validità), non "now"
        current: isActive ? { overall: level, from: fromStr, to: toStr } : null,
        next: isUpcoming ? { overall: level, from: fromStr, to: toStr } : null,

        current_alerts: {
          idrogeologico: isActive ? alertObj : null,
          idraulico: null,
          temporali: null,
        },
        next_alerts: {
          idrogeologico: isUpcoming ? alertObj : null,
          idraulico: null,
          temporali: null,
        },

        note:
          status === "current"
            ? `Allerta attuale: ${labelForLevel(level)} dalle ${fromStr || "—"} alle ${toStr || "—"} per ${ZONE_LABEL[TARGET_ZONE]}.`
            : status === "next"
              ? `Allerta prevista: ${labelForLevel(level)} dalle ${fromStr || "—"} alle ${toStr || "—"} per ${ZONE_LABEL[TARGET_ZONE]}.`
              : `Nessuna allerta attiva al momento per ${ZONE_LABEL[TARGET_ZONE]}.`,

        sources: { mode: "rss->pdf->pdfjs", feed: FEED_IDRO, pdf: latest.link },

        ...(debug
          ? {
              debug: {
                ms_total: Date.now() - t0,
                now_rome: nowISO,
                pdf: { title: latest.title, url: latest.link },
                match_snippet: found.snippet,
                times,
                computed: { status, isActive, isUpcoming, fromStr, toStr },
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