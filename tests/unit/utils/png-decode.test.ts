import { describe, it, expect } from "vitest";
import { inflateSync } from "zlib";
import { Jimp, JimpMime } from "jimp";
import { decodePngToRgbFlate } from "../../../src/lib/utils/image-helper";

// Builds an in-memory PNG (no scratch files) so the test is self-contained.
const png = (width: number, height: number, color: number) =>
  new Jimp({ width, height, color }).getBuffer(JimpMime.png);

describe("decodePngToRgbFlate", () => {
  it("decodes a PNG to Flate-compressed DeviceRGB samples", async () => {
    const { data, width, height } = await decodePngToRgbFlate(
      await png(2, 2, 0xff0000ff), // opaque red, RGBA
    );
    expect([width, height]).toEqual([2, 2]);

    const raw = inflateSync(Buffer.from(data, "binary"));
    expect(raw.length).toBe(2 * 2 * 3); // 3 bytes per pixel, no alpha
    expect([raw[0], raw[1], raw[2]]).toEqual([255, 0, 0]); // first pixel is red
  });

  it("keeps a transparent pixel's raw RGB and emits its alpha as an SMask", async () => {
    // Transparency rides as a separate DeviceGray /SMask now (not composited over white): the RGB is left
    // untouched and the alpha=0 lives in the mask.
    const { data, smask } = await decodePngToRgbFlate(await png(1, 1, 0x00000000));
    expect([...inflateSync(Buffer.from(data, "binary"))]).toEqual([0, 0, 0]);
    expect(smask).toBeDefined();
    expect(inflateSync(Buffer.from(smask!, "binary"))[0]).toBe(0);
  });

  it("keeps a semi-transparent pixel's true color, with its alpha in the SMask", async () => {
    const { data, smask } = await decodePngToRgbFlate(await png(1, 1, 0xff000080)); // 50% red
    expect([...inflateSync(Buffer.from(data, "binary"))]).toEqual([255, 0, 0]);
    expect(smask).toBeDefined();
    expect(inflateSync(Buffer.from(smask!, "binary"))[0]).toBe(0x80);
  });
});
