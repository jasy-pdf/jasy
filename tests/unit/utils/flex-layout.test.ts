import { describe, it, expect, beforeEach } from "vitest";
import { FlexLayoutHelper } from "../../../src/lib/utils/flex-layout";
import {
  PDFElement,
  LayoutConstraints,
  FlexiblePDFElement,
  VerticalAlignment,
} from "../../../src/lib/elements/pdf-element";
import { X } from "vitest/dist/chunks/reporters.WnPwkmgA";

// Mock-Klassen für PDFElement und FlexiblePDFElement
class MockPDFElement extends PDFElement {
  constructor(private layout: { height: number }) {
    super();
  }

  getProps(): { [key: string]: any } {
    throw new Error("Method not implemented.");
  }

  calculateLayout(constraints: LayoutConstraints) {
    return { x: 0, y: 0, width: 0, height: this.layout.height };
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

  calculateLayout(constraints: LayoutConstraints) {
    return { x: 0, y: 0, width: 0, height: constraints.height }; // Just returning the height from constraints for simplicity
  }
}

describe("FlexLayoutHelper", () => {
  it("should calculate layout with fixed and flexible elements", () => {
    const fixedElement1 = new MockPDFElement({ height: 100 });
    const fixedElement2 = new MockPDFElement({ height: 50 });
    const flexibleElement1 = new MockFlexiblePDFElement(1);
    const flexibleElement2 = new MockFlexiblePDFElement(2);

    const parentConstraints = { x: 0, y: 0, width: 0, height: 500 };
    const parentConstraintsDeepClone = JSON.parse(
      JSON.stringify(parentConstraints)
    );
    const startY = 0;

    const result = FlexLayoutHelper.calculateFlexLayout(
      [fixedElement1, fixedElement2, flexibleElement1, flexibleElement2],
      parentConstraints,
      startY
    );

    expect(result.positions.length).toBe(4);
    expect(result.positions[0].y).toBe(0); // Fixed element 1 at y = 0
    expect(result.positions[1].y).toBe(100); // Fixed element 2 at y = 100
    expect(result.positions[2].y).toBe(150); // First flexible element starts at y = 150
    expect(result.positions[3].y).toBeGreaterThan(150); // Second flexible element should be positioned below the first

    const remainingHeight = parentConstraintsDeepClone.height - 150; // Remaining height after fixed elements
    const expectedHeightFlexible1 = remainingHeight / 3; // Flex 1 of total 3

    expect(result.positions[2].y).toBe(150);
    expect(result.positions[3].y).toBe(
      parseFloat((150 + expectedHeightFlexible1).toFixed(6))
    );
    expect(result.totalFlex).toBe(3); // 1 + 2 = 3 :-)
  });

  it("should return correct total height used by fixed elements", () => {
    const fixedElement1 = new MockPDFElement({ height: 100 });
    const fixedElement2 = new MockPDFElement({ height: 50 });
    const parentConstraints = { x: 0, y: 0, width: 0, height: 500 };
    const startY = 0;

    const result = FlexLayoutHelper.calculateFlexLayout(
      [fixedElement1, fixedElement2],
      parentConstraints,
      startY
    );

    expect(result.usedHeight).toBe(150); // 100 + 50
  });

  it("should correctly handle cases with no flexible elements", () => {
    const fixedElement1 = new MockPDFElement({ height: 100 });
    const fixedElement2 = new MockPDFElement({ height: 50 });
    const parentConstraints = { x: 0, y: 0, width: 0, height: 500 };
    const startY = 0;

    const result = FlexLayoutHelper.calculateFlexLayout(
      [fixedElement1, fixedElement2],
      parentConstraints,
      startY
    );

    expect(result.totalFlex).toBe(0); // No flexible elements
    expect(result.usedHeight).toBe(150); // Fixed height is 100 + 50
  });

  it("should correctly handle cases with only flexible elements", () => {
    const flexibleElement1 = new MockFlexiblePDFElement(1);
    const flexibleElement2 = new MockFlexiblePDFElement(2);
    const parentConstraints = { x: 0, y: 0, width: 0, height: 500 };
    const startY = 0;

    const result = FlexLayoutHelper.calculateFlexLayout(
      [flexibleElement1, flexibleElement2],
      parentConstraints,
      startY
    );

    expect(result.totalFlex).toBe(3); // 1 + 2
    const remainingHeight = parentConstraints.height;
    expect(result.positions[0].y).toBe(0);
    expect(result.positions[1].y).toBe(
      parseFloat((remainingHeight / 3).toFixed(6))
    ); // Second element after the first
  });
});
