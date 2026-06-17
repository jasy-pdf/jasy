import { describe, it, expect } from "vitest";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { Color } from "../../../src/lib/common/color";
import { Rect } from "../../../src/lib/ir/display-list";

const rect = (fill: Color): Rect => ({
  type: "rect",
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  fill,
  strokeWidth: 1,
});

describe("opacity (ExtGState)", () => {
  it("emits no graphics state for opaque colors (byte-identical path)", () => {
    const om = new PDFObjectManager();
    const out = PdfBackend.serializeNode(rect(new Color(255, 0, 0)), om);

    expect(out).not.toContain(" gs");
    expect(out).not.toContain("q\n"); // no isolating q/Q for opaque rects
    expect(om.getAllExtGStatesRaw().size).toBe(0);
  });

  it("wraps a transparent fill in q/Q with a /GS gs and registers the state", () => {
    const om = new PDFObjectManager();
    const out = PdfBackend.serializeNode(rect(new Color(255, 0, 0, 0.5)), om);

    expect(out.startsWith("q\n")).toBe(true);
    expect(out.endsWith("Q\n")).toBe(true);
    expect(out).toContain("/GS1 gs");

    expect(om.getAllExtGStatesRaw().get("GS1")).toBeDefined();
    expect(om.getRenderedObjects()).toContain("<< /Type /ExtGState /ca 0.500 /CA 1.000 >>");
  });

  it("dedupes equal alpha pairs to a single graphics state", () => {
    const om = new PDFObjectManager();
    const first = om.registerExtGState(0.5, 1);
    const second = om.registerExtGState(0.5, 1);
    const other = om.registerExtGState(0.5, 0.25);

    expect(first).toBe(second);
    expect(other).not.toBe(first);
    expect(om.getAllExtGStatesRaw().size).toBe(2);
  });
});
