import { describe, it, expect } from "vitest";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend.ts";
import { Color } from "../../../src/lib/common/color.ts";
import type { Path, PathCommand } from "../../../src/lib/ir/display-list.ts";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";

// The Path IR was fill-only, because its one producer was a colour glyph. An SVG shape may also
// stroke, stroke ONLY, and use the even-odd rule - so the node grew three optional fields and the
// backend now picks its painting operator from what the node actually carries.

const SQUARE: PathCommand[] = [
  { op: "m", x: 0, y: 0 },
  { op: "l", x: 10, y: 0 },
  { op: "l", x: 10, y: 10 },
  { op: "z" },
];

const draw = (path: Partial<Path>): string =>
  PdfBackend.serialize(
    [{ type: "path", commands: SQUARE, ...path } as Path],
    new PDFObjectManager(),
  );

const red = new Color(255, 0, 0);
const blue = new Color(0, 0, 255);

describe("which operator paints the path", () => {
  it("fills with `f`, as before", () => {
    expect(draw({ fill: red })).toContain("f\n");
    expect(draw({ fill: red })).not.toContain("S\n");
  });

  it("strokes with `S` when there is no fill", () => {
    const out = draw({ stroke: { color: blue, width: 2 } });
    expect(out).toContain("S\n");
    expect(out).not.toMatch(/\brg\b/);
    expect(out).toContain("2 w");
  });

  it("does both with `B`", () => {
    expect(draw({ fill: red, stroke: { color: blue, width: 1 } })).toContain("B\n");
  });

  it("paints nothing at all when there is neither", () => {
    // Legal SVG. Emitting the path without an operator would leave it pending and swallow the
    // next thing drawn on the page.
    expect(draw({})).toBe("");
  });

  it("uses the star operators for the even-odd rule", () => {
    expect(draw({ fill: red, fillRule: "evenodd" })).toContain("f*\n");
    expect(draw({ fill: red, stroke: { color: blue, width: 1 }, fillRule: "evenodd" })).toContain(
      "B*\n",
    );
  });
});

describe("the stroke's graphics state", () => {
  it("keeps itself inside a q/Q", () => {
    // `d`, `J`, `j` and `M` persist for the rest of the content stream. A dashed logo must not
    // dash the table rule drawn after it.
    const out = draw({ stroke: { color: blue, width: 1, dash: [3, 2] } });
    expect(out.startsWith("q\n")).toBe(true);
    expect(out.trimEnd().endsWith("Q")).toBe(true);
    expect(out).toContain("[3 2] 0 d");
  });

  it("states the miter limit, because SVG's default is not PDF's", () => {
    // SVG starts at 4, PDF at 10. Staying silent would grow a spike on every sharp corner.
    expect(draw({ stroke: { color: blue, width: 1 } })).toContain("4 M");
  });

  it("emits cap and join only when they differ from the default", () => {
    const plain = draw({ stroke: { color: blue, width: 1 } });
    expect(plain).not.toContain(" J");
    expect(plain).not.toContain(" j");
    const shaped = draw({ stroke: { color: blue, width: 1, cap: "round", join: "bevel" } });
    expect(shaped).toContain("1 J");
    expect(shaped).toContain("2 j");
  });

  it("drops an all-zero dash array, which is solid in SVG but an error in PDF", () => {
    expect(draw({ stroke: { color: blue, width: 1, dash: [0, 0] } })).not.toContain(" d\n");
  });
});
