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

  const navItems = [
    { href: "/", label: "Home" },
    { href: "/records", label: "Record" },
    { href: "/radar", label: "Condizioni attuali" },
    { href: "/grafici-previsione", label: "Grafici di previsione" },
    { href: "/confronto-climatico", label: "Confronto climatico" },
  ];

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

        <details className="mobileMenu">
          <summary className="mobileMenuButton" aria-label="Apri menu">
            <span />
            <span />
            <span />
          </summary>

          <nav className="mobileMenuPanel" aria-label="Menu mobile">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`mobileMenuLink ${
                  isActive(item.href) ? "active" : ""
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </details>
      </div>

      <div className="navStripWrap">
        <nav className="navStrip" aria-label="Sezioni principali">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`navStripLink ${isActive(item.href) ? "active" : ""}`}
            >
              <span className="navStripText">{item.label}</span>
            </Link>
          ))}
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
          overflow: visible;
          position: relative;
        }

        .heroTop {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 16px;
          padding: 22px 22px 18px;
          position: relative;
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

        .mobileMenu {
          display: none;
          position: relative;
          z-index: 20;
        }

        .mobileMenu summary {
          list-style: none;
        }

        .mobileMenu summary::-webkit-details-marker {
          display: none;
        }

        .mobileMenuButton {
          width: 46px;
          height: 46px;
          border: 1px solid #d7dce2;
          border-radius: 14px;
          background: linear-gradient(180deg, #ffffff, #f3f6f9);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          cursor: pointer;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.08);
        }

        .mobileMenuButton span {
          width: 21px;
          height: 3px;
          border-radius: 999px;
          background: #0f172a;
          display: block;
        }

        .mobileMenuPanel {
          position: absolute;
          top: 56px;
          right: 0;
          width: 250px;
          border: 1px solid #d7dce2;
          border-radius: 18px;
          background: rgba(255, 255, 255, 0.98);
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.16);
          padding: 10px;
          display: grid;
          gap: 6px;
        }

        .mobileMenuLink {
          display: block;
          padding: 13px 14px;
          border-radius: 13px;
          font-size: 15px;
          font-weight: 900;
          color: #111827;
          text-decoration: none;
        }

        .mobileMenuLink.active,
        .mobileMenuLink:hover {
          background: #f1f5f9;
          color: #0f172a;
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
          line-height: 1;
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
            font-size: 16px;
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
          .siteHero {
            border-radius: 20px;
          }

          .heroTop {
            padding: 20px 18px 18px;
          }

          .title {
            font-size: 36px;
            padding-right: 54px;
          }

          .subline {
            padding-right: 18px;
          }

          .navStripWrap {
            display: none;
          }

          .mobileMenu {
            display: block;
            position: absolute;
            top: 18px;
            right: 18px;
          }

          .liveBoxWrap {
            padding: 0 14px 18px;
          }
        }
      `}</style>
    </header>
  );
}