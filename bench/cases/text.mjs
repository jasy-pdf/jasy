// Flowing text over many pages: the layout engine and the pagination path, nothing else.
//
// PINNED so both engines lay out the SAME document - the two settings that made an earlier comparison
// worthless because one side produced 37 pages and the other 33:
//   margin 40   - react-pdf spells it `padding`, we spell it `margin`; the default differs.
//   lineHeight  - our default line box is the font's natural height (Helvetica 1.156 em),
//                 react-pdf's is `ascent - descent` = 1.10 em. Pin both to 1.1.
import { Document, Page, Column, Paragraph, renderToBytes } from "@jasy/pdf";
import React from "react";
import {
  Document as RDoc,
  Page as RPage,
  Text as RText,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

const LOREM =
  "Lorem ipsum dolor sit amet, consetetur sadipscing elitr, sed diam nonumy eirmod tempor " +
  "invidunt ut labore et dolore magna aliquyam erat, sed diam voluptua. At vero eos et accusam. ";
const PARAS = 180;

// Every paragraph is DIFFERENT. With 180 copies of one string, any engine that caches a measured run
// wins the benchmark and not the real workload - a document's paragraphs are never identical. The
// words are shuffled deterministically, so both engines get the same text and a re-run is comparable.
const WORDS = LOREM.split(" ").filter(Boolean);
const paragraph = (i) => {
  const out = [];
  for (let w = 0; w < 60; w++) out.push(WORDS[(i * 31 + w * 17 + (w % 7)) % WORDS.length]);
  return out.join(" ") + ".";
};
const TEXTS = Array.from({ length: PARAS }, (_, i) => paragraph(i));

export const name = "text";
export const about = "180 flowing paragraphs - line breaking and pagination";

export const jasy = () =>
  renderToBytes(
    Document({ size: 11, lineHeight: 1.1 }, [
      Page({ margin: 40 }, [
        Column(
          { gap: 6 },
          TEXTS.map((t) => Paragraph(t)),
        ),
      ]),
    ]),
  );

export const reactPdf = () =>
  renderToBuffer(
    React.createElement(
      RDoc,
      null,
      React.createElement(
        RPage,
        { style: { padding: 40, fontSize: 11, lineHeight: 1.1 } },
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
