import Link from "next/link";

function fmtDateISO(d) {
  if (!d) return "—";
  return String(d).slice(0, 10);
}

export default function SiteHeader({
  title = "Meteo Collinas",
  kicker = "ARCHIVIO METEO",
  subtitle = "Dati storici della stazione meteo di Collinas",
  start = null,
  end = null,
  showPeriod = true,
  currentPath = "",
}) {
  const isActive = (href) => currentPath === href;

  return (
    <header className="siteHero">
      <div className="heroTop">
        <div className="heroLeft">
          <div className="kicker">{kicker}</div>
          <h1 className="title">{title}</h1>
          <div className="subline">{subtitle}</div>

          {showPeriod && start && end ? (
            <div className="periodLine">
              Periodo disponibile: {fmtDateISO(start)} — {fmtDateISO(end)}
            </div>
          ) : null}
        </div>

        <div className="heroRight" />
      </div>

      <div className="navStripWrap">
        <nav className="navStrip" aria-label="Sezioni principali">
          <Link
            href="/"
            className={`navStripLink ${isActive("/") ? "active" : ""}`}
          >
            <span className="navStripText">Home</span>
          </Link>

          <Link
            href="/records"
            className={`navStripLink ${isActive("/records") ? "active" : ""}`}
          >
            <span className="navStripText">Record</span>
          </Link>

          <Link
            href="/radar"
            className={`navStripLink ${isActive("/radar") ? "active" : ""}`}
          >
            <span className="navStripText">Condizioni attuali</span>
          </Link>

          <Link
            href="/grafici-previsione"
            className={`navStripLink ${
              isActive("/grafici-previsione") ? "active" : ""
            }`}
          >
            <span className="navStripText">Grafici di previsione</span>
          </Link>

          {/* NUOVO LINK */}
          <Link
            href="/confronto-climatico"
            className={`navStripLink ${
              isActive("/confronto-climatico") ? "active" : ""
            }`}
          >
            <span className="navStripText">Confronto climatico</span>
          </Link>
        </nav>
      </div>

      <div className="liveBoxWrap">
        <section className="liveBox" aria-label="Dati in tempo reale">
          <div className="liveBoxHead">
            <h2 className="liveBoxTitle">Dati in tempo reale</h2>
          </div>

          <div className="embedWrap">
            <div className="embedFrame">
              <iframe
                src="https://www.weatherlink.com/embeddablePage/show/865c69d0529a4b2d907ab00a67d2935d/signature"
                width="760"
                height="200"
                frameBorder="0"
                title="WeatherLink Signature"
              />
            </div>
          </div>
        </section>
      </div>

      <style jsx>{`
        .siteHero {
          border: 1px solid #e8e8e8;
          border-radius: 24px;
          background: rgba(255, 255, 255, 0.86);
          backdrop-filter: blur(8px);
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }

        .heroTop {
          display: grid;
          grid-template-columns: 1.15fr 1fr;
          gap: 16px;
          padding: 22px 22px 18px;
        }

        .kicker {
          font-size: 12px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(15, 23, 42, 0.62);
          font-weight: 900;
        }

        .title {
          margin: 8px 0 0;
          font-size: 52px;
          line-height: 1.02;
          letter-spacing: -0.02em;
          font-weight: 950;
          color: #0f172a;
        }

        .subline {
          margin-top: 10px;
          font-size: 14px;
          color: rgba(15, 23, 42, 0.72);
          line-height: 1.45;
        }

        .periodLine {
          margin-top: 14px;
          font-size: 13px;
          color: rgba(15, 23, 42, 0.72);
          line-height: 1.45;
          font-weight: 700;
        }

        .heroRight {
          display: flex;
          justify-content: flex-end;
          align-items: flex-start;
          min-height: 1px;
        }

        .navStripWrap {
          padding: 0 22px 18px;
        }

        .navStrip {
          width: min(980px, 100%);
          margin: 0 auto;
          min-height: 64px;
          border: 1px solid #d7dce2;
          border-radius: 18px;
          background: linear-gradient(180deg, #f9fafb, #f2f5f8);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.85);
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 34px;
          padding: 12px 28px;
        }

        .navStripLink {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
          color: #111827;
          position: relative;
          padding: 10px 0;
          transition: color 140ms ease, transform 140ms ease;
        }

        .navStripText {
          display: inline-block;
          font-size: 14px;
          font-weight: 1000;
          line-height: 0;
          white-space: nowrap;
        }

        .navStripLink::after {
          content: "";
          position: absolute;
          left: 0;
          bottom: -2px;
          width: 100%;
          height: 3px;
          border-radius: 999px;
          background: #64748b;
          transform: scaleX(0);
          transform-origin: center;
          transition: transform 160ms ease;
        }

        .navStripLink:hover {
          color: #0f172a;
          transform: translateY(-1px);
        }

        .navStripLink:hover::after,
        .navStripLink:focus-visible::after,
        .navStripLink.active::after {
          transform: scaleX(1);
        }

        .navStripLink.active {
          color: #0f172a;
        }

        .navStripLink:focus-visible {
          outline: none;
          color: #0f172a;
        }

        .liveBoxWrap {
          padding: 0 22px 22px;
        }

        .liveBox {
          max-width: 920px;
          margin: 0 auto;
          border: 1px solid #e5e7eb;
          border-radius: 22px;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.05);
          overflow: hidden;
        }

        .liveBoxHead {
          padding: 14px 18px 10px;
          border-bottom: 1px solid #eef1f4;
          background: linear-gradient(
            180deg,
            rgba(248, 250, 252, 0.9),
            rgba(255, 255, 255, 0.96)
          );
          display: flex;
          justify-content: center;
        }

        .liveBoxTitle {
          margin: 0;
          font-size: 16px;
          font-weight: 950;
          letter-spacing: -0.01em;
          color: #0f172a;
        }

        .embedWrap {
          padding: 16px 18px 18px;
        }

        .embedFrame {
          display: flex;
          justify-content: center;
          align-items: center;
          overflow: hidden;
        }

        .embedFrame iframe {
          border-radius: 16px;
        }

        @media (max-width: 1080px) {
          .heroTop {
            grid-template-columns: 1fr;
          }

          .title {
            font-size: 44px;
          }

          .navStrip {
            min-height: auto;
            gap: 20px 24px;
            padding: 16px 18px;
            flex-wrap: wrap;
          }

          .navStripText {
            font-size: 22px;
          }

          .embedFrame iframe {
            width: 100%;
            max-width: 760px;
          }

          .liveBox {
            max-width: 100%;
          }
        }

        @media (max-width: 640px) {
          .navStrip {
            justify-content: center;
            gap: 14px 20px;
            padding: 14px 16px;
          }

          .navStripText {
            font-size: 18px;
          }

          .title {
            font-size: 36px;
          }
        }
      `}</style>
    </header>
  );
}