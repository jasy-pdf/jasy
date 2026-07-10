import { describe, it, expect } from "vitest";
import { TextElement } from "../../../src/lib/elements/text-element";
import { TextSegment } from "../../../src/lib/elements/text-element";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import type { FontMetrics } from "../../../src/lib/utils/font-metrics";
import { unitVerticals } from "../support/metrics";

// Deterministic metrics: each glyph is 10 wide, spaces are 0. With six 2-char words and
// maxWidth 50 the greedy breaker yields three lines of two words each.
const metrics: FontMetrics = {
  getStringWidth: (text) => text.length * 10,
  getCharWidth: () => 0,
  getFontVerticals: unitVerticals,
};
const ctx = { metrics } as LayoutContext;

const para = (content: string, fontSize = 10) => new TextElement({ fontSize, content });

const contentOf = (el: unknown) => (el as TextElement).getProps().content as string;

describe("TextElement.fragment - split at line boxes", () => {
  it("keeps the lines that fit and spills the rest", () => {
    // 3 lines, each 10pt tall. maxHeight 20 -> 2 lines fit.
    const { fitted, remainder } = para("aa bb cc dd ee ff").fragment(20, 50, ctx);
    expect(contentOf(fitted)).toBe("aa bb cc dd");
    expect(contentOf(remainder)).toBe("ee ff");
  });

  it("re-wrapping the fitted text reproduces exactly the kept lines", () => {
    // The fitted content must wrap back to the same 2 lines at the same width.
    const { fitted } = para("aa bb cc dd ee ff").fragment(20, 50, ctx);
    const height = (fitted as TextElement).calculateLayout(
      BoxConstraints.loose(50, Infinity),
      { x: 0, y: 0 },
      ctx,
    ).height;
    expect(height).toBe(20); // 2 lines * 10pt
  });

  it("returns the whole element when everything fits", () => {
    const text = para("aa bb cc dd ee ff");
    const { fitted, remainder } = text.fragment(1000, 50, ctx);
    expect(fitted).toBe(text);
    expect(remainder).toBeNull();
  });

  it("places nothing when not even one line fits (caller handles progress)", () => {
    const text = para("aa bb cc dd ee ff");
    const { fitted, remainder } = text.fragment(5, 50, ctx); // < fontSize 10
    expect(fitted).toBeNull();
    expect(remainder).toBe(text);
  });

  // Height after re-wrapping at width 50: a robust proxy for "no text duplicated or lost".
  const wrappedHeight = (el: unknown) =>
    (el as TextElement).calculateLayout(BoxConstraints.loose(50, Infinity), { x: 0, y: 0 }, ctx)
      .height;

  it("splits styled segments at line boxes too", () => {
    // One segment wrapping to 3 lines of 10pt each; maxHeight 20 keeps 2.
    const segments: TextSegment[] = [{ content: "aa bb cc dd ee ff", fontSize: 10 }];
    const text = new TextElement({ fontSize: 10, content: segments });
    const { fitted, remainder } = text.fragment(20, 50, ctx);

    expect(wrappedHeight(fitted)).toBe(20); // 2 lines kept
    expect(wrappedHeight(remainder)).toBe(10); // 1 line spilled
    // Total is conserved: nothing duplicated, nothing dropped.
    expect(wrappedHeight(fitted) + wrappedHeight(remainder)).toBe(30);
  });

  it("splits across a segment boundary without duplicating text", () => {
    // Two segments; the second's first word lands on a new line (exercises the breaker's
    // empty-placeholder fix). 4 lines total of 10pt; maxHeight 25 keeps 2.
    const segments: TextSegment[] = [
      { content: "aa bb cc dd", fontSize: 10 },
      { content: "ee ff gg hh", fontSize: 10 },
    ];
    const original = new TextElement({ fontSize: 10, content: segments });
    const originalHeight = wrappedHeight(original);

    const { fitted, remainder } = original.fragment(25, 50, ctx);
    expect(wrappedHeight(fitted) + wrappedHeight(remainder)).toBe(originalHeight);
  });
});
