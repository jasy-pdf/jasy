import { describe, it, expect } from "vitest";
import { PaddingElement } from "../../../src/lib/elements/layout/padding-element";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { TextElement } from "../../../src/lib/elements/text-element";
import { LineElement } from "../../../src/lib/elements/line-element";
import { LayoutContext, PDFElement } from "../../../src/lib/elements/pdf-element";
import { BoxConstraints, Offset, Size } from "../../../src/lib/layout/box-constraints";
import { packChildren } from "../../../src/lib/layout/fragmentation";
import type { FontMetrics } from "../../../src/lib/utils/font-metrics";

// Each glyph 10 wide, spaces 0: "aa bb cc dd ee ff" wraps to 3 lines of 10pt at width 50.
const metrics: FontMetrics = {
  getStringWidth: (text) => text.length * 10,
  getCharWidth: () => 0,
};
const ctx = { metrics } as LayoutContext;

const tallText = () => new TextElement({ fontSize: 10, content: "aa bb cc dd ee ff" });

const laidOutHeight = (el: unknown, width: number) =>
  (el as PaddingElement).calculateLayout(BoxConstraints.loose(width, Infinity), { x: 0, y: 0 }, ctx)
    .height;

const innerText = (el: unknown): string => {
  const props = (el as { getProps(): any }).getProps();
  const child = props.child ?? props.children[0];
  return child.getProps().content as string;
};

describe("PaddingElement.fragment (clone insets)", () => {
  it("splits the child and re-wraps each half in its own padding", () => {
    const padding = new PaddingElement({
      margin: [5, 0, 5, 0], // top/bottom 5
      child: tallText(),
    });

    const { fitted, remainder } = padding.fragment(30, 50, ctx);

    expect(fitted).toBeInstanceOf(PaddingElement);
    expect(remainder).toBeInstanceOf(PaddingElement);
    // 2 lines (20) + 2*5 inset = 30; the spilled line is 10 + 10 = 20.
    expect(laidOutHeight(fitted, 50)).toBe(30);
    expect(laidOutHeight(remainder, 50)).toBe(20);
    // No text lost across the split.
    expect(innerText(fitted)).toBe("aa bb cc dd");
    expect(innerText(remainder)).toBe("ee ff");
  });

  it("moves the whole padding on when its child can't be split", () => {
    const atomicChild = new LineElement({ x: 0, y: 0, xEnd: 50, yEnd: 0 });
    const padding = new PaddingElement({ margin: [5, 0, 5, 0], child: atomicChild });
    const { fitted, remainder } = padding.fragment(8, 50, ctx);
    // A line isn't fragmentable -> nothing splits, the padding moves whole.
    expect(fitted).toBeNull();
    expect(remainder).toBe(padding);
  });
});

// A fixed-height, non-fragmentable block - the simplest thing packChildren can pack.
class FixedBox extends PDFElement {
  constructor(private h: number) {
    super();
  }
  getProps(): unknown {
    return {};
  }
  calculateLayout(_c: BoxConstraints, _o: Offset): Size {
    return { width: 0, height: this.h };
  }
}

describe("packChildren - the Column gap counts against the region", () => {
  const boxes = () => Array.from({ length: 10 }, () => new FixedBox(100));

  it("packs as many as fit edge-to-edge when there is no gap", () => {
    const { fitted, remainder } = packChildren(boxes(), 350, 0, ctx);
    expect(fitted).toHaveLength(3); // 3 * 100 = 300 <= 350
    expect(remainder).toHaveLength(7);
  });

  it("counts the inter-child gap, so fewer fit (no overflow into the next band)", () => {
    const { fitted, remainder } = packChildren(boxes(), 350, 0, ctx, 50);
    // 100 + (50+100) + (50+100) = 400 > 350, so only 2 fit (100 + 150 = 250).
    expect(fitted).toHaveLength(2);
    expect(remainder).toHaveLength(8);
  });
});

describe("RectangleElement.fragment (clone border)", () => {
  it("splits a bordered box into two, each with its own full border", () => {
    const rect = new RectangleElement({
      x: 0,
      y: 0,
      borderWidth: 2,
      children: [tallText()],
    });

    const { fitted, remainder } = rect.fragment(26, 50, ctx);

    expect(fitted).toBeInstanceOf(RectangleElement);
    expect(remainder).toBeInstanceOf(RectangleElement);
    // The fitted fragment fits within the region it was given.
    expect(laidOutHeight(fitted, 50)).toBeLessThanOrEqual(26);
    // No text lost across the split.
    expect(innerText(fitted)).toBe("aa bb cc dd");
    expect(innerText(remainder)).toBe("ee ff");
  });

  it("does not split when its content already fits", () => {
    const rect = new RectangleElement({
      x: 0,
      y: 0,
      borderWidth: 2,
      children: [tallText()],
    });
    const { fitted, remainder } = rect.fragment(1000, 50, ctx);
    expect(fitted).toBe(rect);
    expect(remainder).toBeNull();
  });
});
