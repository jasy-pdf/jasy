import { describe, it, expect } from "vitest";
import { TextElement } from "../../../src/lib/elements/text-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";
import { FontMetrics } from "../../../src/lib/utils/font-metrics";
import { Text } from "../../../src/lib/api";

// Every glyph (and the space) is 10pt wide -> "alfa" = 40pt; at width 50 each word lands on its line.
const metrics = {
  getStringWidth: (t: string) => t.length * 10,
  getCharWidth: () => 10,
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

  it("defaults to 1 and flows through the factory", () => {
    expect(Text("hi").getProps().lineHeight).toBe(1);
    expect(Text("hi", { lineHeight: 1.4 }).getProps().lineHeight).toBe(1.4);
  });
});
