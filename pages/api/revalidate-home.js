export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    }

    const secret = String(req.query?.secret || "");
    const expected = String(process.env.REVALIDATE_SECRET || "");

    if (!expected) {
      return res.status(500).json({
        ok: false,
        error: "Missing REVALIDATE_SECRET env var",
      });
    }

    if (!secret || secret !== expected) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    // Revalida SOLO la home.
    // Se un domani vuoi aggiungere altre pagine, fai altre chiamate res.revalidate("/percorso")
    await res.revalidate("/");

    return res.status(200).json({
      ok: true,
      revalidated: ["/"],
      ts: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e?.message || String(e),
    });
  }
}