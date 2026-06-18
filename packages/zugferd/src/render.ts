import * as fs from "fs";
import * as path from "path";
import { type PDFDocumentElement, renderToBytes } from "@jasy/pdf";
import { Invoice } from "./invoice";
import { computeInvoice } from "./compute";
import { toCII } from "./cii";
import { bundledFonts } from "./fonts";
import { facturxXmp } from "./xmp";
import { defaultInvoiceTemplate } from "./template";
import { InvoiceLabels, Locale, makeFormatters, resolveLabels } from "./i18n";

const ICC_PATH = path.resolve(__dirname, "..", "assets", "icc", "sRGB.icc");

export interface RenderZugferdOptions {
  /** A custom invoice layout (a `Document`). Omit to use the built-in default template. */
  pdf?: PDFDocumentElement;
  /** Language of the default template's labels + number/date formatting (default `"de"`). */
  locale?: Locale;
  /** Override individual labels (merged onto the locale preset), e.g. `{ vat: "Sales Tax" }`. */
  labels?: Partial<InvoiceLabels>;
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

  const labels = resolveLabels(options.locale, options.labels);
  const fmt = makeFormatters(options.locale, invoice.currency);
  const doc = options.pdf ?? defaultInvoiceTemplate(invoice, computed, labels, fmt);

  const bytes = await renderToBytes(doc, {
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
