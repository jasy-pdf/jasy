import { SupportingDocument } from "./invoice.ts";

// BG-24 - the extra documents that travel with an invoice: a timesheet, a proof of service, a
// delivery note. Anyone billing by effort has one, and sending it separately by mail is exactly the
// break in the chain that e-invoicing exists to close.
//
// A supporting document reaches the recipient TWICE and that is deliberate: base64 inside the XML,
// where a machine finds it, and as a PDF/A-3 embedded file, where a person double-clicks it. Doing
// only the first would hide the document from every human reader of the invoice.

/** Base64, written out rather than borrowed: `Buffer` is Node-only and `btoa` mangles bytes > 0x7f. */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ALPHABET[(triple >> 18) & 63]! + ALPHABET[(triple >> 12) & 63]!;
    out += i + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63]! : "=";
    out += i + 2 < bytes.length ? ALPHABET[triple & 63]! : "=";
  }
  return out;
}

/**
 * The documents that carry an actual file, ready for `renderToBytes({ attachments })`.
 *
 * `relationship: "Supplement"` is the PDF/A-3 term for "extra material" - the invoice XML itself is
 * "Data", and calling both the same would tell a reader that the timesheet is the invoice.
 */
export function pdfAttachments(
  documents: SupportingDocument[] | undefined,
): { name: string; data: Uint8Array; relationship: "Supplement"; mimeType: string }[] {
  return (documents ?? [])
    .filter((d) => d.file)
    .map((d) => ({
      name: d.file!.filename,
      data: d.file!.content,
      relationship: "Supplement" as const,
      mimeType: d.file!.mimeType,
    }));
}

/** Problems with a supporting document, in the wording `profile-check` uses. */
export function supportingDocumentProblems(
  documents: SupportingDocument[] | undefined,
  where: string,
): string[] {
  const problems: string[] = [];
  (documents ?? []).forEach((d, i) => {
    const at = `${where}[${i}]`;
    if (!d.reference) problems.push(`${at}.reference is required (BT-122).`);
    // Neither a file nor a link means the reference points at nothing the recipient can reach.
    if (!d.file && !d.url) {
      problems.push(
        `${at} has neither a file nor a url - a supporting document the recipient cannot open is only a name (BT-124 or BT-125).`,
      );
    }
    if (d.file && !d.file.filename) problems.push(`${at}.file.filename is required by the schema.`);
    if (d.file && !d.file.mimeType) problems.push(`${at}.file.mimeType is required by the schema.`);
  });
  return problems;
}
