import { describe, it, expect } from "vitest";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { buildTestTtf } from "./ttf-fixture";

describe("PDFObjectManager - custom font embedding (slice 2.2a)", () => {
  it("emits the Type0 font object graph and registers the font", () => {
    const om = new PDFObjectManager();
    const before = om.getObjectCount();
    om.registerCustomFont("MyFont", buildTestTtf());

    // FontFile2, FontDescriptor, CIDFontType2, ToUnicode, Type0
    expect(om.getObjectCount()).toBe(before + 5);
    expect(om.getAllFontsRaw().size).toBe(1);

    const pdf = om.getRenderedObjects();
    expect(pdf).toContain("/Subtype /Type0");
    expect(pdf).toContain("/Encoding /Identity-H");
    expect(pdf).toContain("/Subtype /CIDFontType2");
    expect(pdf).toContain("/FontFile2");
    expect(pdf).toContain("/ToUnicode");
  });

  it("is idempotent - re-registering the same name adds nothing", () => {
    const om = new PDFObjectManager();
    om.registerCustomFont("MyFont", buildTestTtf());
    const count = om.getObjectCount();
    om.registerCustomFont("MyFont", buildTestTtf());
    expect(om.getObjectCount()).toBe(count);
  });
});
