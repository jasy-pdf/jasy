// Flowing text over many pages: the layout engine and the pagination path, nothing else.
//
// PINNED so both engines lay out the SAME document - the two settings that made an earlier comparison
// worthless because one side produced 37 pages and the other 33:
//   margin 40   - react-pdf spells it `padding`, we spell it `margin`; the default differs.
//   lineHeight  - our default line box is the font's natural height (Helvetica 1.156 em),
//                 react-pdf's is `ascent - descent` = 1.10 em. Pin both to 1.1.
import { Document, Page, Column, Paragraph, renderToBytes } from "@jasy/pdf";
import { jsPDF } from "jspdf";
import { render as pdfmakeRender, NATURAL_LINE } from "../lib/pdfmake.mjs";
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

// jsPDF has no page and no flow: `splitTextToSize` breaks a paragraph, everything after that - the
// line height, the paragraph gap, the y cursor and WHERE the page ends - is yours to track.
export const jsPdf = () => {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const width = doc.internal.pageSize.getWidth() - 80;
  const bottom = doc.internal.pageSize.getHeight() - 40;
  let y = 40 + 11;
  for (const paragraph of TEXTS) {
    for (const line of doc.splitTextToSize(paragraph, width)) {
      if (y > bottom) {
        doc.addPage();
        y = 40 + 11;
      }
      doc.text(line, 40, y);
      y += 11 * 1.1;
    }
    y += 6;
  }
  return new Uint8Array(doc.output("arraybuffer"));
};

// pdfmake is the closest peer outside React: a document is an object, and it owns the line breaking
// and the page breaks. Only its `lineHeight` has to be converted - see lib/pdfmake.mjs.
export const pdfmake = () =>
  pdfmakeRender({
    pageSize: "A4",
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: "Helvetica", fontSize: 11, lineHeight: 1.1 / NATURAL_LINE },
    content: TEXTS.map((t) => ({ text: t, margin: [0, 0, 0, 6] })),
  });
