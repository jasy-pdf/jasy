import { PDFElement, LayoutContext, FlexiblePDFElement } from "../elements/pdf-element.ts";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints.ts";

/** Distribution of the children ALONG the stacking (main) axis when there is leftover
 *  space and no flex child to absorb it. */
export type MainAlign = "start" | "center" | "end" | "between" | "around";

/** Position/size of each child ACROSS the cross axis. `stretch` fills the cross extent;
 *  the others place the child at its natural cross size. */
export type CrossAlign = "start" | "center" | "end" | "stretch";

/**
 * Maps the abstract MAIN/CROSS axes onto concrete width/height + x/y, so one flex
 * algorithm drives both a vertical Column (main = height) and a horizontal Row
 * (main = width). "main" is the stacking direction; "cross" is perpendicular.
 */
export interface FlexAxis {
  mainOf(size: Size): number;
  crossOf(size: Size): number;
  /**
   * Constraints for a fixed child: the main extent is unbounded (it takes its natural
   * size); the cross extent is ALWAYS capped to what the line offers. The cap is a hard
   * ceiling regardless of `cross` alignment - it is what guarantees nothing ever overflows
   * (a paragraph wraps at the column width instead of running one line off the page). A
   * child smaller than the cap keeps its size and is positioned by `crossOffset`; a child
   * that wants to fill (Container, Text) fills the cap. So `stretch` vs `start/center/end`
   * differ only in where a smaller child sits, never in the ceiling.
   */
  measureConstraints(crossAvail: number): BoxConstraints;
  /** Constraints for a flex child (fills the cross axis like a stretched child). */
  flexConstraints(mainExtent: number, crossAvail: number): BoxConstraints;
  /** Absolute offset for a child at main position `mainPos`, cross position `crossPos`. */
  offsetAt(mainPos: number, crossPos: number): Offset;
}

export const VERTICAL_AXIS: FlexAxis = {
  mainOf: (s) => s.height,
  crossOf: (s) => s.width,
  measureConstraints: (crossAvail) => BoxConstraints.loose(crossAvail, Infinity),
  flexConstraints: (mainExtent, crossAvail) => BoxConstraints.loose(crossAvail, mainExtent),
  offsetAt: (mainPos, crossPos) => ({ x: crossPos, y: mainPos }),
};

export const HORIZONTAL_AXIS: FlexAxis = {
  mainOf: (s) => s.width,
  crossOf: (s) => s.height,
  measureConstraints: (crossAvail) => BoxConstraints.loose(Infinity, crossAvail),
  flexConstraints: (mainExtent, crossAvail) => BoxConstraints.loose(mainExtent, crossAvail),
  offsetAt: (mainPos, crossPos) => ({ x: mainPos, y: crossPos }),
};

/** Cross-axis offset of a child of size `childCross` within `crossExtent`. */
function crossOffset(align: CrossAlign, crossExtent: number, childCross: number): number {
  if (align === "center") return Math.max(0, (crossExtent - childCross) / 2);
  if (align === "end") return Math.max(0, crossExtent - childCross);
  return 0; // start, stretch (stretch fills, so no offset)
}

export interface FlexOptions {
  gap?: number;
  main?: MainAlign;
  cross?: CrossAlign;
}

export class FlexLayoutHelper {
  /**
   * Lays out a flex line along `axis`, IN SOURCE ORDER, and places every child.
   * Fixed children take their natural main extent; flex (`ExpandedElement`) children
   * split the leftover main space by their `flex`. `gap` is inserted between children.
   * `main` distributes any leftover when there is no flex child; `cross` positions/sizes
   * each child across the line. Returns the total main extent consumed and the cross
   * extent occupied. Vertical with `gap 0`, `main start`, `cross stretch` reproduces the
   * previous Column layout exactly.
   */
  static layout(
    children: PDFElement[],
    axis: FlexAxis,
    mainAvail: number,
    crossAvail: number,
    mainStart: number,
    crossOrigin: number,
    options: FlexOptions,
    ctx: LayoutContext,
  ): { mainUsed: number; crossUsed: number } {
    const gap = options.gap ?? 0;
    const main = options.main ?? "start";
    const cross = options.cross ?? "stretch";
    const count = children.length;

    // Pass 1: measure the fixed children (main extent + cross size) and total the flex.
    let fixedMain = 0;
    let totalFlex = 0;
    let crossUsed = 0;
    const fixedSize = new Map<PDFElement, Size>();
    for (const child of children) {
      if (child instanceof FlexiblePDFElement) {
        totalFlex += child.getFlex();
      } else {
        const size = child.calculateLayout(
          axis.measureConstraints(crossAvail),
          axis.offsetAt(mainStart, crossOrigin),
          ctx,
        );
        fixedMain += axis.mainOf(size);
        crossUsed = Math.max(crossUsed, axis.crossOf(size));
        fixedSize.set(child, size);
      }
    }

    const totalGap = Math.max(0, count - 1) * gap;
    const leftover = mainAvail - fixedMain - totalGap;
    const remaining = Math.max(leftover, 0); // for flex children

    // Main-axis distribution only kicks in with no flex child and bounded, positive space.
    let leadingSpace = 0;
    let betweenSpace = gap;
    if (totalFlex === 0 && mainAvail !== Infinity && leftover > 0) {
      if (main === "center") leadingSpace = leftover / 2;
      else if (main === "end") leadingSpace = leftover;
      else if (main === "between" && count > 1) betweenSpace = gap + leftover / (count - 1);
      else if (main === "around") {
        const unit = leftover / count;
        leadingSpace = unit / 2;
        betweenSpace = gap + unit;
      }
    }

    // Measure flex children too (at their main share) so a tall/wrapping flex cell counts
    // toward the line's cross extent - they're placed in pass 2, but crossExtent needs them now.
    if (totalFlex > 0) {
      for (const child of children) {
        if (child instanceof FlexiblePDFElement) {
          const mainExtent = (child.getFlex() / totalFlex) * remaining;
          const size = child.calculateLayout(
            axis.flexConstraints(mainExtent, crossAvail),
            axis.offsetAt(mainStart, crossOrigin),
            ctx,
          );
          crossUsed = Math.max(crossUsed, axis.crossOf(size));
        }
      }
    }

    // The cross extent children align within: the bounded line size, else the tallest child.
    const crossExtent = crossAvail !== Infinity ? crossAvail : crossUsed;

    // `stretch` caps a child's cross to `crossExtent` (not `crossAvail`) so siblings end up
    // equal across the axis. Bounded lines have crossExtent == crossAvail (byte-identical);
    // only an unbounded line (a shrink-wrap Row) now equalises instead of staying natural.
    const stretch = cross === "stretch";

    // Pass 2: place each child at the running main position, offset across by `cross`.
    let mainPos = mainStart + leadingSpace;
    let placedCross = 0;
    children.forEach((child, index) => {
      let mainExtent: number;
      if (child instanceof FlexiblePDFElement) {
        mainExtent = (child.getFlex() / totalFlex) * remaining;
        const size = child.calculateLayout(
          axis.flexConstraints(mainExtent, stretch ? crossExtent : crossAvail),
          axis.offsetAt(mainPos, crossOrigin),
          ctx,
        );
        placedCross = Math.max(placedCross, axis.crossOf(size));
      } else {
        const childCross = axis.crossOf(fixedSize.get(child)!);
        const size = child.calculateLayout(
          axis.measureConstraints(stretch ? crossExtent : crossAvail),
          axis.offsetAt(mainPos, crossOrigin + crossOffset(cross, crossExtent, childCross)),
          ctx,
        );
        mainExtent = axis.mainOf(size);
        placedCross = Math.max(placedCross, axis.crossOf(size));
      }
      mainPos += mainExtent;
      if (index < count - 1) mainPos += betweenSpace;
    });

    return { mainUsed: mainPos - mainStart, crossUsed: placedCross };
  }
}
