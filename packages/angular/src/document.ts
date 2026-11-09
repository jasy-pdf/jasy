import type { PDFDocumentElement } from "@jasy/pdf";

/**
 * A PDF, written as a function from your data to a `Document(...)` tree. It runs in an injection
 * context, like a functional guard, so it may call `inject()` - for `LOCALE_ID`, a service, a config.
 *
 * ```ts
 * export const invoicePdf: PdfDocumentFn<Invoice> = (invoice) =>
 *   Document([Page([Text(`Invoice ${invoice.number}`, { size: 22, bold: true })])]);
 * ```
 */
export type PdfDocumentFn<T = void> = (data: T) => PDFDocumentElement | Promise<PDFDocumentElement>;
