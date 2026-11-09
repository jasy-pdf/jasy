// @jasy/angular - PDFs in Angular, the Angular way: provideJasy() in the app config, inject(JasyPdf)
// anywhere, pdfResource() for a preview that follows your signals, inject(JasyForms) for an existing
// PDF form. The documents themselves are written with @jasy/pdf (Document, Page, Text, ...); this
// package is the Angular side.
export {
  provideJasy,
  JASY_CONFIG,
  type JasyConfig,
  type FontFile,
  type FontInput,
} from "./config.js";
export type { PdfDocumentFn } from "./document.js";
export { JasyPdf, JasyBrowserOnlyError } from "./service.js";
export { pdfResource, type PdfFile, type PdfResourceOptions } from "./resource.js";
export {
  JasyForms,
  filledPdfResource,
  type FilledPdfResourceOptions,
  type FormValues,
} from "./forms.js";
export type { FileSource } from "./load.js";
