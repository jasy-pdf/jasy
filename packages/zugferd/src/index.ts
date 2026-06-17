// @jasy-pdf/zugferd — ZUGFeRD / Factur-X / XRechnung (EN-16931) on top of the jasy-pdf renderer.
// The invoice data model, the CII XML generator, the PDF/A-3 assembly and the (pluggable)
// validation live here, NOT in the layout core. Slice 0: package skeleton + workspace wiring.
import { renderPdf } from "jasy-pdf";

/** ZUGFeRD / Factur-X conformance profiles, in rising order of data completeness. */
export type ZugferdProfile = "minimum" | "basic" | "en16931" | "extended" | "xrechnung";

// Proves the workspace wiring: the layout core is importable from this package.
export const core = { renderPdf };
