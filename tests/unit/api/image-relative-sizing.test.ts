import { describe, it, expect } from "vitest";
import { Image } from "../../../src/lib/api/content";
import { CustomImage, BoxFit } from "../../../src/lib/elements/image-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";

// A stand-in image with a fixed intrinsic size, so aspect math is deterministic and needs no IO.
class FakeImage extends CustomImage {
  constructor(
    private w: number,
    private h: number,
  ) {
    super();
  }
  async init(): Promise<void> {}
  async getImageType(): Promise<string> {
    return "DCTDecode";
  }
  async getFileData(): Promise<string> {
    return "x";
  }
  async getImageDimensions(): Promise<{ width: number; height: number }> {
    return { width: this.w, height: this.h };
  }
}

const ctx = {} as LayoutContext;
const region = BoxConstraints.loose(400, Infinity);

describe("Image relative sizing + aspect auto-height", () => {
  it("a fixed width gives a proportional height from the intrinsic ratio (400x200 -> ratio 2)", async () => {
    const img = Image(new FakeImage(400, 200), { width: 100 });
    await img.resolveIntrinsicSize();
    const size = img.calculateLayout(region, { x: 0, y: 0 }, ctx);
    expect(size.width).toBe(100);
    expect(size.height).toBe(50); // 100 / 2
  });

  it("a percentage width resolves against the offered width, height follows the ratio", async () => {
    const img = Image(new FakeImage(400, 200), { width: "50%" });
    await img.resolveIntrinsicSize();
    const size = img.calculateLayout(region, { x: 0, y: 0 }, ctx);
    expect(size.width).toBe(200); // 50% of 400
    expect(size.height).toBe(100); // 200 / 2
  });

  it("pinning the height instead derives the width from the ratio", async () => {
    const img = Image(new FakeImage(400, 200), { height: 80 });
    await img.resolveIntrinsicSize();
    const size = img.calculateLayout(region, { x: 0, y: 0 }, ctx);
    expect(size.height).toBe(80);
    expect(size.width).toBe(160); // 80 * 2
  });

  it("pinning exactly one axis scales the image to the box (fit: fill)", () => {
    expect(Image(new FakeImage(400, 200), { width: 100 }).getProps().fit).toBe(BoxFit.fill);
    expect(Image(new FakeImage(400, 200), { height: 80 }).getProps().fit).toBe(BoxFit.fill);
  });

  it("both axes or neither keep the default fit (none) - unchanged behavior", () => {
    expect(Image(new FakeImage(400, 200), { width: 100, height: 100 }).getProps().fit).toBe(
      BoxFit.none,
    );
    expect(Image(new FakeImage(400, 200)).getProps().fit).toBe(BoxFit.none);
  });

  it("an explicit fit always wins over the auto-fill default", () => {
    expect(Image(new FakeImage(400, 200), { width: 100, fit: "contain" }).getProps().fit).toBe(
      BoxFit.contain,
    );
  });
});
