import { describe, it, expect } from "vitest";
import { FlexLayoutHelper } from "../../../src/lib/utils/flex-layout";
import {
  PDFElement,
  LayoutContext,
  FlexiblePDFElement,
  VerticalAlignment,
} from "../../../src/lib/elements/pdf-element";
import { BoxConstraints, Size } from "../../../src/lib/layout/box-constraints";

// Mock elements for PDFElement and FlexiblePDFElement. The helper only lays out the
// fixed children (and reads their returned height); flexible children are positioned
// but never laid out here, so their calculateLayout return is irrelevant.
class MockPDFElement extends PDFElement {
  constructor(private layout: { height: number }) {
    super();
  }

  getProps(): { [key: string]: any } {
    throw new Error("Method not implemented.");
  }

  calculateLayout(): Size {
    return { width: 0, height: this.layout.height };
  }
}

class MockFlexiblePDFElement extends FlexiblePDFElement {
  constructor(flex: number) {
    super({ flex, verticalChildAlignment: VerticalAlignment.top });
  }

  getProps(): { [key: string]: any } {
    throw new Error("Method not implemented.");
  }

  getFlex() {
    return this.flex;
  }

  calculateLayout(constraints: BoxConstraints): Size {
    return { width: 0, height: constraints.maxHeight };
  }
}

const ctx = {} as LayoutContext; // mocks ignore it
const originX = 0;
const startY = 0;
const inner = BoxConstraints.loose(0, 500); // content box: maxHeight 500

describe("FlexLayoutHelper", () => {
  it("should calculate layout with fixed and flexible elements", () => {
    const fixedElement1 = new MockPDFElement({ height: 100 });
    const fixedElement2 = new MockPDFElement({ height: 50 });
    const flexibleElement1 = new MockFlexiblePDFElement(1);
    const flexibleElement2 = new MockFlexiblePDFElement(2);

    const result = FlexLayoutHelper.calculateFlexLayout(
      [fixedElement1, fixedElement2, flexibleElement1, flexibleElement2],
      inner,
      originX,
      startY,
      ctx
    );

    expect(result.positions.length).toBe(4);
    expect(result.positions[0].y).toBe(0); // Fixed element 1 at y = 0
    expect(result.positions[1].y).toBe(100); // Fixed element 2 at y = 100
    expect(result.positions[2].y).toBe(150); // First flexible element starts at y = 150
    expect(result.positions[3].y).toBeGreaterThan(150); // Second flexible element below the first

    const remainingHeight = inner.maxHeight - 150; // after the fixed elements
    const expectedHeightFlexible1 = remainingHeight / 3; // flex 1 of total 3

    expect(result.positions[2].y).toBe(150);
    expect(result.positions[3].y).toBeCloseTo(150 + expectedHeightFlexible1, 5);
    expect(result.totalFlex).toBe(3); // 1 + 2 = 3 :-)
  });

  it("places children in source order: a fixed child after a flex child lands below it", () => {
    const header = new MockPDFElement({ height: 100 });
    const flexBody = new MockFlexiblePDFElement(1);
    const footer = new MockPDFElement({ height: 50 });

    const result = FlexLayoutHelper.calculateFlexLayout(
      [header, flexBody, footer],
      inner, // maxHeight 500
      originX,
      startY,
      ctx
    );

    // remaining = 500 - (100 + 50) = 350 -> the flex body fills 350.
    expect(result.positions.map((p) => p.element)).toEqual([
      header,
      flexBody,
      footer,
    ]);
    expect(result.positions[0].y).toBe(0); // header at the top
    expect(result.positions[1].y).toBe(100); // body right after the header
    expect(result.positions[2].y).toBe(450); // footer below the body (100 + 350), not at 100
  });

  it("should return correct total height used by fixed elements", () => {
    const fixedElement1 = new MockPDFElement({ height: 100 });
    const fixedElement2 = new MockPDFElement({ height: 50 });

    const result = FlexLayoutHelper.calculateFlexLayout(
      [fixedElement1, fixedElement2],
      inner,
      originX,
      startY,
      ctx
    );

    expect(result.usedHeight).toBe(150); // 100 + 50
  });

  it("should correctly handle cases with no flexible elements", () => {
    const fixedElement1 = new MockPDFElement({ height: 100 });
    const fixedElement2 = new MockPDFElement({ height: 50 });

    const result = FlexLayoutHelper.calculateFlexLayout(
      [fixedElement1, fixedElement2],
      inner,
      originX,
      startY,
      ctx
    );

    expect(result.totalFlex).toBe(0); // No flexible elements
    expect(result.usedHeight).toBe(150); // Fixed height is 100 + 50
  });

  it("should correctly handle cases with only flexible elements", () => {
    const flexibleElement1 = new MockFlexiblePDFElement(1);
    const flexibleElement2 = new MockFlexiblePDFElement(2);

    const result = FlexLayoutHelper.calculateFlexLayout(
      [flexibleElement1, flexibleElement2],
      inner,
      originX,
      startY,
      ctx
    );

    expect(result.totalFlex).toBe(3); // 1 + 2
    const remainingHeight = inner.maxHeight;
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[1].y).toBeCloseTo(remainingHeight / 3, 5); // after the first
  });
});
