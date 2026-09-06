// The embedded-font path, where kerning and ligatures actually do something: a standard-14 face has no
// GSUB and no embedded kern table, so `liga` is a no-op there and the pairs come from the AFM. Here both
// engines read the real tables out of the same .ttf, subset it, and embed it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Document, Page, Column, Paragraph, renderToBytes } from "@jasy/pdf";
import React from "react";
import {
  Document as RDoc,
  Page as RPage,
  Text as RText,
  View,
  Font,
  renderToBuffer,
} from "@react-pdf/renderer";

const TTF = new URL(
  "../../packages/e-invoice/assets/fonts/LiberationSerif-Regular.ttf",
  import.meta.url,
);
const bytes = readFileSync(TTF);

// Deliberately full of the pairs that kern and the clusters that ligate: "Wa", "To", "AV", "fi", "fl".
const TEXT =
  "Wave To AVATAR: the office finds five flags, affix the final file. " +
  "Waterfall traffic offers efficient workflow verification for offices. ";
const PARAS = 120;

// Different text per paragraph, for the same reason as in the `text` case: identical strings reward
// caching, not layout. Shuffled deterministically so both engines see exactly the same words.
const WORDS = TEXT.split(" ").filter(Boolean);
const TEXTS = Array.from({ length: PARAS }, (_, i) => {
  const out = [];
  for (let w = 0; w < 44; w++) out.push(WORDS[(i * 23 + w * 13 + (w % 5)) % WORDS.length]);
  return out.join(" ") + ".";
});

Font.register({ family: "Liberation", src: fileURLToPath(TTF) });

export const name = "typography";
export const about = `${PARAS} paragraphs in an embedded TrueType - real kerning + ligatures`;

export const jasy = () =>
  renderToBytes(
    Document({ size: 11, lineHeight: 1.1, font: "Liberation" }, [
      Page({ margin: 40 }, [
        Column(
          { gap: 6 },
          TEXTS.map((t) => Paragraph(t)),
        ),
      ]),
    ]),
    { fonts: { Liberation: new Uint8Array(bytes) } },
  );

export const reactPdf = () =>
  renderToBuffer(
    React.createElement(
      RDoc,
      null,
      React.createElement(
        RPage,
        { style: { padding: 40, fontSize: 11, lineHeight: 1.1, fontFamily: "Liberation" } },
        React.createElement(
          View,
          null,
          ...TEXTS.map((t, i) =>
            React.createElement(RText, { key: i, style: { marginBottom: 6 } }, t),
          ),
        ),
      ),
    ),
  );
