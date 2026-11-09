import { DOCUMENT } from "@angular/common";
import { inject } from "@angular/core";
import type { PdfDocument } from "@jasy/angular";
import { Box, Document, Image, Page, Row, Text } from "@jasy/pdf";

const PANELS = ["#0a2348", "#0d9488", "#fb7185"];

// A PNG with an alpha channel, decoded in the browser and embedded with a real /SMask.
export const transparencyPdf: PdfDocument = () => {
  const logo = new URL("logo.png", inject(DOCUMENT).baseURI).href;
  return Document({ size: 12, color: "#1f2937" }, [
    Page({ size: "A4", gap: 20 }, [
      Text("Transparent PNG", { size: 22, bold: true, color: "#0a2348" }),
      Text(
        "The transparency composites over whatever sits behind it - the panel shows through, " +
          "not a white rectangle.",
        { color: "#64748b" },
      ),
      Row(
        { gap: 16, align: "center" },
        PANELS.map((bg) =>
          Box({ bg, padding: 16, radius: 8 }, [
            Image(logo, { width: 100, height: 100, fit: "contain" }),
          ]),
        ),
      ),
    ]),
  ]);
};
