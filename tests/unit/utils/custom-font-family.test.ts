import { describe, it, expect } from "vitest";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { buildTestTtf } from "./ttf-fixture";

// "Inter" family: regular (A=500) + a wider bold (A=600); no italic registered.
function familyOm() {
  const om = new PDFObjectManager();
  om.registerCustomFont("Inter", buildTestTtf([0, 500, 700, 250]), FontStyle.Normal);
  om.registerCustomFont("Inter", buildTestTtf([0, 600, 800, 300]), FontStyle.Bold);
  return om;
}

describe("PDFObjectManager - custom font families (slice 2.3)", () => {
  it("measures each style with its own variant", () => {
    const om = familyOm();
    expect(om.getStringWidth("A", "Inter", 1000, FontStyle.Normal)).toBeCloseTo(500, 5);
    expect(om.getStringWidth("A", "Inter", 1000, FontStyle.Bold)).toBeCloseTo(600, 5);
  });

  it("falls back to Normal for a style that was not registered (italic)", () => {
    const om = familyOm();
    expect(om.getStringWidth("A", "Inter", 1000, FontStyle.Italic)).toBeCloseTo(500, 5);
    expect(om.isCustomFont("Inter", FontStyle.Italic)).toBe(true); // resolves via fallback
  });

  it("is a custom font for any style once the family exists, and not for unknown names", () => {
    const om = familyOm();
    expect(om.isCustomFont("Inter", FontStyle.Bold)).toBe(true);
    expect(om.isCustomFont("Helvetica", FontStyle.Bold)).toBe(false);
  });

  it("selects a different font resource for bold than for normal", () => {
    const om = familyOm();
    const normal = om.getCustomFontResource("Inter", FontStyle.Normal);
    const bold = om.getCustomFontResource("Inter", FontStyle.Bold);
    expect(normal!.fontIndex).not.toBe(bold!.fontIndex);
    // Italic has no file → resolves to the normal resource.
    expect(om.getCustomFontResource("Inter", FontStyle.Italic)!.fontIndex).toBe(normal!.fontIndex);
  });

  it("encodes glyph ids from the resolved variant", () => {
    const om = familyOm();
    // Same glyph ids (cmap identical) but the resolution must succeed per style.
    expect(om.encodeCustomText("Inter", "A", FontStyle.Bold)).toBe("0001");
    expect(om.encodeCustomText("Inter", "AB", FontStyle.Normal)).toBe("00010002");
  });
});
