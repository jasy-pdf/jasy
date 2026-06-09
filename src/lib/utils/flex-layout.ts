import {
  PDFElement,
  LayoutConstraints,
  LayoutContext,
  FlexiblePDFElement,
} from "../elements/pdf-element";

export class FlexLayoutHelper {
  static calculateFlexLayout(
    children: PDFElement[],
    parentConstraints: LayoutConstraints,
    startY: number,
    ctx: LayoutContext
  ): {
    positions: { element: PDFElement; y: number }[];
    usedHeight: number;
    totalFlex: number;
  } {
    let usedHeight = 0; // Height for `PDFElements`
    let totalFlex = 0; // Flex value
    let expandedElements: { element: FlexiblePDFElement; index: number }[] = [];
    let positions: { element: PDFElement; y: number }[] = [];
    let lastYPosition = startY;

    // First run: Calc `PDFElement`s and hold `FlexibleElement`s
    for (let [index, child] of children.entries()) {
      if (child instanceof FlexiblePDFElement) {
        expandedElements.push({ element: child, index });
        totalFlex += child.getFlex();
      } else {
        // Calc the fixed elements
        const childLayout = child.calculateLayout(
          {
            ...parentConstraints,
            y: lastYPosition,
          },
          ctx
        );
        usedHeight += childLayout.height || 0;
        positions.push({ element: child, y: lastYPosition });
        lastYPosition += childLayout.height || 0;
      }
    }

    const remainingHeight = Math.max(
      (parentConstraints.height || 0) - usedHeight,
      0
    );

    // Second run: Calc the flexible elements height
    for (let expanded of expandedElements) {
      const flexHeight = parseFloat(
        ((expanded.element.getFlex() / totalFlex) * remainingHeight).toFixed(6)
      );
      positions.push({ element: expanded.element, y: lastYPosition });
      lastYPosition += flexHeight;
    }

    return {
      positions, // Returns all positions
      usedHeight, // The height, used by the fixed elements
      totalFlex, // All the summarized flex
    };
  }
}
