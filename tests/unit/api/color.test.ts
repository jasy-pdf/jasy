import { describe, it, expect } from "vitest";
import { toColor, rgb, rgba } from "../../../src/lib/api/color";
import { Color } from "../../../src/lib/common/color";

const channels = (c: Color) => c.toArray();

describe("toColor - every input form normalizes to one Color", () => {
  it("passes a Color instance through untouched", () => {
    const c = new Color(20, 90, 170, 0.5);
    expect(toColor(c)).toBe(c);
  });

  it("named CSS colors (case-insensitive, incl. grey/gray synonyms)", () => {
    expect(channels(toColor("steelblue"))).toEqual([70, 130, 180]);
    expect(channels(toColor("SteelBlue"))).toEqual([70, 130, 180]);
    expect(channels(toColor("rebeccapurple"))).toEqual([102, 51, 153]);
    expect(channels(toColor("gray"))).toEqual(channels(toColor("grey")));
  });

  it("transparent is a real zero-alpha color", () => {
    const t = toColor("transparent");
    expect(t.getAlpha()).toBe(0);
    expect(t.isTransparent()).toBe(true);
  });

  it("hex 6 and shorthand 3 agree", () => {
    expect(channels(toColor("#1450aa"))).toEqual([0x14, 0x50, 0xaa]);
    expect(channels(toColor("#14a"))).toEqual([0x11, 0x44, 0xaa]);
  });

  it("hex 8 / 4 carry alpha LAST", () => {
    const c = toColor("#1450aacc");
    expect(channels(c)).toEqual([0x14, 0x50, 0xaa]);
    expect(c.getAlpha()).toBeCloseTo(0xcc / 255, 5);
    expect(toColor("#14ac").getAlpha()).toBeCloseTo(0xcc / 255, 5);
  });

  it("number is Flutter ARGB - alpha FIRST", () => {
    const c = toColor(0xff1450aa);
    expect(channels(c)).toEqual([0x14, 0x50, 0xaa]);
    expect(c.getAlpha()).toBe(1);
    // A 6-digit number has alpha byte 0x00 → transparent (documented Flutter gotcha).
    expect(toColor(0x1450aa).getAlpha()).toBe(0);
  });

  it("rgb / rgba builders", () => {
    expect(channels(rgb(20, 90, 170))).toEqual([20, 90, 170]);
    expect(rgb(20, 90, 170).getAlpha()).toBe(1);
    expect(rgba(20, 90, 170, 0.8).getAlpha()).toBeCloseTo(0.8, 5);
  });

  it("throws on an unknown name or malformed hex", () => {
    expect(() => toColor("notacolor")).toThrow();
    expect(() => toColor("#12345")).toThrow();
  });
});

// The doc table above `toColor` has promised `rgb(20,90,170)` since the API layer was built, and it
// THREW - there was no function branch at all. The test above covers the `rgb()` BUILDER, which is a
// different thing and is why nobody noticed. Found by running 10,819 real SVGs through the parser.
describe("CSS colour functions", () => {
  it("reads rgb() in the legacy comma form, spaces or not", () => {
    expect(channels(toColor("rgb(20,90,170)"))).toEqual([20, 90, 170]);
    expect(channels(toColor("rgb(20, 90, 170)"))).toEqual([20, 90, 170]);
  });

  it("reads the modern space form, with slash alpha", () => {
    expect(channels(toColor("rgb(20 90 170)"))).toEqual([20, 90, 170]);
    expect(toColor("rgb(20 90 170 / 50%)").getAlpha()).toBeCloseTo(0.5, 5);
    expect(toColor("rgba(20, 90, 170, 0.25)").getAlpha()).toBeCloseTo(0.25, 5);
  });

  it("reads percentage channels", () => {
    expect(channels(toColor("rgb(100%, 0%, 50%)"))).toEqual([255, 0, 127.5]);
  });

  it("reads hsl(), which is the same sRGB family", () => {
    expect(channels(toColor("hsl(0, 100%, 50%)"))).toEqual([255, 0, 0]);
    expect(channels(toColor("hsl(120 100% 25%)"))).toEqual([0, 128, 0]);
    expect(toColor("hsl(214 79% 37% / .5)").getAlpha()).toBeCloseTo(0.5, 5);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(channels(toColor("  RGB(20, 90, 170)  "))).toEqual([20, 90, 170]);
  });

  it("NAMES a wide-gamut function instead of squashing it into sRGB", () => {
    // Approximating would hand back a colour nobody chose; both appear in real files.
    expect(() => toColor("color(display-p3 0.5 0.2 1)")).toThrow(/color\(\)/);
    expect(() => toColor("light-dark(#000,#fff)")).toThrow(/light-dark\(\)/);
  });

  it("rejects a function with too few channels", () => {
    expect(() => toColor("rgb(20, 90)")).toThrow();
  });
});
