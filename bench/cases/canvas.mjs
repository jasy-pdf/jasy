// The imperative pen on both sides: a bar chart drawn per page, no text, no images.
import { Document, Page, Canvas, renderToBytes } from "@jasy/pdf";
import { jsPDF } from "jspdf";
import { render as pdfmakeRender } from "../lib/pdfmake.mjs";
import React from "react";
import {
  Document as RDoc,
  Page as RPage,
  Canvas as RCanvas,
  renderToBuffer,
} from "@react-pdf/renderer";

const CHARTS = 40;
const BARS = 24;
const H = 60;
const value = (i) => 8 + ((i * 37) % 52);

export const name = "canvas";
export const about = `${CHARTS} charts x ${BARS} bars, drawn with the imperative pen`;

export const jasy = () =>
  renderToBytes(
    Document([
      Page(
        { margin: 30, gap: 6 },
        Array.from({ length: CHARTS }, () =>
          Canvas({ height: H }, (c, { width }) => {
            const slot = width / BARS;
            for (let i = 0; i < BARS; i++) {
              const h = (value(i) / 60) * H;
              c.rect(i * slot + 1, H - h, slot - 2, h).fill(i % 4 === 0 ? "#f3dc29" : "#1450aa");
            }
            c.move(0, H).line(width, H).stroke("#0a2348", { width: 1 });
          }),
        ),
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
        { style: { padding: 30 } },
        ...Array.from({ length: CHARTS }, (_, k) =>
          React.createElement(RCanvas, {
            key: k,
            style: { height: H, marginBottom: 6 },
            paint: (painter, width) => {
              const slot = width / BARS;
              for (let i = 0; i < BARS; i++) {
                const h = (value(i) / 60) * H;
                painter
                  .rect(i * slot + 1, H - h, slot - 2, h)
                  .fill(i % 4 === 0 ? "#f3dc29" : "#1450aa");
              }
              painter.moveTo(0, H).lineTo(width, H).stroke("#0a2348");
            },
          }),
        ),
      ),
    ),
  );

// The one case where jsPDF is at home: it IS a drawing API. Still no layout - the chart's box, the
// gap between charts and the page break are all coordinates you keep yourself.
export const jsPdf = () => {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  const width = doc.internal.pageSize.getWidth() - 60;
  const bottom = doc.internal.pageSize.getHeight() - 30;
  const slot = width / BARS;
  let y = 30;
  for (let k = 0; k < CHARTS; k++) {
    if (y + H > bottom) {
      doc.addPage();
      y = 30;
    }
    for (let i = 0; i < BARS; i++) {
      const h = (value(i) / 60) * H;
      doc.setFillColor(i % 4 === 0 ? "#f3dc29" : "#1450aa");
      doc.rect(30 + i * slot + 1, y + H - h, slot - 2, h, "F");
    }
    doc.setDrawColor("#0a2348");
    doc.setLineWidth(1);
    doc.line(30, y + H, 30 + width, y + H);
    y += H + 6;
  }
  return new Uint8Array(doc.output("arraybuffer"));
};

// pdfmake has a vector `canvas` element - rectangles and lines as data rather than pen calls.
export const pdfmake = () =>
  pdfmakeRender({
    pageSize: "A4",
    pageMargins: [30, 30, 30, 30],
    defaultStyle: { font: "Helvetica" },
    content: Array.from({ length: CHARTS }, () => {
      const width = 595.28 - 60;
      const slot = width / BARS;
      return {
        margin: [0, 0, 0, 6],
        canvas: [
          ...Array.from({ length: BARS }, (_, i) => {
            const h = (value(i) / 60) * H;
            return {
              type: "rect",
              x: i * slot + 1,
              y: H - h,
              w: slot - 2,
              h,
              color: i % 4 === 0 ? "#f3dc29" : "#1450aa",
            };
          }),
          { type: "line", x1: 0, y1: H, x2: width, y2: H, lineWidth: 1, lineColor: "#0a2348" },
        ],
      };
    }),
  });
