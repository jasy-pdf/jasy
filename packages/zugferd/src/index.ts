// @jasy/zugferd - ZUGFeRD / Factur-X / XRechnung (EN-16931) on top of the @jasy/pdf renderer.
// The invoice data model, the CII XML generator, the PDF/A-3 assembly and the (pluggable)
// validation live here, NOT in the layout core.

export * from "./invoice.ts";
export { computeInvoice, round2 } from "./compute.ts";
export type { ComputedInvoice, VatBreakdownEntry } from "./compute.ts";
export { toCII } from "./cii.ts";
export { toUBL } from "./ubl.ts";
export type { CiiProfile } from "./cii.ts";
export { xrechnungProblems } from "./profile-check.ts";
export { bundledFonts } from "./fonts.ts";
export { facturxXmp } from "./xmp.ts";
export type { XmpOptions } from "./xmp.ts";
export { renderZugferd } from "./render.ts";
export type { RenderZugferdOptions, ZugferdResult } from "./render.ts";
export { defaultInvoiceTemplate } from "./template.ts";
export { resolveLabels, makeFormatters } from "./i18n.ts";
export type { Locale, InvoiceLabels, Formatters } from "./i18n.ts";

/** ZUGFeRD / Factur-X conformance profiles, in rising order of data completeness. */
export type ZugferdProfile = "minimum" | "basic" | "en16931" | "extended" | "xrechnung";
