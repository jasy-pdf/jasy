import { describe, it, expect } from "vitest";
import { jpegColor, JpegFormatError } from "../../../src/lib/utils/image-helper.ts";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { latin1FromBytes } from "../../../src/lib/utils/bytes.ts";
import * as api from "../../../src/lib/api/index.ts";

// A JPEG is embedded as it is, so its color space is the one it was saved in: gray, RGB or CMYK.
// Photoshop stores CMYK inverted and says so with an Adobe APP14 segment.

const segment = (marker: number, data: number[]) => [
  0xff,
  marker,
  (data.length + 2) >> 8,
  (data.length + 2) & 0xff,
  ...data,
];
const ADOBE = segment(0xee, [0x41, 0x64, 0x6f, 0x62, 0x65, 0, 100, 0, 0, 0, 0, 2]);

/** SOI, the given segments, then a frame header with `components` channels. */
const jpeg = (components: number, sof = 0xc0, ...segments: number[][]) =>
  Uint8Array.from([
    0xff,
    0xd8,
    ...segments.flat(),
    ...segment(sof, [8, 0, 4, 0, 8, components, ...Array(components * 3).fill(0)]),
  ]);

describe("the color space of a JPEG", () => {
  it("follows its channels: gray, RGB, CMYK", () => {
    expect(jpegColor(jpeg(1))).toEqual({ colorSpace: "DeviceGray" });
    expect(jpegColor(jpeg(3))).toEqual({ colorSpace: "DeviceRGB" });
    expect(jpegColor(jpeg(4))).toEqual({ colorSpace: "DeviceCMYK" });
  });

  it("inverts an Adobe CMYK JPEG", () => {
    expect(jpegColor(jpeg(4, 0xc0, ADOBE))).toEqual({
      colorSpace: "DeviceCMYK",
      decode: [1, 0, 1, 0, 1, 0, 1, 0],
    });
  });

  it("reads the frame of every coding a viewer decodes: baseline, extended, progressive", () => {
    for (const sof of [0xc0, 0xc1, 0xc2])
      expect(jpegColor(jpeg(3, sof)).colorSpace).toBe("DeviceRGB");
  });

  it("names the codings a viewer cannot decode", () => {
    for (const sof of [0xc3, 0xc5, 0xc9, 0xca, 0xcb, 0xcd, 0xcf]) {
      expect(() => jpegColor(jpeg(3, sof))).toThrow(JpegFormatError);
    }
  });

  it("names a channel count it cannot embed", () => {
    expect(() => jpegColor(jpeg(2))).toThrow(/2 color channels/);
  });

  it("skips fill bytes before a marker", () => {
    const filled = Uint8Array.from([0xff, 0xd8, 0xff, ...jpeg(1).subarray(2)]);
    expect(jpegColor(filled)).toEqual({ colorSpace: "DeviceGray" });
  });
});

describe("an embedded JPEG", () => {
  const embedded = (bytes: Uint8Array, om = new PDFObjectManager()) => {
    om.registerImage(8, 4, "DCTDecode", latin1FromBytes(bytes));
    return om.getRenderedObjects();
  };

  it("declares its own color space", () => {
    expect(embedded(jpeg(1))).toContain("/ColorSpace /DeviceGray");
    expect(embedded(jpeg(3))).toContain("/ColorSpace /DeviceRGB");
    const cmyk = embedded(jpeg(4, 0xc0, ADOBE));
    expect(cmyk).toContain("/ColorSpace /DeviceCMYK");
    expect(cmyk).toContain("/Decode [1 0 1 0 1 0 1 0]");
  });

  it("refuses CMYK in a PDF/A document, whose sRGB output intent forbids it", () => {
    const om = new PDFObjectManager();
    om.setOutputIntent(new Uint8Array(16));
    expect(() => embedded(jpeg(4, 0xc0, ADOBE), om)).toThrow(/CMYK JPEG in a PDF\/A document/);
    expect(embedded(jpeg(1), om)).toContain("/ColorSpace /DeviceGray");
  });
});

describe("JpegFormatError", () => {
  it("is public, so a caller can catch it by type", () => {
    expect(api.JpegFormatError).toBe(JpegFormatError);
  });
});
