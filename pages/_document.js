// pages/_document.js
import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="it">
      <Head>
        {/* Forza rendering “desktop” anche su mobile */}
        <meta
          name="viewport"
          content="width=1200, initial-scale=0.33, maximum-scale=1.0, user-scalable=yes"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}