// Drawing throughput: many boxes with borders, radii and fills. Almost no text, so this isolates the
// geometry and content-stream path from the font machinery.
//
// The 16pt height is load-bearing. At 14 the cell leaves 10pt inside its padding, and react-pdf drops
// the label rather than overflowing it - it drew 2 characters to our 1382, so it was doing strictly
// less work. Both engines must draw the same ink for the number to mean anything.
import { Document, Page, Row, Box, Text, renderToBytes } from "@jasy/pdf";
import React from "react";
import {
  Document as RDoc,
  Page as RPage,
  Text as RText,
  View,
  renderToBuffer,
} from "@react-pdf/renderer";

const ROWS = 60;
const COLS = 6;
const COLOURS = ["#dbe6f8", "#f8e6db", "#dbf8e6", "#f8dbe6", "#e6dbf8", "#f8f4db"];

export const name = "boxes";
export const about = `${ROWS * COLS} rounded, bordered, filled boxes`;

export const jasy = () =>
  renderToBytes(
    Document({ size: 8 }, [
      Page(
        { margin: 30, gap: 4 },
        Array.from({ length: ROWS }, (_, r) =>
          Row(
            { gap: 4 },
            Array.from({ length: COLS }, (_, c) =>
              Box(
                {
                  width: 80,
                  height: 16,
                  bg: COLOURS[(r + c) % COLOURS.length],
                  border: "#8fa5c8",
                  borderWidth: 1,
                  radius: 3,
                  padding: 2,
                },
                [Text(`${r}.${c}`)],
              ),
            ),
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
        { style: { padding: 30, fontSize: 8 } },
        ...Array.from({ length: ROWS }, (_, r) =>
          React.createElement(
            View,
            // wrap={false}: a jasy Row never breaks across a page, so say the same here or one engine
              // keeps half a row on the previous page.
              { key: r, wrap: false, style: { flexDirection: "row", gap: 4, marginBottom: 4 } },
            ...Array.from({ length: COLS }, (_, c) =>
              React.createElement(
                View,
                {
                  key: c,
                  style: {
                    width: 80,
                    height: 16,
                    padding: 2,
                    borderRadius: 3,
                    backgroundColor: COLOURS[(r + c) % COLOURS.length],
                    borderWidth: 1,
                    borderColor: "#8fa5c8",
                  },
                },
                React.createElement(RText, null, `${r}.${c}`),
              ),
            ),
          ),
        ),
      ),
    ),
  );
