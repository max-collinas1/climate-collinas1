import { useEffect, useMemo, useState } from "react";
import SiteLayout from "../components/SiteLayout";

export default function RadarPage() {
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

    return `https://map.blitzortung.org/index.php?${params.toString()}#4.4/42.0/12.5`;
  }, []);

  const [satFrames, setSatFrames] = useState([]);
  const [satIndex, setSatIndex] = useState(0);
  const [satPlaying, setSatPlaying] = useState(true);
  const [satLoading, setSatLoading] = useState(true);
  const [satRefreshKey, setSatRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const makeTime = (date) => {
      const d = new Date(date);
      d.setUTCSeconds(0, 0);
      d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 10) * 10);
      return d;
    };

    const buildUrl = (date) => {
      const params = new URLSearchParams({
        SERVICE: "WMS",
        VERSION: "1.1.1",
        REQUEST: "GetMap",
        LAYERS: "mtg_fd:rgb_geocolour",
        STYLES: "",
        SRS: "EPSG:3857",
        BBOX: "0,4163881,2860911,6106855",
        WIDTH: "1100",
        HEIGHT: "748",
        FORMAT: "image/jpeg",
        TRANSPARENT: "FALSE",
        TIME: date.toISOString(),
      });
      return `https://view.eumetsat.int/geoserver/wms?${params.toString()}`;
    };

    const loadImageFrame = (time) => {
      const frame = { time, url: buildUrl(time) };

      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(frame);
        img.onerror = () => resolve(null);
        img.src = frame.url;
      });
    };

    const loadFrames = async () => {
      setSatLoading(true);

      const currentSlot = makeTime(Date.now());
      let latestAvailable = null;

      for (let step = 0; step < 12; step += 1) {
        const time = new Date(currentSlot.getTime() - step * 10 * 60 * 1000);
        const frame = await loadImageFrame(time);

        if (cancelled) return;

        if (frame) {
          latestAvailable = frame.time;
          break;
        }
      }

      if (!latestAvailable) {
        if (!cancelled) {
          setSatFrames([]);
          setSatIndex(0);
          setSatLoading(false);
        }
        return;
      }

      const candidates = Array.from({ length: 12 }, (_, i) => {
        const time = new Date(latestAvailable.getTime() - (11 - i) * 10 * 60 * 1000);
        return time;
      });

      const loaded = await Promise.all(candidates.map((time) => loadImageFrame(time)));

      if (cancelled) return;

      const valid = loaded.filter(Boolean);
      setSatFrames(valid);
      setSatIndex(valid.length ? valid.length - 1 : 0);
      setSatLoading(false);
    };

    loadFrames();
    return () => {
      cancelled = true;
    };
  }, [satRefreshKey]);

  useEffect(() => {
    if (!satPlaying || satFrames.length < 2) return undefined;
    const timer = window.setInterval(() => {
      setSatIndex((current) => (current + 1) % satFrames.length);
    }, 450);
    return () => window.clearInterval(timer);
  }, [satPlaying, satFrames.length]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSatRefreshKey((v) => v + 1);
    }, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        setSatRefreshKey((v) => v + 1);
      }
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);

    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, []);

  const satFrame = satFrames[satIndex] || null;

  const arpasLinks = [
    {
      title: "Rete stazioni ARPAS",
      text: "Misure e clima nei punti stazione della rete regionale.",
      href: "https://www.sar.sardegna.it/servizi/dati/datistazioni.asp",
      icon: "◉",
    },
    {
      title: "Ultimi 7 giorni",
      text: "Dati meteorologici giornalieri più recenti della rete ARPAS.",
      href: "https://dati-annuali-rete-arpas-2021-arpas.hub.arcgis.com/apps/dati-meteo-sardegna-ultimi-7-giorni/explore",
      icon: "▥",
    },
    {
      title: "Temperature minime",
      text: "Minime della notte rilevate dalle stazioni ufficiali.",
      href: "https://www.sar.sardegna.it/servizi/dati/minoggi.asp",
      icon: "↓",
    },
    {
      title: "Temperature massime",
      text: "Massime giornaliere rilevate dalle stazioni ufficiali.",
      href: "https://www.sar.sardegna.it/servizi/dati/maxoggi.asp",
      icon: "↑",
    },
  ];

  return (
    <SiteLayout
      headerProps={{
        title: "Condizioni attuali",
        kicker: "MONITORAGGIO METEO",
        subtitle: (
          <span className="currentHeroSubtitle">
            Questa pagina permette di seguire in tempo reale l’evoluzione delle
            precipitazioni, della copertura nuvolosa e dell’attività elettrica
            sulla Sardegna e sull’Italia. Il radar Windy, basato sui dati della
            Protezione Civile, consente di monitorare piogge e nuclei
            temporaleschi in atto; è possibile andare più nel dettaglio
            aumentando lo zoom sulla zona di interesse. Anche la mappa delle
            fulminazioni può essere esplorata nello stesso modo, così da seguire
            con maggiore precisione la distribuzione dei fulmini e l’evoluzione
            dei temporali.
          </span>
        ),
        currentPath: "/condizioni-attuali",
        showPeriod: false,
      }}
    >
      <section className="section firstSection">
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
            <div className="cardHeadText">
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
              Monitoraggio quasi in tempo reale della copertura nuvolosa e
              dell’attività elettrica sull’Europa e sull’Italia.
            </div>
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <div className="cardHead">
              <div className="cardHeadText">
                <div className="eyebrow">EUMETSAT</div>
                <div className="cardTitle">Meteosat-12 · Italia</div>
              </div>
              <div className="cardMeta">Near realtime</div>
            </div>

            <div className="frameWrap">
              <div className="satViewer">
                {satFrame ? (
                  <img
                    key={satFrame.url}
                    src={satFrame.url}
                    alt="Animazione Meteosat-12 GeoColour centrata sull’Italia"
                    className="satImage"
                  />
                ) : (
                  <div className="satFallback">
                    {satLoading ? "Caricamento immagini EUMETSAT…" : "Animazione EUMETSAT momentaneamente non disponibile."}
                  </div>
                )}

                {satFrame ? (
                  <div className="satTimestamp">
                    {satFrame.time.toLocaleString("it-IT", {
                      timeZone: "Europe/Rome",
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                ) : null}

                <div className="satControls">
                  <button
                    type="button"
                    onClick={() => setSatPlaying((v) => !v)}
                    disabled={satFrames.length < 2}
                  >
                    {satPlaying ? "Pausa" : "Play"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSatPlaying(false);
                      setSatIndex(Math.max(0, satFrames.length - 1));
                    }}
                    disabled={!satFrames.length}
                  >
                    Ultima immagine
                  </button>
                  <button type="button" onClick={() => setSatRefreshKey((v) => v + 1)}>
                    Aggiorna
                  </button>
                </div>
              </div>

              <div className="satCredit">GeoColour RGB Meteosat-12 · © EUMETSAT / NASA</div>

              <div className="frameFoot">
                <a
                  href="https://view.eumetsat.int/productviewer/productDetails/mtg_fd%3Argb_geocolour?v=default"
                  target="_blank"
                  rel="noreferrer"
                >
                  Apri EUMETView ↗
                </a>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="cardHead">
              <div className="cardHeadText">
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

      <section className="section arpasSection">
        <div className="sectionHead compact">
          <div className="sectionText">
            <h2>Osservazioni ufficiali Sardegna</h2>
            <div className="hint">
              Accesso rapido ai dati della rete ARPAS senza duplicare o
              replicare le osservazioni all’interno del sito.
            </div>
          </div>
        </div>

        <div className="arpasGrid">
          {arpasLinks.map((item) => (
            <a
              key={item.title}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              className="arpasCard"
            >
              <div className="arpasIcon" aria-hidden="true">{item.icon}</div>
              <div className="arpasText">
                <div className="arpasEyebrow">ARPAS</div>
                <div className="arpasTitle">{item.title}</div>
                <div className="arpasDescription">{item.text}</div>
              </div>
              <div className="arpasArrow" aria-hidden="true">↗</div>
            </a>
          ))}
        </div>
      </section>

      <style jsx>{`
        :global(.currentHeroSubtitle) {
          display: block;
          width: 100%;
          max-width: none;
          box-sizing: border-box;
          text-align: justify;
          text-align-last: left;
          hyphens: auto;
          -webkit-hyphens: auto;
          overflow-wrap: break-word;
        }

        .section {
          margin: 18px auto 0;
        }

        .firstSection {
          margin-top: 22px;
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
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 10px;
          border-bottom: 1px solid #f0f0f0;
          text-align: center;
        }

        .cardHeadText {
          grid-column: 2;
          text-align: center;
        }

        .eyebrow {
          font-size: 11px;
          font-weight: 900;
          text-transform: uppercase;
          color: rgba(15, 23, 42, 0.6);
          text-align: center;
        }

        .cardTitle {
          font-size: 15px;
          font-weight: 950;
          color: #0f172a;
          text-align: center;
        }

        .cardMeta {
          grid-column: 3;
          justify-self: end;
          font-size: 11px;
          color: rgba(15, 23, 42, 0.6);
          white-space: nowrap;
          text-align: center;
        }

        .frameWrap {
          padding: 10px;
        }

        .satViewer {
          position: relative;
          width: 100%;
          height: 520px;
          border-radius: 16px;
          overflow: hidden;
          background: #0b1220;
        }

        .satImage {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .satFallback {
          width: 100%;
          height: 100%;
          min-height: 360px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          box-sizing: border-box;
          color: #e2e8f0;
          font-size: 13px;
          font-weight: 800;
          text-align: center;
        }

        .satTimestamp {
          position: absolute;
          left: 12px;
          bottom: 12px;
          padding: 6px 9px;
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.76);
          color: #fff;
          font-size: 10px;
          font-weight: 900;
          backdrop-filter: blur(8px);
        }

        .satControls {
          position: absolute;
          right: 12px;
          bottom: 12px;
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .satControls button {
          min-height: 32px;
          padding: 0 10px;
          border: 1px solid rgba(255, 255, 255, 0.22);
          border-radius: 999px;
          background: rgba(15, 23, 42, 0.78);
          color: #fff;
          font-size: 10px;
          font-weight: 850;
          cursor: pointer;
          backdrop-filter: blur(8px);
        }

        .satControls button:disabled {
          opacity: 0.45;
          cursor: default;
        }

        .satCredit {
          margin-top: 7px;
          color: #64748b;
          font-size: 9px;
          font-weight: 750;
          text-align: center;
        }

        .frameFoot {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          flex-wrap: wrap;
          padding: 9px 4px 2px;
        }

        .frameFoot a {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 34px;
          padding: 0 12px;
          border: 1px solid #e2e8f0;
          border-radius: 999px;
          background: #fff;
          color: #334155;
          font-size: 11px;
          font-weight: 850;
          text-decoration: none;
          transition: background 130ms ease, border-color 130ms ease, transform 130ms ease;
        }

        .frameFoot a:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
          transform: translateY(-1px);
        }

        .arpasSection {
          margin-bottom: 10px;
        }

        .arpasGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }

        .arpasCard {
          position: relative;
          display: grid;
          grid-template-columns: 38px minmax(0, 1fr) 22px;
          align-items: center;
          gap: 10px;
          min-height: 112px;
          padding: 14px;
          border: 1px solid #e2e8f0;
          border-radius: 16px;
          background: #fff;
          color: #0f172a;
          text-decoration: none;
          box-shadow: 0 8px 22px rgba(15, 23, 42, 0.045);
          transition: transform 130ms ease, box-shadow 130ms ease, border-color 130ms ease;
        }

        .arpasCard:hover {
          transform: translateY(-2px);
          border-color: #cbd5e1;
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.075);
        }

        .arpasIcon {
          width: 38px;
          height: 38px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 12px;
          background: #eff6ff;
          color: #0369a1;
          font-size: 18px;
          font-weight: 950;
        }

        .arpasText {
          min-width: 0;
        }

        .arpasEyebrow {
          margin-bottom: 2px;
          color: #0369a1;
          font-size: 9px;
          font-weight: 950;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }

        .arpasTitle {
          color: #0f172a;
          font-size: 13px;
          line-height: 1.2;
          font-weight: 950;
        }

        .arpasDescription {
          margin-top: 4px;
          color: #64748b;
          font-size: 10px;
          line-height: 1.35;
          font-weight: 650;
        }

        .arpasArrow {
          justify-self: end;
          color: #94a3b8;
          font-size: 16px;
          font-weight: 900;
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

          .arpasGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 768px) {
          :global(.currentHeroSubtitle) {
            width: 100%;
            max-width: none;
            text-align: justify;
            text-align-last: left;
            line-height: 1.5;
          }

          .firstSection {
            margin-top: 18px;
          }

          .section {
            margin-top: 14px;
          }

          .sectionHead {
            margin: 12px 0 8px;
          }

          .radarFrame {
            height: 560px;
          }

          .subFrame {
            height: 460px;
          }

          .cardHead {
            padding: 11px 12px;
          }

          .cardMeta {
            white-space: normal;
          }

          .satViewer {
            height: 460px;
          }

          .satFallback {
            min-height: 300px;
          }

          .satTimestamp {
            left: 8px;
            bottom: 8px;
            font-size: 9px;
          }

          .satControls {
            right: 8px;
            bottom: 8px;
            gap: 5px;
          }

          .satControls button {
            min-height: 30px;
            padding: 0 8px;
            font-size: 9px;
          }

          .frameFoot {
            gap: 7px;
            padding-top: 8px;
          }

          .frameFoot a {
            flex: 1 1 150px;
            min-height: 32px;
            padding: 0 10px;
            font-size: 10px;
          }

          .arpasGrid {
            grid-template-columns: 1fr;
            gap: 8px;
          }

          .arpasCard {
            min-height: 0;
            padding: 11px 12px;
            grid-template-columns: 34px minmax(0, 1fr) 20px;
            gap: 9px;
          }

          .arpasIcon {
            width: 34px;
            height: 34px;
            border-radius: 10px;
            font-size: 16px;
          }

          .arpasTitle {
            font-size: 12px;
          }

          .arpasDescription {
            font-size: 10px;
            line-height: 1.3;
          }
        }
      `}</style>
    </SiteLayout>
  );
}