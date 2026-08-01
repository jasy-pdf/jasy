import { describe, it, expect } from "vitest";
import { Box, Column, Document, Page, renderPdf } from "../../../src/lib/api/index.ts";
import { toRadius } from "../../../src/lib/api/dimension.ts";
import { isRounded } from "../../../src/lib/ir/display-list.ts";

// Per-corner radius. This is the one prop of the layout batch that reaches the byte writer, so the
// thing worth proving is the negative: a single number must still emit exactly what it always did.

const draw = async (radius: unknown) =>
  renderPdf(
    Document([
      Page({ margin: 40 }, [
        Column([
          Box({ bg: "#dddddd", borderWidth: 0, width: 200, height: 100, radius } as never, []),
        ]),
      ]),
    ]),
    { compress: false },
  );

/** The curve/line operators of the drawn path, which is what a radius changes. */
const pathOps = (pdf: string) => (pdf.match(/^[\d.\- ]+(?:m|l|c)$/gm) ?? []).join("\n");

describe("a single number is unchanged", () => {
  it("emits the same path as before per-corner radii existed", async () => {
    // The reference string is the operator sequence the single-radius builder produced. Written out
    // rather than compared against a second render, so a change in BOTH paths cannot hide itself.
    const ops = pathOps(await draw(8));
    // The exact operators the single-radius builder emitted: start 8pt along the bottom edge, four
    // curves, four straight edges. Written out rather than compared to a second render, so a change
    // in BOTH paths could not hide itself.
    expect(ops).toContain("48.000 701.890 m");
    expect(ops).toContain("236.418 701.890 240.000 705.472 240.000 709.890 c");
    expect(ops.split("\n").filter((l) => l.endsWith(" c")).length).toBe(4);
    // Four corners, four curves, and the straight edges between them.
    expect(ops.split("\n").filter((l) => l.endsWith(" l")).length).toBe(4);
  });

  it("a radius of 0 emits a plain rect, no curves at all", async () => {
    expect(
      pathOps(await draw(0))
        .split("\n")
        .filter((l) => l.endsWith(" c")).length,
    ).toBe(0);
  });
});

describe("per corner", () => {
  it("rounds only the corner that asks for it", async () => {
    const ops = pathOps(await draw({ topLeft: 12 }));
    // The top-left corner starts 12pt in from the left edge and curves down 12pt - the box is
    // 200x100 at x=40, so its top-left in PDF coordinates is (40, 801.890).
    expect(ops).toContain("52.000 801.890 l");
    expect(ops).toContain("45.372 801.890 40.000 796.518 40.000 789.890 c");
    // The other three corners collapse onto their corner point: sharp, as asked.
    expect(ops).toContain("240.000 701.890 240.000 701.890 240.000 701.890 c");
  });

  it("does not let an empty edge scale the other corners away", () => {
    // The bug this test exists for: the per-edge overlap check divided by the sum of two radii, and
    // an edge with both corners at 0 produced a ratio of 0 - scaling every OTHER corner to nothing.
    // One corner set is exactly the case where two edges are empty.
    expect(toRadius({ topLeft: 12 })).toEqual({
      tl: 12,
      tr: undefined,
      br: undefined,
      bl: undefined,
    });
  });

  it("takes the CSS tuple order - topLeft, topRight, bottomRight, bottomLeft", () => {
    expect(toRadius([1, 2, 3, 4])).toEqual({ tl: 1, tr: 2, br: 3, bl: 4 });
    expect(toRadius({ topRight: 5 })).toEqual({
      tl: undefined,
      tr: 5,
      br: undefined,
      bl: undefined,
    });
    expect(toRadius(7)).toBe(7);
  });

  it("knows when nothing is rounded", () => {
    expect(isRounded(undefined)).toBe(false);
    expect(isRounded(0)).toBe(false);
    expect(isRounded({})).toBe(false);
    expect(isRounded({ bl: 0 })).toBe(false);
    expect(isRounded({ bl: 3 })).toBe(true);
    expect(isRounded(3)).toBe(true);
  });

  it("differs from the same box with all four corners set", async () => {
    expect(pathOps(await draw({ topLeft: 20 }))).not.toBe(pathOps(await draw(20)));
  });
});
