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
      await png(2, 2, 0xff0000ff) // opaque red, RGBA
    );
    expect([width, height]).toEqual([2, 2]);

    const raw = inflateSync(Buffer.from(data, "binary"));
    expect(raw.length).toBe(2 * 2 * 3); // 3 bytes per pixel, no alpha
    expect([raw[0], raw[1], raw[2]]).toEqual([255, 0, 0]); // first pixel is red
  });

  it("composites transparent pixels over white (no black halo)", async () => {
    const { data } = await decodePngToRgbFlate(
      await png(1, 1, 0x00000000) // fully transparent
    );
    const raw = inflateSync(Buffer.from(data, "binary"));
    expect([raw[0], raw[1], raw[2]]).toEqual([255, 255, 255]);
  });

  it("keeps a semi-transparent pixel between its color and white", async () => {
    // 50% red over white -> ~ (255, 128, 128).
    const { data } = await decodePngToRgbFlate(await png(1, 1, 0xff000080));
    const raw = inflateSync(Buffer.from(data, "binary"));
    expect(raw[0]).toBe(255);
    expect(raw[1]).toBeGreaterThan(120);
    expect(raw[1]).toBeLessThan(140);
    expect(raw[2]).toBe(raw[1]);
  });
});
