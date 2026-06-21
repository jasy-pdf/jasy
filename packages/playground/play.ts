// jasy playground - full TypeScript, full autocomplete. Edit, then `pnpm play` (from the repo root)
// or `pnpm --filter @jasy/playground play`. Writes ./out.pdf next to this file.
//
// Hover anything, Ctrl-Space for options - every factory + its options object is typed from @jasy/pdf.

import { writeFileSync } from "node:fs";
import { Document, Page, Text, Table, Box, Row, Padding, Divider, renderToBytes } from "@jasy/pdf";

const invoice = Document([
  Page({ size: "A4", margin: 48 }, [
    Text("Invoice #2026-014", { size: 26, bold: true, color: "#1450aa" }),
    Text("Acme GmbH · Berlin", { size: 11, color: "gray" }),
    Divider({ color: "steelblue" }),

    Table(
      {
        columns: ["auto", "1fr", "auto"],
        header: ["Qty", "Item", "Amount"],
        rule: "#e0e0e0",
        cellPadding: 6,
      },
      [
        ["2", "Design", "1,200 €"],
        ["8", "Build", "6,400 €"],
      ],
    ),

    Padding(
      { top: 16 },
      Box({ bg: "#1450aa11", padding: 12, radius: 6 }, [
        // space-between: pushes label + amount apart, never constrains them (the bug is fixed).
        Row({ justify: "between", align: "center" }, [
          Text("Total due", { size: 12, color: "gray" }),
          Text("7,600 €", { size: 18, bold: true }),
        ]),
      ]),
    ),
  ]),
]);

const pdf = await renderToBytes(invoice);
writeFileSync(new URL("./out.pdf", import.meta.url), pdf);
console.log("✓ wrote packages/playground/out.pdf");
