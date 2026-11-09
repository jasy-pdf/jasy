import type { PdfDocument } from "@jasy/angular";
import { Column, Document, Expanded, Page, Row, Text, span } from "@jasy/pdf";

const LOREM =
  "Good typography is invisible. The words sit evenly on the line, the spaces stay calm, and the eye moves on without noticing any of it. jasy measures every glyph with the font's own metrics and kerns each pair, so what is measured is exactly what is drawn.";
const caption = (text: string) => Text(text, { size: 9, bold: true, color: "#64748b" });

export const typographyPdf: PdfDocument = () =>
  Document({ size: 11, color: "#1f2937" }, [
    Page({ size: "A4", gap: 16 }, [
      Text("Typography", {
        size: 11,
        bold: true,
        color: "#1450aa",
        letterSpacing: 4,
        textTransform: "uppercase",
      }),
      Text("AVATAR Wave, kerned.", { size: 40, bold: true, color: "#0a2348" }),

      Text(
        [
          span("Spans mix "),
          span("bold", { bold: true }),
          span(", "),
          span("italic", { italic: true }),
          span(", "),
          span("color", { color: "#1450aa" }),
          span(", "),
          span("underline", { underline: true }),
          span(", "),
          span("strikethrough", { strikethrough: true }),
          span(", a footnote"),
          span("1", { verticalAlign: "super", size: 8 }),
          span(" and a "),
          span("link", { href: "https://jasy.dev", color: "#1450aa", underline: true }),
          span(" - in one paragraph that wraps as one."),
        ],
        { size: 13 },
      ),

      Row({ gap: 20 }, [
        Expanded(
          Column({ gap: 4 }, [
            caption("JUSTIFIED"),
            Text(LOREM, { align: "justify", lineHeight: 1.5 }),
          ]),
        ),
        Expanded(
          Column({ gap: 4 }, [
            caption("FIRST-LINE INDENT"),
            Text(LOREM, { textIndent: 18, lineHeight: 1.5 }),
          ]),
        ),
      ]),

      Column({ gap: 4 }, [
        caption("TWO LINES, THEN AN ELLIPSIS"),
        Text(`${LOREM} ${LOREM}`, { maxLines: 2, overflow: "ellipsis" }),
      ]),

      Row({ gap: 20 }, [
        Text("spaced", { size: 18, letterSpacing: 6 }),
        Text("word spacing too", { size: 18, wordSpacing: 14 }),
        Text("capitalize every word", { size: 18, textTransform: "capitalize" }),
      ]),

      Text(
        '¹ Raised with verticalAlign: "super" - it shifts the baseline, the size is yours to pick.',
        {
          size: 9,
          color: "#94a3b8",
        },
      ),
    ]),
  ]);
