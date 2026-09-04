import { describe, it, expect } from "vitest";
import { svgToIr, svgSize, SvgUnsupportedError } from "../../../src/lib/svg/index.ts";
import type { Path } from "../../../src/lib/ir/display-list.ts";

const BOX = { x: 0, y: 0, width: 100, height: 100 };
const ir = (body: string, viewBox = "0 0 100 100") =>
  svgToIr(`<svg viewBox="${viewBox}">${body}</svg>`, BOX);
const paths = (body: string, viewBox?: string) =>
  ir(body, viewBox).filter((n): n is Path => n.type === "path");

describe("shapes become paths", () => {
  it("keeps a rect's four corners", () => {
    const [p] = paths(`<rect x="10" y="20" width="30" height="40" />`);
    expect(p!.commands).toEqual([
      { op: "m", x: 10, y: 20 },
      { op: "l", x: 40, y: 20 },
      { op: "l", x: 40, y: 60 },
      { op: "l", x: 10, y: 60 },
      { op: "z" },
    ]);
  });

  it("closes a polygon but not a polyline", () => {
    const pts = `points="0,0 10,0 10,10"`;
    expect(paths(`<polygon ${pts} />`)[0]!.commands.at(-1)).toEqual({ op: "z" });
    expect(paths(`<polyline ${pts} stroke="red" />`)[0]!.commands.at(-1)).not.toEqual({ op: "z" });
  });

  it("draws a circle as four cubics that return to the start", () => {
    const c = paths(`<circle cx="50" cy="50" r="20" />`)[0]!.commands;
    expect(c.filter((s) => s.op === "c")).toHaveLength(4);
    expect(c[0]).toEqual({ op: "m", x: 30, y: 50 });
  });
});

describe("path data", () => {
  it("resolves relative coordinates and shorthands", () => {
    // `h`/`v` are relative here, and `s` needs the previous curve's reflected control point.
    const c = paths(`<path d="M0 0 h10 v10 c0 5 5 5 5 0 s5 -5 5 0" />`)[0]!.commands;
    expect(c[1]).toEqual({ op: "l", x: 10, y: 0 });
    expect(c[2]).toEqual({ op: "l", x: 10, y: 10 });
    expect(c.filter((s) => s.op === "c")).toHaveLength(2);
  });

  it("turns an arc into cubics, which PDF has no operator for", () => {
    const c = paths(`<path d="M10 10 a20 20 0 0 1 0 40" />`)[0]!.commands;
    expect(c.every((s) => s.op === "m" || s.op === "c")).toBe(true);
    const end = c.at(-1) as { x: number; y: number };
    expect([end.x, end.y].map(Math.round)).toEqual([10, 50]);
  });

  it("converts a quadratic, since PDF has only cubics", () => {
    const c = paths(`<path d="M0 0 Q6 9 12 0" />`)[0]!.commands;
    expect(c[1]).toMatchObject({ op: "c", x1: 4, y1: 6, x2: 8, y2: 6, x: 12, y: 0 });
  });
});

describe("style", () => {
  it("defaults to a black fill and no stroke, as SVG does", () => {
    const [p] = paths(`<rect width="10" height="10" />`);
    expect(p!.fill?.toPDFColorString()).toBe("0.000 0.000 0.000");
    expect(p!.stroke).toBeUndefined();
  });

  it("inherits fill from an ancestor group", () => {
    const [p] = paths(`<g fill="#1450aa"><rect width="10" height="10" /></g>`);
    expect(p!.fill?.toPDFColorString()).toBe("0.078 0.314 0.667");
  });

  it("lets a style bag win over the presentation attribute, as CSS does", () => {
    const [p] = paths(`<rect width="10" height="10" fill="red" style="fill:#000000" />`);
    expect(p!.fill?.toPDFColorString()).toBe("0.000 0.000 0.000");
  });

  it("treats fill=none as no paint, not as transparent black", () => {
    const [p] = paths(`<rect width="10" height="10" fill="none" stroke="red" />`);
    expect(p!.fill).toBeUndefined();
    expect(p!.stroke?.width).toBe(1);
  });

  it("folds opacity down into the paint", () => {
    const [p] = paths(`<g opacity="0.5"><rect width="10" height="10" fill-opacity="0.5" /></g>`);
    expect(p!.fill?.getAlpha()).toBeCloseTo(0.25, 5);
  });

  it("carries the even-odd rule through", () => {
    expect(paths(`<path d="M0 0h10v10z" fill-rule="evenodd" />`)[0]!.fillRule).toBe("evenodd");
  });

  it("drops a stroke with no width - it paints nothing", () => {
    expect(
      paths(`<rect width="9" height="9" stroke="red" stroke-width="0" />`)[0]!.stroke,
    ).toBeUndefined();
  });

  it("resolves currentColor against the inherited color", () => {
    const [p] = paths(`<g color="#1450aa"><rect width="9" height="9" fill="currentColor" /></g>`);
    expect(p!.fill?.toPDFColorString()).toBe("0.078 0.314 0.667");
  });
});

describe("transforms ride in the graphics state", () => {
  it("wraps a transformed group, so its stroke scales with it", () => {
    const nodes = ir(`<g transform="translate(5 5) scale(2)"><rect width="1" height="1" /></g>`);
    // Root mapping, then the group's own - and both are popped again.
    expect(nodes.filter((n) => n.type === "transform-push")).toHaveLength(2);
    expect(nodes.filter((n) => n.type === "transform-pop")).toHaveLength(2);
    // The group's own push is the second one - the first maps the viewBox onto the target box.
    const pushes = nodes.filter((n) => n.type === "transform-push");
    expect(pushes[1]).toMatchObject({ matrix: [2, 0, 0, 2, 5, 5] });
  });

  it("emits nothing for an identity transform", () => {
    const nodes = ir(`<g transform="translate(0 0)"><rect width="1" height="1" /></g>`);
    expect(nodes.filter((n) => n.type === "transform-push")).toHaveLength(1);
  });

  it("maps the viewBox onto the target box, scaling uniformly", () => {
    // A 200-wide viewBox into a 100-wide target halves everything.
    const nodes = svgToIr(`<svg viewBox="0 0 200 200"><rect width="1" height="1"/></svg>`, BOX);
    expect(nodes.find((n) => n.type === "transform-push")).toMatchObject({
      matrix: [0.5, 0, 0, 0.5, 0, 0],
    });
  });
});

describe("the root <svg> is a viewport", () => {
  it("clips to its box, as the browser does", () => {
    // An <svg> element has `overflow: hidden`. Without this a stroke sitting on the viewBox edge -
    // or a rounded cap - bleeds into whatever is laid out beside the drawing. Found by comparing
    // against headless Chrome, which cut exactly the parts we were still painting.
    const nodes = svgToIr(`<svg viewBox="0 0 10 10"><rect width="9" height="9"/></svg>`, BOX);
    expect(nodes[0]).toEqual({ type: "clip-push", x: 0, y: 0, width: 100, height: 100 });
    expect(nodes.at(-1)).toEqual({ type: "clip-pop" });
  });
});

describe("the edge of the subset is a named error, never a silent skip", () => {
  it("names the element and says what to do", () => {
    expect(() => ir(`<text x="0" y="0">Acme</text>`)).toThrow(SvgUnsupportedError);
    expect(() => ir(`<text x="0" y="0">Acme</text>`)).toThrow(/<text>.*outlines/s);
    expect(() => ir(`<use href="#a" />`)).toThrow(/<use>/);
  });

  it("names an unresolved paint reference where it is USED", () => {
    expect(() => ir(`<rect width="9" height="9" fill="url(#grad)" />`)).toThrow(/gradient/);
  });

  it("ignores elements that legitimately draw nothing", () => {
    expect(
      paths(`<title>Logo</title><desc>x</desc><defs></defs><rect width="9" height="9"/>`),
    ).toHaveLength(1);
  });
});

describe("svgSize", () => {
  it("prefers the declared width/height, then the viewBox", () => {
    expect(svgSize(`<svg width="40" height="20" viewBox="0 0 100 100"></svg>`)).toEqual({
      width: 40,
      height: 20,
    });
    expect(svgSize(`<svg viewBox="0 0 100 50"></svg>`)).toEqual({ width: 100, height: 50 });
  });
});
