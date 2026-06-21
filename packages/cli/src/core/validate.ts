import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import SaxonJS from "saxon-js";
import type { InvoiceMeta } from "./detect.js";

// FULL e-invoice validation, pure Node. Runs the official EN16931 / XRechnung **Schematron** business
// rules (the same ones KoSIT / Mustang apply) locally via SaxonJS - no upload, DSGVO-safe. The rules
// are vendored as gzipped SEF (SaxonJS's compiled form). This validates the XML (the legally decisive
// part). PDF/A-3 structural validation (veraPDF) is Java and stays an external/CI check.

export type ValidationProfile = "en16931-cii" | "en16931-ubl" | "xrechnung-cii" | "xrechnung-ubl";

// Which rule sets to run for a profile. XRechnung is a CIUS *on top of* EN 16931, so its files carry
// only the BR-DE delta - we run the EN 16931 base AND the XRechnung rules and merge the findings.
const RULE_SETS: Record<ValidationProfile, string[]> = {
  "en16931-cii": ["en16931-cii"],
  "en16931-ubl": ["en16931-ubl"],
  "xrechnung-cii": ["en16931-cii", "xrechnung-cii"],
  "xrechnung-ubl": ["en16931-ubl", "xrechnung-ubl"],
};

export interface Violation {
  id?: string; // the rule id, e.g. "BR-CO-15" / "BR-DE-15"
  test?: string; // the XPath assertion that failed
  location?: string; // where in the document
  text: string; // the human-readable message
}

export interface ValidationReport {
  profile: ValidationProfile;
  valid: boolean;
  errors: Violation[];
  warnings: Violation[];
}

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "validation");

/** The profile that matches what detect() found - picks the right syntax + CIUS automatically. */
export function profileFor(meta: InvoiceMeta): ValidationProfile {
  const ubl = meta.syntax === "UBL";
  if (meta.profile === "xrechnung") return ubl ? "xrechnung-ubl" : "xrechnung-cii";
  return ubl ? "en16931-ubl" : "en16931-cii";
}

function runRuleSet(set: string, xml: string): { errors: Violation[]; warnings: Violation[] } {
  const sef = gunzipSync(readFileSync(join(RULES_DIR, `${set}.sef.json.gz`))).toString("utf-8");
  const out = SaxonJS.transform(
    { stylesheetText: sef, sourceText: xml, destination: "serialized" },
    "sync",
  );
  return parseSvrl(out.principalResult ?? "");
}

/** Validate invoice XML against a profile's Schematron rules → a structured pass/fail report. */
export function validateInvoiceXml(xml: string, profile: ValidationProfile): ValidationReport {
  const errors: Violation[] = [];
  const warnings: Violation[] = [];
  for (const set of RULE_SETS[profile]) {
    const r = runRuleSet(set, xml);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
  }
  return { profile, valid: errors.length === 0, errors, warnings };
}

// The rules emit SVRL (Schematron Validation Report Language). Each <svrl:failed-assert> is a violation;
// flag="warning" downgrades it. Regex is enough for this well-formed machine output.
function parseSvrl(svrl: string): { errors: Violation[]; warnings: Violation[] } {
  const errors: Violation[] = [];
  const warnings: Violation[] = [];
  const re = /<svrl:failed-assert\b([^>]*)>([\s\S]*?)<\/svrl:failed-assert>/g;
  for (let m = re.exec(svrl); m; m = re.exec(svrl)) {
    const flag = attr(m[1], "flag") ?? attr(m[1], "role") ?? "fatal";
    const text = (m[2].match(/<svrl:text>([\s\S]*?)<\/svrl:text>/)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const violation: Violation = {
      id: text.match(/\[((?:BR|BG)-?[A-Z0-9-]+)\]/)?.[1],
      test: attr(m[1], "test"),
      location: attr(m[1], "location"),
      text,
    };
    // only fatal asserts fail validity; warning/information are advisory (Schematron flag levels)
    (/warn|info/i.test(flag) ? warnings : errors).push(violation);
  }
  return { errors, warnings };
}

function attr(s: string, name: string): string | undefined {
  return s.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}
