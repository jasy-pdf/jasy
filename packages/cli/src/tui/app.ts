import { basename } from "node:path";
import { createScreen, createDraw, createInputManager } from "@jano-editor/ui";
import { readInvoiceFile, type ReadResult } from "../core/read.js";
import { describeInvoice } from "../core/detect.js";
import { openFileDialog } from "./file-open.js";

// clip a line so it never spills past the framed box (text starts at col 5, box is 64 wide)
const fit = (s: string, max = 58): string => (s.length > max ? s.slice(0, max - 1) + "…" : s);

// The interactive jasy terminal: a home screen, `o` opens the file picker, the loaded invoice is shown.
// Both this and the `jasy read` command call the same UI-agnostic core (readInvoiceFile).

const BRAND: [number, number, number] = [26, 79, 138];
const INK: [number, number, number] = [230, 234, 240];
const MUTED: [number, number, number] = [123, 135, 148];
const OK: [number, number, number] = [90, 170, 110];
const ERR: [number, number, number] = [200, 90, 90];

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

  let result: ReadResult | null = null;
  let error: string | null = null;
  let loaded: string | null = null;

  function render(): void {
    draw.clear();
    draw.rect(2, 1, 64, 13, { border: "round" });
    draw.text(5, 1, " jasy ", { fg: BRAND });
    draw.text(11, 1, "· ZUGFeRD / XRechnung terminal", { fg: INK });

    if (error) {
      draw.text(5, 4, fit("✗ " + error), { fg: ERR });
    } else if (result) {
      draw.text(5, 4, fit("✓ " + basename(loaded ?? "")), { fg: OK });
      draw.text(5, 6, fit("format     " + describeInvoice(result.meta)), { fg: INK });
      draw.text(5, 7, fit("guideline  " + (result.meta.guideline ?? "—")), { fg: MUTED });
      draw.text(5, 8, "source     " + (result.isPdf ? "PDF — embedded XML extracted" : "raw XML"), {
        fg: MUTED,
      });
      draw.text(5, 9, "XML        " + result.xml.length + " bytes", { fg: INK });
    } else {
      draw.text(5, 4, "No invoice loaded.", { fg: MUTED });
      draw.text(5, 6, "Read a ZUGFeRD / XRechnung PDF or XML and see what it is.", { fg: MUTED });
    }

    draw.text(5, 11, "o", { fg: BRAND });
    draw.text(7, 11, "open" + (result || error ? " another" : "") + "    ", { fg: INK });
    draw.text(18, 11, "q", { fg: BRAND });
    draw.text(20, 11, "quit", { fg: INK });
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
        result = readInvoiceFile(chosen);
        error = null;
        loaded = chosen;
      } catch (e) {
        error = (e as Error).message;
        result = null;
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
