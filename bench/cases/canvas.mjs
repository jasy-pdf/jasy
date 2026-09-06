// The imperative pen on both sides: a bar chart drawn per page, no text, no images.
import { Document, Page, Canvas, renderToBytes } from "@jasy/pdf";
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
