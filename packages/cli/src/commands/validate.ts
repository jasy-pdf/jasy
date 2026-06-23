import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { readInvoice, type ReadResult } from "../core/read.js";
import { describeInvoice } from "../core/detect.js";
import { validateInvoiceXml, profileFor, type ValidationReport } from "../core/validate.js";
import { checkPdfA3, type PdfaReport } from "../core/pdfa.js";
import { findVerapdf, runVeraPdf, type VeraReport } from "../core/verapdf.js";

// `jasy validate <file> [--json] [-v]` - runs the full local check (EN 16931 business rules +
// structural PDF/A-3, plus veraPDF when installed) on a ZUGFeRD/XRechnung PDF or raw XML, prints a
// report (or `--json` for scripts/CI/services), and exits non-zero when invalid. Same core as the TUI.

const tty = process.stdout.isTTY;
const paint = (code: string, s: string): string => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string): string => paint("32", s);
const red = (s: string): string => paint("31", s);
const dim = (s: string): string => paint("2", s);
const bold = (s: string): string => paint("1", s);

export function validateCommand(args: string[]): void {
  const file = args.find((a) => !a.startsWith("-"));
  const verbose = args.includes("-v") || args.includes("--verbose");
  const json = args.includes("--json");

  const fail = (msg: string): void => {
    if (json) console.log(JSON.stringify({ error: msg }));
    else console.error(red(`✗ ${msg}`));
    process.exitCode = 1;
  };

  if (!file) {
    fail("usage: jasy validate <file.pdf|file.xml> [--json] [-v]");
    return;
  }

  const base = process.env.INIT_CWD ?? process.cwd();
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolve(base, file));
  } catch (e) {
    fail(`could not read ${file}: ${(e as Error).message}`);
    return;
  }

  const read = readInvoice(bytes);

  // XML business rules (Schematron) - EN 16931, plus the XRechnung BR-DE delta when it's an XRechnung.
  // The rule set is picked automatically from what detect() found (syntax + CIUS).
  let rules: ValidationReport | null = null;
  if (read.meta.syntax !== "unknown") {
    try {
      rules = validateInvoiceXml(read.xml, profileFor(read.meta));
    } catch {
      rules = null;
    }
  }
  const pdfa: PdfaReport | null = read.isPdf ? checkPdfA3(bytes) : null;

  // Full ISO 19005 (PDF/A) via veraPDF - only when installed; never blocks, just adds the official seal.
  let vera: VeraReport | null = null;
  if (read.isPdf && findVerapdf()) {
    try {
      vera = runVeraPdf(resolve(base, file));
    } catch {
      vera = null;
    }
  }

  // VALID requires that we actually recognised EN 16931 invoice data: a file we could not parse as an
  // invoice (random bytes, or a plain PDF with no embedded XML) is "not an invoice" - never "valid".
  const recognized = read.meta.syntax !== "unknown";
  const ok = recognized && (!rules || rules.valid) && (!pdfa || pdfa.ok) && (!vera || vera.ok);
  if (!ok) process.exitCode = 1;

  if (json) {
    console.log(JSON.stringify(toJson(file, read, rules, pdfa, vera, recognized, ok)));
    return;
  }

  printReport(file, read, rules, pdfa, vera, recognized, ok, verbose);
}

/** The machine-readable report (`--json`): the exact same data the printed report shows. */
function toJson(
  file: string,
  read: ReadResult,
  rules: ValidationReport | null,
  pdfa: PdfaReport | null,
  vera: VeraReport | null,
  recognized: boolean,
  ok: boolean,
) {
  return {
    file: basename(file),
    summary: describeInvoice(read.meta),
    recognized,
    valid: ok,
    businessRules: rules && {
      kind: rules.profile.startsWith("xrechnung") ? "XRechnung" : "EN 16931",
      profile: rules.profile,
      valid: rules.valid,
      errors: rules.errors,
      warnings: rules.warnings,
    },
    pdfA3: pdfa && {
      valid: pdfa.ok,
      passed: pdfa.checks.filter((c) => c.ok).length,
      total: pdfa.checks.length,
      checks: pdfa.checks,
    },
    // null when it isn't a PDF; { available: false } when it is but veraPDF isn't installed.
    veraPdf: read.isPdf
      ? vera
        ? {
            available: true,
            valid: vera.ok,
            profile: vera.profile,
            failedRules: vera.failedRules ?? vera.failures.length,
            failures: vera.failures,
          }
        : { available: false }
      : null,
  };
}

/** The human-readable report (default): a coloured summary line + per-check detail. */
function printReport(
  file: string,
  read: ReadResult,
  rules: ValidationReport | null,
  pdfa: PdfaReport | null,
  vera: VeraReport | null,
  recognized: boolean,
  ok: boolean,
  verbose: boolean,
): void {
  const label = (s: string): string => s.padEnd(20);
  console.log(`\n  ${bold(basename(file))}  ${dim("·")}  ${describeInvoice(read.meta)}\n`);

  // business rules
  if (rules) {
    const n = rules.errors.length;
    const name = rules.profile.startsWith("xrechnung") ? "XRechnung rules" : "EN 16931 rules";
    console.log(
      `  ${label(name)}${rules.valid ? green("✓ valid") : red(`✗ ${n} error${n === 1 ? "" : "s"}`)}`,
    );
    for (const e of rules.errors)
      console.log(`    ${red("✗")} ${e.id ? bold(`[${e.id}]`) + " " : ""}${e.text}`);
    if (verbose)
      for (const w of rules.warnings)
        console.log(`    ${dim(`! ${w.id ? `[${w.id}] ` : ""}${w.text}`)}`);
  } else {
    console.log(`  ${label("business rules")}${dim("n/a (unrecognised XML)")}`);
  }

  // PDF/A-3 structure
  if (pdfa) {
    const passed = pdfa.checks.filter((c) => c.ok).length;
    const tot = pdfa.checks.length;
    console.log(
      `  ${label("PDF/A-3 structure")}${pdfa.ok ? green(`✓ ${passed}/${tot}`) : red(`✗ ${passed}/${tot}`)}`,
    );
    for (const c of pdfa.checks) {
      if (!c.ok || verbose)
        console.log(
          `    ${c.ok ? green("✓") : red("✗")} ${c.label}${c.detail ? dim(`  ${c.detail}`) : ""}`,
        );
    }
  } else {
    console.log(`  ${label("PDF/A-3 structure")}${dim("n/a (raw XML)")}`);
  }

  // full ISO 19005 (PDF/A) via veraPDF
  if (vera) {
    const n = vera.failedRules ?? vera.failures.length;
    console.log(
      `  ${label("PDF/A (veraPDF)")}${vera.ok ? green("✓ compliant") : red(`✗ ${n} failed`)}`,
    );
    if (!vera.ok)
      for (const f of vera.failures)
        console.log(`    ${red("✗")} ISO clause ${f.clause}${dim(`  (${f.failedChecks} checks)`)}`);
  } else if (read.isPdf) {
    console.log(
      `  ${label("PDF/A (veraPDF)")}${dim("n/a - `jasy verapdf --install` for the full ISO check")}`,
    );
  }

  if (!recognized)
    console.log(
      `\n  → ${red(bold("NOT A ZUGFeRD / XRECHNUNG INVOICE"))}  ${dim("(no EN 16931 data found)")}\n`,
    );
  else console.log(`\n  → ${ok ? green(bold("VALID")) : red(bold("INVALID"))}\n`);
}
