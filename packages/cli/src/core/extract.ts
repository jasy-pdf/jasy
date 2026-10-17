import { PdfDocument, readAttachments } from "@jasy/pdf/edit";

// PDF → embedded XML: the e-invoice inside a ZUGFeRD / Factur-X / XRechnung PDF/A-3, read through
// @jasy/pdf's own reader - every attachment the file lists, every filter, object streams, a damaged
// index rebuilt. The foundation the whole CLI hangs off (read → parse → validate).

// A PDF may embed SEVERAL files (a tool also attaches its own gobl.json or source), so the invoice is
// picked by name: factur-x.xml / zugferd-invoice.xml / xrechnung.xml / order-x.xml, then any .xml, then
// the first file.
const INVOICE_XML = /(factur-x|zugferd-invoice|xrechnung|order-x|cii)\.xml$/i;

/** The embedded XML of a ZUGFeRD / XRechnung PDF, as a UTF-8 string. Throws if the PDF carries none. */
export function extractEmbeddedXml(pdf: Uint8Array): string {
  const doc = PdfDocument.load(pdf);
  if (doc.isEncrypted) {
    throw new Error("This PDF is encrypted - an e-invoice (PDF/A-3) never is, so it is not one.");
  }
  const files = readAttachments(doc);
  const pick =
    files.find((f) => INVOICE_XML.test(f.name)) ??
    files.find((f) => /\.xml$/i.test(f.name)) ??
    files[0];
  if (!pick) throw new Error("No embedded XML found - is this a ZUGFeRD / Factur-X PDF?");
  return pick.text();
}
