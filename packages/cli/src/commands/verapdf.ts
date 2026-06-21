import { resolve } from "node:path";
import { detectTools, installVeraPdf, runVeraPdf, findVerapdf } from "../core/verapdf.js";

// `jasy verapdf` - a guided doctor for the optional full-ISO PDF/A validator:
//   jasy verapdf            explain what veraPDF is + show Java / veraPDF status (✓ / ✗) + next steps
//   jasy verapdf --install  download + install it into ~/.jasy/verapdf (no admin, no account)
//   jasy verapdf <file>     validate a PDF with veraPDF and print the report

const tty = process.stdout.isTTY;
const paint = (c: string, s: string): string => (tty ? `\x1b[${c}m${s}\x1b[0m` : s);
const green = (s: string): string => paint("32", s);
const red = (s: string): string => paint("31", s);
const dim = (s: string): string => paint("2", s);
const bold = (s: string): string => paint("1", s);

export async function verapdfCommand(args: string[]): Promise<void> {
  if (args.includes("--install")) return install();
  const file = args.find((a) => !a.startsWith("-"));
  if (file) return validateFile(file);
  doctor();
}

function doctor(): void {
  const t = detectTools();
  console.log(`
  ${bold("veraPDF")} - the official open-source PDF/A validator (PDF Association).
  It checks a PDF against the full ISO 19005 (PDF/A) standard - the exact
  conformance a ZUGFeRD / Factur-X invoice PDF must meet. Runs 100% locally;
  your invoice never leaves the machine. Free, no account.
`);
  const row = (label: string, ok: boolean, detail: string): void =>
    console.log(`  ${label.padEnd(11)}${ok ? green("✓ " + detail) : red("✗ " + detail)}`);
  row("Java", !!t.java, t.java ?? "not found");
  row(
    "veraPDF",
    !!t.verapdf,
    t.verapdf ? `${t.verapdf}  ${dim(t.verapdfPath ?? "")}` : "not found",
  );
  console.log("");

  if (!t.java) {
    console.log(`  ${dim("Java is required - veraPDF is a Java app. Install a JRE 11+:")}`);
    console.log(`    ${dim("macOS")}   brew install --cask temurin`);
    console.log(`    ${dim("Ubuntu")}  sudo apt install default-jre`);
    console.log(`    ${dim("Windows")} winget install EclipseAdoptium.Temurin.21.JRE`);
  }
  if (!t.verapdf) {
    console.log(
      `  ${dim("Then install veraPDF (no admin, into ~/.jasy/verapdf):")}  ${bold("jasy verapdf --install")}`,
    );
  } else if (t.java) {
    console.log(
      `  ${green("Ready.")} ${dim("`jasy validate <file>` now adds the full ISO PDF/A check automatically.")}`,
    );
  }
}

async function install(): Promise<void> {
  try {
    const bin = await installVeraPdf((s) => console.log(`  ${dim(s)}`));
    console.log(`  ${green("✓ veraPDF installed")}  ${dim(bin)}`);
    console.log(`  ${dim("`jasy validate <file>` now runs the full ISO PDF/A check.")}`);
  } catch (e) {
    console.error(`  ${red("✗ " + (e as Error).message)}`);
    process.exitCode = 1;
  }
}

function validateFile(file: string): void {
  if (!findVerapdf()) {
    console.error(`  ${red("✗ veraPDF is not installed")} - run ${bold("jasy verapdf --install")}`);
    process.exitCode = 1;
    return;
  }
  const base = process.env.INIT_CWD ?? process.cwd();
  try {
    const r = runVeraPdf(resolve(base, file));
    const head = r.ok
      ? green("✓ compliant")
      : red(`✗ ${r.failedRules ?? r.failures.length} rule(s) failed`);
    console.log(`\n  ${r.profile ?? "PDF/A"}   ${head}`);
    for (const f of r.failures) {
      const n = f.failedChecks;
      console.log(
        `    ${red("✗")} ISO clause ${bold(f.clause)}  ${dim(`(${n} check${n === 1 ? "" : "s"})`)}`,
      );
    }
    if (!r.ok) process.exitCode = 1;
  } catch (e) {
    console.error(`  ${red("✗ " + (e as Error).message)}`);
    process.exitCode = 1;
  }
}
