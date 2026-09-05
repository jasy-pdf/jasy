import { describe, it, expect } from "vitest";
import { svgToIr, SvgUnsupportedError } from "../../../src/lib/svg/index.ts";
import type { Gradient, Path } from "../../../src/lib/ir/display-list.ts";

// The backend has painted shadings since colour emoji, so this is about POSITIONING one: in its
// default units a gradient's anchors are fractions of the bounding box of the shape it fills, which
// is why it can only be resolved where it is used.

const BOX = { x: 0, y: 0, width: 100, height: 100 };
const gradientOf = (body: string, viewBox = "0 0 100 100"): Gradient => {
  const fill = svgToIr(`<svg viewBox="${viewBox}">${body}</svg>`, BOX).find(
    (n): n is Path => n.type === "path",
  )?.fill;
  if (!fill || "toPDFColorString" in fill) throw new Error("expected a gradient fill");
  return fill;
};

const LINEAR = `<linearGradient id="g"><stop stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>`;

describe("units", () => {
  it("resolves objectBoundingBox against the SHAPE, which is the default", () => {
    // x1 defaults to 0 and x2 to 1, i.e. the left and right edge of the shape - not of the page.
    const g = gradientOf(
      `<defs>${LINEAR}</defs><rect x="20" y="30" width="40" height="10" fill="url(#g)"/>`,
    );
    expect([g.x0, g.y0]).toEqual([20, 30]);
    expect([g.x1, g.y1]).toEqual([60, 30]);
  });

  it("leaves userSpaceOnUse coordinates alone", () => {
    const g = gradientOf(
      `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="5" y1="6" x2="7" y2="8">` +
        `<stop stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient>` +
        `<rect x="20" y="30" width="40" height="10" fill="url(#g)"/>`,
    );
    expect([g.x0, g.y0, g.x1, g.y1]).toEqual([5, 6, 7, 8]);
  });
});

describe("href chains", () => {
  it("inherits stops from the gradient it references", () => {
    // Illustrator emits one gradient with the stops and a second that only moves the coordinates.
    const g = gradientOf(
      `<defs>${LINEAR}<linearGradient id="h" xlink:href="#g" x1="0" x2="0" y1="0" y2="1"/></defs>` +
        `<rect width="50" height="50" fill="url(#h)"/>`,
    );
    expect(g.stops).toHaveLength(2);
    expect([g.x0, g.y0, g.x1, g.y1]).toEqual([0, 0, 0, 50]);
  });

  it("survives a reference cycle instead of hanging", () => {
    expect(() =>
      gradientOf(
        `<linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/>` +
          `<rect width="9" height="9" fill="url(#a)"/>`,
      ),
    ).toThrow(/no <stop>/);
  });
});

describe("stop-opacity", () => {
  it("becomes ONE alpha when every stop agrees - 87 of 125 real files are that case", () => {
    const g = gradientOf(
      `<linearGradient id="g"><stop stop-color="#000" stop-opacity=".5"/>` +
        `<stop offset="1" stop-color="#fff" stop-opacity=".5"/></linearGradient>` +
        `<rect width="9" height="9" fill="url(#g)"/>`,
    );
    expect(g.alpha).toBeCloseTo(0.5, 5);
  });

  it("multiplies the shape's own opacity in", () => {
    const g = gradientOf(
      `<linearGradient id="g"><stop stop-color="#000" stop-opacity=".5"/>` +
        `<stop offset="1" stop-color="#fff" stop-opacity=".5"/></linearGradient>` +
        `<rect width="9" height="9" fill="url(#g)" opacity=".5"/>`,
    );
    expect(g.alpha).toBeCloseTo(0.25, 5);
  });

  it("names stops that DIFFER, which a DeviceRGB shading cannot express", () => {
    expect(() =>
      gradientOf(
        `<linearGradient id="g"><stop stop-color="#000"/>` +
          `<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
          `<rect width="9" height="9" fill="url(#g)"/>`,
      ),
    ).toThrow(/DIFFERENT stop-opacity/);
  });
});

describe("what it refuses", () => {
  it("names a gradient on a stroke - PDF strokes with a colour only", () => {
    expect(() =>
      gradientOf(`${LINEAR}<rect width="9" height="9" stroke="url(#g)" fill="none"/>`),
    ).toThrow(SvgUnsupportedError);
  });

  it("names a reference that resolves to nothing", () => {
    expect(() => gradientOf(`<rect width="9" height="9" fill="url(#nope)"/>`)).toThrow(
      /no gradient with that id/,
    );
  });

  it("names a radial gradient made elliptical by its transform", () => {
    // PDF's radial shading is circles only; a non-uniform transform makes it an ellipse.
    expect(() =>
      gradientOf(
        `<radialGradient id="g" gradientTransform="scale(2 1)">` +
          `<stop stop-color="#000"/><stop offset="1" stop-color="#fff"/></radialGradient>` +
          `<rect width="9" height="9" fill="url(#g)"/>`,
      ),
    ).toThrow(/elliptical/);
  });
});

// Found by comparing a real logo against Chrome: its eyes came out flat black. `fill="none"` on the
// root <svg> is the Figma export default and sits in 778 of 10,819 real files; ignoring it filled
// every shape that has no fill of its own with BLACK, covering what was underneath.
describe("the root <svg> has presentation attributes of its own", () => {
  const fillsOf = (body: string, rootAttributes: string) =>
    svgToIr(`<svg viewBox="0 0 100 100" ${rootAttributes}>${body}</svg>`, BOX)
      .filter((n): n is Path => n.type === "path")
      .map((p) => p.fill);

  it("inherits fill=none from the root, so a stroke-only shape is not filled black", () => {
    const [fill] = fillsOf(`<path stroke="#000" d="M0 0h9v9z"/>`, `fill="none"`);
    expect(fill).toBeUndefined();
  });

  it("still defaults to black when the root says nothing", () => {
    const [fill] = fillsOf(`<path stroke="#000" d="M0 0h9v9z"/>`, "");
    expect(fill).toBeDefined();
  });

  it("inherits any other text of a style from the root too", () => {
    const [fill] = fillsOf(`<path d="M0 0h9v9z"/>`, `fill="#1450aa"`);
    expect((fill as { toPDFColorString(): string }).toPDFColorString()).toBe("0.078 0.314 0.667");
  });
});
