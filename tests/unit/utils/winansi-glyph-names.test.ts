import { describe, it, expect } from "vitest";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";

// Five Windows-1252 characters have no name in the Adobe Glyph List For New Fonts: NBSP, the soft
// hyphen, and the superscripts one, two, three. Unnamed, a standard-14 font MEASURED them as "?"
// (556 in Helvetica) while the viewer DREW the real glyph - a right-aligned line with six no-break
// spaces ended 33pt short of its edge.

const om = () => {
  const m = new PDFObjectManager();
  m.registerFont("Helvetica", FontStyle.Normal, "Helvetica");
  m.registerFont("Courier", FontStyle.Normal, "Courier");
  return m;
};
const width = (m: PDFObjectManager, s: string, font = "Helvetica") =>
  m.getStringWidth(s, font, 1000, FontStyle.Normal);

describe("standard-14: every Windows-1252 character is measured as the glyph that is drawn", () => {
  it("a no-break space is as wide as a space (WinAnsi draws 0xA0 with `space`)", () => {
    const m = om();
    expect(width(m, "a b")).toBe(width(m, "a b"));
  });

  it("superscripts one, two, three have their own widths (Helvetica 333, Courier 600)", () => {
    const m = om();
    for (const sup of ["¹", "²", "³"]) {
      expect(width(m, sup), sup).toBe(333);
      expect(width(m, sup, "Courier"), sup).toBe(600);
    }
  });
});

describe("a no-break space is kerned like a space - not at all", () => {
  it("even though the AFM lists pairs for `space` (KPX space A -55)", () => {
    const m = om();
    expect(m.getKernPairs("A A", "Helvetica", FontStyle.Normal)).toEqual([0, 0]);
  });
});
