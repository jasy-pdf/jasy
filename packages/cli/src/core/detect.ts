// Identifies an e-invoice XML at a glance: which syntax (UN/CEFACT CII vs OASIS UBL) and which
// profile (plain EN16931 vs the German XRechnung CIUS). Pure tag/regex inspection - no full parse
// needed (that comes later). Lets the CLI say "ZUGFeRD EN16931 (CII)" before doing anything heavy.

export type Syntax = "CII" | "UBL" | "unknown";
export type Profile = "en16931" | "xrechnung" | "unknown";

export interface InvoiceMeta {
  syntax: Syntax;
  profile: Profile;
  /** The raw guideline / customization identifier (BT-24). */
  guideline: string | null;
}

export function detectInvoice(xml: string): InvoiceMeta {
  const syntax: Syntax = /<(?:rsm:)?CrossIndustryInvoice/.test(xml)
    ? "CII"
    : /<Invoice\b[^>]*urn:oasis:names:specification:ubl/.test(xml) || /<(?:\w+:)?Invoice\b/.test(xml)
      ? "UBL"
      : "unknown";

  // BT-24: CII carries it in GuidelineSpecified…/ram:ID, UBL in cbc:CustomizationID.
  const guideline =
    xml.match(/GuidelineSpecifiedDocumentContextParameter>\s*<(?:ram:)?ID>([^<]+)</)?.[1] ??
    xml.match(/<(?:cbc:)?CustomizationID>([^<]+)</)?.[1] ??
    null;

  const profile: Profile = !guideline
    ? "unknown"
    : /xrechnung/i.test(guideline)
      ? "xrechnung"
      : /en16931:2017/.test(guideline)
        ? "en16931"
        : "unknown";

  return { syntax, profile, guideline };
}

/** A short human label, e.g. "ZUGFeRD · EN 16931 (CII)" or "XRechnung (UBL)". */
export function describeInvoice(meta: InvoiceMeta): string {
  const profile = meta.profile === "xrechnung" ? "XRechnung" : meta.profile === "en16931" ? "EN 16931" : "unknown profile";
  const family = meta.profile === "xrechnung" ? "XRechnung" : "ZUGFeRD";
  return `${family} · ${profile} (${meta.syntax})`;
}
