import type { PdfDocument } from "@jasy/angular";
import { Box, Column, Divider, Document, Expanded, Page, Text } from "@jasy/pdf";

const center = { align: "center", color: "#ffffff", size: 12 } as const;

export const invitationPdf: PdfDocument = () =>
  Document([
    Page({ size: "A5", margin: 0 }, [
      // Expanded fills the whole page height; the Box (full width by default) makes it full-bleed.
      Expanded(
        Box({ bg: "#0a2348", padding: 44 }, [
          Column({ gap: 14, align: "center" }, [
            Text("YOU ARE INVITED", { ...center, bold: true, color: "#f3dc29", letterSpacing: 3 }),
            Text("Summer Gala 2026", { ...center, size: 34, bold: true }),
            Text("An evening of music, food and celebration.", { ...center, color: "#9db8e0" }),
            Divider({ color: "#f3dc29" }),
            Text("Saturday, 11 July 2026 · 19:00", center),
            Text("The Old Warehouse, Berlin", center),
          ]),
        ]),
      ),
    ]),
  ]);
