// The mixed case, and the one closest to real work: a multi-page report with a repeating header and
// footer, headings, flowing copy and a long table. Text and geometry in one document, which is where
// the two engines' opposite strengths meet.
import {
  Document,
  Page,
  Column,
  Row,
  Box,
  Text,
  Paragraph,
  Spacer,
  renderToBytes,
} from "@jasy/pdf";
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

const ROWS = 90;
const PARAS = 24;
const COPY =
  "Every figure below is produced from the same source and laid out by the engine, not by a browser. " +
  "The table flows across pages and the header repeats. ";
const row = (i) => [
  `A-${1000 + i}`,
  `Line item number ${i}`,
  `${(i % 7) + 1}`,
  `${(120 + i * 3).toFixed(2)} EUR`,
];
const HEAD = ["Ref", "Description", "Qty", "Amount"];
const FOOTER_LINE = 8 * 1.1; // the footer is 8pt at the page line height
// What a table row comes to in jasy: 4pt padding, a 9pt line at the page line height, 4pt padding.
// jsPDF has to be told it, because nothing there derives a height from its content.
const ROW_H = 4 + 9 * 1.1 + 4;
const W = [70, 250, 40, 90];

export const name = "document";
export const about = `a report: repeating header/footer, ${PARAS} paragraphs, ${ROWS} table rows`;

export const jasy = () =>
  renderToBytes(
    Document({ size: 10, lineHeight: 1.1 }, [
      Page(
        {
          margin: 40,
          header: Row({ align: "center" }, [
            Text("Quarterly report", { size: 12, bold: true }),
            Spacer(),
            Text("Q3 2026", { size: 9, color: "gray" }),
          ]),
          footer: Text("Muster Studio GmbH", { size: 8, color: "gray" }),
        },
        [
          // The prose is spaced by a Column gap, the table rows are NOT - which is exactly how the
          // react-pdf side declares it (marginBottom on the paragraphs only). A page-level gap would
          // space the 90 table rows too, and the two documents would stop being the same one.
          Column({ gap: 8 }, [
            Text("Summary", { size: 16, bold: true }),
            // orphans/widows pinned off: jasy keeps at least two lines of a paragraph together at a page
            // break, react-pdf and jsPDF have no such rule, and with it on the three documents break at
            // different places. Turning OUR feature off is what makes the comparison the same document.
            ...Array.from({ length: PARAS }, () =>
              Paragraph(COPY.repeat(2), { orphans: 1, widows: 1 }),
            ),
            Text("Detail", { size: 16, bold: true }),
          ]),
          Row(
            { gap: 0 },
            HEAD.map((h, i) =>
              Box({ width: W[i], bg: "#eef1f5", padding: 4 }, [Text(h, { size: 9, bold: true })]),
            ),
          ),
          ...Array.from({ length: ROWS }, (_, r) =>
            Row(
              { gap: 0 },
              row(r).map((cell, i) =>
                Box({ width: W[i], bg: r % 2 ? "#f4f6f9" : "#ffffff", padding: 4 }, [
                  Text(cell, { size: 9 }),
                ]),
              ),
            ),
          ),
        ],
      ),
    ]),
  );

export const reactPdf = () =>
  renderToBuffer(
    React.createElement(
      RDoc,
      null,
      React.createElement(
        RPage,
        // paddingBottom reserves the fixed footer's line. Without it the flow runs underneath it and
        // the two engines would be laying out different body heights.
        { style: { padding: 40, paddingBottom: 40 + FOOTER_LINE, fontSize: 10, lineHeight: 1.1 } },
        React.createElement(
          View,
          // No marginBottom: our header is a BAND that sits straight above the body, so adding one
          // here would push react-pdf's first heading 8pt further down than ours.
          { fixed: true, style: { flexDirection: "row", alignItems: "center" } },
          React.createElement(
            RText,
            { style: { fontSize: 12, fontFamily: "Helvetica-Bold", lineHeight: 1.1 } },
            "Quarterly report",
          ),
          React.createElement(View, { style: { flexGrow: 1 } }),
          React.createElement(
            RText,
            { style: { fontSize: 9, color: "gray", lineHeight: 1.1 } },
            "Q3 2026",
          ),
        ),
        React.createElement(
          RText,
          {
            style: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 8, lineHeight: 1.1 },
          },
          "Summary",
        ),
        ...Array.from({ length: PARAS }, (_, i) =>
          React.createElement(
            RText,
            // orphans/widows off here too - react-pdf defaults to 2/2 like jasy, see the note above.
            {
              key: `p${i}`,
              orphans: 1,
              widows: 1,
              style: { fontSize: 10, marginBottom: 8, lineHeight: 1.1 },
            },
            COPY.repeat(2),
          ),
        ),
        React.createElement(
          RText,
          { style: { fontSize: 16, fontFamily: "Helvetica-Bold", lineHeight: 1.1 } },
          "Detail",
        ),
        React.createElement(
          View,
          { style: { flexDirection: "row" } },
          ...HEAD.map((h, i) =>
            React.createElement(
              View,
              { key: i, style: { width: W[i], backgroundColor: "#eef1f5", padding: 4 } },
              React.createElement(
                RText,
                { style: { fontSize: 9, fontFamily: "Helvetica-Bold", lineHeight: 1.1 } },
                h,
              ),
            ),
          ),
        ),
        ...Array.from({ length: ROWS }, (_, r) =>
          React.createElement(
            View,
            { key: `r${r}`, wrap: false, style: { flexDirection: "row" } },
            ...row(r).map((cell, i) =>
              React.createElement(
                View,
                {
                  key: i,
                  style: {
                    width: W[i],
                    backgroundColor: r % 2 ? "#f4f6f9" : "#ffffff",
                    padding: 4,
                  },
                },
                React.createElement(RText, { style: { fontSize: 9, lineHeight: 1.1 } }, cell),
              ),
            ),
          ),
        ),
        // Absolutely positioned, so it sits at the foot of every page the way our footer BAND does -
        // react-pdf's plain `fixed` puts it in the flow instead, which is a different document.
        React.createElement(
          RText,
          {
            fixed: true,
            style: {
              position: "absolute",
              bottom: 40,
              left: 40,
              fontSize: 8,
              color: "gray",
              lineHeight: 1.1,
            },
          },
          "Muster Studio GmbH",
        ),
      ),
    ),
  );

// The case with the widest gap in what you have to write. jsPDF has no repeating header, no footer
// band and no table: the bands are redrawn by hand after every addPage, the columns are x offsets you
// keep, and every page break is a coordinate check. This is the whole document, and it is what the
// twelve lines of the jasy version above buy you.
export const jsPdf = () => {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  // jasy reserves its footer BAND below the body; jsPDF has no band, so the same room is set here.
  const bodyBottom = pageH - 40 - FOOTER_LINE;
  let y = 0;

  // A header and a footer are elements in jasy; here they are a function you must remember to call.
  const bands = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Quarterly report", 40, 40 + 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor("#808080");
    doc.text("Q3 2026", pageW - 40 - doc.getTextWidth("Q3 2026"), 40 + 9);
    doc.setFontSize(8);
    doc.text("Muster Studio GmbH", 40, pageH - 40);
    doc.setTextColor("#000000");
    y = 40 + 12 * 1.1;
  };
  const room = (need) => {
    if (y + need > bodyBottom) {
      doc.addPage();
      bands();
    }
  };

  bands();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Summary", 40, y + 16);
  y += 16 * 1.1 + 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (let i = 0; i < PARAS; i++) {
    for (const line of doc.splitTextToSize(COPY.repeat(2), pageW - 80)) {
      room(10 * 1.1);
      doc.text(line, 40, y + 10);
      y += 10 * 1.1;
    }
    y += 8;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  room(16 * 1.1);
  doc.text("Detail", 40, y + 16);
  y += 16 * 1.1;

  const cols = W.reduce((acc, w, i) => [...acc, (acc[i - 1] ?? 40) + (W[i - 1] ?? 0)], []);
  doc.setFontSize(9);
  doc.setFillColor("#eef1f5");
  doc.rect(
    40,
    y,
    W.reduce((a, b) => a + b, 0),
    ROW_H,
    "F",
  );
  HEAD.forEach((h, i) => doc.text(h, cols[i] + 4, y + 4 + 9));
  y += ROW_H;

  doc.setFont("helvetica", "normal");
  for (let r = 0; r < ROWS; r++) {
    room(ROW_H);
    doc.setFillColor(r % 2 ? "#f4f6f9" : "#ffffff");
    doc.rect(
      40,
      y,
      W.reduce((a, b) => a + b, 0),
      ROW_H,
      "F",
    );
    row(r).forEach((cell, i) => doc.text(cell, cols[i] + 4, y + 4 + 9));
    y += ROW_H;
  }
  return new Uint8Array(doc.output("arraybuffer"));
};

// pdfmake is the only one of the three besides jasy with real repeating bands and a table: `header`
// and `footer` are functions it calls per page, and a table takes column widths. What it does not
// have is orphan control - see the note on the jasy side.
export const pdfmake = () =>
  pdfmakeRender({
    pageSize: "A4",
    pageMargins: [40, 40 + 12 * 1.1 + 4, 40, 40 + FOOTER_LINE],
    defaultStyle: { font: "Helvetica", fontSize: 10, lineHeight: 1.1 / NATURAL_LINE },
    header: () => ({
      margin: [40, 40, 40, 0],
      columns: [
        { text: "Quarterly report", bold: true, fontSize: 12, width: "*" },
        { text: "Q3 2026", fontSize: 9, color: "gray", width: "auto" },
      ],
    }),
    footer: () => ({
      margin: [40, 0, 40, 0],
      text: "Muster Studio GmbH",
      fontSize: 8,
      color: "gray",
    }),
    content: [
      { text: "Summary", bold: true, fontSize: 16, margin: [0, 0, 0, 8] },
      ...Array.from({ length: PARAS }, () => ({ text: COPY.repeat(2), margin: [0, 0, 0, 8] })),
      { text: "Detail", bold: true, fontSize: 16 },
      {
        table: {
          widths: W.map((w) => w - 8),
          body: [
            HEAD.map((h) => ({ text: h, bold: true, fontSize: 9, fillColor: "#eef1f5" })),
            ...Array.from({ length: ROWS }, (_, r) =>
              row(r).map((cell) => ({
                text: cell,
                fontSize: 9,
                fillColor: r % 2 ? "#f4f6f9" : "#ffffff",
              })),
            ),
          ],
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          paddingLeft: () => 4,
          paddingRight: () => 4,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
    ],
  });
