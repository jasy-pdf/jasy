import {
  PDFElement,
  LayoutContext,
  FlexiblePDFElement,
} from "../elements/pdf-element";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";

/**
 * Maps the abstract MAIN/CROSS axes onto concrete width/height + x/y, so one flex
 * algorithm drives both a vertical Column (main = height) and a horizontal Row
 * (main = width). "main" is the stacking direction; "cross" is perpendicular.
 */
export interface FlexAxis {
  mainOf(size: Size): number;
  crossOf(size: Size): number;
  /** Constraints for a content-sized child: main unbounded, cross capped at `crossAvail`. */
  measureConstraints(crossAvail: number): BoxConstraints;
  /** Constraints for a flex child given its resolved main extent. */
  flexConstraints(mainExtent: number, crossAvail: number): BoxConstraints;
  /** Absolute offset for a child at main position `mainPos`, cross origin `crossOrigin`. */
  offsetAt(mainPos: number, crossOrigin: number): Offset;
}

/** Vertical stacking (Column): main = height (y), cross = width (x). */
export const VERTICAL_AXIS: FlexAxis = {
  mainOf: (s) => s.height,
  crossOf: (s) => s.width,
  measureConstraints: (crossAvail) => BoxConstraints.loose(crossAvail, Infinity),
  flexConstraints: (mainExtent, crossAvail) =>
    BoxConstraints.loose(crossAvail, mainExtent),
  offsetAt: (mainPos, crossOrigin) => ({ x: crossOrigin, y: mainPos }),
};

/** Horizontal stacking (Row): main = width (x), cross = height (y). */
export const HORIZONTAL_AXIS: FlexAxis = {
  mainOf: (s) => s.width,
  crossOf: (s) => s.height,
  measureConstraints: (crossAvail) => BoxConstraints.loose(Infinity, crossAvail),
  flexConstraints: (mainExtent, crossAvail) =>
    BoxConstraints.loose(mainExtent, crossAvail),
  offsetAt: (mainPos, crossOrigin) => ({ x: mainPos, y: crossOrigin }),
};

export class FlexLayoutHelper {
  /**
   * Lays out a flex line along `axis`, IN SOURCE ORDER, and places every child.
   * Fixed children take their natural main extent; flex (`ExpandedElement`) children
   * split the leftover main space by their `flex`. `gap` is inserted between children.
   * Returns the total main extent consumed and the largest cross extent (the line's
   * cross size). Vertical with `gap = 0` reproduces the previous Column layout exactly.
   */
  static layout(
    children: PDFElement[],
    axis: FlexAxis,
    mainAvail: number,
    crossAvail: number,
    mainStart: number,
    crossOrigin: number,
    gap: number,
    ctx: LayoutContext
  ): { mainUsed: number; crossUsed: number } {
    const totalGap = Math.max(0, children.length - 1) * gap;

    // Pass 1: measure the fixed children's main extent and total the flex. (Flex
    // children get no extent yet - it depends on what the fixed ones leave over.)
    let fixedMain = 0;
    let totalFlex = 0;
    for (const child of children) {
      if (child instanceof FlexiblePDFElement) {
        totalFlex += child.getFlex();
      } else {
        const size = child.calculateLayout(
          axis.measureConstraints(crossAvail),
          axis.offsetAt(mainStart, crossOrigin),
          ctx
        );
        fixedMain += axis.mainOf(size);
      }
    }

    const remaining = Math.max(mainAvail - fixedMain - totalGap, 0);

    // Pass 2: place each child in order at the running main position. A flex child
    // takes its share of the leftover; a fixed child takes its measured extent.
    let mainPos = mainStart;
    let crossUsed = 0;
    children.forEach((child, index) => {
      let mainExtent: number;
      if (child instanceof FlexiblePDFElement) {
        mainExtent = (child.getFlex() / totalFlex) * remaining;
        const size = child.calculateLayout(
          axis.flexConstraints(mainExtent, crossAvail),
          axis.offsetAt(mainPos, crossOrigin),
          ctx
        );
        crossUsed = Math.max(crossUsed, axis.crossOf(size));
      } else {
        const size = child.calculateLayout(
          axis.measureConstraints(crossAvail),
          axis.offsetAt(mainPos, crossOrigin),
          ctx
        );
        mainExtent = axis.mainOf(size);
        crossUsed = Math.max(crossUsed, axis.crossOf(size));
      }
      mainPos += mainExtent;
      if (index < children.length - 1) mainPos += gap;
    });

    return { mainUsed: mainPos - mainStart, crossUsed };
  }
}
