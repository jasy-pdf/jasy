import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Document, Page, Text, renderPdf } from "../../../src/lib/api/index.ts";
import { TTFParser } from "../../../src/lib/utils/ttf-parser.ts";

// The widths an embedded font is drawn with (`/W`) are the ones layout measured with: exact, not
// rounded to whole thousandths of an em. A 2048-unit font is where rounding showed.

const font = new Uint8Array(
  readFileSync(new URL("../../fixtures/fonts/dejavu-subset.ttf", import.meta.url)),
);

describe("the /W widths of an embedded font", () => {
  it("are the measured widths, to four decimals", async () => {
    const ttf = new TTFParser(font);
    const gid = ttf.getGlyphIndex("W".codePointAt(0)!);
    const exact = (ttf.getAdvanceWidth(gid) * 1000) / ttf.unitsPerEm;
    expect(ttf.unitsPerEm).toBe(2048);
    expect(Number.isInteger(exact)).toBe(false);

    const pdf = await renderPdf(Document([Page([Text("W", { font: "Test" })])]), {
      compress: false,
      fonts: { Test: font },
    });
    const w = pdf.match(new RegExp(`/W \\[[^]*?\\b${gid} \\[([\\d.]+)\\]`));
    expect(Number(w?.[1])).toBeCloseTo(exact, 4);
  });
});
