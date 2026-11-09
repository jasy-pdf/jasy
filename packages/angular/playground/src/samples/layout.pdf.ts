import type { PdfDocumentFn } from "@jasy/angular";
import {
  Box,
  Column,
  Document,
  Expanded,
  Page,
  Positioned,
  Rotated,
  RotatedBox,
  Row,
  Text,
  linearGradient,
  type BoxOptions,
  type PDFElement,
} from "@jasy/pdf";

const BLUE = "#1450aa";
const COLORS = ["#0a2348", "#1450aa", "#3b82f6"];

// Plain functions compose: a titled section is just a function.
const demo = (title: string, note: string, content: PDFElement) =>
  Column({ gap: 6, keepTogether: true }, [
    Text(title, { size: 12, bold: true, color: "#0a2348" }),
    Text(note, { size: 9, color: "#64748b" }),
    content,
  ]);

const tile = (label: string, box: BoxOptions = {}) =>
  Box({ bg: "#e0e9f8", padding: 8, radius: 4, ...box }, [
    Text(label, { size: 10, color: BLUE, align: "center" }),
  ]);

export const layoutPdf: PdfDocumentFn = () =>
  Document({ size: 11, color: "#1f2937" }, [
    Page({ size: "A4", gap: 18 }, [
      Text("Layout, the way you know it", { size: 24, bold: true, color: "#0a2348" }),

      demo(
        "Flex",
        "Expanded shares the leftover space by its flex: 1 · 2 · 1.",
        Row({ gap: 8 }, [
          Expanded({ flex: 1 }, tile("flex 1")),
          Expanded({ flex: 2 }, tile("flex 2", { bg: "#c7d7f3" })),
          Expanded({ flex: 1 }, tile("flex 1")),
        ]),
      ),

      demo(
        "Wrap",
        'wrap breaks the Row into lines; width: "31%" is a share of the line.',
        Row(
          { wrap: true, gap: 8 },
          ["Invoices", "Reports", "Forms", "Tickets", "Labels", "Letters", "Certificates"].map(
            (label) => tile(label, { width: "31%" }),
          ),
        ),
      ),

      demo(
        "Align",
        "A child with its own height leaves the Row's alignment with alignSelf.",
        Row({ gap: 8, height: 70, align: "start" }, [
          tile("start", { height: 28 }),
          tile("center", { height: 28, alignSelf: "center" }),
          tile("end", { height: 28, alignSelf: "end" }),
          Expanded(tile("no height: it fills the Row")),
        ]),
      ),

      Row({ gap: 18 }, [
        Expanded(
          demo(
            "Overlap with zIndex",
            "The first card in the tree paints on top: zIndex orders.",
            Box(
              { relative: true, height: 92 },
              [0, 1, 2].map((i) =>
                Positioned(
                  { left: i * 34, top: i * 14, zIndex: 3 - i },
                  Box({ width: 110, height: 56, radius: 6, padding: 6, bg: COLORS[i] }, [
                    Column({ height: 44, justify: "end" }, [
                      Text(`zIndex ${3 - i}`, {
                        size: 9,
                        bold: true,
                        color: "#ffffff",
                        align: "right",
                      }),
                    ]),
                  ]),
                ),
              ),
            ),
          ),
        ),
        Expanded(
          demo(
            "Stamp",
            "Rotated spins at paint time; nothing reflows.",
            Box({ relative: true, height: 92, border: "#cbd5e1", radius: 6, padding: 10 }, [
              Text("Invoice 2026-0042", { size: 10 }),
              Text("5,400.00 EUR", { size: 10, color: "#64748b" }),
              Positioned(
                { h: "center", v: "center" },
                Rotated(
                  { angle: -14 },
                  Box({ border: "#dc2626", borderWidth: 2, radius: 4, padding: { x: 12, y: 4 } }, [
                    Text("PAID", { size: 20, bold: true, color: "#dc2626", letterSpacing: 2 }),
                  ]),
                ),
              ),
            ]),
          ),
        ),
      ]),

      Row({ gap: 18 }, [
        Expanded(
          demo(
            "Gradient and corners",
            "A gradient fill, each corner its own radius.",
            Box(
              {
                height: 70,
                padding: 14,
                radius: { topLeft: 22, bottomRight: 22 },
                bg: linearGradient({ angle: 90, stops: ["#0a2348", "#1450aa", "#3b82f6"] }),
              },
              [Text("Gradient", { size: 14, bold: true, color: "#ffffff" })],
            ),
          ),
        ),
        Expanded(
          demo(
            "Vertical label",
            "RotatedBox turns a quarter and swaps width and height.",
            Row({ gap: 10, height: 70 }, [
              Box({ bg: "#f3dc29", padding: { x: 6, y: 4 } }, [
                RotatedBox({ turns: 3 }, Text("NEW", { size: 9, bold: true, color: "#0a2348" })),
              ]),
              Expanded(
                Text("The label stands upright, and the text beside it makes room.", { size: 10 }),
              ),
            ]),
          ),
        ),
      ]),
    ]),
  ]);
