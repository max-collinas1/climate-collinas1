import { useMemo } from "react";
import SiteLayout from "../components/SiteLayout";

export default function RadarPage() {
  // WINDY
  const windySrc = useMemo(() => {
    const params = new URLSearchParams({
      type: "map",
      location: "coordinates",
      metricRain: "mm",
      metricTemp: "°C",
      metricWind: "km/h",
      zoom: "7.3",
      overlay: "radar",
      product: "ecmwf",
      level: "surface",
      lat: "40.05",
      lon: "8.95",
      message: "true",
    });

    return `https://embed.windy.com/embed.html?${params.toString()}`;
  }, []);

  // BLITZORTUNG meno zoomato, più simile all'inquadratura del satellite
  const blitzortungSrc = useMemo(() => {
    const params = new URLSearchParams({
      MapInteractive: "1",
      NavigationControl: "1",
      FullScreenControl: "0",
      Cookies: "0",
      InfoDiv: "0",
      MenuDiv: "1",
      MapStyle: "3",
    });

    return `https://map.blitzortung.org/index.php?${params.toString()}#4/42.3/12.5`;
  }, []);

  return (
    <SiteLayout
      headerProps={{
        title: "Condizioni attuali",
        kicker: "MONITORAGGIO METEO",
        subtitle:
          "Radar, satellite e fulminazioni in tempo reale con focus su Sardegna e Italia.",
        currentPath: "/condizioni-attuali",
        showPeriod: false,
      }}
    >
      <section className="section">
        <div className="sectionHead">
          <div className="sectionText">
            <h2>Radar in tempo reale</h2>
            <div className="hint">
              Radar Windy centrato sulla Sardegna per monitorare precipitazioni
              e nuclei attivi.
            </div>
          </div>
        </div>

        <div className="card">
          <div className="cardHead">
            <div>
              <div className="eyebrow">Windy</div>
              <div className="cardTitle">Radar precipitazioni</div>
            </div>
            <div className="cardMeta">Sardegna</div>
          </div>

          <div className="frameWrap">
            <iframe
              title="Radar Windy Sardegna"
              src={windySrc}
              className="radarFrame"
              loading="lazy"
              allowFullScreen
            />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="sectionHead compact">
          <div className="sectionText">
            <h2>Satellite e fulminazioni</h2>
            <div className="hint">
              Monitoraggio in tempo reale della copertura nuvolosa e
              dell’attività elettrica.
            </div>
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="cardHead">
              <div>
                <div className="eyebrow">Satellite</div>
                <div className="cardTitle">Italia (cloud cover)</div>
              </div>
              <div className="cardMeta">Realtime</div>
            </div>

            <div className="frameWrap">
              <iframe
                title="Satellite Italia"
                sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                src="https://widgets.meteox.com/it-IT/widgets/radar/country/it/satellite?z=4.8"
                className="subFrame"
                scrolling="no"
                frameBorder="0"
                loading="lazy"
              />
            </div>
          </div>

          <div className="card">
            <div className="cardHead">
              <div>
                <div className="eyebrow">Blitzortung</div>
                <div className="cardTitle">Fulmini in tempo reale</div>
              </div>
              <div className="cardMeta">Italia</div>
            </div>

            <div className="frameWrap">
              <iframe
                title="Blitzortung Italia"
                src={blitzortungSrc}
                className="subFrame"
                loading="lazy"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      </section>

      <style jsx>{`
        .section {
          margin: 18px auto 0;
        }

        .sectionHead {
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 16px 0 10px;
          width: 100%;
          text-align: center;
        }

        .sectionHead.compact {
          align-items: center;
          justify-content: center;
        }

        .sectionText {
          width: 100%;
          text-align: center;
        }

        h2 {
          margin: 0;
          font-size: 22px;
          font-weight: 950;
          color: #0f172a;
          text-align: center;
        }

        .hint {
          margin-top: 4px;
          font-size: 12px;
          color: rgba(15, 23, 42, 0.66);
          text-align: center;
          margin-left: auto;
          margin-right: auto;
        }

        .grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }

        .card {
          border: 1px solid #e8e8e8;
          border-radius: 20px;
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 0 8px 24px rgba(15, 23, 42, 0.06);
          overflow: hidden;
        }

        .cardHead {
          padding: 14px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 10px;
          border-bottom: 1px solid #f0f0f0;
        }

        .eyebrow {
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          color: rgba(15, 23, 42, 0.6);
        }

        .cardTitle {
          font-size: 15px;
          font-weight: 950;
          color: #0f172a;
        }

        .cardMeta {
          font-size: 11px;
          color: rgba(15, 23, 42, 0.6);
          white-space: nowrap;
        }

        .frameWrap {
          padding: 10px;
        }

        .radarFrame {
          width: 100%;
          height: 700px;
          border: 0;
          border-radius: 16px;
          display: block;
          background: #f8fafc;
        }

        .subFrame {
          width: 100%;
          height: 520px;
          border: 0;
          border-radius: 16px;
          background: #f8fafc;
          display: block;
        }

        @media (max-width: 1080px) {
          .grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 768px) {
          .radarFrame {
            height: 560px;
          }

          .subFrame {
            height: 460px;
          }

          .cardMeta {
            white-space: normal;
          }
        }
      `}</style>
    </SiteLayout>
  );
}