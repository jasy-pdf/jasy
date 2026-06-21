#!/usr/bin/env node
import { readCommand } from "./commands/read.js";
import { validateCommand } from "./commands/validate.js";
import { exportCommand } from "./commands/export.js";
import { verapdfCommand } from "./commands/verapdf.js";
import { launchTui } from "./tui/app.js";

// jasy CLI entry. With a command (e.g. `jasy read invoice.pdf`) it runs non-interactively and exits;
// with no command it opens the interactive JANO terminal.

const argv = process.argv.slice(2);
const cmd = argv[0];

// run a command and return true (then we exit), or open the interactive TUI and return false (it owns
// the process). Wrapped in an async fn so `verapdf` can await without needing top-level await.
async function dispatch(): Promise<boolean> {
  if (cmd === "read") {
    readCommand(argv.slice(1));
    return true;
  }
  if (cmd === "validate") {
    validateCommand(argv.slice(1));
    return true;
  }
  if (cmd === "export") {
    exportCommand(argv.slice(1));
    return true;
  }
  if (cmd === "verapdf") {
    await verapdfCommand(argv.slice(1));
    return true;
  }
  // shorthand: `jasy some-invoice.pdf` == `jasy read some-invoice.pdf`
  if (cmd && /\.(pdf|xml)$/i.test(cmd)) {
    readCommand(argv);
    return true;
  }
  if (cmd === "-h" || cmd === "--help") {
    printHelp();
    return true;
  }
  launchTui();
  return false;
}

void dispatch().then((done) => {
  if (done) process.exit(process.exitCode ?? 0);
});

function printHelp(): void {
  console.log(`jasy - ZUGFeRD / XRechnung terminal

usage:
  jasy                        open the interactive terminal
  jasy read <file>            read a PDF/XML invoice and show what it is
  jasy read <file> --xml      print the embedded XML to stdout
  jasy read <file> -o x.xml   save the embedded XML to a file
  jasy validate <file>        check EN 16931 rules + PDF/A-3 structure (exit 1 if invalid)
  jasy validate <file> -v     also list every passing check
  jasy export <file> -f json  write the invoice as JSON (or txt) to stdout
  jasy export <file> -o x.xlsx export the invoice as a spreadsheet
  jasy verapdf                check the optional full-ISO PDF/A validator (veraPDF)
  jasy verapdf --install      install veraPDF locally for the full PDF/A check
`);
}
