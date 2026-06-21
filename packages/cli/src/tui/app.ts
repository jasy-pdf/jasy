import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createScreen, createDraw, createInputManager, type RGB } from "@jano-editor/ui";
import { readInvoice, type ReadResult } from "../core/read.js";
import { describeInvoice } from "../core/detect.js";
import { checkPdfA3, type PdfaReport } from "../core/pdfa.js";
import { validateInvoiceXml, profileFor, type ValidationReport } from "../core/validate.js";
import { exportInvoice, type ExportFormat } from "../core/export.js";
import { openFileDialog } from "./file-open.js";

// The interactive jasy terminal: `o` opens a file picker, then the loaded invoice is shown together
// with its checks - EN 16931 business rules + structural PDF/A-3. Same core as the `jasy read` command.

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
const money = (n: number): string => n.toFixed(2);

export function launchTui(): void {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log(
      "jasy - ZUGFeRD / XRechnung terminal. Run me in an interactive terminal (or try `jasy read <file>`).",
    );
    process.exit(0);
  }

  const screen = createScreen();
  const draw = createDraw(screen);
  const input = createInputManager();

  let loaded: Loaded | null = null;
  let error: string | null = null;
  let notice: string | null = null; // last export result, shown in the footer
  let scroll = 0; // first visible body row (the body scrolls; the header stays pinned)
  let pageSize = 1; // body rows per screen, set in render() - used by PgUp/PgDn

  // The pinned top: a one-line confirmation of which file + what it is (stays put while body scrolls).
  function buildHeader(w: number): Row[] {
    if (error || !loaded) return [];
    const { read } = loaded;
    return [
      { text: fit("✓ " + basename(loaded.path), w - 6), fg: OK },
      {
        text: fit(describeInvoice(read.meta) + " · " + read.xml.length + " B XML", w - 6),
        fg: MUTED,
      },
    ];
  }

  // The scrollable body: the parsed invoice + its checks (or the empty / error message).
  function buildBody(w: number): Row[] {
    if (error) return [{ text: fit("✗ " + error, w - 6), fg: ERR }];
    if (!loaded) {
      return [
        { text: "No invoice loaded.", fg: MUTED },
        { text: "", fg: MUTED },
        { text: "Open a ZUGFeRD / XRechnung PDF or XML -", fg: MUTED },
        { text: "jasy extracts the XML, identifies it, and checks it.", fg: MUTED },
      ];
    }
    const { read, pdfa, rules } = loaded;
    const rows: Row[] = [];

    // the parsed invoice itself (number, parties, lines, totals)
    const inv = read.invoice;
    if (inv && read.totals) {
      const t = read.totals;
      rows.push({ text: fit(inv.number, w - 16), fg: INK, status: inv.issueDate, statusFg: MUTED });
      rows.push({ text: fit(`${inv.seller.name}  →  ${inv.buyer.name}`, w - 6), fg: MUTED });
      rows.push({ text: "", fg: MUTED });
      for (const [i, l] of inv.lines.entries()) {
        rows.push({
          text: fit(`${l.quantity} ${l.unit}  ${l.name}`, w - 14),
          fg: INK,
          status: money(t.lineNets[i]),
          statusFg: MUTED,
        });
      }
      rows.push({
        text: `net ${money(t.taxBasisTotal)}   VAT ${money(t.taxTotal)}`,
        fg: MUTED,
        status: `${money(t.grandTotal)} ${inv.currency}`,
        statusFg: INK,
      });
      rows.push({ text: "", fg: MUTED });
    }

    // XML business rules (Schematron) - EN 16931, + XRechnung BR-DE when applicable
    rows.push({
      text: rules?.profile.startsWith("xrechnung") ? "XRechnung rules" : "EN 16931 rules",
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
    const screenH = screen.height;
    const w = Math.max(44, Math.min(cols - 2, MAX_W));
    const x = Math.max(1, Math.floor((cols - w) / 2)); // centre the box
    const statusEnd = x + w - 3;

    const header = buildHeader(w); // pinned
    const body = buildBody(w); // scrollable
    const canExport = !!(loaded?.read.invoice && loaded.read.totals);

    // fit the box to the terminal height: pin the header, scroll the body in whatever is left
    const headBlock = header.length ? header.length + 1 : 0; // header rows + a separator blank
    const overhead = 5 + headBlock + (notice ? 1 : 0); // borders + blanks + footer around the body
    const maxBodyH = Math.max(1, screenH - TOP - overhead);
    const viewH = Math.min(body.length, maxBodyH);
    pageSize = viewH;
    const maxScroll = Math.max(0, body.length - viewH);
    scroll = Math.max(0, Math.min(scroll, maxScroll));
    const visible = body.slice(scroll, scroll + viewH);
    const boxH = 5 + headBlock + viewH + (notice ? 1 : 0);

    const drawRow = (r: Row, y: number): void => {
      draw.text(x + 2, y, r.text, { fg: r.fg });
      if (r.status) draw.text(statusEnd - r.status.length, y, r.status, { fg: r.statusFg ?? r.fg });
    };

    draw.clear();
    draw.rect(x, TOP, w, boxH, { border: "round" });
    draw.text(x + 2, TOP, " jasy · ZUGFeRD / XRechnung ", { fg: BRAND });

    let y = TOP + 2;
    for (const r of header) drawRow(r, y++);
    if (header.length) y++; // separator blank
    const bodyTop = y;
    for (const r of visible) drawRow(r, y++);

    // scrollbar on the right inner edge, only when the body overflows the viewport
    if (maxScroll > 0) {
      const thumbH = Math.max(1, Math.round((viewH * viewH) / body.length));
      const thumbAt = Math.round((scroll * (viewH - thumbH)) / maxScroll);
      for (let i = 0; i < viewH; i++) {
        const on = i >= thumbAt && i < thumbAt + thumbH;
        draw.text(x + w - 2, bodyTop + i, on ? "█" : "░", { fg: on ? BRAND : FAINT });
      }
    }

    // footer: open, export shortcuts (when an invoice is parsed), quit - drawn left to right
    const footerY = bodyTop + viewH + 1;
    let fx = x + 2;
    const key = (k: string, label: string): void => {
      draw.text(fx, footerY, k, { fg: BRAND });
      draw.text(fx + k.length + 1, footerY, label, { fg: INK });
      fx += k.length + 1 + label.length + 2;
    };
    key("o", loaded || error ? "open another" : "open");
    if (canExport) {
      key("j", "JSON");
      key("t", "TXT");
      key("x", "XLSX");
    }
    key("q", "quit");
    if (notice) {
      draw.text(x + 2, footerY + 1, fit(notice, w - 4), { fg: notice.startsWith("✓") ? OK : ERR });
    }
    draw.flush();
  }

  function scrollBy(delta: number): void {
    scroll += delta;
    render(); // render() clamps scroll to the valid range
  }

  function quit(): void {
    input.stop();
    process.stdin.setRawMode(false);
    screen.showCursor();
    screen.leave();
    process.exit(0);
  }

  function exportTo(format: ExportFormat): void {
    const inv = loaded?.read.invoice;
    if (!inv || !loaded?.read.totals) return;
    const name = `${inv.number.replace(/[^\w.-]+/g, "_")}.${format === "txt" ? "txt" : format}`;
    try {
      writeFileSync(resolve(process.cwd(), name), exportInvoice(inv, loaded.read.totals, format));
      notice = `✓ wrote ${name}`;
    } catch (e) {
      notice = `✗ export failed: ${(e as Error).message}`;
    }
    render();
  }

  async function openFlow(): Promise<void> {
    const chosen = await openFileDialog({ screen, draw, input, startDir: process.cwd(), quit });
    if (chosen) {
      notice = null;
      scroll = 0;
      try {
        const bytes = readFileSync(chosen);
        const read = readInvoice(bytes);
        const pdfa = read.isPdf ? checkPdfA3(bytes) : null;
        let rules: ValidationReport | null = null;
        if (read.meta.syntax !== "unknown") {
          try {
            rules = validateInvoiceXml(read.xml, profileFor(read.meta));
          } catch {
            rules = null;
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
  process.stdin.setRawMode(true); // no echo - keys & mouse go to JANO, not the tty
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
    if ((key.name === "j" || key.name === "t" || key.name === "x") && loaded?.read.invoice) {
      exportTo(key.name === "j" ? "json" : key.name === "t" ? "txt" : "xlsx");
      return true;
    }
    if (key.name === "up") {
      scrollBy(-1);
      return true;
    }
    if (key.name === "down") {
      scrollBy(1);
      return true;
    }
    if (key.name === "pageup") {
      scrollBy(-pageSize);
      return true;
    }
    if (key.name === "pagedown") {
      scrollBy(pageSize);
      return true;
    }
    if (key.name === "home") {
      scrollBy(-Number.MAX_SAFE_INTEGER);
      return true;
    }
    if (key.name === "end") {
      scrollBy(Number.MAX_SAFE_INTEGER);
      return true;
    }
  });
  main.on("resize", () => render());
  main.on("mouse:click", () => true);
  main.on("mouse:drag", () => true);
  main.on("mouse:release", () => true);
  main.on("mouse:scroll", (e) => {
    if (e.type === "scroll-up") scrollBy(-3);
    else if (e.type === "scroll-down") scrollBy(3);
    return true;
  });

  render();
}
