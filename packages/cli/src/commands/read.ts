import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { readInvoiceFile, type ReadResult } from "../core/read.js";
import { describeInvoice } from "../core/detect.js";

// `jasy read <file> [--xml] [-o out]` — the first user-facing taste of the core: read a ZUGFeRD /
// XRechnung PDF (or a raw XML), say what it is, and either summarise it or dump / save the XML.
export function readCommand(args: string[]): void {
  let file: string | undefined;
  let out: string | undefined;
  let dumpXml = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--xml") dumpXml = true;
    else if (a === "-o" || a === "--out") out = args[++i];
    else if (!a.startsWith("-") && !file) file = a;
  }

  if (!file) {
    console.error("usage: jasy read <file.pdf|file.xml> [--xml] [-o out.xml]");
    process.exitCode = 1;
    return;
  }

  // resolve against where the user actually stood — pnpm scripts cd into the package dir
  const base = process.env.INIT_CWD ?? process.cwd();
  let r: ReadResult;
  try {
    r = readInvoiceFile(resolve(base, file));
  } catch (e) {
    console.error(`✗ could not read ${file}: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  if (out) {
    writeFileSync(resolve(base, out), r.xml);
    console.log(`✓ wrote ${r.xml.length} bytes of XML → ${out}`);
    return;
  }
  if (dumpXml) {
    process.stdout.write(r.xml.endsWith("\n") ? r.xml : r.xml + "\n");
    return;
  }

  console.log(`✓ ${file}`);
  console.log(`  source     ${r.isPdf ? "PDF — embedded XML extracted" : "raw XML"}`);
  console.log(`  format     ${describeInvoice(r.meta)}`);
  console.log(`  guideline  ${r.meta.guideline ?? "—"}`);
  console.log(`  XML        ${r.xml.length} bytes`);
  console.log("\n  → add --xml to print the XML, or -o <file> to save it");
}
