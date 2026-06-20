import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { readInvoice } from "../core/read.js";
import { describeInvoice } from "../core/detect.js";
import { validateInvoiceXml, profileFor, type ValidationReport } from "../core/validate.js";
import { checkPdfA3, type PdfaReport } from "../core/pdfa.js";

// `jasy validate <file> [-v]` — runs the full local check (EN 16931 business rules + structural
// PDF/A-3) on a ZUGFeRD/XRechnung PDF or raw XML, prints a report, and exits non-zero when invalid
// (so it slots into scripts/CI). Same UI-agnostic core as the TUI.

const tty = process.stdout.isTTY;
const paint = (code: string, s: string): string => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string): string => paint("32", s);
const red = (s: string): string => paint("31", s);
const dim = (s: string): string => paint("2", s);
const bold = (s: string): string => paint("1", s);

export function validateCommand(args: string[]): void {
  const file = args.find((a) => !a.startsWith("-"));
  const verbose = args.includes("-v") || args.includes("--verbose");
  if (!file) {
    console.error("usage: jasy validate <file.pdf|file.xml> [-v]");
    process.exitCode = 1;
    return;
  }

  const base = process.env.INIT_CWD ?? process.cwd();
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolve(base, file));
  } catch (e) {
    console.error(red(`✗ could not read ${file}: ${(e as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const read = readInvoice(bytes);

  // XML business rules (Schematron) — EN 16931, plus the XRechnung BR-DE delta when it's an XRechnung.
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

  const ok = (!rules || rules.valid) && (!pdfa || pdfa.ok);
  console.log(`\n  → ${ok ? green(bold("VALID")) : red(bold("INVALID"))}\n`);
  if (!ok) process.exitCode = 1;
}
