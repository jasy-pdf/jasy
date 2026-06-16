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
