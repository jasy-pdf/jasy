import { writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { readInvoiceFile, type ReadResult } from "../core/read.js";
import { describeInvoice } from "../core/detect.js";

// `jasy read <file> [--xml] [-o out]` - read a ZUGFeRD / XRechnung PDF (or raw XML) and show the actual
// invoice (number, parties, lines, totals) for humans, or dump / save the embedded XML.

const tty = process.stdout.isTTY;
const paint = (c: string, s: string): string => (tty ? `\x1b[${c}m${s}\x1b[0m` : s);
const bold = (s: string): string => paint("1", s);
const dim = (s: string): string => paint("2", s);
const money = (n: number): string => n.toFixed(2);

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

  // resolve against where the user actually stood - pnpm scripts cd into the package dir
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

  console.log(`\n✓ ${bold(basename(file))}  ${dim("·")}  ${describeInvoice(r.meta)}\n`);

  const inv = r.invoice;
  if (inv && r.totals) {
    console.log(`  invoice    ${bold(inv.number)}`);
    console.log(`  date       ${inv.issueDate}${inv.dueDate ? dim(`   due ${inv.dueDate}`) : ""}`);
    console.log(`  from       ${inv.seller.name}`);
    console.log(`  to         ${inv.buyer.name}\n`);
    inv.lines.forEach((l, i) => {
      const left = `  ${l.quantity} ${l.unit}  ${l.name}`;
      console.log(left.padEnd(48) + money(r.totals!.lineNets[i]).padStart(12));
    });
    const t = r.totals;
    console.log("  " + dim("─".repeat(58)));
    console.log(
      `  ${dim("net")} ${money(t.taxBasisTotal)}   ${dim("VAT")} ${money(t.taxTotal)}   ${bold(`total ${money(t.grandTotal)} ${inv.currency}`)}`,
    );
    console.log(`\n  ${dim("→ --xml print the XML · -o <file> save it · jasy validate <file>")}`);
  } else {
    console.log(`  source     ${r.isPdf ? "PDF - embedded XML extracted" : "raw XML"}`);
    console.log(`  guideline  ${r.meta.guideline ?? "-"}`);
    console.log(`  XML        ${r.xml.length} bytes`);
    console.log(`\n  ${dim("→ --xml print the XML · -o <file> save it")}`);
  }
}
