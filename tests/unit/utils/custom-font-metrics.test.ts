import { describe, it, expect } from "vitest";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { buildTestTtf } from "./ttf-fixture";

describe("PDFObjectManager - custom font metric routing (slice 2.1)", () => {
  it("measures a registered TTF via its own metrics (A=500, B=700 units @ em 1000)", () => {
    const om = new PDFObjectManager();
    om.registerCustomFont("MyFont", buildTestTtf());
    expect(om.getStringWidth("A", "MyFont", 1000, FontStyle.Normal)).toBeCloseTo(500, 5);
    expect(om.getStringWidth("AB", "MyFont", 12, FontStyle.Normal)).toBeCloseTo(14.4, 5);
    expect(om.getStringWidth("A B", "MyFont", 12, FontStyle.Normal)).toBeCloseTo(
      ((500 + 250 + 700) / 1000) * 12,
      5,
    );
  });

  it("leaves the standard-14 (AFM) path intact", () => {
    const om = new PDFObjectManager();
    om.registerFont("Helvetica");
    expect(om.getStringWidth("Hello", "Helvetica", 12, FontStyle.Normal)).toBeGreaterThan(0);
  });
});
