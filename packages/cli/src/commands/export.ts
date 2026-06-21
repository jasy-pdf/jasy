import { readFileSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { readInvoice } from "../core/read.js";
import { exportInvoice, type ExportFormat } from "../core/export.js";

// `jasy export <file> [-f json|txt|xlsx] [-o out]` - read a ZUGFeRD/XRechnung PDF or XML and write the
// invoice out as JSON, plain text or a spreadsheet. Format comes from -f, else the -o extension, else json.

const FORMATS: Record<string, ExportFormat> = {
  json: "json",
  txt: "txt",
  text: "txt",
  xlsx: "xlsx",
  excel: "xlsx",
};

export function exportCommand(args: string[]): void {
  let file: string | undefined;
  let out: string | undefined;
  let fmtArg: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-f" || a === "--format") fmtArg = args[++i];
    else if (a === "-o" || a === "--out") out = args[++i];
    else if (!a.startsWith("-") && !file) file = a;
  }
  if (!file) {
    console.error("usage: jasy export <file.pdf|file.xml> [-f json|txt|xlsx] [-o out]");
    process.exitCode = 1;
    return;
  }

  const format = FORMATS[fmtArg ?? ""] ?? FORMATS[out ? extname(out).slice(1) : ""] ?? "json";
  if (format === "xlsx" && !out) {
    console.error("✗ xlsx is binary - give an output path with -o <file.xlsx>");
    process.exitCode = 1;
    return;
  }

  const base = process.env.INIT_CWD ?? process.cwd();
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolve(base, file));
  } catch (e) {
    console.error(`✗ could not read ${file}: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const r = readInvoice(bytes);
  if (!r.invoice || !r.totals) {
    console.error(`✗ could not parse the invoice (${r.meta.syntax}/${r.meta.profile})`);
    process.exitCode = 1;
    return;
  }

  const data = exportInvoice(r.invoice, r.totals, format);
  if (out) {
    writeFileSync(resolve(base, out), data);
    console.log(`✓ wrote ${format} → ${out}`);
  } else {
    process.stdout.write(data); // json/txt are strings (xlsx required -o above)
  }
}
