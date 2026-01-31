// pages/api/pc-alert.js
import pdfParseMod from "pdf-parse";

export const config = { api: { bodyParser: false } };
const pdfParse = pdfParseMod?.default || pdfParseMod;

// Pagina Regione dove compaiono i link
const SOURCE_PAGE =
  "https://www.sardegnaambiente.it/index.php?xsl=2273&s=20&v=9&nodesc=1&c=7092";

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

const RISK_KEYS = ["idrogeologico", "idraulico", "temporali"];

// hard cap per non impallare la home
const HARD_DEADLINE_MS = 8000;

// cache in memoria
const CACHE_TTL_MS = 3 * 60 * 1000;
let _cache = { ts: 0, data: null };
let _inflight = null;

// -------------------- utils --------------------
function pickText(s) {
  return String(s || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function extractFirst(text, re) {
  const m = String(text || "").match(re);
  return m ? String(m[1] || "").trim() : null;
}

function pad2(x) {
  return String(x).padStart(2, "0");
}

function nowEuropeRomeParts() {
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
  return { y: +parts.year, mo: +parts.month, d: +parts.day, hh: +parts.hour, mm: +parts.minute };
}

function wallClockKey(y, mo, d, hh, mm) {
  return Date.UTC(y, mo - 1, d, hh, mm, 0, 0);
}

function parseDateTimeIT(dt) {
  const s = String(dt || "").trim();
  // "31.01.2026 14:00"
  let m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2})[:.](\d{2})/);
  if (m) return { d: +m[1], mo: +m[2], y: +m[3], hh: +m[4], mm: +m[5] };
  // "31/01/2026 15:00"
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2})[:.](\d{2})/);
  if (m) return { d: +m[1], mo: +m[2], y: +m[3], hh: +m[4], mm: +m[5] };
  return null;
}

function levelRank(lvl) {
  const L = String(lvl || "verde").toLowerCase();
  if (L === "rosso") return 3;
  if (L === "arancione") return 2;
  if (L === "giallo") return 1;
  return 0;
}
function isAlertLevel(lvl) {
  return levelRank(lvl) > 0;
}
function labelForLevel(lvl) {
  const L = String(lvl || "verde").toLowerCase();
  if (L === "giallo") return "Allerta gialla";
  if (L === "arancione") return "Allerta arancione";
  if (L === "rosso") return "Allerta rossa";
  return "Nessuna allerta";
}

function areaLabel() {
  return `Collinas (${ZONE_LABEL[TARGET_ZONE] || TARGET_ZONE} - ${TARGET_ZONE})`;
}

function baseGreen(note, extra = {}) {
  return {
    ok: true,
    overall: "verde",
    level: "verde",
    area: areaLabel(),
    title: "Avvisi Protezione Civile",
    url: SOURCE_PAGE,
    valid_from: null,
    valid_to: null,
    from: null,
    to: null,
    current: null,
    current_alerts: { idrogeologico: null, idraulico: null, temporali: null },
    next_alerts: { idrogeologico: null, idraulico: null, temporali: null },
    note: note || "Condizione attuale: Nessuna allerta in corso.",
    ...extra,
  };
}

// -------------------- fetch w/ timeout --------------------
async function fetchWithTimeout(url, opts = {}, timeoutMs = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url) {
  const r = await fetchWithTimeout(
    url,
    {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (pc-alert-bot)",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        Accept: "text/html,application/xhtml+xml",
      },
    },
    9000
  );
  if (!r.ok) throw new Error(`HTTP ${r.status} nel download HTML`);
  return await r.text();
}

async function fetchPdfBuffer(url) {
  const r = await fetchWithTimeout(
    url,
    {
      cache: "no-store",
      headers: {
        "User-Agent": "Mozilla/5.0 (pc-alert-bot)",
        "Accept-Language": "it-IT,it;q=0.9,en;q=0.8",
        Accept: "application/pdf",
        Referer: SOURCE_PAGE,
      },
    },
    12000
  );
  if (!r.ok) throw new Error(`HTTP ${r.status} nel download PDF`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab);
}

// -------------------- HTML link picking --------------------
function extractPdfLinksFromHtml(html, baseUrl) {
  const h = String(html || "");
  const pdfs = [];
  const re =
    /<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let m;
  while ((m = re.exec(h)) !== null) {
    const href = m[1];
    const labelHtml = m[2] || "";
    const label = pickText(labelHtml.replace(/<[^>]+>/g, " "));
    pdfs.push({ url: new URL(href, baseUrl).toString(), label });
  }

  const norm = (s) => upperNoAccents(String(s || ""));

  const press =
    pdfs.find((p) => {
      const L = norm(p.label);
      return L.includes("COMUNICATO") && L.includes("AVVISO") && L.includes("CRITIC");
    }) || null;

  const press2 =
    press ||
    pdfs.find((p) => norm(p.url).includes("CS_") || norm(p.url).includes("COMUNICATO")) ||
    null;

  const bcr =
    pdfs.find((p) => {
      const L = norm(p.label);
      return L.includes("AVVISO") && L.includes("CRITIC") && !L.includes("COMUNICATO");
    }) || null;

  const bcr2 =
    bcr ||
    pdfs.find((p) => norm(p.url).includes("ACR_") || norm(p.url).includes("BCR")) ||
    null;

  return {
    pressUrl: press2?.url || null,
    pressLabel: press2?.label || null,
    bcrUrl: bcr2?.url || null,
    bcrLabel: bcr2?.label || null,
    all: pdfs,
  };
}

// -------------------- BCR (testuale) -> ATTENZIONE + fascia avviso --------------------
// Nel PDF BCR/ACR il testo contiene:
// "Inizio avviso: 31/01/2026 15:00 Fine avviso: 01/02/2026 09:00"
// e, per Campidano SARD-B, la fase operativa "ATTENZIONE".
function parseBcrAttentionAndWindow(text) {
  const t = pickText(text);

  const valid_from = extractFirst(t, /Inizio validit[àa]:\s*([0-9.]{10}\s*[0-9:]{4,5})/i);
  const valid_to = extractFirst(t, /Fine validit[àa]:\s*([0-9.]{10}\s*[0-9:]{4,5})/i);

  const avv_from = extractFirst(t, /Inizio avviso:\s*([0-9/]{10}\s*[0-9:]{4,5})/i);
  const avv_to = extractFirst(t, /Fine avviso:\s*([0-9/]{10}\s*[0-9:]{4,5})/i);

  // verifica che per SARD-B compaia "ATTENZIONE"
  const hasSardB = /Campidano\s*\n\s*SARD-B/i.test(t) || /Campidano\s+SARD-B/i.test(t) || /\bSARD-B\b/i.test(t);
  const hasAttenzione = /\bATTENZIONE\b/i.test(t);

  // Non posso leggere i colori senza canvas: uso la semantica
  // ATTENZIONE -> giallo
  const sardBOverall = hasSardB && hasAttenzione ? "giallo" : "verde";

  return { valid_from, valid_to, avv_from, avv_to, sardBOverall };
}

function computeStatusFromSpan(span, nowKey) {
  if (!span?.fromKey || !span?.toKey) return { isCurrent: false, isFuture: false };
  if (nowKey >= span.fromKey && nowKey < span.toKey) return { isCurrent: true, isFuture: false };
  if (nowKey < span.fromKey) return { isCurrent: false, isFuture: true };
  return { isCurrent: false, isFuture: false };
}

// -------------------- compute (cache + dedup) --------------------
async function computeAlert(debug) {
  if (_cache.data && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.data;
  if (_inflight) return await _inflight;

  _inflight = (async () => {
    try {
      const html = await fetchText(SOURCE_PAGE);
      const links = extractPdfLinksFromHtml(html, SOURCE_PAGE);

      if (!links.pressUrl && !links.bcrUrl) {
        const out = baseGreen("Non trovo PDF utili nella pagina Regione (HTML cambiato?).", debug ? { debug: { links } } : {});
        _cache = { ts: Date.now(), data: out };
        return out;
      }

      // 1) scarico BCR (serve per ATTENZIONE + fascia avviso)
      let bcr = null;
      if (links.bcrUrl) {
        const buf = await fetchPdfBuffer(links.bcrUrl);
        const parsed = await pdfParse(buf);
        const text = pickText(parsed.text);

        const metaTitle =
          extractFirst(text, /(AVVISO DI CRITICIT[ÀA][^\n]+)/i) || "Avviso di criticità";

        const bcrCode =
          extractFirst(text, /\b(BCR\/\d+\s+del\s+\d{2}\.\d{2}\.\d{4})\b/i) ||
          extractFirst(text, /\b(BCR\/\d+)\b/i) ||
          null;

        const b = parseBcrAttentionAndWindow(text);

        bcr = {
          title: bcrCode ? `${metaTitle} — ${bcrCode}` : metaTitle,
          url: links.bcrUrl,
          valid_from: b.valid_from || null,
          valid_to: b.valid_to || null,
          avv_from: b.avv_from || null,
          avv_to: b.avv_to || null,
          overall: b.sardBOverall || "verde",
        };
      }

      // 2) scarico comunicato (solo per titolo + validità “testuale” e link principale)
      let press = null;
      if (links.pressUrl) {
        const buf = await fetchPdfBuffer(links.pressUrl);
        const parsed = await pdfParse(buf);
        const text = pickText(parsed.text);
        const title =
          extractFirst(text, /(COMUNICATO STAMPA[\s\S]*?AVVISO DI CRITICIT[ÀA][^\n]*)/i) ||
          extractFirst(text, /(COMUNICATO STAMPA[^\n]*)/i) ||
          "Comunicato stampa";

        const valid_from =
          extractFirst(text, /a\s+partire\s+dalle\s+ore\s+\d{1,2}[:.]\d{2}\s+del\s+(\d{2}\.\d{2}\.\d{4}\s+\d{1,2}[:.]\d{2})/i) ||
          extractFirst(text, /a\s+partire\s+dalle\s+ore\s+(\d{1,2}[:.]\d{2}\s+del\s+\d{2}\.\d{2}\.\d{4})/i) ||
          null;

        // fallback: spesso il comunicato ha già righe pulite nel tuo caso
        const vf = extractFirst(text, /a\s+partire\s+dalle\s+ore\s+(\d{1,2}[:.]\d{2})\s+del\s+(\d{2}\.\d{2}\.\d{4})/i);
        const vt = extractFirst(text, /sino\s+alle\s+(\d{1,2}[:.]\d{2})\s+del\s+(\d{2}\.\d{2}\.\d{4})/i);

        const validFrom2 = vf ? `${vf.split(/\s+/)[1]} ${vf.split(/\s+/)[0]}` : null; // non usato
        const valid_to = vt ? `${vt.split(/\s+/)[1]} ${vt.split(/\s+/)[0]}` : null; // non usato

        // meglio: ricostruisco come facevi tu
        const m1 = text.match(/a\s+partire\s+dalle\s+ore\s+(\d{1,2}[:.]\d{2})\s+del\s+(\d{2}\.\d{2}\.\d{4})/i);
        const m2 = text.match(/sino\s+alle\s+(\d{1,2}[:.]\d{2})\s+del\s+(\d{2}\.\d{2}\.\d{4})/i);
        const vfrom = m1 ? `${m1[2]} ${m1[1].replace(".", ":")}` : null;
        const vto = m2 ? `${m2[2]} ${m2[1].replace(".", ":")}` : null;

        press = { title, url: links.pressUrl, valid_from: vfrom, valid_to: vto };
      }

      // 3) costruisco stato “corrente / previsto” usando la fascia avviso del BCR
      const now = nowEuropeRomeParts();
      const nowKey = wallClockKey(now.y, now.mo, now.d, now.hh, now.mm);

      let span = null;
      if (bcr?.avv_from && bcr?.avv_to) {
        const pFrom = parseDateTimeIT(bcr.avv_from);
        const pTo = parseDateTimeIT(bcr.avv_to);
        if (pFrom && pTo) {
          span = {
            from: `${pad2(pFrom.d)}.${pad2(pFrom.mo)}.${pFrom.y} ${pad2(pFrom.hh)}:${pad2(pFrom.mm)}`,
            to: `${pad2(pTo.d)}.${pad2(pTo.mo)}.${pTo.y} ${pad2(pTo.hh)}:${pad2(pTo.mm)}`,
            fromKey: wallClockKey(pFrom.y, pFrom.mo, pFrom.d, pFrom.hh, pFrom.mm),
            toKey: wallClockKey(pTo.y, pTo.mo, pTo.d, pTo.hh, pTo.mm),
          };
        }
      }

      const bcrOverall = bcr?.overall || "verde";
      const status = computeStatusFromSpan(span, nowKey);

      // Assunzione coerente con intestazione: rischio idrogeologico + idraulico (non temporali)
      const riskLevels =
        bcrOverall === "giallo"
          ? { idrogeologico: "giallo", idraulico: "giallo", temporali: "verde" }
          : { idrogeologico: "verde", idraulico: "verde", temporali: "verde" };

      const overall =
        bcrOverall === "giallo" && status.isCurrent ? "giallo" : "verde";

      const current_alerts = {
        idrogeologico: overall === "giallo" ? { level: "giallo", from: span?.from || null, to: span?.to || null } : null,
        idraulico: overall === "giallo" ? { level: "giallo", from: span?.from || null, to: span?.to || null } : null,
        temporali: null,
      };

      const next_alerts = {
        idrogeologico: bcrOverall === "giallo" && status.isFuture ? { level: "giallo", from: span?.from || null, to: span?.to || null } : null,
        idraulico: bcrOverall === "giallo" && status.isFuture ? { level: "giallo", from: span?.from || null, to: span?.to || null } : null,
        temporali: null,
      };

      let note = "Condizione attuale: Nessuna allerta in corso.";
      if (overall === "giallo") {
        note = `Condizione attuale: ${labelForLevel("giallo")} (Idrogeologico + Idraulico)${span ? ` dalle ${span.from.slice(11)} alle ${span.to.slice(11)}` : ""}.`;
      } else if (bcrOverall === "giallo" && status.isFuture) {
        note = `Allerte previste: ${labelForLevel("giallo")} (Idrogeologico + Idraulico)${span ? ` dalle ${span.from.slice(11)} alle ${span.to.slice(11)}` : ""}.`;
      }

      const out = {
        ok: true,
        overall,
        level: overall,
        area: areaLabel(),

        // titolo: meglio BCR (più “operativo”), ma se manca uso comunicato
        title: bcr?.title || press?.title || "Avvisi Protezione Civile",

        // link dettagli: se c’è comunicato, meglio quello; altrimenti BCR/pagina
        url: press?.url || bcr?.url || SOURCE_PAGE,

        // validità: preferisci comunicato se presente
        valid_from: press?.valid_from || bcr?.valid_from || null,
        valid_to: press?.valid_to || bcr?.valid_to || null,
        from: press?.valid_from || bcr?.valid_from || null,
        to: press?.valid_to || bcr?.valid_to || null,

        current: overall === "giallo" && span ? { from: span.from, to: span.to, overall, risks: riskLevels } : null,
        current_alerts,
        next_alerts,
        note,

        sources: {
          page: SOURCE_PAGE,
          press: press ? { url: press.url, title: press.title } : null,
          bcr: bcr ? { url: bcr.url, title: bcr.title, avv_from: bcr.avv_from, avv_to: bcr.avv_to } : null,
        },

        ...(debug ? { debug: { links, bcr, press, span, now } } : {}),
      };

      _cache = { ts: Date.now(), data: out };
      return out;
    } finally {
      _inflight = null;
    }
  })();

  return await _inflight;
}

// -------------------- handler (hard deadline) --------------------
export default async function handler(req, res) {
  const debug = String(req.query?.debug || "") === "1";

  const deadline = new Promise((resolve) => {
    setTimeout(() => {
      if (_cache.data) resolve({ ..._cache.data, note: "Risposta da cache (timeout parsing)." });
      else resolve(baseGreen("Timeout parsing: risposta di sicurezza."));
    }, HARD_DEADLINE_MS);
  });

  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, note: "Method Not Allowed" });
    }

    const data = await Promise.race([computeAlert(debug), deadline]);
    return res.status(200).json(data);
  } catch (e) {
    return res.status(200).json(
      baseGreen(`Eccezione: ${e?.message || String(e)}`, {
        stack: process.env.NODE_ENV === "development" ? e?.stack || null : null,
      })
    );
  }
}