// A datasheet page built from the drawing primitives: stat cards, a bar chart drawn as rectangles on
// a baseline, and a spec strip. Shows boxes, fills, rules and color driving a data-dense layout.
import { Document, Page, Column, Row, Box, Padding, Text, Divider } from "@jasy/pdf";

const ink = "#1b2433";
const muted = "#6b7280";
const brand = "#1450aa";
const accent = "#e3b505";
const hair = "#e6eaf2";
const paper = "#f5f8fd";

const stat = (value: string, label: string, sub: string) =>
  Box({ bg: paper, padding: { x: 16, y: 14 }, radius: 8 }, [
    Column({ gap: 3 }, [
      Text(value, { size: 25, bold: true, color: brand, lineHeight: 1.3 }),
      Text(label, { size: 10.5, bold: true, color: ink, lineHeight: 1.3 }),
      Text(sub, { size: 9, color: muted, lineHeight: 1.3 }),
    ]),
  ]);

// bar chart data: [label, value]; the peak gets the accent fill
const data: [string, number][] = [
  ["W1", 62],
  ["W2", 95],
  ["W3", 78],
  ["W4", 128],
  ["W5", 112],
  ["W6", 168],
  ["W7", 141],
  ["W8", 190],
];
const MAXV = 200;
const CHART_H = 168;
const BAR_W = 34;
const peak = Math.max(...data.map(([, v]) => v));

const bars = Row(
  { justify: "between", align: "end" },
  data.map(([, v]) =>
    Box(
      { width: BAR_W, height: (CHART_H * v) / MAXV, bg: v === peak ? accent : brand, radius: 3 },
      [],
    ),
  ),
);

const labels = Row(
  { justify: "between" },
  data.map(([lbl]) =>
    Box({ width: BAR_W }, [Text(lbl, { size: 9, color: muted, align: "center" })]),
  ),
);

const spec = (k: string, v: string) =>
  Row({ justify: "between", gap: 12 }, [
    Text(k, { size: 9.5, color: muted, lineHeight: 1.3 }),
    Text(v, { size: 9.5, color: ink, bold: true, align: "right", lineHeight: 1.3 }),
  ]);

const page = Page({ margin: 56, gap: 0 }, [
  // header
  Text("DATASHEET", { size: 10, bold: true, color: accent }),
  Padding(
    { top: 3 },
    Text("Render performance", { size: 26, bold: true, color: ink, lineHeight: 1.3 }),
  ),
  Text("Pure-TypeScript PDF engine, measured on a laptop, single thread", {
    size: 11.5,
    color: muted,
    lineHeight: 1.3,
  }),

  // stat cards
  Padding(
    { top: 22 },
    Row({ gap: 14, align: "stretch" }, [
      stat("2.4s", "1,000 invoices", "rendered end to end"),
      stat("0", "native deps", "no browser, no JVM"),
      stat("~97%", "font subset", "embedded TrueType"),
      stat("13/13", "PDF/A-3 checks", "ZUGFeRD conformant"),
    ]),
  ),

  // bar chart
  Padding(
    { top: 30 },
    Text("Throughput, pages per second over eight builds", { size: 11, bold: true, color: ink }),
  ),
  Padding({ top: 12 }, Column({ gap: 8 }, [bars, Divider({ color: ink }), labels])),

  // spec strip
  Padding(
    { top: 30 },
    Box({ border: hair, padding: { x: 16, y: 14 }, radius: 8 }, [
      Row({ gap: 40, align: "start" }, [
        Box({ width: 200 }, [
          Column({ gap: 8 }, [
            spec("Page sizes", "A6 to A3, Letter, custom"),
            spec("Fonts", "standard-14 + TrueType"),
            spec("Output", "PDF 1.7, PDF/A-3"),
          ]),
        ]),
        Box({ width: 200 }, [
          Column({ gap: 8 }, [
            spec("Images", "JPEG, PNG, BoxFit"),
            spec("Pagination", "text, tables, images"),
            spec("E-invoice", "EN 16931 CII + UBL"),
          ]),
        ]),
      ]),
    ]),
  ),
]);

export default Document([page]);
