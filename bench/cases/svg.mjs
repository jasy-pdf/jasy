// The same picture from both engines. The INPUT differs on purpose and that is half the point: jasy
// takes the markup an agency hands over, react-pdf needs it converted into its own components first.
// What is measured is the drawing, not the convenience.
import { Document, Page, Row, Svg as JSvg, renderToBytes } from "@jasy/pdf";
import React from "react";
import {
  Document as RDoc,
  Page as RPage,
  View,
  Svg,
  Path,
  Circle,
  G,
  renderToBuffer,
} from "@react-pdf/renderer";

const N = 120;
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <circle cx="24" cy="24" r="21" fill="none" stroke="#1450aa" stroke-width="3"/>
  <path d="M14 25 l7 8 14-17" fill="none" stroke="#0a2348" stroke-width="4"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M6 40 q 18 -8 36 0" fill="none" stroke="#f3dc29" stroke-width="2"/>
</svg>`;

export const name = "svg";
export const about = `${N} vector marks - paths, strokes, joins`;

export const jasy = () =>
  renderToBytes(
    Document([
      Page(
        { margin: 30, gap: 6 },
        Array.from({ length: N / 10 }, () =>
          Row(
            { gap: 6 },
            Array.from({ length: 10 }, () => JSvg(MARK, { width: 44 })),
          ),
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
        ...Array.from({ length: N / 10 }, (_, r) =>
          React.createElement(
            View,
            { key: r, style: { flexDirection: "row", gap: 6, marginBottom: 6 } },
            ...Array.from({ length: 10 }, (_, c) =>
              React.createElement(
                Svg,
                { key: c, width: 44, height: 44, viewBox: "0 0 48 48" },
                React.createElement(
                  G,
                  null,
                  React.createElement(Circle, {
                    cx: 24,
                    cy: 24,
                    r: 21,
                    fill: "none",
                    stroke: "#1450aa",
                    strokeWidth: 3,
                  }),
                  React.createElement(Path, {
                    d: "M14 25 l7 8 14-17",
                    fill: "none",
                    stroke: "#0a2348",
                    strokeWidth: 4,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }),
                  React.createElement(Path, {
                    d: "M6 40 q 18 -8 36 0",
                    fill: "none",
                    stroke: "#f3dc29",
                    strokeWidth: 2,
                  }),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
