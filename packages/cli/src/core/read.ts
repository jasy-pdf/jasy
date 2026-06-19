import { readFileSync } from "node:fs";
import { extractEmbeddedXml } from "./extract.js";
import { detectInvoice, type InvoiceMeta } from "./detect.js";

// The "read anything" orchestrator: hand it the bytes of a ZUGFeRD/XRechnung PDF *or* a bare e-invoice
// XML and it gives back the XML + what it is. Ties extract + detect together; parse (→ Invoice) plugs
// in here next. UI-agnostic on purpose - the CLI command and the future TUI both call this.

export interface ReadResult {
  isPdf: boolean;
  xml: string;
  meta: InvoiceMeta;
}

/** Read an e-invoice from raw bytes — a PDF (embedded XML extracted) or raw XML (used as-is). */
export function readInvoice(data: Uint8Array): ReadResult {
  const buf = Buffer.from(data);
  const isPdf = buf.subarray(0, 5).toString("latin1") === "%PDF-";
  const xml = isPdf ? extractEmbeddedXml(buf) : buf.toString("utf-8");
  return { isPdf, xml, meta: detectInvoice(xml) };
}

export function readInvoiceFile(path: string): ReadResult {
  return readInvoice(readFileSync(path));
}
