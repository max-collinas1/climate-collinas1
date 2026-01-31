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
const HARD_DEADLINE_MS = 12000;

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

function normOneLine(s) {
  return upperNoAccents(s).replace(/\s+/g, " ").trim();
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
  return {
    y: +parts.year,
    mo: +parts.month,
    d: +parts.day,
    hh: +parts.hour,
    mm: +parts.minute,
  };
}

// Chiave "wall clock" (Roma) comparabile senza timezone-bug
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
function maxLevel(a, b) {
  return levelRank(a) >= levelRank(b) ? a : b;
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

// In caso di errore: NON verde finto
function baseUnavailable(note, extra = {}) {
  return {
    ok: false,
    overall: null,
    level: null,
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
    note: note || "Dati Protezione Civile non disponibili.",
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

// scarica PDF come Uint8Array (poi proviamo anche Buffer se serve)
async function fetchPdfBytes(url) {
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
  return new Uint8Array(ab);
}

async function parsePdfText(bytes) {
  // prova Uint8Array, poi fallback Buffer
  try {
    const parsed = await pdfParse(bytes);
    return pickText(parsed.text);
  } catch (e1) {
    try {
      const parsed = await pdfParse(Buffer.from(bytes));
      return pickText(parsed.text);
    } catch (e2) {
      // rialzo l'errore originale ma includo info
      const msg = `pdf-parse failed: ${e1?.message || e1} | fallback failed: ${e2?.message || e2}`;
      const err = new Error(msg);
      err.cause = e1;
      throw err;
    }
  }
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

// -------------------- BCR parsing robusto --------------------
function phaseToLevel(phase) {
  const P = normOneLine(phase);
  if (P.includes("ALLARME")) return "rosso";
  if (P.includes("PREALLARME")) return "arancione";
  if (P.includes("ATTENZIONE")) return "giallo";
  return "verde";
}

function findPhaseForZone(text, zone = TARGET_ZONE) {
  const t = pickText(text);
  const lines = t.split("\n").map((x) => x.trim()).filter(Boolean);

  // normalizza target: accetta "SARD-B", "SARD B", "SARDB"
  const zoneNorm = normOneLine(zone).replace(/[^A-Z0-9]/g, ""); // SARDB
  const lineHasZone = (ln) => {
    const n = normOneLine(ln).replace(/[^A-Z0-9]/g, "");
    return n.includes(zoneNorm);
  };

  const hasKeyword = (s) =>
    s.includes("ATTENZIONE") || s.includes("PREALLARME") || s.includes("ALLARME");

  // strategia: trova indice riga con zona, poi guarda riga stessa e vicine
  for (let i = 0; i < lines.length; i++) {
    if (!lineHasZone(lines[i])) continue;

    const window = [
      lines[i - 2],
      lines[i - 1],
      lines[i],
      lines[i + 1],
      lines[i + 2],
    ].filter(Boolean);

    const joined = normOneLine(window.join(" "));
    if (hasKeyword(joined)) {
      if (joined.includes("ALLARME")) return "ALLARME";
      if (joined.includes("PREALLARME")) return "PREALLARME";
      if (joined.includes("ATTENZIONE")) return "ATTENZIONE";
    }
  }

  // fallback: nel testo completo, se c'è zona e keyword (meno preciso ma meglio di niente)
  const all = normOneLine(t);
  const allCompact = all.replace(/[^A-Z0-9]/g, ""); // senza spazi/simboli
  if (allCompact.includes(zoneNorm)) {
    if (all.includes("ALLARME")) return "ALLARME";
    if (all.includes("PREALLARME")) return "PREALLARME";
    if (all.includes("ATTENZIONE")) return "ATTENZIONE";
  }

  return null;
}

function parseBcrWindowAndLevel(text) {
  const t = pickText(text);

  const valid_from = extractFirst(
    t,
    /Inizio validit[àa]:\s*([0-9.]{10}\s*[0-9:]{4,5})/i
  );
  const valid_to = extractFirst(
    t,
    /Fine validit[àa]:\s*([0-9.]{10}\s*[0-9:]{4,5})/i
  );

  const avv_from = extractFirst(t, /Inizio avviso:\s*([0-9/]{10}\s*[0-9:]{4,5})/i);
  const avv_to = extractFirst(t, /Fine avviso:\s*([0-9/]{10}\s*[0-9:]{4,5})/i);

  const phase = findPhaseForZone(t, TARGET_ZONE);
  const level = phaseToLevel(phase);

  return { valid_from, valid_to, avv_from, avv_to, phase, level };
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
        const out = baseUnavailable(
          "Non trovo PDF utili nella pagina Regione (HTML cambiato?).",
          debug ? { debug: { links } } : {}
        );
        _cache = { ts: Date.now(), data: out };
        return out;
      }

      // 1) BCR
      let bcr = null;
      let bcrText = null;

      if (links.bcrUrl) {
        const bytes = await fetchPdfBytes(links.bcrUrl);
        bcrText = await parsePdfText(bytes);

        const metaTitle =
          extractFirst(bcrText, /(AVVISO DI CRITICIT[ÀA][^\n]+)/i) || "Avviso di criticità";

        const bcrCode =
          extractFirst(bcrText, /\b(BCR\/\d+\s+del\s+\d{2}\.\d{2}\.\d{4})\b/i) ||
          extractFirst(bcrText, /\b(BCR\/\d+)\b/i) ||
          null;

        const p = parseBcrWindowAndLevel(bcrText);

        bcr = {
          title: bcrCode ? `${metaTitle} — ${bcrCode}` : metaTitle,
          url: links.bcrUrl,
          valid_from: p.valid_from || null,
          valid_to: p.valid_to || null,
          avv_from: p.avv_from || null,
          avv_to: p.avv_to || null,
          overall: p.level || "verde",
          phase: p.phase || null,
        };
      }

      // 2) Comunicato
      let press = null;
      if (links.pressUrl) {
        const bytes = await fetchPdfBytes(links.pressUrl);
        const text = await parsePdfText(bytes);

        const title =
          extractFirst(text, /(COMUNICATO STAMPA[\s\S]*?AVVISO DI CRITICIT[ÀA][^\n]*)/i) ||
          extractFirst(text, /(COMUNICATO STAMPA[^\n]*)/i) ||
          "Comunicato stampa";

        const m1 = text.match(
          /a\s+partire\s+dalle\s+ore\s+(\d{1,2}[:.]\d{2})\s+del\s+(\d{2}\.\d{2}\.\d{4})/i
        );
        const m2 = text.match(
          /sino\s+alle\s+(\d{1,2}[:.]\d{2})\s+del\s+(\d{2}\.\d{2}\.\d{4})/i
        );
        const vfrom = m1 ? `${m1[2]} ${m1[1].replace(".", ":")}` : null;
        const vto = m2 ? `${m2[2]} ${m2[1].replace(".", ":")}` : null;

        press = { title, url: links.pressUrl, valid_from: vfrom, valid_to: vto };
      }

      // 3) stato corrente / previsto (fascia BCR)
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

      const docLevel = bcr?.overall || "verde";
      const status = computeStatusFromSpan(span, nowKey);

      // livello attuale: docLevel solo se fascia "avviso" è corrente
      const overall = isAlertLevel(docLevel) && status.isCurrent ? docLevel : "verde";

      // rischi (per ora: idro + idraulico, temporali null come facevi tu)
      const current_alerts = {
        idrogeologico: isAlertLevel(overall) ? { level: overall, from: span?.from || null, to: span?.to || null } : null,
        idraulico: isAlertLevel(overall) ? { level: overall, from: span?.from || null, to: span?.to || null } : null,
        temporali: null,
      };

      const nextLevel = isAlertLevel(docLevel) && status.isFuture ? docLevel : "verde";
      const next_alerts = {
        idrogeologico: isAlertLevel(nextLevel) ? { level: nextLevel, from: span?.from || null, to: span?.to || null } : null,
        idraulico: isAlertLevel(nextLevel) ? { level: nextLevel, from: span?.from || null, to: span?.to || null } : null,
        temporali: null,
      };

      let note = "Condizione attuale: Nessuna allerta in corso.";
      if (isAlertLevel(overall)) {
        note = `Condizione attuale: ${labelForLevel(overall)} (Idrogeologico + Idraulico) fino alle ${
          span ? `${span.to.slice(11)} del ${span.to.slice(0, 10)}` : "—"
        }.`;
      } else if (isAlertLevel(nextLevel)) {
        note = `Allerte previste: ${labelForLevel(nextLevel)} (Idrogeologico + Idraulico) dalle ${
          span ? `${span.from.slice(11)} del ${span.from.slice(0, 10)}` : "—"
        } alle ${span ? `${span.to.slice(11)} del ${span.to.slice(0, 10)}` : "—"}.`;
      }

      const out = {
        ok: true,
        overall,
        level: overall,
        area: areaLabel(),

        title: bcr?.title || press?.title || "Avvisi Protezione Civile",
        url: press?.url || bcr?.url || SOURCE_PAGE,

        valid_from: press?.valid_from || bcr?.valid_from || null,
        valid_to: press?.valid_to || bcr?.valid_to || null,
        from: press?.valid_from || bcr?.valid_from || null,
        to: press?.valid_to || bcr?.valid_to || null,

        current: isAlertLevel(overall) && span ? { from: span.from, to: span.to, overall } : null,
        current_alerts,
        next_alerts,
        note,

        sources: {
          page: SOURCE_PAGE,
          press: press ? { url: press.url, title: press.title } : null,
          bcr: bcr
            ? {
                url: bcr.url,
                title: bcr.title,
                avv_from: bcr.avv_from,
                avv_to: bcr.avv_to,
                phase: bcr.phase,
                overall: bcr.overall,
              }
            : null,
        },

        ...(debug ? { debug: { links, bcr, span, now } } : {}),
      };

      _cache = { ts: Date.now(), data: out };
      return out;
    } catch (e) {
      console.error("pc-alert computeAlert error:", e);
      const out = baseUnavailable(`Errore nel recupero avvisi Protezione Civile. (${e?.message || String(e)})`, {
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

// -------------------- handler (hard deadline) --------------------
export default async function handler(req, res) {
  const debug = String(req.query?.debug || "") === "1";

  // evita cache Vercel/CDN
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const deadline = new Promise((resolve) => {
    setTimeout(() => {
      if (_cache.data) resolve({ ..._cache.data, note: `${_cache.data.note} (Risposta da cache: timeout)` });
      else resolve(baseUnavailable("Timeout parsing: dati Protezione Civile non disponibili."));
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
    console.error("pc-alert handler error:", e);
    return res.status(200).json(
      baseUnavailable(`Errore nel recupero avvisi Protezione Civile. (${e?.message || String(e)})`, {
        stack: process.env.NODE_ENV === "development" ? e?.stack || null : null,
      })
    );
  }
}