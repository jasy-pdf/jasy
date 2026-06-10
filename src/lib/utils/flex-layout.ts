import {
  PDFElement,
  LayoutContext,
  FlexiblePDFElement,
} from "../elements/pdf-element";
import { BoxConstraints } from "../layout/box-constraints";

export class FlexLayoutHelper {
  /**
   * Vertical flex distribution. Fixed children are laid out first (stacked from
   * `startY`, each at `originX`) and their heights summed; `ExpandedElement`s are held
   * back and only get y positions here (their actual height is split from the leftover
   * by the caller). `inner` carries the container's content box: `maxWidth`/`maxHeight`
   * are the space available to the children.
   */
  static calculateFlexLayout(
    children: PDFElement[],
    inner: BoxConstraints,
    originX: number,
    startY: number,
    ctx: LayoutContext
  ): {
    positions: { element: PDFElement; y: number }[];
    usedHeight: number;
    totalFlex: number;
  } {
    let usedHeight = 0; // Height taken by the fixed children
    let totalFlex = 0;
    let expandedElements: { element: FlexiblePDFElement; index: number }[] = [];
    let positions: { element: PDFElement; y: number }[] = [];
    let lastYPosition = startY;

    const innerWidth = inner.maxWidth;
    const innerHeight = inner.maxHeight;

    // First run: lay out the fixed children, hold the flexible ones.
    for (let [index, child] of children.entries()) {
      if (child instanceof FlexiblePDFElement) {
        expandedElements.push({ element: child, index });
        totalFlex += child.getFlex();
      } else {
        const childSize = child.calculateLayout(
          BoxConstraints.loose(innerWidth, innerHeight),
          { x: originX, y: lastYPosition },
          ctx
        );
        usedHeight += childSize.height;
        positions.push({ element: child, y: lastYPosition });
        lastYPosition += childSize.height;
      }
    }

    const remainingHeight = Math.max(innerHeight - usedHeight, 0);

    // Second run: only y positions for the flexible children (height split below).
    for (let expanded of expandedElements) {
      const flexHeight = parseFloat(
        ((expanded.element.getFlex() / totalFlex) * remainingHeight).toFixed(6)
      );
      positions.push({ element: expanded.element, y: lastYPosition });
      lastYPosition += flexHeight;
    }

    return {
      positions,
      usedHeight,
      totalFlex,
    };
  }
}
