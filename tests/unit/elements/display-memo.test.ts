// `display()` memoises recasing, glyph coverage and the fallback split. Both are answers ABOUT the
// registered fonts, so a face registered afterwards has to invalidate them - the same reason
// `runAdvance` watches `fontEpoch`.
import { describe, it, expect } from "vitest";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { testMetrics } from "../support/metrics.ts";

describe("the display memo", () => {
  it("recomputes coverage when a face is registered on the same metrics", () => {
    let epoch = 0;
    let knows = false; // the tick mark is undrawable until a face brings it
    const m = testMetrics({
      hasGlyph: (cp) => cp !== 0x2713 || knows,
    });
    Object.defineProperty(m, "fontEpoch", { get: () => epoch });

    const ctx = { metrics: m, pageConfig: { width: 595, height: 842, margin: 0 } } as never;
    const el = new TextElement({ content: "ok ✓", fontSize: 10 });
    el.calculateLayout(BoxConstraints.loose(400, Infinity), { x: 0, y: 0 }, ctx);
    expect(el.getProps().content).toBe("ok "); // dropped, nothing can draw it

    knows = true;
    epoch = 1; // what registerFont does
    el.calculateLayout(BoxConstraints.loose(400, Infinity), { x: 0, y: 0 }, ctx);
    expect(el.getProps().content).toBe("ok ✓");
  });
});
