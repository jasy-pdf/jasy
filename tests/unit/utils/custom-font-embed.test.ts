import { describe, it, expect } from "vitest";
import { FontStyle, PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
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

  // Regression: embedding under a standard-14 name (e.g. "Helvetica" → Liberation for PDF/A) must
  // OVERRIDE the standard /Type1 entry, so the page resource and the CID text use the SAME embedded
  // font. Before the fix the /Type1 entry won and the text rendered as garbage. (A substring "is
  // /CIDFontType2 present" check missed this — the Type0 existed but wasn't the one referenced.)
  it("a custom font overrides a same-named standard-14 entry (no /Type1 collision)", () => {
    const om = new PDFObjectManager();
    om.registerFont("Helvetica"); // standard-14 /Type1
    const standard = om.getAllFontsRaw().get("Helvetica-normal")!;

    om.registerCustomFont("Helvetica", buildTestTtf()); // embed as a custom Type0
    const resolved = om.getCustomFontResource("Helvetica", FontStyle.Normal)!;
    const registered = om.getAllFontsRaw().get("Helvetica-normal")!;

    // the page resource for "Helvetica" now points at the embedded Type0, not the standard /Type1
    expect(resolved.resourceIndex).not.toBe(standard.resourceIndex);
    expect(registered.resourceIndex).toBe(resolved.resourceIndex);
    expect(registered.fontIndex).toBe(resolved.fontIndex);
  });
});
