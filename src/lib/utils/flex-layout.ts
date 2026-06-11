import {
  PDFElement,
  LayoutContext,
  FlexiblePDFElement,
} from "../elements/pdf-element";
import { BoxConstraints } from "../layout/box-constraints";

export class FlexLayoutHelper {
  /**
   * Vertical flex distribution, IN SOURCE ORDER. Fixed children take their measured
   * height; flex (`ExpandedElement`) children split the leftover space by their `flex`.
   * Positions are assigned in declaration order, so a flex child placed between fixed
   * ones pushes the later ones down - `[header, Expanded, footer]` puts the footer at the
   * bottom, not above the body. `inner` carries the container's content box:
   * `maxWidth`/`maxHeight` are the space available to the children.
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
    const innerWidth = inner.maxWidth;
    const innerHeight = inner.maxHeight;

    // First pass: measure the fixed children and total the flex. (Flex children get no
    // height yet - it depends on what the fixed ones leave over.)
    let usedHeight = 0;
    let totalFlex = 0;
    const fixedHeights = new Map<PDFElement, number>();
    for (const child of children) {
      if (child instanceof FlexiblePDFElement) {
        totalFlex += child.getFlex();
      } else {
        const childSize = child.calculateLayout(
          BoxConstraints.loose(innerWidth, innerHeight),
          { x: originX, y: startY },
          ctx
        );
        usedHeight += childSize.height;
        fixedHeights.set(child, childSize.height);
      }
    }

    const remainingHeight = Math.max(innerHeight - usedHeight, 0);

    // Second pass: walk children in order, stacking each at the running y. A flex child
    // takes its share of the leftover; a fixed child takes its measured height.
    const positions: { element: PDFElement; y: number }[] = [];
    let lastYPosition = startY;
    for (const child of children) {
      positions.push({ element: child, y: lastYPosition });
      const childHeight =
        child instanceof FlexiblePDFElement
          ? (child.getFlex() / totalFlex) * remainingHeight
          : fixedHeights.get(child)!;
      lastYPosition += childHeight;
    }

    return { positions, usedHeight, totalFlex };
  }
}
