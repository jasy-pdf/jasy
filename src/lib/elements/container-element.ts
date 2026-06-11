import { FlexLayoutHelper } from "../utils/flex-layout";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
import {
  Fragmentable,
  FragmentResult,
  packChildren,
} from "../layout/fragmentation";
import {
  FlexiblePDFElement,
  LayoutContext,
  PDFElement,
  SizedElement,
  SizedPDFElement,
  WithChildren,
} from "./pdf-element";

interface ContainerElementParams extends SizedElement, WithChildren {}

export class ContainerElement extends SizedPDFElement implements Fragmentable {
  private children: PDFElement[];

  constructor({ x, y, width, height, children }: ContainerElementParams) {
    super({ x, y, width, height });

    this.children = children;
  }

  /**
   * Splits the vertical stack across pages. Children are measured against the content
   * width and packed until one would exceed `maxHeight`. That straddling child is itself
   * fragmented if it can be (Slice 1: a text paragraph splits at line boxes); otherwise
   * it moves whole. Everything after the break spills into the remainder. Progress is
   * guaranteed: if nothing fit on the page, the straddling child is forced on (it
   * overflows) so the next region always makes headway.
   *
   * Flex children make the container absorb the leftover space, so it never overflows -
   * in that case we don't fragment and hand the whole container back as `fitted`.
   */
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    const { fitted, remainder } = packChildren(
      this.children,
      maxHeight,
      width,
      ctx
    );
    // Fits as one region: hand the whole container back so the page renders unchanged
    // (its normal layout distributes flex / fills the page).
    if (remainder.length === 0) return { fitted: this, remainder: null };

    return {
      fitted: this.cloneWithChildren(fitted),
      remainder: this.cloneWithChildren(remainder),
    };
  }

  private cloneWithChildren(children: PDFElement[]): ContainerElement {
    return new ContainerElement({
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      children,
    });
  }

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    // The container fills the space it is offered.
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;
    if (constraints.hasBoundedHeight) this.height = constraints.maxHeight;
    this.x = offset.x;
    this.y = offset.y;

    const width = this.width ?? 0;
    const height = this.height ?? 0;

    if (this.children) {
      const inner = BoxConstraints.loose(width, height);
      // Helper to caluclate the height
      const { positions, usedHeight, totalFlex } =
        FlexLayoutHelper.calculateFlexLayout(
          this.children,
          inner,
          this.x,
          this.y,
          ctx
        );
      // Calc the remaining height and set the current positions
      const remainingHeight = Math.max(height - usedHeight, 0);

      for (let position of positions) {
        const { element, y } = position;
        if (element instanceof FlexiblePDFElement) {
          const flexHeight = (element.getFlex() / totalFlex) * remainingHeight;
          element.calculateLayout(
            BoxConstraints.loose(width, flexHeight),
            { x: this.x, y },
            ctx
          );
        } else {
          // Fixed elements are already calculated. Set only the y position
          element.calculateLayout(
            BoxConstraints.loose(width, height),
            { x: this.x, y },
            ctx
          );
        }
      }
    }

    // Top-left coordinates; the container itself draws nothing, and the Y-flip now
    // happens once at the IR -> backend seam.
    return { width, height };
  }

  override getProps(): ContainerElementParams {
    return {
      x: this.x,
      y: this.y,
      width: this.width!,
      height: this.height,
      children: this.children,
    };
  }
}
