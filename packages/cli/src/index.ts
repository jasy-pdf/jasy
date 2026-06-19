#!/usr/bin/env node
import { readCommand } from "./commands/read.js";
import { launchTui } from "./tui/app.js";

// jasy CLI entry. With a command (e.g. `jasy read invoice.pdf`) it runs non-interactively and exits;
// with no command it opens the interactive JANO terminal.

const argv = process.argv.slice(2);
const cmd = argv[0];

if (cmd === "read") {
  readCommand(argv.slice(1));
  process.exit(process.exitCode ?? 0);
}
// shorthand: `jasy some-invoice.pdf` == `jasy read some-invoice.pdf`
if (cmd && /\.(pdf|xml)$/i.test(cmd)) {
  readCommand(argv);
  process.exit(process.exitCode ?? 0);
}
if (cmd === "-h" || cmd === "--help") {
  printHelp();
  process.exit(0);
}

launchTui();

function printHelp(): void {
  console.log(`jasy — ZUGFeRD / XRechnung terminal

usage:
  jasy                        open the interactive terminal
  jasy read <file>            read a PDF/XML invoice and show what it is
  jasy read <file> --xml      print the embedded XML to stdout
  jasy read <file> -o x.xml   save the embedded XML to a file
`);
}
