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
            ...Array.from({ length: PARAS }, () => Paragraph(COPY.repeat(2))),
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
                Box({ width: W[i], borderBottom: "#dfe4ee", borderWidth: 0.5, padding: 4 }, [
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
        { style: { padding: 40, fontSize: 10, lineHeight: 1.1 } },
        React.createElement(
          View,
          { fixed: true, style: { flexDirection: "row", alignItems: "center", marginBottom: 8 } },
          React.createElement(
            RText,
            { style: { fontSize: 12, fontFamily: "Helvetica-Bold" } },
            "Quarterly report",
          ),
          React.createElement(View, { style: { flexGrow: 1 } }),
          React.createElement(RText, { style: { fontSize: 9, color: "gray" } }, "Q3 2026"),
        ),
        React.createElement(
          RText,
          { style: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 8 } },
          "Summary",
        ),
        ...Array.from({ length: PARAS }, (_, i) =>
          React.createElement(RText, { key: `p${i}`, style: { marginBottom: 8 } }, COPY.repeat(2)),
        ),
        React.createElement(
          RText,
          { style: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 8 } },
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
                { style: { fontSize: 9, fontFamily: "Helvetica-Bold" } },
                h,
              ),
            ),
          ),
        ),
        ...Array.from({ length: ROWS }, (_, r) =>
          React.createElement(
            View,
            { key: `r${r}`, style: { flexDirection: "row" } },
            ...row(r).map((cell, i) =>
              React.createElement(
                View,
                {
                  key: i,
                  style: {
                    width: W[i],
                    borderBottomWidth: 0.5,
                    borderBottomColor: "#dfe4ee",
                    padding: 4,
                  },
                },
                React.createElement(RText, { style: { fontSize: 9 } }, cell),
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
            style: { position: "absolute", bottom: 40, left: 40, fontSize: 8, color: "gray" },
          },
          "Muster Studio GmbH",
        ),
      ),
    ),
  );
