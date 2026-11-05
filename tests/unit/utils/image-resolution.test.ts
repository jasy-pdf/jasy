import { describe, it, expect } from "vitest";
import { crc32 } from "node:zlib";
import { Jimp } from "jimp";
import { readImageDimensions, naturalSize } from "../../../src/lib/utils/image-helper.ts";
import { Document, Image, Page, renderToBytes } from "../../../src/lib/api/index.ts";
import { drawnNodes } from "../support/drawn.ts";

// An image is as large as its file says: its pixels at the resolution it declares, else at 96 dpi
// (CSS's reference pixel). A malformed declaration is no declaration, never a failed image.

const u16 = (n: number) => [n >> 8, n & 0xff];
const u32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/** A PNG chunk with a real CRC, so a decoder accepts the file too. */
const chunk = (type: string, data: number[]) => {
  const body = Uint8Array.from([...type].map((c) => c.charCodeAt(0)).concat(data));
  return [...u32(data.length), ...body, ...u32(crc32(body))];
};

/** `png` with a pHYs chunk after IHDR: pixels per unit, unit 1 = meter. */
const withPhys = (png: Uint8Array, ppuX: number, ppuY: number, unit = 1) => {
  const ihdrEnd = 8 + 12 + 13;
  return Uint8Array.from([
    ...png.subarray(0, ihdrEnd),
    ...chunk("pHYs", [...u32(ppuX), ...u32(ppuY), unit]),
    ...png.subarray(ihdrEnd),
  ]);
};

const segment = (marker: number, data: number[]) => [
  0xff,
  marker,
  ...u16(data.length + 2),
  ...data,
];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const jfif = (units: number, x: number, y: number) =>
  segment(0xe0, [...ascii("JFIF"), 0, 1, 2, units, ...u16(x), ...u16(y), 0, 0]);

/** EXIF with XResolution / YResolution (rationals) and an optional ResolutionUnit, big-endian. */
const exif = (x: number, y: number, unit?: number) => {
  const tags = unit === undefined ? 2 : 3;
  const ifdEnd = 8 + 2 + tags * 12 + 4;
  const entry = (tag: number, type: number, value: number[]) => [
    ...u16(tag),
    ...u16(type),
    ...u32(1),
    ...value,
  ];
  const tiff = [
    ...ascii("MM"),
    ...u16(42),
    ...u32(8),
    ...u16(tags),
    ...entry(0x011a, 5, u32(ifdEnd)),
    ...entry(0x011b, 5, u32(ifdEnd + 8)),
    ...(unit === undefined ? [] : entry(0x0128, 3, [...u16(unit), 0, 0])),
    ...u32(0),
    ...u32(x),
    ...u32(1),
    ...u32(y),
    ...u32(1),
  ];
  return segment(0xe1, [...ascii("Exif"), 0, 0, ...tiff]);
};

/** SOI, the given segments, then an SOF0 with the size. */
const jpeg = (w: number, h: number, ...segments: number[][]) =>
  Uint8Array.from([0xff, 0xd8, ...segments.flat(), ...segment(0xc0, [8, ...u16(h), ...u16(w), 3])]);

const greenPng = async (w: number, h: number) =>
  new Uint8Array(await new Jimp({ width: w, height: h, color: 0x00ff00ff }).getBuffer("image/png"));

describe("the resolution an image file declares", () => {
  it("PNG pHYs in pixels per meter", async () => {
    const dims = readImageDimensions(withPhys(await greenPng(4, 2), 5669, 11811));
    expect(dims.dpi!.x).toBeCloseTo(144, 0);
    expect(dims.dpi!.y).toBeCloseTo(300, 0);
  });

  it("PNG pHYs with unit 0 is an aspect ratio, not a resolution", async () => {
    expect(readImageDimensions(withPhys(await greenPng(4, 2), 3, 3, 0)).dpi).toBeUndefined();
  });

  it("JFIF in dots per inch and per centimeter; units 0 declares none", async () => {
    expect(readImageDimensions(jpeg(8, 8, jfif(1, 300, 150))).dpi).toEqual({
      x: 300,
      y: 150,
    });
    expect(readImageDimensions(jpeg(8, 8, jfif(2, 100, 100))).dpi).toEqual({
      x: 254,
      y: 254,
    });
    expect(readImageDimensions(jpeg(8, 8, jfif(0, 1, 1))).dpi).toBeUndefined();
  });

  it("EXIF when JFIF declares none - inch by default, or centimeters", async () => {
    expect(readImageDimensions(jpeg(8, 8, jfif(0, 1, 1), exif(72, 72))).dpi).toEqual({
      x: 72,
      y: 72,
    });
    expect(readImageDimensions(jpeg(8, 8, exif(100, 100, 3))).dpi).toEqual({
      x: 254,
      y: 254,
    });
  });

  it("JFIF wins over EXIF", async () => {
    expect(readImageDimensions(jpeg(8, 8, exif(72, 72), jfif(1, 300, 300))).dpi).toEqual({
      x: 300,
      y: 300,
    });
  });

  it("a zero or truncated declaration is none, and the size still reads", async () => {
    expect(readImageDimensions(jpeg(8, 4, jfif(1, 0, 300)))).toEqual({ width: 8, height: 4 });
    const truncated = segment(0xe1, [...ascii("Exif"), 0, 0, ...ascii("MM"), 0, 42, 0, 0, 0xff, 0]);
    expect(readImageDimensions(jpeg(8, 4, truncated))).toEqual({ width: 8, height: 4 });
  });
});

describe("an image's own size", () => {
  it("is its pixels at the declared resolution, else at 96 dpi", () => {
    expect(naturalSize({ width: 96, height: 48 })).toEqual({ width: 72, height: 36 });
    expect(naturalSize({ width: 300, height: 300, dpi: { x: 300, y: 150 } })).toEqual({
      width: 72,
      height: 144,
    });
  });

  it("is what an unsized Image draws: a 144-dpi screenshot comes out at half its pixels", async () => {
    const page = Page({ size: { width: 400, height: 400 }, margin: 0 }, [
      Image(withPhys(await greenPng(200, 100), 5669, 5669)),
    ]);
    const [nodes] = await drawnNodes(() => renderToBytes(Document([page])));
    const image = nodes!.find((n) => n.type === "image") as { width: number; height: number };
    expect(image.width).toBeCloseTo(100, 1);
    expect(image.height).toBeCloseTo(50, 1);
  });
});
