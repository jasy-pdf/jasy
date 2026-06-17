import * as fs from "fs";
import * as path from "path";
import {
  Column,
  Document,
  Page,
  type PDFDocumentElement,
  renderToBytes,
  Row,
  Table,
  Text,
} from "@jasy/pdf";
import { Invoice, PostalAddress } from "./invoice";
import { ComputedInvoice, computeInvoice } from "./compute";
import { toCII } from "./cii";
import { bundledFonts } from "./fonts";
import { facturxXmp } from "./xmp";

const ICC_PATH = path.resolve(__dirname, "..", "assets", "icc", "sRGB.icc");

export interface RenderZugferdOptions {
  /** A custom invoice layout (a `Document`). Omit to use the built-in default template. */
  pdf?: PDFDocumentElement;
}

export interface ZugferdResult {
  /** The ZUGFeRD PDF/A-3 bytes (the human-readable invoice + embedded XML). */
  bytes: Uint8Array;
  /** The generated EN-16931 CII XML (the embedded `factur-x.xml`), for inspection. */
  xml: string;
}

/**
 * Produces a ZUGFeRD PDF/A-3 from an `Invoice`: computes the totals, emits the CII XML, renders the
 * visual PDF (the default template or `options.pdf`) with embedded fonts, and assembles the PDF/A-3
 * (embedded `factur-x.xml`, Factur-X XMP, sRGB OutputIntent, version 1.7 + /ID). One data source →
 * XML and PDF stay in lockstep. Full PDF/A + EN-16931 conformance is verified by external validators
 * (veraPDF + KoSIT) in CI.
 */
export async function renderZugferd(
  invoice: Invoice,
  options: RenderZugferdOptions = {}
): Promise<ZugferdResult> {
  const computed = computeInvoice(invoice);
  const xml = toCII(invoice, computed);

  const bytes = await renderToBytes(options.pdf ?? defaultTemplate(invoice, computed), {
    // The standard-14 names render as embedded Liberation substitutes (PDF/A needs all fonts in);
    // standardFonts:false drops the non-embeddable standard-14 so only embedded fonts remain.
    fonts: bundledFonts(),
    standardFonts: false,
    attachments: [
      {
        name: "factur-x.xml",
        data: Buffer.from(xml, "utf-8"),
        relationship: "Data",
        mimeType: "text/xml",
      },
    ],
    xmp: facturxXmp({ title: `Invoice ${invoice.number}`, author: invoice.seller.name }),
    outputIntent: fs.readFileSync(ICC_PATH),
    pdfVersion: "1.7",
    documentId: true,
  });

  return { bytes, xml };
}

/** A plain built-in invoice layout (the polished template is a later slice). */
function defaultTemplate(invoice: Invoice, c: ComputedInvoice): PDFDocumentElement {
  const money = (n: number) => `${n.toFixed(2)} ${invoice.currency}`;
  const addressLines = (a: PostalAddress) =>
    [a.line1, `${a.postCode ?? ""} ${a.city ?? ""}`.trim(), a.country].filter(Boolean) as string[];

  const party = (label: string, name: string, a: PostalAddress) =>
    Column({ gap: 2 }, [
      Text(label, { bold: true, size: 10, color: "#555" }),
      Text(name),
      ...addressLines(a).map((t) => Text(t, { size: 10 })),
    ]);

  const lineRows = invoice.lines.map((l, i) => [
    l.name,
    String(l.quantity),
    money(l.netUnitPrice),
    money(c.lineNets[i]),
  ]);

  return Document([
    Page({ size: "A4", margin: 56, gap: 14 }, [
      Text(`Rechnung ${invoice.number}`, { size: 22, bold: true, color: "#145aaa" }),
      Text(`Datum: ${invoice.issueDate}${invoice.dueDate ? `   ·   Fällig: ${invoice.dueDate}` : ""}`, {
        size: 10,
        color: "#555",
      }),
      Row({ gap: 24 }, [
        party("Von", invoice.seller.name, invoice.seller.address),
        party("An", invoice.buyer.name, invoice.buyer.address),
      ]),
      Table(
        {
          columns: ["3fr", "auto", "auto", "auto"],
          header: ["Beschreibung", "Menge", "Einzelpreis", "Netto"],
          cellBorder: "#cccccc",
          cellPadding: { x: 6, y: 4 },
        },
        lineRows
      ),
      Text(`Nettobetrag: ${money(c.taxBasisTotal)}`, { align: "right", size: 11 }),
      Text(`Umsatzsteuer: ${money(c.taxTotal)}`, { align: "right", size: 11 }),
      Text(`Gesamtbetrag: ${money(c.grandTotal)}`, { align: "right", bold: true, size: 14 }),
    ]),
  ]);
}
