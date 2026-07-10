import { describe, it, expect } from "vitest";
import { TextElement } from "../../../src/lib/elements/text-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";
import { FontMetrics } from "../../../src/lib/utils/font-metrics";
import { Text } from "../../../src/lib/api";
import { unitVerticals } from "../support/metrics";

// Every glyph (and the space) is 10pt wide -> "alfa" = 40pt; at width 50 each word lands on its line.
const metrics = {
  getStringWidth: (t: string) => t.length * 10,
  getCharWidth: () => 10,
  getFontVerticals: unitVerticals,
} as unknown as FontMetrics;

const CONTENT = "alfa bram char dent emil"; // wraps to 5 lines at width 50

describe("lineHeight", () => {
  it("scales the laid-out height (line box = fontSize * lineHeight)", () => {
    const ctx = { metrics, pageConfig: {} } as LayoutContext;
    const tight = new TextElement({ fontSize: 10, content: CONTENT });
    const roomy = new TextElement({ fontSize: 10, content: CONTENT, lineHeight: 1.5 });
    tight.calculateLayout(BoxConstraints.loose(50, Infinity), { x: 0, y: 0 }, ctx);
    roomy.calculateLayout(BoxConstraints.loose(50, Infinity), { x: 0, y: 0 }, ctx);

    expect(tight.getProps().height).toBe(50); // 5 lines x 10
    expect(roomy.getProps().height).toBe(75); // 5 lines x 10 x 1.5
  });

  it("is unset by default (the font's natural line height) and flows through the factory", () => {
    // Unset does NOT mean 1: it means `ascent + descent + lineGap`, resolved per font at layout
    // time. Only an explicit value is a multiplier of the font size.
    expect(Text("hi").getProps().lineHeight).toBeUndefined();
    expect(Text("hi", { lineHeight: 1.4 }).getProps().lineHeight).toBe(1.4);
  });

  it("unset falls back to the font's own metrics, not to 1", () => {
    // A face that asks for 0.9 up, 0.3 down and 0.1 of lineGap wants a 1.3 em line box. A 1 em box
    // would be tighter than the font itself declares - which is exactly what the old hard-coded
    // baseline constant did to every embedded font.
    const tall = {
      getStringWidth: (t: string) => t.length * 10,
      getCharWidth: () => 10,
      getFontVerticals: () => ({ ascent: 0.9, descent: 0.3, lineGap: 0.1 }),
    } as unknown as FontMetrics;
    const ctx = { metrics: tall, pageConfig: {} } as LayoutContext;

    const natural = new TextElement({ fontSize: 10, content: CONTENT });
    natural.calculateLayout(BoxConstraints.loose(50, Infinity), { x: 0, y: 0 }, ctx);
    expect(natural.getProps().height).toBeCloseTo(65); // 5 lines x 10 x 1.3

    const explicit = new TextElement({ fontSize: 10, content: CONTENT, lineHeight: 1 });
    explicit.calculateLayout(BoxConstraints.loose(50, Infinity), { x: 0, y: 0 }, ctx);
    expect(explicit.getProps().height).toBe(50); // an explicit 1 still means exactly 1 em
  });
});
