import { DOCUMENT } from "@angular/common";
import { inject } from "@angular/core";
import type { PdfDocumentFn } from "@jasy/angular";
import { Box, Column, Divider, Document, Image, Page, Row, Text } from "@jasy/pdf";

const PRODUCTS = [
  { name: "Origami Crane Kit", qty: 3, price: 12.5 },
  { name: "Washi Tape Set", qty: 2, price: 8.0 },
  { name: "Calligraphy Pen", qty: 1, price: 24.9 },
];

// "GreatVibes" is registered once for the whole app, in provideJasy() - see app.config.ts.
// The photo is a URL: jasy fetches it before the layout, in the browser.
export const fontsAndImagesPdf: PdfDocumentFn = () => {
  const photo = new URL("photo.jpg", inject(DOCUMENT).baseURI).href;
  const total = PRODUCTS.reduce((sum, p) => sum + p.qty * p.price, 0);

  return Document([
    Page({ size: "A4", gap: 14 }, [
      Row({ justify: "between", align: "center" }, [
        Text("Jasy Atelier", { font: "GreatVibes", size: 44, color: "#1450aa" }),
        Image(photo, { width: 84, height: 84, fit: "cover", radius: 42 }),
      ]),
      Text("A font from provideJasy() · an image URL · a circular crop · computed totals", {
        size: 11,
        color: "#64748b",
      }),
      Divider(),

      Box({ bg: "#0a2348", padding: 10, radius: 4 }, [
        Row({ justify: "between" }, [
          Text("Product", { size: 11, bold: true, color: "#ffffff" }),
          Text("Qty × Price = Total", { size: 11, bold: true, color: "#ffffff" }),
        ]),
      ]),
      Column(
        { gap: 7 },
        PRODUCTS.map((p) =>
          Row({ justify: "between" }, [
            Text(p.name, { size: 12 }),
            Text(`${p.qty} × ${p.price.toFixed(2)} = ${(p.qty * p.price).toFixed(2)} €`, {
              size: 12,
            }),
          ]),
        ),
      ),

      Divider(),
      Row({ justify: "between", align: "center" }, [
        Text("Total", { size: 14, bold: true }),
        Text(`${total.toFixed(2)} €`, { font: "GreatVibes", size: 22, color: "#1450aa" }),
      ]),
    ]),
  ]);
};
