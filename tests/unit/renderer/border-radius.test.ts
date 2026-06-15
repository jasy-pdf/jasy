import { describe, it, expect } from "vitest";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { Color } from "../../../src/lib/common/color";
import { Rect, Image } from "../../../src/lib/ir/display-list";

const filled = (extra: Partial<Rect> = {}): Rect => ({
  type: "rect",
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  fill: new Color(0, 0, 255),
  strokeWidth: 1,
  ...extra,
});

const image = (extra: Partial<Image> = {}): Image => ({
  type: "image",
  x: 0,
  y: 0,
  width: 100,
  height: 80,
  intrinsicWidth: 100,
  intrinsicHeight: 80,
  data: "x",
  imageType: "DCTDecode",
  ...extra,
});

describe("border radius", () => {
  it("emits a plain `re` rect when there is no radius (byte-identical path)", () => {
    const out = PdfBackend.serializeNode(filled(), new PDFObjectManager());
    expect(out).toContain("0 0 100 50 re");
    expect(out).not.toContain(" c\n"); // no Bézier corners
  });

  it("emits a Bézier rounded path when radius > 0", () => {
    const out = PdfBackend.serializeNode(
      filled({ radius: 10 }),
      new PDFObjectManager()
    );
    expect(out).not.toContain(" re "); // not the sharp rectangle operator
    expect(out).toContain(" m\n"); // moveto starts the path
    expect(out).toContain(" c\n"); // curved corners
    expect(out).toContain("h f"); // closed subpath, then fill paint
  });

  it("clamps the radius to half the smaller side", () => {
    // 999 on a 100×50 box clamps to 25 (height/2); the path starts at x + r = 25.
    const out = PdfBackend.serializeNode(
      filled({ radius: 999 }),
      new PDFObjectManager()
    );
    expect(out).toContain("25.000 0.000 m");
  });

  it("clips an image to a rectangular frame when no radius (byte-identical)", () => {
    const out = PdfBackend.serializeNode(
      image({ clip: { x: 0, y: 0, width: 100, height: 80 } }),
      new PDFObjectManager()
    );
    expect(out).toContain("0 0 100 80 re \nW n");
    expect(out).not.toContain(" c\n"); // no Bézier corners
  });

  it("clips an image to a rounded frame when radius > 0", () => {
    const out = PdfBackend.serializeNode(
      image({ clip: { x: 0, y: 0, width: 100, height: 80 }, radius: 12 }),
      new PDFObjectManager()
    );
    expect(out).toContain(" c\n"); // Bézier-cornered clip
    expect(out).toContain("W n"); // used as a clipping path
    expect(out).not.toContain(" re \nW n"); // not the sharp rectangle clip
  });
});
