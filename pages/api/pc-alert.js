// pages/api/pc-alert.js
// CommonJS per evitare problemi ESM/Turbopack con pdf-parse
const cheerio = require("cheerio");
const pdfParse = require("pdf-parse");

const INDEX_URL = "https://www.sardegnaambiente.it/index.php?xsl=2273&s=20&v=9&nodesc=1&c=7092";

// Collinas ricade in Sard-B
const ZONE_LABELS = [
  "Sard-B",
  "SARD-B",
  "SARD B",
  "SARDB",
  "SARD–B", // trattino lungo
  "SARD—B",
];

function absUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function extractDateFromText(t) {
  // cerca "del 30/01/2026" o "30-01-2026" o "30.01.2026"
  const s = String(t || "");
  let m = s.match(/\bdel\s+(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})\b/i);
  if (!m) m = s.match(/\b(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})\b/);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yy = Number(m[3]);
  if (!dd || !mm || !yy) return null;
  // timestamp UTC “neutro” per ordinare
  return Date.UTC(yy, mm - 1, dd, 12, 0, 0);
}

function pickLatestCriticalityPdfFromIndex(html) {
  const $ = cheerio.load(html);

  // prendi tutti i link pdf
  const links = [];
  $("a[href*='.pdf']").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!href) return;
    links.push({ href, text });
  });

  if (!links.length) return null;

  // filtra SOLO quelli che sembrano “Avviso di criticità” (regionale/ordinaria)
  const crit = links.filter((l) => /avviso\s+di\s+critic/i.test(l.text));
  const pool = crit.length ? crit : links;

  // ordina per data nel testo (più recente prima). Se non c’è data, resta in fondo.
  pool.sort((a, b) => {
    const da = extractDateFromText(a.text) || 0;
    const db = extractDateFromText(b.text) || 0;
    return db - da;
  });

  return pool[0];
}

function severity(level) {
  // più alto = peggio
  switch (level) {
    case "rosso":
      return 3;
    case "arancione":
      return 2;
    case "giallo":
      return 1;
    default:
      return 0;
  }
}

function normalizeLevelWord(w) {
  const u = String(w || "").toUpperCase();
  if (u.includes("ROSS")) return "rosso";
  if (u.includes("ARANC")) return "arancione";
  if (u.includes("GIAL")) return "giallo";
  return "verde";
}

function findBestLevelNearZones(fullText) {
  const t = String(fullText || "");
  const T = t.toUpperCase();

  // trova tutte le occorrenze di ciascuna etichetta zona
  const hits = [];
  for (const label of ZONE_LABELS) {
    const L = String(label).toUpperCase();
    let idx = 0;
    while (true) {
      const pos = T.indexOf(L, idx);
      if (pos < 0) break;
      hits.push({ label, pos });
      idx = pos + L.length;
    }
  }

  if (!hits.length) {
    return { level: "verde", note: `Zona non trovata nel testo PDF (provate: ${ZONE_LABELS.join(", ")}).` };
  }

  // cerca parole-colore vicino a ogni hit e prendi il massimo livello trovato
  let best = "verde";
  let foundAny = false;

  for (const h of hits) {
    const start = Math.max(0, h.pos - 1200);
    const end = Math.min(t.length, h.pos + 2500);
    const chunk = t.slice(start, end).toUpperCase();

    // match robusto: “CODICE GIALLO”, “ALLERTA GIALLA”, o semplicemente “GIALLO”
    const colorMatches = [...chunk.matchAll(/\b(ROSSO|ARANCIONE|GIALLO|VERDE)\b/g)].map((m) => m[1]);

    if (!colorMatches.length) continue;

    foundAny = true;

    // in quel chunk prendi il massimo (se appare ROSSO e GIALLO insieme, vale ROSSO)
    for (const w of colorMatches) {
      const lv = normalizeLevelWord(w);
      if (severity(lv) > severity(best)) best = lv;
    }
  }

  if (foundAny) {
    return { level: best, note: null };
  }

  // fallback: se vicino alla zona non c’è nulla, prova il massimo in tutto il documento
  const all = [...T.matchAll(/\b(ROSSO|ARANCIONE|GIALLO|VERDE)\b/g)].map((m) => m[1]);
  if (all.length) {
    let maxLv = "verde";
    for (const w of all) {
      const lv = normalizeLevelWord(w);
      if (severity(lv) > severity(maxLv)) maxLv = lv;
    }
    return {
      level: maxLv,
      note: "Colore non trovato vicino alla zona; usato massimo livello presente nel PDF (fallback).",
    };
  }

  return {
    level: "verde",
    note: "Nessuna parola-colore trovata nel testo del PDF (probabile tabella come immagine/scansione).",
  };
}

module.exports = async function handler(req, res) {
  const debug = String(req.query.debug || "") === "1";
  const isDev = process.env.NODE_ENV !== "production";

  try {
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=1200");

    // 1) scarico pagina indice
    const indexRes = await fetch(INDEX_URL, {
      headers: {
        "User-Agent": "meteo-collinas/1.0",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!indexRes.ok) {
      return res.status(200).json({
        ok: false,
        level: "verde",
        area: "Collinas (Campidano - SARD-B)",
        title: "Avvisi Protezione Civile",
        url: null,
        from: null,
        to: null,
        note: `Errore caricamento indice: HTTP ${indexRes.status}`,
      });
    }

    const html = await indexRes.text();

    // 2) prendo il PDF “Avviso di criticità” più recente
    const best = pickLatestCriticalityPdfFromIndex(html);
    if (!best) {
      return res.status(200).json({
        ok: false,
        level: "verde",
        area: "Collinas (Campidano - SARD-B)",
        title: "Avvisi Protezione Civile",
        url: null,
        from: null,
        to: null,
        note: "Nessun link PDF trovato nella pagina indice.",
      });
    }

    const pdfUrl = absUrl(INDEX_URL, best.href);

    // 3) scarico PDF
    const pdfRes = await fetch(pdfUrl, {
      headers: {
        "User-Agent": "meteo-collinas/1.0",
        Accept: "application/pdf",
      },
    });

    if (!pdfRes.ok) {
      return res.status(200).json({
        ok: false,
        level: "verde",
        area: "Collinas (Campidano - SARD-B)",
        title: best.text || "Avviso di criticità",
        url: pdfUrl,
        from: null,
        to: null,
        note: `Errore download PDF: HTTP ${pdfRes.status}`,
      });
    }

    const buf = Buffer.from(await pdfRes.arrayBuffer());

    // 4) parse PDF
    const parsed = await pdfParse(buf);
    const text = String(parsed?.text || "");

    // 5) livello per Sard-B (robusto)
    const { level, note } = findBestLevelNearZones(text);

    // DEBUG: ti faccio capire subito se il testo contiene davvero GIALLO ecc.
    const dbg = debug
      ? {
          pickedPdfText: best.text,
          pickedPdfUrl: pdfUrl,
          textLen: text.length,
          hasGiallo: /GIALLO/i.test(text),
          hasArancione: /ARANCIONE/i.test(text),
          hasRosso: /ROSSO/i.test(text),
          zoneFoundAny: ZONE_LABELS.some((z) => String(text).toUpperCase().includes(String(z).toUpperCase())),
          textSampleHead: text.slice(0, 1200),
        }
      : undefined;

    return res.status(200).json({
      ok: true,
      level,
      area: "Collinas (Campidano - SARD-B)",
      title: best.text || "Avviso di criticità",
      url: pdfUrl,
      from: null,
      to: null,
      note,
      debug: dbg,
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      level: "verde",
      area: "Collinas (Campidano - SARD-B)",
      title: "Avvisi Protezione Civile",
      url: null,
      from: null,
      to: null,
      note: `Eccezione: ${e?.message || "unknown"}`,
      stack: isDev ? String(e?.stack || "") : undefined,
    });
  }
};