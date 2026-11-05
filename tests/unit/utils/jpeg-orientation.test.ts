import { describe, it, expect } from "vitest";
import {
  readImageDimensions,
  naturalSize,
  ORIENTATION_MATRIX,
  type Orientation,
} from "../../../src/lib/utils/image-helper.ts";
import { Document, Image, Page, renderToBytes } from "../../../src/lib/api/index.ts";
import { drawnNodes } from "../support/drawn.ts";

// A phone stores a photo as the sensor saw it and says in EXIF how to turn it upright. A browser
// applies that, and so do we: the box is the upright size, the pixels are turned inside it.

const u16 = (n: number, le: boolean) => (le ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
const u32 = (n: number, le: boolean) => {
  const be = [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  return le ? be.reverse() : be;
};
const segment = (marker: number, data: number[]) => [
  0xff,
  marker,
  (data.length + 2) >> 8,
  (data.length + 2) & 0xff,
  ...data,
];

/** EXIF with one Orientation entry, in either byte order. */
const exif = (orientation: number, le = false) =>
  segment(0xe1, [
    0x45,
    0x78,
    0x69,
    0x66,
    0,
    0, // "Exif\0\0"
    ...(le ? [0x49, 0x49] : [0x4d, 0x4d]),
    ...u16(42, le),
    ...u32(8, le),
    ...u16(1, le),
    ...u16(0x0112, le),
    ...u16(3, le),
    ...u32(1, le),
    ...u16(orientation, le),
    0,
    0,
    ...u32(0, le),
  ]);

/** SOI, EXIF, then an RGB baseline frame of w x h pixels. */
const jpeg = (w: number, h: number, orientation: number, le = false) =>
  Uint8Array.from([
    0xff,
    0xd8,
    ...exif(orientation, le),
    ...segment(0xc0, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, ...Array(9).fill(0)]),
  ]);

describe("the EXIF orientation of a JPEG", () => {
  it("is read in both byte orders", () => {
    expect(readImageDimensions(jpeg(40, 20, 6)).orientation).toBe(6);
    expect(readImageDimensions(jpeg(40, 20, 8, true)).orientation).toBe(8);
  });

  it("is absent when the pixels are already upright, or the value is not one", () => {
    expect(readImageDimensions(jpeg(40, 20, 1)).orientation).toBeUndefined();
    expect(readImageDimensions(jpeg(40, 20, 9)).orientation).toBeUndefined();
  });

  it("swaps width and height for 5-8, and only there", () => {
    for (const o of [2, 3, 4] as const) {
      expect(naturalSize({ width: 40, height: 20, orientation: o })).toEqual({
        width: 30,
        height: 15,
      });
    }
    for (const o of [5, 6, 7, 8] as const) {
      expect(naturalSize({ width: 40, height: 20, orientation: o })).toEqual({
        width: 15,
        height: 30,
      });
    }
  });
});

describe("the matrix that turns the pixels upright", () => {
  // Image space: the first stored row at the top (y = 1). Where do the stored corners land?
  const apply = (m: readonly number[], [x, y]: [number, number]) => [
    m[0]! * x + m[2]! * y + m[4]!,
    m[1]! * x + m[3]! * y + m[5]!,
  ];
  const TOP_LEFT: [number, number] = [0, 1];
  const TOP_RIGHT: [number, number] = [1, 1];
  // EXIF: where the stored top-left and top-right pixels belong once upright.
  const upright: Record<Orientation, [number[], number[]]> = {
    2: [
      [1, 1],
      [0, 1],
    ],
    3: [
      [1, 0],
      [0, 0],
    ],
    4: [
      [0, 0],
      [1, 0],
    ],
    5: [
      [0, 1],
      [0, 0],
    ],
    6: [
      [1, 1],
      [1, 0],
    ],
    7: [
      [1, 0],
      [1, 1],
    ],
    8: [
      [0, 0],
      [0, 1],
    ],
  };

  it.each(Object.keys(upright).map(Number) as Orientation[])(
    "puts the corners right for %i",
    (o) => {
      expect(apply(ORIENTATION_MATRIX[o], TOP_LEFT)).toEqual(upright[o][0]);
      expect(apply(ORIENTATION_MATRIX[o], TOP_RIGHT)).toEqual(upright[o][1]);
    },
  );
});

describe("an unsized JPEG with an orientation", () => {
  const drawn = async (bytes: Uint8Array) => {
    const [nodes] = await drawnNodes(() =>
      renderToBytes(
        Document([Page({ size: { width: 200, height: 200 }, margin: 0 }, [Image(bytes)])]),
        {
          compress: false,
        },
      ),
    );
    return nodes!.find((n) => n.type === "image") as { width: number; height: number };
  };

  it("is laid out upright", async () => {
    expect(await drawn(jpeg(40, 20, 6))).toMatchObject({ width: 15, height: 30 });
    expect(await drawn(jpeg(40, 20, 3))).toMatchObject({ width: 30, height: 15 });
  });

  it("turns its pixels inside the box, and an upright one draws as before", async () => {
    const pdf = async (bytes: Uint8Array) =>
      new TextDecoder("latin1").decode(
        await renderToBytes(Document([Page([Image(bytes)])]), { compress: false }),
      );
    expect(await pdf(jpeg(40, 20, 6))).toMatch(/ cm\n0 -1 1 0 0 1 cm\n\/IM\d+ Do/);
    expect(await pdf(jpeg(40, 20, 1))).toMatch(/ cm\n\/IM\d+ Do/);
  });
});
