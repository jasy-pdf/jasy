#!/usr/bin/env node
import { createScreen, createDraw, createInputManager } from "@jano-editor/ui";

// The jasy CLI scaffold: opens the JANO terminal, draws a branded frame, quits on q / Ctrl-C.
// The real screens (read a PDF → validate → export) hang off this skeleton next.

// JANO's RGB is a [r, g, b] tuple.
const BRAND: [number, number, number] = [26, 79, 138];
const INK: [number, number, number] = [230, 234, 240];
const MUTED: [number, number, number] = [123, 135, 148];

if (!process.stdout.isTTY) {
  console.log("jasy — ZUGFeRD / XRechnung terminal. Run me in an interactive terminal.");
  process.exit(0);
}

const screen = createScreen();
const draw = createDraw(screen);
const input = createInputManager();

function render(): void {
  draw.clear();
  draw.rect(2, 1, 56, 9, { border: "round" });
  draw.text(5, 3, "jasy", { fg: BRAND });
  draw.text(10, 3, "· ZUGFeRD / XRechnung terminal", { fg: INK });
  draw.text(5, 5, "read PDFs · validate · export JSON / TXT / Excel", { fg: MUTED });
  draw.text(5, 7, "scaffold ready — press q to quit", { fg: MUTED });
  draw.flush();
}

function quit(): void {
  input.stop();
  screen.showCursor();
  screen.leave();
  process.exit(0);
}

screen.enter();
screen.hideCursor();
input.start();

const main = input.pushLayer("main");
main.on("key", (key) => {
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    quit();
    return true;
  }
});
main.on("resize", () => render());

render();
