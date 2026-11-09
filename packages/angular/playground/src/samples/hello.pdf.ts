import type { PdfDocument } from "@jasy/angular";
import { Box, Document, Page, Text } from "@jasy/pdf";

export const helloPdf: PdfDocument<{ name: string }> = ({ name }) =>
  Document([
    Page({ size: "A4", gap: 14 }, [
      Text(`Hello, ${name}`, { size: 30, bold: true, color: "#1450aa" }),
      Text(
        "This whole document is a plain function, turned into a real PDF by @jasy/angular - " +
          "right here in your browser. Change the name and watch it rebuild.",
        { size: 13, color: "#475569" },
      ),
      Box({ bg: "#eef2ff", padding: 16, radius: 6 }, [
        Text("A Box with a background, padding and rounded corners, holding a Text.", {
          size: 12,
        }),
      ]),
    ]),
  ]);
