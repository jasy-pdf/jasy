import { describe, it, expect } from "vitest";
import { codePointCount, runAdvance } from "../../../src/lib/text/advance";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import type { FontMetrics } from "../../../src/lib/utils/font-metrics";

// The one canonical run advance. letterSpacing is added after EVERY code point (the `Tc` operator),
// the last one included - measuring `(n - 1)` would draw one spacing wider than it was wrapped.

const helvetica = () => {
  const m = new PDFObjectManager();
  m.registerFont("Helvetica", FontStyle.Normal, "Helvetica");
  return m;
};
const font = { fontFamily: "Helvetica", fontSize: 100, fontStyle: FontStyle.Normal };

describe("codePointCount", () => {
  it("counts code points, not UTF-16 units (an astral char is one)", () => {
    expect(codePointCount("abc")).toBe(3);
    expect(codePointCount(" ")).toBe(1);
    expect(codePointCount("a😀b")).toBe(3); // the emoji is one code point, not two
  });
});

describe("runAdvance", () => {
  it("is the plain glyph width when there is no letter-spacing", () => {
    const m = helvetica();
    expect(runAdvance(m, "Total", font)).toBeCloseTo(
      m.getStringWidth("Total", "Helvetica", 100, FontStyle.Normal),
      9,
    );
  });

  it("adds one spacing per code point, the last included", () => {
    const m = helvetica();
    const plain = m.getStringWidth("Total", "Helvetica", 100, FontStyle.Normal);
    // "Total" is 5 code points -> 5 spacings, not 4.
    expect(runAdvance(m, "Total", font, 3)).toBeCloseTo(plain + 5 * 3, 9);
  });

  it("counts the trailing spacing (n, not n-1) - the box must reserve what Tc draws", () => {
    const m = helvetica();
    const a = runAdvance(m, "ab", font, 10);
    const b = runAdvance(m, "abc", font, 10);
    // One more glyph adds its width AND one spacing.
    const cWidth = m.getCharWidth("c", 100, undefined, "Helvetica", FontStyle.Normal);
    expect(b - a).toBeCloseTo(cWidth + 10, 9);
  });

  it("tightens with a negative spacing", () => {
    const m = helvetica();
    const plain = m.getStringWidth("AV", "Helvetica", 100, FontStyle.Normal);
    expect(runAdvance(m, "AV", font, -5)).toBeCloseTo(plain - 2 * 5, 9);
  });

  it("at spacing 0 returns the exact getStringWidth value (the fast path)", () => {
    const m = helvetica();
    const w = m.getStringWidth("hello world", "Helvetica", 100, FontStyle.Normal);
    expect(runAdvance(m, "hello world", font, 0)).toBe(w);
  });
});

describe("naturalWidth matches the wrapped width (via the shared primitive)", () => {
  it("a spaced string measures the same whether laid out bounded or unbounded", async () => {
    // The bug this guards: if the line-breaker and naturalWidth added spacing differently, a Row-sized
    // text would re-wrap in its own box. Both call runAdvance, so they agree.
    const { TextElement } = await import("../../../src/lib/elements/text-element");
    const { BoxConstraints } = await import("../../../src/lib/layout/box-constraints");
    const m: FontMetrics = {
      getStringWidth: (t) => t.length * 6,
      getCharWidth: () => 6,
      getFontVerticals: () => ({ ascent: 0.8, descent: 0.2, lineGap: 0 }),
    };
    const ctx = { metrics: m, pageConfig: {} } as never;

    const text = new TextElement({ fontSize: 10, content: "one two three", letterSpacing: 2 });
    const unbounded = text.calculateLayout(
      BoxConstraints.loose(Infinity, Infinity),
      { x: 0, y: 0 },
      ctx,
    );
    // 13 glyphs * 6 + 13 spacings * 2 = 78 + 26 = 104.
    expect(unbounded.width).toBe(104);
    // Laid out at exactly that width, it stays one line (height = one line box).
    const bounded = text.calculateLayout(BoxConstraints.loose(104, Infinity), { x: 0, y: 0 }, ctx);
    expect(bounded.height).toBe(10);
  });
});
