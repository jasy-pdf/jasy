import { describe, it, expect } from "vitest";
import { svgToIr, SvgUnsupportedError } from "../../../src/lib/svg/index.ts";
import { Image, Svg } from "../../../src/lib/api/index.ts";
import { toColor } from "../../../src/lib/api/color.ts";
import type { Gradient, Path, StrokeStyle } from "../../../src/lib/ir/display-list.ts";

// `Number.parseFloat` stops at the first character it cannot use and returns what it had, so "10px"
// is 10 and "20abc" is 20. Convenient exactly once and wrong everywhere else: a length misread that
// way draws a shape the file never described. 53 of 10,819 real files put `px` on a shape attribute.

const BOX = { x: 0, y: 0, width: 100, height: 100 };
const first = (body: string) =>
  svgToIr(`<svg viewBox="0 0 100 100">${body}</svg>`, BOX).find(
    (n): n is Path => n.type === "path",
  );

describe("lengths on a shape", () => {
  it("reads px as the user unit, instead of dropping the shape", () => {
    const withUnit = first(`<rect width="40px" height="10px"/>`);
    const plain = first(`<rect width="40" height="10"/>`);
    expect(withUnit?.commands).toEqual(plain?.commands);
  });

  it("converts the other absolute units", () => {
    // 1pt = 96/72 user units, and SVG pins the user unit to 1/96 inch.
    const pt = first(`<rect width="72pt" height="10"/>`)!.commands[1] as { x: number };
    expect(pt.x).toBeCloseTo(96, 5);
  });

  it("names a unit it cannot resolve without a font or a viewport", () => {
    expect(() => first(`<rect width="2em" height="10"/>`)).toThrow(SvgUnsupportedError);
    expect(() => first(`<rect width="50%" height="10"/>`)).toThrow(/50%/);
  });

  it("refuses a number that overflows to Infinity", () => {
    // It would reach the content stream as the literal text `Infinity`, and viewers discard the
    // rest of the page over it.
    expect(first(`<rect width="1e400" height="1e400"/>`)).toBeUndefined();
  });
});

describe("opacity and stroke width", () => {
  const strokeOf = (attributes: string): StrokeStyle | undefined =>
    first(`<rect width="9" height="9" stroke="#000" ${attributes}/>`)?.stroke;

  it("reads a percentage opacity", () => {
    // `Number("50%")` is NaN, which used to travel straight into the paint.
    expect(first(`<rect width="9" height="9" opacity="50%"/>`)?.fill?.getAlpha?.()).toBeCloseTo(
      0.5,
      5,
    );
  });

  it("clamps an opacity outside 0..1, as CSS does", () => {
    expect(first(`<rect width="9" height="9" opacity="7"/>`)?.fill?.getAlpha?.()).toBe(1);
    expect(first(`<rect width="9" height="9" opacity="-3"/>`)?.fill?.getAlpha?.()).toBe(0);
  });

  it("reads a px stroke width", () => {
    expect(strokeOf(`stroke-width="3px"`)?.width).toBe(3);
  });
});

describe("colour functions reject a component with trailing text", () => {
  it("does not read rgb(20abc, 90, 170) as rgb(20, 90, 170)", () => {
    expect(() => toColor("rgb(20abc, 90, 170)")).toThrow(/Unknown color/);
    expect(() => toColor("hsl(120deg, 100%, 50%)")).toThrow(/Unknown color/);
    expect(() => toColor("rgba(20, 90, 170, 0.5x)")).toThrow(/Unknown color/);
  });

  it("still reads the valid forms", () => {
    expect(toColor("rgb(20, 90, 170)").toPDFColorString()).toBe("0.078 0.353 0.667");
    expect(toColor("rgb(50%, 0%, 100%)").toPDFColorString()).toBe("0.500 0.000 1.000");
  });
});

describe("gradient stops are kept inside what a PDF function accepts", () => {
  const gradientOf = (stops: string): Gradient => {
    const fill = first(
      `<linearGradient id="g">${stops}</linearGradient>` +
        `<rect width="9" height="9" fill="url(#g)"/>`,
    )!.fill!;
    if ("toPDFColorString" in fill) throw new Error("expected a gradient");
    return fill;
  };

  it("clamps an offset outside 0..1", () => {
    const g = gradientOf(
      `<stop offset="-1" stop-color="#000"/><stop offset="3" stop-color="#fff"/>`,
    );
    expect(g.stops.map((s) => s.offset)).toEqual([0, 1]);
  });

  it("raises an offset that goes backwards, as SVG says", () => {
    // A decreasing pair would become an invalid Domain in the stitching function.
    const g = gradientOf(
      `<stop offset=".8" stop-color="#000"/><stop offset=".2" stop-color="#fff"/>`,
    );
    expect(g.stops.map((s) => s.offset)).toEqual([0.8, 0.8]);
  });

  it("clamps a stop-opacity outside 0..1", () => {
    expect(
      gradientOf(
        `<stop stop-color="#000" stop-opacity="5"/><stop offset="1" stop-color="#fff" stop-opacity="5"/>`,
      ).alpha,
    ).toBe(1);
  });
});

describe("what the root and the outer API refuse", () => {
  /** Both halves matter: the TYPE is what a caller catches, the hint is what they act on. */
  const expectNamed = (run: () => unknown, feature: RegExp, hint: RegExp) => {
    expect(run).toThrow(SvgUnsupportedError);
    expect(run).toThrow(feature);
    expect(run).toThrow(hint);
  };

  it("holds the root <svg> to the same attribute rules as its children", () => {
    expectNamed(
      () => svgToIr(`<svg viewBox="0 0 10 10" filter="url(#f)"><rect/></svg>`, BOX),
      /"filter" on <svg>/,
      /rasterise that part to a PNG/,
    );
  });

  it("names a nested <svg>, which is a viewport and not a group", () => {
    // Walking it as a group would place and scale its children wrong, in silence.
    expectNamed(
      () => first(`<svg x="10" y="10"><rect width="5" height="5"/></svg>`),
      /nested <svg>/,
      /Flatten it into the outer drawing/,
    );
  });

  it("sees a refused effect through the cascade, not just as a raw attribute", () => {
    // `filter="url(#f)"` and `style="filter:url(#f)"` are the same instruction, and a <style> rule
    // can set either - checking only the attribute let the other two through unnoticed.
    expect(() => first(`<g style="filter:url(#f)"><rect width="9" height="9"/></g>`)).toThrow(
      SvgUnsupportedError,
    );
    expect(() =>
      first(`<style>.a{mask:url(#m)}</style><rect class="a" width="9" height="9"/>`),
    ).toThrow(SvgUnsupportedError);
  });

  it("applies a clip set through the cascade too", () => {
    const nodes = svgToIr(
      `<svg viewBox="0 0 10 10"><clipPath id="c"><rect width="5" height="5"/></clipPath>` +
        `<rect style="clip-path:url(#c)" width="9" height="9"/></svg>`,
      BOX,
    );
    expect(nodes.some((n) => n.type === "clip-path-push")).toBe(true);
  });

  it("returns the fallback when a unit conversion overflows", () => {
    expect(first(`<rect width="1e308in" height="10"/>`)).toBeUndefined();
  });

  it("names an .svgz, which is gzipped and not markup", () => {
    expect(() => Image("logo.svgz")).toThrow(/SVGZ/);
  });

  it("still routes a plain .svg to the vector path", () => {
    expect(() => Svg(`<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>`)).not.toThrow();
  });
});
