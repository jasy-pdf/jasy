// @jasy/zugferd — ZUGFeRD / Factur-X / XRechnung (EN-16931) on top of the @jasy/pdf renderer.
// The invoice data model, the CII XML generator, the PDF/A-3 assembly and the (pluggable)
// validation live here, NOT in the layout core.

export * from "./invoice";
export { computeInvoice, round2 } from "./compute";
export type { ComputedInvoice, VatBreakdownEntry } from "./compute";
export { toCII } from "./cii";
export type { CiiProfile } from "./cii";
export { xrechnungProblems } from "./profile-check";
export { bundledFonts } from "./fonts";
export { facturxXmp } from "./xmp";
export type { XmpOptions } from "./xmp";
export { renderZugferd } from "./render";
export type { RenderZugferdOptions, ZugferdResult } from "./render";
export { defaultInvoiceTemplate } from "./template";
export { resolveLabels, makeFormatters } from "./i18n";
export type { Locale, InvoiceLabels, Formatters } from "./i18n";

/** ZUGFeRD / Factur-X conformance profiles, in rising order of data completeness. */
export type ZugferdProfile = "minimum" | "basic" | "en16931" | "extended" | "xrechnung";
