import { describe, it, expect } from "vitest";
import { bundledFonts } from "../src/fonts";

describe("bundledFonts", () => {
  it("loads Liberation substitutes for the standard-14 text families, all four styles", () => {
    const fonts = bundledFonts();
    expect(Object.keys(fonts)).toEqual(["Helvetica", "Times", "Courier"]);
    for (const family of Object.values(fonts)) {
      for (const style of ["normal", "bold", "italic", "boldItalic"] as const) {
        const data = family[style];
        // a real TrueType file: present, non-trivial, and starts with the sfnt version 0x00010000
        expect(Buffer.isBuffer(data)).toBe(true);
        expect((data as Buffer).length).toBeGreaterThan(10000);
        expect((data as Buffer).readUInt32BE(0)).toBe(0x00010000);
      }
    }
  });
});
