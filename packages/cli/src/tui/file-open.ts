import { readdirSync, statSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import {
  drawList,
  listMoveUp,
  listMoveDown,
  type Screen,
  type Draw,
  type InputManager,
  type ListItem,
  type ListState,
} from "@jano-editor/ui";

// A modal path picker. Type a path; it live-filters the current dir to sub-dirs + *.pdf / *.xml.
// The list scrolls (↑↓), Tab completes to the highlighted entry, ⏎ descends into a dir or loads a
// file, Esc / Ctrl-C escape. Resolves to the chosen file path, or null on cancel. UI only.

interface Deps {
  screen: Screen;
  draw: Draw;
  input: InputManager;
  startDir: string;
  quit: () => void; // emergency exit - Ctrl-C must always escape, even from inside the modal
}

const BRAND: [number, number, number] = [26, 79, 138];
const INK: [number, number, number] = [230, 234, 240];
const MUTED: [number, number, number] = [123, 135, 148];
const FAINT: [number, number, number] = [80, 85, 95];
const ROWS = 10; // visible window height; the list scrolls beyond it

export function openFileDialog({
  screen,
  draw,
  input,
  startDir,
  quit,
}: Deps): Promise<string | null> {
  return new Promise((done) => {
    let path = startDir.endsWith("/") ? startDir : startDir + "/";
    let items: ListItem[] = [];
    let state: ListState = { selectedIndex: 0, scrollOffset: 0 };
    const layer = input.pushLayer("open");

    const refresh = (): void => {
      const dir = path.endsWith("/") ? path : dirname(path);
      const prefix = path.endsWith("/") ? "" : basename(path);
      // offer ".." to climb out of the folder (only while browsing, not mid-typing, and not at root)
      const cur = dir.replace(/\/+$/, "") || "/";
      const parent = dirname(cur);
      const up: ListItem[] =
        prefix === "" && parent !== cur
          ? [{ label: "../", value: parent === "/" ? "/" : parent + "/" }]
          : [];
      try {
        const entries = readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.name.startsWith(prefix))
          .filter((e) => e.isDirectory() || /\.(pdf|xml)$/i.test(e.name))
          .sort(
            (a, b) =>
              Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
          )
          .map((e) => {
            const full = join(dir, e.name);
            return e.isDirectory()
              ? { label: e.name + "/", value: full + "/" }
              : { label: e.name, value: full };
          });
        items = [...up, ...entries];
      } catch {
        items = up;
      }
      state = { selectedIndex: 0, scrollOffset: 0 };
    };

    const render = (): void => {
      const cols = screen.width;
      const w = Math.max(44, Math.min(cols - 2, 72));
      const x = Math.max(1, Math.floor((cols - w) / 2)); // centre the dialog
      const y = 2;
      const avail = w - 11; // keep the text + cursor strictly inside the right border
      const shown = path.length > avail ? "…" + path.slice(-(avail - 1)) : path;
      draw.clear();
      draw.rect(x, y, w, ROWS + 6, { border: "round" });
      draw.text(x + 2, y, " open invoice ", { fg: BRAND });
      draw.text(x + 2, y + 1, "path:", { fg: MUTED });
      draw.text(x + 8, y + 1, shown + "▌", { fg: INK });
      if (items.length) {
        drawList(draw, {
          x: x + 2,
          y: y + 3,
          width: w - 4,
          height: ROWS,
          items,
          selectedIndex: state.selectedIndex,
          scrollOffset: state.scrollOffset,
        });
      } else {
        draw.text(x + 2, y + 3, "(no matching folders / .pdf / .xml here)", { fg: MUTED });
      }
      const pos = items.length ? `${state.selectedIndex + 1}/${items.length}` : "0";
      draw.text(x + 2, y + ROWS + 4, `↑↓ pick (${pos}) · Tab complete · ⏎ open · Esc cancel`, {
        fg: FAINT,
      });
      draw.flush();
    };

    const close = (result: string | null): void => {
      input.popLayer(layer);
      done(result);
    };

    const current = (): ListItem | undefined => items[state.selectedIndex];

    layer.on("key", (key) => {
      if (key.ctrl && key.name === "c") {
        quit(); // never returns - restores the tty and exits
        return true;
      }
      if (key.name === "escape" || (key.raw.length === 1 && key.raw[0] === 0x1b)) {
        close(null);
      } else if (key.name === "up") {
        state = listMoveUp(state, items);
        render();
      } else if (key.name === "down") {
        state = listMoveDown(state, items, ROWS);
        render();
      } else if (key.name === "tab") {
        const c = current();
        if (c) {
          path = c.value;
          refresh();
          render();
        }
      } else if (key.name === "enter" || key.name === "return") {
        const c = current();
        if (c && c.value.endsWith("/")) {
          path = c.value; // descend into the folder (or climb via "../")
          refresh();
          render();
        } else if (c) {
          close(c.value); // load the file
        } else {
          try {
            if (statSync(path).isFile()) close(path);
          } catch {
            /* nothing to open */
          }
        }
      } else if (key.name === "backspace") {
        path = path.slice(0, -1);
        refresh();
        render();
      } else if (!key.ctrl && !key.alt && key.name.length === 1) {
        path += key.name;
        refresh();
        render();
      }
      return true; // modal swallows everything (Ctrl-C / Esc handled above)
    });
    layer.on("mouse:click", () => true);
    layer.on("mouse:scroll", () => true);

    refresh();
    render();
  });
}
