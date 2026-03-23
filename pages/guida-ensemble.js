// pages/guida-ensemble.js
import Head from "next/head";
import SiteLayout from "../components/SiteLayout";
import SiteHeader from "../components/SiteHeader";

export default function GuidaEnsemblePage() {
  return (
    <SiteLayout>
      <Head>
        <title>Guida ai grafici ensemble | Meteo Collinas</title>
        <meta
          name="description"
          content="Spiegazione semplice dei grafici ensemble e di come leggere la dispersione dei membri del modello."
        />
      </Head>

      <SiteHeader
        kicker="PREVISIONE"
        title="Guida ai grafici Ensemble"
        subtitle="Come leggere in modo semplice i grafici di previsione"
      />

      <main className="guidePage">
        <section className="introBox">
          <h2 className="introTitle">Cosa sono i grafici ensemble</h2>
          <p>
            I grafici ensemble non mostrano una sola previsione, ma tante
            simulazioni dello stesso modello. Ogni linea rappresenta uno
            scenario possibile. Questo serve a capire non solo la tendenza, ma
            anche quanto la previsione sia affidabile oppure ancora incerta.
          </p>
          <p>
            In pratica: se molte linee restano vicine, il modello è più convinto
            della previsione. Se invece si allargano molto, significa che gli
            scenari possibili sono diversi e quindi l&apos;affidabilità cala.
          </p>
        </section>

        <section className="imageSection">
          <div className="sectionTop">
            <h2>Esempio di grafico ensemble</h2>
            <p>
              Nell&apos;immagine qui sotto sono evidenziati i punti principali da
              osservare.
            </p>
          </div>

          <div className="imageCard">
            <img
              src="/images/guida-ensemble-collinas.png"
              alt="Grafico ensemble annotato per spiegare membri, media climatica, media dei membri e dispersione"
            />
          </div>
        </section>

        <section className="explainSection">
          <div className="sectionTop">
            <h2>Cosa guardare per prima cosa</h2>
          </div>

          <div className="infoGrid">
            <article className="infoCard">
              <h3>Membri del modello</h3>
              <p>
                Le tante linee colorate rappresentano i diversi scenari
                possibili. In alto si leggono le temperature previste, in basso
                i segnali di precipitazione.
              </p>
            </article>

            <article className="infoCard">
              <h3>Media dei membri</h3>
              <p>
                È la linea che riassume l&apos;insieme degli scenari. È utile per
                capire la tendenza generale della previsione.
              </p>
            </article>

            <article className="infoCard">
              <h3>Media termica 1991-2020</h3>
              <p>
                La linea rossa già presente nel grafico rappresenta il confronto
                con il clima medio. Serve a capire se la massa d&apos;aria prevista
                è sopra o sotto la norma.
              </p>
            </article>

            <article className="infoCard">
              <h3>Dispersione dei membri</h3>
              <p>
                È l&apos;elemento più importante per valutare l&apos;affidabilità.
                Più le linee si allargano, più la previsione diventa incerta.
              </p>
            </article>
          </div>
        </section>

        <section className="levelsSection">
          <div className="sectionTop">
            <h2>I 3 livelli di dispersione</h2>
            <p>
              Nell&apos;immagine hai evidenziato tre fasi diverse. Sono molto utili
              per capire a colpo d&apos;occhio il livello di accuratezza della
              previsione.
            </p>
          </div>

          <div className="levelsGrid">
            <article className="levelCard levelGood">
              <div className="levelBadge">1</div>
              <h3>Dispersione bassa</h3>
              <p>
                Le linee restano molto vicine tra loro. In questa fase la
                previsione è generalmente più affidabile, perché i vari scenari
                del modello sono simili.
              </p>
              <span className="levelNote">Accuratezza più alta</span>
            </article>

            <article className="levelCard levelMedium">
              <div className="levelBadge">2</div>
              <h3>Dispersione media</h3>
              <p>
                Le linee iniziano ad allargarsi. La previsione mantiene una
                tendenza leggibile, ma aumenta l&apos;incertezza e bisogna essere
                più prudenti.
              </p>
              <span className="levelNote">Accuratezza intermedia</span>
            </article>

            <article className="levelCard levelLow">
              <div className="levelBadge">3</div>
              <h3>Dispersione alta</h3>
              <p>
                Le linee si aprono molto e gli scenari diventano numerosi. In
                questa fase il dettaglio perde valore e il grafico va letto solo
                come tendenza generale.
              </p>
              <span className="levelNote">Accuratezza più bassa</span>
            </article>
          </div>
        </section>

        <section className="quickReadSection">
          <div className="sectionTop">
            <h2>Come leggerlo velocemente</h2>
          </div>

          <div className="quickList">
            <div className="quickItem">
              <strong>Linee molto compatte</strong>
              <span>previsione più stabile e in genere più affidabile</span>
            </div>

            <div className="quickItem">
              <strong>Linee che si aprono gradualmente</strong>
              <span>tendenza ancora utile, ma con affidabilità in calo</span>
            </div>

            <div className="quickItem">
              <strong>Linee molto disperse</strong>
              <span>previsione da leggere solo come orientamento generale</span>
            </div>

            <div className="quickItem">
              <strong>Media sopra la linea climatica</strong>
              <span>scenario mediamente più caldo della norma</span>
            </div>

            <div className="quickItem">
              <strong>Media sotto la linea climatica</strong>
              <span>scenario mediamente più fresco della norma</span>
            </div>

            <div className="quickItem">
              <strong>Molti picchi precipitativi su più membri</strong>
              <span>segnale di pioggia più credibile</span>
            </div>
          </div>
        </section>

        <section className="finalBox">
          <h2>La regola più utile</h2>
          <p>
            Nei grafici ensemble non conta inseguire la singola linea più
            estrema. Conta capire se il gruppo dei membri va nella stessa
            direzione oppure no. Più il gruppo è compatto, più il segnale è
            solido. Più si disperde, più serve prudenza.
          </p>
        </section>
      </main>

      <style jsx>{`
        .guidePage {
          width: 100%;
          max-width: 1280px;
          margin: 0 auto;
          padding: 22px 14px 40px;
        }

        .introBox,
        .imageSection,
        .explainSection,
        .levelsSection,
        .quickReadSection,
        .finalBox {
          background: #fff;
          border: 1px solid #ececec;
          border-radius: 18px;
          box-shadow: 0 1px 0 rgba(0, 0, 0, 0.02),
            0 12px 34px rgba(0, 0, 0, 0.04);
          padding: 18px;
          margin-bottom: 18px;
        }

        .introBox {
          text-align: center;
        }

        .sectionTop {
          text-align: center;
          margin-bottom: 16px;
        }

        .sectionTop h2,
        .introTitle,
        .finalBox h2 {
          font-size: 26px;
          margin-bottom: 8px;
        }

        .sectionTop p,
        .introBox p,
        .finalBox p {
          font-size: 15px;
          line-height: 1.7;
          color: #475569;
          max-width: 920px;
          margin-left: auto;
          margin-right: auto;
        }

        .introTitle {
          text-align: center;
        }

        .introBox p {
          max-width: 820px;
        }

        .introBox p + p {
          margin-top: 10px;
        }

        .imageCard {
          display: flex;
          justify-content: center;
          align-items: center;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 16px;
          background: #ffffff;
          padding: 16px;
          overflow: auto;
        }

        .imageCard img {
          width: 100%;
          max-width: 1100px;
          height: auto;
          display: block;
          border-radius: 10px;
        }

        .infoGrid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .infoCard {
          border: 1px solid #e7e7e7;
          border-radius: 16px;
          background: #fff;
          padding: 16px;
        }

        .infoCard h3 {
          font-size: 18px;
          margin-bottom: 8px;
          line-height: 1.3;
        }

        .infoCard p {
          font-size: 14px;
          line-height: 1.6;
          color: #475569;
        }

        .levelsGrid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
        }

        .levelCard {
          position: relative;
          border-radius: 18px;
          padding: 18px 16px 16px;
          border: 1px solid #e7e7e7;
          background: #fff;
        }

        .levelGood {
          background: linear-gradient(180deg, #f3fbf5 0%, #ffffff 100%);
          border-color: #cce8d5;
        }

        .levelMedium {
          background: linear-gradient(180deg, #fffaf0 0%, #ffffff 100%);
          border-color: #f2dfb3;
        }

        .levelLow {
          background: linear-gradient(180deg, #fff4f4 0%, #ffffff 100%);
          border-color: #efc5c5;
        }

        .levelBadge {
          width: 42px;
          height: 42px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 900;
          margin-bottom: 12px;
          background: #111;
          color: #fff;
        }

        .levelCard h3 {
          font-size: 18px;
          margin-bottom: 8px;
        }

        .levelCard p {
          font-size: 14px;
          line-height: 1.6;
          color: #475569;
          margin-bottom: 12px;
        }

        .levelNote {
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          padding: 0 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          background: #111;
          color: #fff;
        }

        .quickList {
          display: grid;
          gap: 10px;
        }

        .quickItem {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          align-items: center;
          border: 1px solid #ececec;
          border-radius: 14px;
          background: #fafafa;
          padding: 14px 16px;
        }

        .quickItem strong {
          font-size: 15px;
          color: #0f172a;
        }

        .quickItem span {
          font-size: 14px;
          color: #475569;
          text-align: right;
        }

        @media (max-width: 1100px) {
          .levelsGrid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 860px) {
          .infoGrid {
            grid-template-columns: 1fr;
          }

          .quickItem {
            flex-direction: column;
            align-items: flex-start;
          }

          .quickItem span {
            text-align: left;
          }
        }

        @media (max-width: 640px) {
          .guidePage {
            padding: 16px 10px 32px;
          }

          .sectionTop h2,
          .introTitle,
          .finalBox h2 {
            font-size: 22px;
          }

          .imageCard {
            padding: 10px;
          }
        }
      `}</style>
    </SiteLayout>
  );
}