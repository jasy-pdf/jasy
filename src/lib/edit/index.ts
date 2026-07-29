/**
 * `@jasy/pdf/edit` - reading and filling the form of an EXISTING PDF.
 *
 * A separate entry point on purpose. Creating a document never needs the parser, and a browser bundle
 * that only generates should not carry it - the same reason jimp is kept out of the text path. Importing
 * `@jasy/pdf` alone pulls in none of this.
 *
 * The scope is deliberately narrow: AcroForm fields, and nothing else. This is not a PDF editor. What we
 * do not understand, we leave untouched, and what we cannot do safely we refuse by name.
 */

export { readAcroForm } from "./acroform-reader.ts";
export type { ReadField, ReadForm, ReadWidget } from "./acroform-reader.ts";

export { fillForm, FillError } from "./fill.ts";
export type { FieldValue, FillOptions, FillResult } from "./fill.ts";

// The document itself, for callers who want to look further than the form.
export { PdfDocument } from "./document.ts";
export type { PdfDict, PdfName, PdfObject, PdfRef, PdfStream, PdfString } from "./objects.ts";
