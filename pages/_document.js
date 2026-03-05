// pages/_document.js
import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="it">
      <Head>

        {/* Viewport mobile corretto */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />

        {/* Colore barra browser mobile */}
        <meta name="theme-color" content="#0b1d2a" />

        {/* Miglior rendering font */}
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />

        {/* Ottimizzazione font */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />

        {/* Fix layout mobile globale */}
        <style>{`
          html, body {
            margin: 0;
            padding: 0;
            max-width: 100%;
            overflow-x: hidden;
            -webkit-text-size-adjust: 100%;
          }

          * {
            box-sizing: border-box;
          }

          img, video, canvas {
            max-width: 100%;
            height: auto;
          }
        `}</style>

      </Head>

      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}