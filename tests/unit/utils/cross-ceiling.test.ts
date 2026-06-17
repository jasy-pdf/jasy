import { describe, it, expect } from "vitest";
import { FlexLayoutHelper, VERTICAL_AXIS } from "../../../src/lib/utils/flex-layout";
import { LayoutContext, PDFElement } from "../../../src/lib/elements/pdf-element";
import { BoxConstraints, Offset, Size } from "../../../src/lib/layout/box-constraints";

// Records the max width it was OFFERED, and reports a "wrapping" height: the narrower the
// offered width, the taller it gets (like a paragraph). This lets us assert the ceiling is
// applied even when the cross alignment is not `stretch`.
class WrappingBox extends PDFElement {
  offeredMaxWidth?: number;
  placedAt?: Offset;
  getProps(): unknown {
    return {};
  }
  calculateLayout(c: BoxConstraints, offset: Offset): Size {
    this.offeredMaxWidth = c.maxWidth;
    this.placedAt = offset;
    // Fill the offered width (like Text under bounded width); height grows as width shrinks.
    const width = c.maxWidth === Infinity ? 1000 : c.maxWidth;
    return { width, height: width === Infinity ? 20 : Math.ceil(1000 / width) * 20 };
  }
}

const ctx = {} as LayoutContext;

describe("cross-axis ceiling - nothing overflows regardless of alignment", () => {
  for (const cross of ["stretch", "start", "center", "end"] as const) {
    it(`caps a child's width to the column width with cross: ${cross}`, () => {
      const child = new WrappingBox();
      FlexLayoutHelper.layout(
        [child],
        VERTICAL_AXIS,
        /*mainAvail*/ 500,
        /*crossAvail*/ 120,
        0,
        0,
        { cross },
        ctx,
      );
      // The ceiling is the available column width, NEVER unbounded - so the child wraps
      // instead of running one line off the page. This is the regression that the old
      // non-stretch `loose(Infinity)` branch caused.
      expect(child.offeredMaxWidth).toBe(120);
    });
  }
});
