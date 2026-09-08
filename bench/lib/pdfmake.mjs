// pdfmake, set up for Node.
//
// Its package main is the BROWSER build, and the documented `new PdfPrinter(fonts)` server API is gone
// in 0.3 - `createPdfKitDocument` returns a promise and wants a url resolver. What works is the deep
// require plus `addFonts`, which is what every case here uses.
//
// `lineHeight` also means something else than in jasy or react-pdf: it multiplies the FONT's natural
// line height (about 0.925 em for Helvetica), not the font size. A case that wants jasy's 1.1 has to
// ask for `1.1 / 0.925`, or the two documents break at different places.
import { createRequire } from "node:module";

const pm = createRequire(import.meta.url)("pdfmake/js/index.js");
pm.addFonts({
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
});

/** Helvetica's natural line height, so a case can convert a jasy `lineHeight` into pdfmake's. */
export const NATURAL_LINE = 0.925;

export const render = (definition) =>
  pm.createPdf(definition).getBuffer().then((b) => new Uint8Array(b));
