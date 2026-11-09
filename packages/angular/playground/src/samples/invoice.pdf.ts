import { formatCurrency, formatDate } from "@angular/common";
import { LOCALE_ID, inject } from "@angular/core";
import type { PdfDocumentFn } from "@jasy/angular";
import { Divider, Document, Page, PageCount, PageNumber, Row, Table, Text } from "@jasy/pdf";

const CATALOG = [
  { desc: "Design work - landing page", price: 1200 },
  { desc: "Frontend development (Angular)", price: 3400 },
  { desc: "PDF engine integration", price: 800 },
  { desc: "Accessibility review", price: 650 },
  { desc: "Hosting, 12 months", price: 240 },
];

export interface Invoice {
  customer: string;
  lines: number;
}

// A document runs in an injection context, like a functional guard: inject() works right here.
export const invoicePdf: PdfDocumentFn<Invoice> = ({ customer, lines }) => {
  const locale = inject(LOCALE_ID);
  const eur = (n: number) => formatCurrency(n, locale, "€", "EUR");
  const muted = { size: 9, color: "#94a3b8" };

  const items = Array.from({ length: lines }, (_, i) => CATALOG[i % CATALOG.length]);
  const total = items.reduce((sum, item) => sum + item.price, 0);

  const footer = Row({ justify: "between" }, [
    Text("Acme GmbH · Musterstrasse 1 · 10115 Berlin", muted),
    Row({ gap: 3 }, [Text("Page", muted), PageNumber(muted), Text("of", muted), PageCount(muted)]),
  ]);

  return Document({ size: 11, color: "#1f2937" }, [
    Page({ size: "A4", gap: 16, footer }, [
      Row({ justify: "between" }, [
        Text("Acme GmbH", { size: 22, bold: true, color: "#0a2348" }),
        Text("INVOICE", { size: 22, bold: true, color: "#1450aa" }),
      ]),
      Text(`No. 2026-0042 · ${formatDate(Date.now(), "longDate", locale)} · due in 14 days`, {
        color: "#64748b",
      }),
      Text(`Bill to: ${customer}`, { size: 12 }),

      // The header row repeats at the top of every page the table flows onto.
      Table(
        {
          columns: [36, "1fr", 110],
          cellBorder: "#e2e8f0",
          cellPadding: 8,
          header: [
            Text("#", { bold: true, color: "#0a2348" }),
            Text("Description", { bold: true, color: "#0a2348" }),
            Text("Amount", { bold: true, color: "#0a2348", align: "right" }),
          ],
        },
        items.map((item, i) => [
          String(i + 1),
          item.desc,
          Text(eur(item.price), { align: "right" }),
        ]),
      ),

      Divider(),
      Row({ justify: "between", keepTogether: true }, [
        Text("Total", { size: 14, bold: true }),
        Text(eur(total), { size: 14, bold: true, color: "#1450aa" }),
      ]),
      Text("Thank you for your business. Payment within 14 days.", { size: 10, color: "#94a3b8" }),
    ]),
  ]);
};
