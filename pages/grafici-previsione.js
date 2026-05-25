// pages/grafici-previsione.js
import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import SiteLayout from "../components/SiteLayout";
import SiteHeader from "../components/SiteHeader";

const GEOID_COLLINAS = "70206";
const IMAGE_BASE_URL = "https://www.wetterzentrale.de/en/ens_image.php";

const PARAMETERS = [
  {
    id: "t850-prec",
    varCode: "201",
    label: "Temperatura 850 hPa e precipitazioni",
  },
  {
    id: "t2m-prec",
    varCode: "202",
    label: "Temperatura a 2 m e precipitazioni",
  },
  {
    id: "snow",
    varCode: "203",
    label: "Neve",
  },
  {
    id: "dewpoint",
    varCode: "205",
    label: "Punto di rugiada a 2 m",
  },
  {
    id: "wind",
    varCode: "206",
    label: "Vento a 10 m",
  },
];

const ENSEMBLE_MODELS = [
  {
    id: "gfs",
    wzModel: "gfs",
    name: "GFS",
    supportedVarCodes: ["201", "202", "203", "205", "206"],
    supportedRuns: ["00", "06", "12", "18"],
  },
  {
    id: "gem",
    wzModel: "gem",
    name: "GEM",
    supportedVarCodes: ["201", "202", "203", "205", "206"],
    supportedRuns: ["00", "12"],
  },
  {
    id: "icon",
    wzModel: "ico",
    name: "ICON",
    supportedVarCodes: ["202", "205", "206"],
    supportedRuns: ["00", "06", "12", "18"],
  },
  {
    id: "ecmwf",
    wzModel: "ecm",
    name: "ECMWF",
    supportedVarCodes: ["201", "202", "206"],
    supportedRuns: ["00", "06", "12", "18"],
  },
  {
    id: "aifs",
    wzModel: "aifs",
    name: "AIFS ECMWF",
    supportedVarCodes: ["201", "202"],
    supportedRuns: ["00", "06", "12", "18"],
  },
];

const RUN_OPTIONS = ["00", "06", "12", "18"];

function pad2(v) {
  return String(v).padStart(2, "0");
}

function formatUTCDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate()
  )}`;
}

function getLatestSuggestedRunInfo() {
  const now = new Date();
  const adjusted = new Date(now.getTime() - 5 * 60 * 60 * 1000);
  const hour = adjusted.getUTCHours();
  const flooredRun = Math.floor(hour / 6) * 6;

  return {
    run: pad2(flooredRun),
    date: formatUTCDate(adjusted),
  };
}

function buildEnsImageUrl({ model, varCode, run, date }) {
  const params = new URLSearchParams({
    geoid: GEOID_COLLINAS,
    var: String(varCode),
    run: String(Number(run)),
    date,
    model,
    member: "ENS",
    bw: "1",
  });

  return `${IMAGE_BASE_URL}?${params.toString()}`;
}

export default function GraficiPrevisionePage() {
  const suggestedRunInfo = useMemo(() => getLatestSuggestedRunInfo(), []);

  const [activeModelId, setActiveModelId] = useState(ENSEMBLE_MODELS[0].id);
  const [activeParamId, setActiveParamId] = useState(PARAMETERS[0].id);
  const [activeRun, setActiveRun] = useState(suggestedRunInfo.run);
  const [imgError, setImgError] = useState(false);

  const activeModel = useMemo(
    () =>
      ENSEMBLE_MODELS.find((model) => model.id === activeModelId) ||
      ENSEMBLE_MODELS[0],
    [activeModelId]
  );

  const availableParams = useMemo(() => {
    return PARAMETERS.filter((p) =>
      activeModel.supportedVarCodes.includes(p.varCode)
    );
  }, [activeModel]);

  useEffect(() => {
    const currentParam = PARAMETERS.find((p) => p.id === activeParamId);
    const isSupported = currentParam
      ? activeModel.supportedVarCodes.includes(currentParam.varCode)
      : false;

    if (!isSupported && availableParams.length) {
      setActiveParamId(availableParams[0].id);
    }
  }, [activeModel, activeParamId, availableParams]);

  useEffect(() => {
    if (!activeModel.supportedRuns.includes(activeRun)) {
      const fallbackRun = activeModel.supportedRuns.includes(suggestedRunInfo.run)
        ? suggestedRunInfo.run
        : activeModel.supportedRuns[0];
      setActiveRun(fallbackRun);
    }
  }, [activeModel, activeRun, suggestedRunInfo.run]);

  const activeParam = useMemo(
    () => PARAMETERS.find((p) => p.id === activeParamId) || PARAMETERS[0],
    [activeParamId]
  );

  const imageUrl = useMemo(() => {
    return buildEnsImageUrl({
      model: activeModel.wzModel,
      varCode: activeParam.varCode,
      run: activeRun,
      date: suggestedRunInfo.date,
    });
  }, [activeModel, activeParam, activeRun, suggestedRunInfo.date]);

  useEffect(() => {
    setImgError(false);
  }, [imageUrl]);

  return (
    <SiteLayout>
      <Head>
        <title>Grafici di previsione | Meteo Collinas</title>
        <meta
          name="description"
          content="Grafici di previsione ensemble di Wetterzentrale per Collinas con selezione di modello, parametro e orario di corsa."
        />
      </Head>

      <SiteHeader
        kicker="PREVISIONE"
        title="Grafici di previsione"
        subtitle='Grafici "spaghetti" ensemble per Collinas'
      />

      <main className="forecastPage">
        <section
          className="pageDescription"
          aria-label="Descrizione grafici di previsione"
        >
          <div className="descriptionCard">
            <p>
              Questa pagina permette di consultare i grafici ensemble di
              previsione per Collinas, utili per valutare non solo la tendenza
              prevista, ma anche il grado di incertezza tra i diversi scenari
              modellistici. Puoi scegliere il modello di previsione, il
              parametro da visualizzare e l’orario di corsa disponibile. Il
              grafico si aggiorna automaticamente in base alla combinazione
              selezionata e mostra l’andamento previsto di temperatura,
              precipitazioni, neve, punto di rugiada o vento. Le linee
              ravvicinate indicano una previsione più stabile e concorde, mentre
              una maggiore apertura tra gli scenari segnala un aumento
              dell’incertezza previsionale.
            </p>
          </div>
        </section>

        <section className="selectorsBox">
          <div className="selectorGroup">
            <div className="selectorLabel">Seleziona modello</div>
            <div className="selectorButtons">
              {ENSEMBLE_MODELS.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => setActiveModelId(model.id)}
                  className={model.id === activeModel.id ? "mBtn mBtnOn" : "mBtn"}
                >
                  {model.name}
                </button>
              ))}
            </div>
          </div>

          <div className="selectorGroup">
            <div className="selectorLabel">Seleziona parametro</div>
            <div className="selectorButtons">
              {PARAMETERS.map((parameter) => {
                const disabled = !activeModel.supportedVarCodes.includes(
                  parameter.varCode
                );

                let cls = "mBtn";
                if (parameter.id === activeParam.id && !disabled) cls += " mBtnOn";
                if (disabled) cls += " mBtnDisabled";

                return (
                  <button
                    key={parameter.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled) setActiveParamId(parameter.id);
                    }}
                    className={cls}
                    title={
                      disabled
                        ? "Parametro non disponibile per questo modello"
                        : parameter.label
                    }
                  >
                    {parameter.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="selectorGroup">
            <div className="selectorLabel">Orario corsa modello</div>
            <div className="selectorButtons">
              {RUN_OPTIONS.map((run) => {
                const disabled = !activeModel.supportedRuns.includes(run);

                let cls = "mBtn";
                if (run === suggestedRunInfo.run && !disabled) cls += " mBtnLatest";
                if (run === activeRun && !disabled) cls += " mBtnOn";
                if (
                  run === suggestedRunInfo.run &&
                  run === activeRun &&
                  !disabled
                ) {
                  cls += " mBtnLatestOn";
                }
                if (disabled) cls += " mBtnDisabled";

                return (
                  <button
                    key={run}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (!disabled) setActiveRun(run);
                    }}
                    className={cls}
                    title={
                      disabled
                        ? `Run ${run}Z non disponibile per ${activeModel.name}`
                        : run === suggestedRunInfo.run
                        ? "Ultima uscita modellistica suggerita"
                        : `Run ${run}Z`
                    }
                  >
                    {run}Z
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="viewerSection">
          <div className="viewerHeader">
            <span className="viewerEyebrow">Grafico attivo</span>
            <h2>
              {activeModel.name} · {activeParam.label} · {activeRun}Z
            </h2>
          </div>

          <div className="viewerBox">
            {!imgError ? (
              <img
                key={imageUrl}
                src={imageUrl}
                alt={`${activeModel.name} ${activeParam.label} Collinas`}
                loading="lazy"
                width="850"
                height="620"
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="errorBox">
                <h3>Grafico non disponibile</h3>
                <p>
                  Per questa combinazione il grafico non è stato caricato. Prova
                  un altro parametro, un altro modello oppure un altro orario di
                  corsa.
                </p>
              </div>
            )}
          </div>

          <p className="viewerNote">Fonte: Wetterzentrale.</p>
        </section>

        <section className="cardsSection">
          <div className="sectionTop">
            <h2>Come leggere i grafici di previsione</h2>
            <p>
              Se le linee restano vicine, la previsione è più affidabile. Se si
              allargano molto, aumenta l&apos;incertezza. La media ensemble
              mostra la tendenza generale.
            </p>
            <Link href="/guida-ensemble" className="guideLink">
              Clicca qui per maggiori informazioni
            </Link>
          </div>
        </section>
      </main>

      <style jsx>{`
        .forecastPage {
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          padding: 22px 14px 40px;
        }

        .pageDescription {
          width: 100%;
          margin: 0 0 18px;
        }

        .descriptionCard {
          width: 100%;
          box-sizing: border-box;
          margin: 0 auto;
          padding: 18px 24px;
          border: 1px solid #dfe5ec;
          border-radius: 18px;
          background: rgba(248, 250, 252, 0.92);
          box-shadow: 0 10px 28px rgba(15, 23, 42, 0.05);
        }

        .descriptionCard p {
          margin: 0;
          font-size: 14px;
          line-height: 1.75;
          font-weight: 800;
          color: #334155;
          text-align: justify;
          text-align-last: left;
          hyphens: auto;
          -webkit-hyphens: auto;
          overflow-wrap: break-word;
        }

        .selectorsBox,
        .viewerSection,
        .cardsSection {
          background: #fff;
          border: 1px solid #ececec;
          border-radius: 18px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02),
            0 12px 34px rgba(0, 0, 0, 0.04);
          padding: 18px;
          margin-bottom: 18px;
        }

        .selectorGroup + .selectorGroup {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid #efefef;
        }

        .selectorLabel {
          font-weight: 950;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-size: 12px;
          opacity: 0.8;
          text-align: center;
          margin-bottom: 10px;
        }

        .selectorButtons {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 10px;
          width: 100%;
        }

        .mBtn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 8px 12px;
          border-radius: 12px;
          border: 1px solid #ededed;
          background: #fff;
          color: #111;
          font-weight: 950;
          font-size: 14px;
          cursor: pointer;
          transition: background 120ms ease, transform 120ms ease,
            box-shadow 120ms ease, border-color 120ms ease,
            color 120ms ease, opacity 120ms ease;
        }

        .mBtn:hover:not(:disabled) {
          background: #f4f4f4;
          transform: translateY(-1px);
          box-shadow: 0 8px 20px rgba(0, 0, 0, 0.06);
        }

        .mBtnOn {
          background: #111;
          color: #fff;
          border-color: #111;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.1);
        }

        .mBtnLatest {
          border-color: #bde3c4;
          background: #f4fcf6;
          color: #176b34;
        }

        .mBtnLatest:hover:not(:disabled) {
          background: #edf9f0;
        }

        .mBtnLatestOn {
          background: #17803d;
          color: #fff;
          border-color: #17803d;
          box-shadow: 0 10px 24px rgba(23, 128, 61, 0.2);
        }

        .mBtnDisabled,
        .mBtn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          background: #f8fafc;
          color: #111;
          box-shadow: none;
          transform: none;
        }

        .viewerHeader {
          margin-bottom: 14px;
          text-align: center;
        }

        .viewerEyebrow {
          display: inline-block;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #2563eb;
          margin-bottom: 8px;
        }

        .viewerHeader h2 {
          font-size: 24px;
          line-height: 1.25;
        }

        .viewerBox {
          width: 100%;
          border-radius: 16px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          background: #ffffff;
          padding: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: auto;
        }

        .viewerBox img {
          width: 850px;
          max-width: 100%;
          height: auto;
          display: block;
          background: #ffffff;
        }

        .errorBox {
          width: 100%;
          padding: 28px 20px;
          text-align: center;
        }

        .errorBox h3 {
          font-size: 18px;
          margin-bottom: 8px;
        }

        .errorBox p {
          font-size: 14px;
          line-height: 1.6;
          color: #475569;
        }

        .viewerNote {
          margin-top: 10px;
          font-size: 13px;
          line-height: 1.5;
          color: #64748b;
        }

        .sectionTop {
          margin-bottom: 0;
          text-align: center;
        }

        .sectionTop h2 {
          font-size: 22px;
          margin-bottom: 6px;
        }

        .sectionTop p {
          color: #64748b;
          font-size: 14px;
          line-height: 1.6;
          max-width: 820px;
          margin: 0 auto;
        }

        .guideLink {
          display: inline-block;
          margin-top: 10px;
          font-size: 14px;
          font-weight: 800;
          color: #111;
          text-decoration: underline;
        }

        .guideLink:hover {
          color: #17803d;
        }

        .infoGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .infoCard {
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          background: #fff;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02),
            0 12px 34px rgba(0, 0, 0, 0.04);
          padding: 16px;
        }

        .infoCard h3 {
          font-size: 16px;
          margin-bottom: 8px;
          line-height: 1.3;
        }

        .infoCard p {
          font-size: 14px;
          line-height: 1.55;
          color: #475569;
        }

        @media (max-width: 1100px) {
          .infoGrid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 640px) {
          .forecastPage {
            padding: 16px 10px 32px;
          }

          .pageDescription {
            margin: 0 0 16px;
          }

          .descriptionCard {
            padding: 16px 18px;
            border-radius: 18px;
          }

          .descriptionCard p {
            font-size: 14px;
            line-height: 1.75;
            font-weight: 800;
            text-align: justify;
            text-align-last: left;
          }

          .viewerHeader h2,
          .sectionTop h2 {
            font-size: 20px;
          }

          .selectorButtons {
            gap: 8px;
          }

          .mBtn {
            width: 100%;
          }

          .infoGrid {
            grid-template-columns: 1fr;
          }

          .viewerBox {
            padding: 10px;
          }
        }
      `}</style>
    </SiteLayout>
  );
}