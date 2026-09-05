import { describe, it, expect } from "vitest";
import { CanvasPainter } from "../../../src/lib/canvas/painter.ts";
import { linearGradient } from "../../../src/lib/api/gradient.ts";
import type { Path } from "../../../src/lib/ir/display-list.ts";

// The painter is the SECOND producer of the vector layer, so it emits the same `Path` nodes an SVG
// does - no new IR, no backend change. What is tested here is the surface a user actually touches.

const painter = () => new CanvasPainter({ width: 100, height: 50 });
const paths = (draw: (c: CanvasPainter) => void): Path[] => {
  const c = painter();
  draw(c);
  return c.drawn().filter((n): n is Path => n.type === "path");
};

describe("a path is finished by painting it", () => {
  it("emits one node per fill or stroke", () => {
    const out = paths((c) => {
      c.rect(0, 0, 10, 10).fill("red");
      c.rect(20, 0, 10, 10).stroke("blue");
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.fill).toBeDefined();
    expect(out[0]!.stroke).toBeUndefined();
    expect(out[1]!.stroke?.color.toPDFColorString()).toBe("0.000 0.000 1.000");
  });

  it("starts a new path afterwards, so a shape cannot leak into the next", () => {
    const out = paths((c) => {
      c.rect(0, 0, 10, 10).fill();
      c.rect(20, 0, 10, 10).fill();
    });
    expect(out[0]!.commands).toHaveLength(5);
    expect(out[1]!.commands).toHaveLength(5);
  });

  it("draws nothing for a path nobody painted", () => {
    expect(paths((c) => void c.rect(0, 0, 10, 10))).toHaveLength(0);
  });

  it("does both with fillAndStroke", () => {
    const [p] = paths((c) => void c.circle(5, 5, 4).fillAndStroke("red", "blue", { width: 2 }));
    expect(p!.fill).toBeDefined();
    expect(p!.stroke?.width).toBe(2);
  });
});

describe("the shapes", () => {
  it("closes a rect on its four corners", () => {
    const [p] = paths((c) => void c.rect(1, 2, 10, 20).fill());
    expect(p!.commands).toEqual([
      { op: "m", x: 1, y: 2 },
      { op: "l", x: 11, y: 2 },
      { op: "l", x: 11, y: 22 },
      { op: "l", x: 1, y: 22 },
      { op: "z" },
    ]);
  });

  it("draws a circle as four cubics", () => {
    const [p] = paths((c) => void c.circle(10, 10, 5).fill());
    expect(p!.commands.filter((s) => s.op === "c")).toHaveLength(4);
  });

  it("raises a quadratic to the cubic PDF needs", () => {
    const [p] = paths((c) => void c.move(0, 0).quad(6, 9, 12, 0).stroke());
    expect(p!.commands[1]).toMatchObject({ op: "c", x1: 4, y1: 6, x2: 8, y2: 6, x: 12, y: 0 });
  });

  it("reads SVG path data, arcs included", () => {
    const [p] = paths((c) => void c.path("M0 0 h10 a5 5 0 0 1 0 10 z").fill());
    expect(p!.commands.every((s) => ["m", "l", "c", "z"].includes(s.op))).toBe(true);
  });

  it("leaves the pen where SVG leaves it - a `z` returns to the subpath start", () => {
    // A `quad` after a closed path used the last POINT seen, which is not where the pen is.
    const [p] = paths((c) => void c.path("M10 10 h10 v10 z").quad(30, 30, 20, 20).stroke());
    expect(p!.commands.at(-1)).toMatchObject({ x1: 23.333333333333332, y1: 23.333333333333332 });
  });
});

describe("scopes close themselves - there is no restore() to forget", () => {
  it("wraps a group in a transform pair", () => {
    const c = painter();
    c.group({ translate: [5, 5] }, (g) => void g.rect(0, 0, 4, 4).fill());
    const kinds = c.drawn().map((n) => n.type);
    expect(kinds).toEqual(["transform-push", "path", "transform-pop"]);
  });

  it("composes translate, rotate and scale around an origin", () => {
    const c = painter();
    c.group({ translate: [10, 0], scale: 2 }, () => {});
    expect(c.drawn()[0]).toMatchObject({ matrix: [2, 0, 0, 2, 10, 0] });
  });

  it("turns clockwise, like every other rotation in the engine", () => {
    const c = painter();
    c.group({ rotate: 90 }, () => {});
    const m = (c.drawn()[0] as { matrix: number[] }).matrix;
    expect(m[1]).toBeCloseTo(1, 10);
    expect(m[2]).toBeCloseTo(-1, 10);
  });

  it("clips with the shape `build` drew, and paints nothing from it", () => {
    const c = painter();
    c.clipped(
      (clip) => void clip.circle(10, 10, 5),
      (draw) => void draw.rect(0, 0, 20, 20).fill(),
    );
    const kinds = c.drawn().map((n) => n.type);
    expect(kinds).toEqual(["clip-path-push", "path", "clip-pop"]);
    // Exactly one path: the clip shape is geometry, never ink.
    expect(c.drawn().filter((n) => n.type === "path")).toHaveLength(1);
  });
});

// Found while reviewing: a path built BEFORE a scope was silently swallowed when the scope closed -
// the user's shape simply disappeared. It cannot be carried across either, because it would be built
// in one coordinate space and painted in another.
describe("a path may not cross the edge of a scope", () => {
  it("names it instead of dropping the shape", () => {
    expect(() => {
      const c = painter();
      c.rect(0, 0, 10, 10);
      c.group({ translate: [50, 0] }, (g) => void g.circle(5, 5, 4).fill());
    }).toThrow(/never filled or stroked/);
  });

  it("names one left behind INSIDE a scope too", () => {
    expect(() => {
      const c = painter();
      c.group({ translate: [50, 0] }, (g) => void g.rect(0, 0, 4, 4));
    }).toThrow(/group\(\)/);
  });

  it("is happy when every path is painted", () => {
    expect(() => {
      const c = painter();
      c.rect(0, 0, 10, 10).fill();
      c.group({ translate: [50, 0] }, (g) => void g.circle(5, 5, 4).fill());
    }).not.toThrow();
  });
});

describe("paint", () => {
  it("defaults to black, as SVG and PDF do", () => {
    const [p] = paths((c) => void c.rect(0, 0, 4, 4).fill());
    expect(p!.fill && "toPDFColorString" in p.fill && p.fill.toPDFColorString()).toBe(
      "0.000 0.000 0.000",
    );
  });

  it("takes any ColorInput the rest of the API takes", () => {
    const [p] = paths((c) => void c.rect(0, 0, 4, 4).fill("rgb(20, 90, 170)"));
    expect(p!.fill && "toPDFColorString" in p.fill && p.fill.toPDFColorString()).toBe(
      "0.078 0.353 0.667",
    );
  });

  it("resolves a gradient against the SHAPE's own box, as SVG does", () => {
    const [p] = paths(
      (c) =>
        void c.rect(10, 20, 40, 10).fill(linearGradient({ angle: 90, stops: ["#000", "#fff"] })),
    );
    const fill = p!.fill as { type: string; x0: number; x1: number };
    expect(fill.type).toBe("linear");
    expect([fill.x0, fill.x1]).toEqual([10, 50]);
  });

  it("carries the even-odd rule through", () => {
    const [p] = paths((c) => void c.rect(0, 0, 9, 9).fill("red", { rule: "evenodd" }));
    expect(p!.fillRule).toBe("evenodd");
  });
});
