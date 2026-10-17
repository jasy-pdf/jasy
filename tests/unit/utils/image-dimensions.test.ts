import { describe, it, expect } from "vitest";
import { getImageDimensions } from "../../../src/lib/utils/image-helper.ts";

// The image header is read through the VIEW's window. A `Uint8Array` handed in may be a slice of a
// larger buffer - a Node `Buffer` from a pool usually is - and reading from the buffer's start then
// finds someone else's bytes.

/** A PNG signature + IHDR chunk header: everything the size is read from. */
const png = (w: number, h: number) => {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

/** SOI, then an SOF0 segment: length, precision, height, width. */
const jpeg = (w: number, h: number) =>
  Uint8Array.of(0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 0, 0, 0);

/** The same bytes as a view at `offset` into a larger buffer, preceded by noise. */
const sliced = (bytes: Uint8Array, offset = 16) => {
  const pool = new Uint8Array(offset + bytes.length + 8).fill(0xab);
  pool.set(bytes, offset);
  return pool.subarray(offset, offset + bytes.length);
};

describe("getImageDimensions - reads the view, not the buffer under it", () => {
  it("a PNG at an offset", async () => {
    expect(await getImageDimensions(sliced(png(40, 20)))).toEqual({ width: 40, height: 20 });
  });

  it("a JPEG at an offset", async () => {
    expect(await getImageDimensions(sliced(jpeg(300, 200)))).toEqual({ width: 300, height: 200 });
  });

  it("a pooled Node Buffer", async () => {
    const bytes = Buffer.from(png(7, 9)); // small Buffers come out of a shared pool, at an offset
    expect(await getImageDimensions(bytes)).toEqual({ width: 7, height: 9 });
  });
});
