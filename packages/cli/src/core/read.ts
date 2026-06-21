import { readFileSync } from "node:fs";
import { computeInvoice, type Invoice, type ComputedInvoice } from "@jasy/zugferd";
import { extractEmbeddedXml } from "./extract.js";
import { detectInvoice, type InvoiceMeta } from "./detect.js";
import { parseInvoice } from "./parse.js";

// The "read anything" orchestrator: hand it the bytes of a ZUGFeRD/XRechnung PDF *or* a bare e-invoice
// XML and it gives back the XML, what it is, AND the parsed invoice + computed totals (when the syntax
// is supported). UI-agnostic on purpose - the `read` command and the TUI both call this.

export interface ReadResult {
  isPdf: boolean;
  xml: string;
  meta: InvoiceMeta;
  /** The parsed invoice (CII supported; UBL coming) - undefined if the syntax can't be parsed yet. */
  invoice?: Invoice;
  /** Totals derived from `invoice` (net, VAT, gross …). */
  totals?: ComputedInvoice;
}

/** Read an e-invoice from raw bytes - a PDF (embedded XML extracted) or raw XML (used as-is). */
export function readInvoice(data: Uint8Array): ReadResult {
  const buf = Buffer.from(data);
  const isPdf = buf.subarray(0, 5).toString("latin1") === "%PDF-";
  const xml = isPdf ? extractEmbeddedXml(buf) : buf.toString("utf-8");
  const meta = detectInvoice(xml);

  let invoice: Invoice | undefined;
  let totals: ComputedInvoice | undefined;
  try {
    invoice = parseInvoice(xml); // throws for not-yet-supported syntaxes
    totals = computeInvoice(invoice);
  } catch {
    /* leave the parsed view empty - the raw XML + detection still work */
  }

  return { isPdf, xml, meta, invoice, totals };
}

export function readInvoiceFile(path: string): ReadResult {
  return readInvoice(readFileSync(path));
}
