import type { PdfDocument } from "@jasy/angular";
import {
  Box,
  Canvas,
  Column,
  Document,
  Expanded,
  Page,
  Row,
  Svg,
  Text,
  type CanvasPaint,
} from "@jasy/pdf";

const SALES = [
  { month: "Jan", value: 42 },
  { month: "Feb", value: 55 },
  { month: "Mar", value: 48 },
  { month: "Apr", value: 71 },
  { month: "May", value: 66 },
  { month: "Jun", value: 90 },
];

// A chart is a function of its data and the size it was given.
const bars: CanvasPaint = (p, { width, height }) => {
  const step = width / SALES.length;
  const max = Math.max(...SALES.map((s) => s.value));
  SALES.forEach((s, i) => {
    const h = (s.value / max) * (height - 6);
    p.rect(i * step + step * 0.2, height - h, step * 0.6, h).fill(i === 5 ? "#1450aa" : "#93c5fd");
  });
  p.move(0, height).line(width, height).stroke("#475569", { width: 1 });
};

const rosette: CanvasPaint = (p, { width, height }) => {
  for (let i = 0; i < 12; i++) {
    p.group({ rotate: i * 15, origin: [width / 2, height / 2] }, (c) =>
      c
        .rect(width / 2 - 34, height / 2 - 34, 68, 68)
        .stroke(i % 2 ? "#1450aa" : "#f3dc29", { width: 1.5 }),
    );
  }
};

const CRANE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <polygon points="10,60 50,20 50,60" fill="#1450aa"/>
  <polygon points="50,20 90,45 50,60" fill="#3b82f6"/>
  <polygon points="50,60 90,45 70,85" fill="#0a2348"/>
  <circle cx="50" cy="60" r="4" fill="#f3dc29"/>
</svg>`;

const heading = (text: string) => Text(text, { size: 12, bold: true, color: "#0a2348" });

export const drawingPdf: PdfDocument = () =>
  Document({ size: 11, color: "#1f2937" }, [
    Page({ size: "A4", gap: 18 }, [
      Text("Drawing", { size: 24, bold: true, color: "#0a2348" }),

      Column({ gap: 6 }, [
        heading("Canvas: a chart from data"),
        Canvas({ height: 140, alt: "Sales from January to June" }, bars),
        Row(
          SALES.map((s) => Expanded(Text(s.month, { size: 9, color: "#64748b", align: "center" }))),
        ),
      ]),

      Row({ gap: 18 }, [
        Expanded(
          Column({ gap: 6 }, [
            heading("Canvas: transforms"),
            Box({ bg: "#0a2348", radius: 6 }, [Canvas({ height: 160 }, rosette)]),
          ]),
        ),
        Expanded(
          Column({ gap: 6 }, [
            heading("SVG: vector, inline markup"),
            Box({ border: "#cbd5e1", radius: 6, padding: 10 }, [
              Row({ justify: "center" }, [Svg(CRANE, { width: 140, alt: "An origami crane" })]),
            ]),
          ]),
        ),
      ]),

      Text("Everything here is vector: zoom in as far as you like.", {
        size: 9,
        color: "#94a3b8",
      }),
    ]),
  ]);
