import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { isWoff2, woff2ToSfnt } from "../../../src/lib/utils/woff2.ts";
import { TTFParser } from "../../../src/lib/utils/ttf-parser.ts";

// The fixtures are the SAME font in both containers, made with fontTools - which is what makes this
// checkable rather than merely green: every glyph outline reconstructed from the WOFF2 must equal the
// one in the .ttf. WOFF2 does not just compress `glyf`, it REWRITES it (points triplet-encoded across
// five streams), so a single wrong row in the 128-entry encoding table would show up here.

const fixture = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(fileURLToPath(new URL(`../../fixtures/fonts/${name}`, import.meta.url))),
  );

const woff2 = fixture("dejavu-subset.woff2");
const ttf = fixture("dejavu-subset.ttf");

describe("recognising the container", () => {
  it("knows a WOFF2 by its signature", () => {
    expect(isWoff2(woff2)).toBe(true);
    expect(isWoff2(ttf)).toBe(false);
    expect(isWoff2(new Uint8Array([0x77, 0x4f, 0x46, 0x46]))).toBe(false); // that is WOFF1
    expect(isWoff2(new Uint8Array(3))).toBe(false);
  });

  it("names bytes that are not one", async () => {
    await expect(woff2ToSfnt(ttf)).rejects.toThrow(/not a WOFF2 container/);
  });
});

describe("the reconstructed font", () => {
  it("is a readable sfnt", async () => {
    const parser = new TTFParser(await woff2ToSfnt(woff2));
    expect(parser.numGlyphs).toBe(new TTFParser(ttf).numGlyphs);
    expect(parser.unitsPerEm).toBe(new TTFParser(ttf).unitsPerEm);
  });

  it("has the same metrics as the .ttf it was made from", async () => {
    const a = new TTFParser(ttf);
    const b = new TTFParser(await woff2ToSfnt(woff2));
    expect([b.ascent, b.descent, b.lineGap]).toEqual([a.ascent, a.descent, a.lineGap]);
    expect(b.bbox).toEqual(a.bbox);
    for (const ch of "Waffel fjord VAV 0123") {
      expect(b.getAdvanceWidth(ch.codePointAt(0)!)).toBe(a.getAdvanceWidth(ch.codePointAt(0)!));
    }
  });

  it("rebuilds every glyph OUTLINE identically - the point of the whole transform", async () => {
    const a = new TTFParser(ttf);
    const b = new TTFParser(await woff2ToSfnt(woff2));
    let compared = 0;
    for (const ch of "Waffel fjordVAV0123") {
      const gid = a.getGlyphIndex(ch.codePointAt(0)!);
      if (!gid) continue;
      expect(b.getGlyphPath(gid)).toEqual(a.getGlyphPath(gid));
      compared++;
    }
    // Guards the loop itself: a lookup that found nothing would make every assertion vacuous.
    expect(compared).toBeGreaterThan(10);
  });
});

describe("loca and head agree", () => {
  /** `head.indexToLocFormat` sits 50 bytes into the head table. */
  const locaFormat = (sfnt: Uint8Array): number => {
    const count = (sfnt[4]! << 8) | sfnt[5]!;
    for (let i = 0; i < count; i++) {
      const at = 12 + i * 16;
      const tag = String.fromCharCode(sfnt[at]!, sfnt[at + 1]!, sfnt[at + 2]!, sfnt[at + 3]!);
      if (tag !== "head") continue;
      const off =
        ((sfnt[at + 8]! << 24) | (sfnt[at + 9]! << 16) | (sfnt[at + 10]! << 8) | sfnt[at + 11]!) >>>
        0;
      return (sfnt[off + 50]! << 8) | sfnt[off + 51]!;
    }
    throw new Error("no head table");
  };

  it("writes the short form for a small font, and says so in head", async () => {
    // The two must match or a reader walks `loca` with the wrong stride. And the format is decided by
    // what we PRODUCED: our glyf can be larger than the original, since we emit no REPEAT flags, so a
    // font that fitted the short form may no longer.
    const sfnt = await woff2ToSfnt(woff2);
    expect(locaFormat(sfnt)).toBe(0);
    expect(new TTFParser(sfnt).numGlyphs).toBe(new TTFParser(ttf).numGlyphs);
  });
});

describe("malformed input", () => {
  it("says so when the header claims no tables", async () => {
    const broken = woff2.slice();
    broken[12] = 0;
    broken[13] = 0;
    await expect(woff2ToSfnt(broken)).rejects.toThrow(/declares no tables/);
  });

  it("says so when the body is shorter than the directory claims", async () => {
    await expect(woff2ToSfnt(woff2.subarray(0, 200))).rejects.toThrow();
  });
});
