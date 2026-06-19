import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { createScreen, createDraw, createInputManager, type RGB } from "@jano-editor/ui";
import { readInvoice, type ReadResult } from "../core/read.js";
import { describeInvoice } from "../core/detect.js";
import { checkPdfA3, type PdfaReport } from "../core/pdfa.js";
import { validateInvoiceXml, type ValidationReport } from "../core/validate.js";
import { openFileDialog } from "./file-open.js";

// The interactive jasy terminal: `o` opens a file picker, then the loaded invoice is shown together
// with its checks — EN 16931 business rules + structural PDF/A-3. Same core as the `jasy read` command.

const BRAND: RGB = [26, 79, 138];
const INK: RGB = [230, 234, 240];
const MUTED: RGB = [123, 135, 148];
const FAINT: RGB = [80, 85, 95];
const OK: RGB = [90, 170, 110];
const ERR: RGB = [200, 90, 90];

const TOP = 1;
const MAX_W = 72; // cap so the box doesn't sprawl on very wide terminals

interface Loaded {
  path: string;
  read: ReadResult;
  pdfa: PdfaReport | null;
  rules: ValidationReport | null;
}

interface Row {
  text: string;
  fg: RGB;
  status?: string;
  statusFg?: RGB;
}

// clip a line so it never spills past the framed box
const fit = (s: string, max: number): string => (s.length > max ? s.slice(0, max - 1) + "…" : s);

export function launchTui(): void {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log(
      "jasy — ZUGFeRD / XRechnung terminal. Run me in an interactive terminal (or try `jasy read <file>`).",
    );
    process.exit(0);
  }

  const screen = createScreen();
  const draw = createDraw(screen);
  const input = createInputManager();

  let loaded: Loaded | null = null;
  let error: string | null = null;

  function buildRows(w: number): Row[] {
    if (error) return [{ text: fit("✗ " + error, w - 6), fg: ERR }];
    if (!loaded) {
      return [
        { text: "No invoice loaded.", fg: MUTED },
        { text: "", fg: MUTED },
        { text: "Open a ZUGFeRD / XRechnung PDF or XML —", fg: MUTED },
        { text: "jasy extracts the XML, identifies it, and checks it.", fg: MUTED },
      ];
    }
    const { read, pdfa, rules } = loaded;
    const rows: Row[] = [
      { text: fit("✓ " + basename(loaded.path), w - 6), fg: OK },
      {
        text: fit(describeInvoice(read.meta) + " · " + read.xml.length + " B XML", w - 6),
        fg: MUTED,
      },
      { text: "", fg: MUTED },
    ];

    // EN 16931 business rules (XML Schematron)
    rows.push({
      text: "EN 16931 rules",
      fg: INK,
      status: rules ? (rules.valid ? "OK" : `${rules.errors.length} errors`) : "n/a",
      statusFg: rules ? (rules.valid ? OK : ERR) : FAINT,
    });
    if (rules && !rules.valid) {
      for (const e of rules.errors.slice(0, 4)) {
        rows.push({ text: fit("  ✗ " + (e.id ? `[${e.id}] ` : "") + e.text, w - 6), fg: ERR });
      }
    }

    // structural PDF/A-3 (per check)
    rows.push({ text: "", fg: MUTED });
    rows.push({
      text: "PDF/A-3 structure",
      fg: INK,
      status: pdfa ? `${pdfa.checks.filter((c) => c.ok).length}/${pdfa.checks.length}` : "raw XML",
      statusFg: pdfa ? (pdfa.ok ? OK : ERR) : FAINT,
    });
    if (pdfa) {
      for (const c of pdfa.checks) {
        rows.push({
          text: fit("  " + c.label, w - 14),
          fg: MUTED,
          status: c.ok ? "OK" : "FAILED",
          statusFg: c.ok ? OK : ERR,
        });
      }
    }
    return rows;
  }

  function render(): void {
    const cols = screen.width;
    const w = Math.max(44, Math.min(cols - 2, MAX_W));
    const x = Math.max(1, Math.floor((cols - w) / 2)); // centre the box
    const statusEnd = x + w - 3;
    const rows = buildRows(w);

    draw.clear();
    draw.rect(x, TOP, w, rows.length + 5, { border: "round" });
    draw.text(x + 2, TOP, " jasy · ZUGFeRD / XRechnung ", { fg: BRAND });

    rows.forEach((r, i) => {
      const y = TOP + 2 + i;
      draw.text(x + 2, y, r.text, { fg: r.fg });
      if (r.status) draw.text(statusEnd - r.status.length, y, r.status, { fg: r.statusFg ?? r.fg });
    });

    // footer (spaced so nothing collides)
    const footerY = TOP + 2 + rows.length + 1;
    draw.text(x + 2, footerY, "o", { fg: BRAND });
    draw.text(x + 4, footerY, loaded || error ? "open another" : "open", { fg: INK });
    draw.text(x + 20, footerY, "q", { fg: BRAND });
    draw.text(x + 22, footerY, "quit", { fg: INK });
    draw.flush();
  }

  function quit(): void {
    input.stop();
    process.stdin.setRawMode(false);
    screen.showCursor();
    screen.leave();
    process.exit(0);
  }

  async function openFlow(): Promise<void> {
    const chosen = await openFileDialog({ screen, draw, input, startDir: process.cwd(), quit });
    if (chosen) {
      try {
        const bytes = readFileSync(chosen);
        const read = readInvoice(bytes);
        const pdfa = read.isPdf ? checkPdfA3(bytes) : null;
        let rules: ValidationReport | null = null;
        if (read.meta.syntax === "CII") {
          try {
            rules = validateInvoiceXml(read.xml, "en16931-cii");
          } catch {
            rules = null; // rule set for this profile not bundled (yet)
          }
        }
        loaded = { path: chosen, read, pdfa, rules };
        error = null;
      } catch (e) {
        error = (e as Error).message;
        loaded = null;
      }
    }
    render();
  }

  screen.enter();
  screen.hideCursor();
  process.stdin.setRawMode(true); // no echo — keys & mouse go to JANO, not the tty
  input.start();

  const main = input.pushLayer("main");
  main.on("key", (key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      quit();
      return true;
    }
    if (key.name === "o") {
      void openFlow();
      return true;
    }
  });
  main.on("resize", () => render());
  main.on("mouse:click", () => true);
  main.on("mouse:drag", () => true);
  main.on("mouse:release", () => true);
  main.on("mouse:scroll", () => true);

  render();
}
