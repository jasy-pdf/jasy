import { Color } from "../common/color.ts";
import { BoxConstraints, Offset, Size, resolveExtent } from "../layout/box-constraints.ts";
import {
  Fragmentable,
  FragmentResult,
  childrenForceBreak,
  packChildren,
} from "../layout/fragmentation.ts";
import {
  LayoutContext,
  PDFElement,
  PositioningFrame,
  SizedElement,
  SizedPDFElement,
  WithChildren,
} from "./pdf-element.ts";

/** Per-side border colors. When set, each present side is stroked individually (sharp
 *  corners), instead of the uniform `color` border - this is what enables grid lines. */
export interface SideBorders {
  top?: Color;
  right?: Color;
  bottom?: Color;
  left?: Color;
}

interface RectangleElementParams extends SizedElement, WithChildren {
  color?: Color;
  backgroundColor?: Color;
  borderWidth?: number;
  /** Corner radius in points; 0 = sharp corners (default). */
  radius?: number;
  /** Individual side borders; overrides the uniform `color` border when present. */
  sideBorders?: SideBorders;
  /** When true, this box is a positioning frame for `Positioned` descendants (CSS `relative`). */
  relative?: boolean;
  /** `"hidden"` crops children to the box (CSS `overflow: hidden`); `"visible"` (default) lets a
   *  `Positioned` child spill over the edge. */
  overflow?: "hidden" | "visible";
  /** Width as a fraction (0..1) of the offered width, instead of a fixed `width` (CSS `50%`). Only
   *  resolves in a bounded region; an explicit `width` wins over it. */
  widthFactor?: number;
  /** Height as a fraction (0..1) of the offered height; see `widthFactor`. */
  heightFactor?: number;
  /** Start this box on a fresh page (CSS `break-before: page`). */
  breakBefore?: boolean;
  /** Start everything after this box on a fresh page (CSS `break-after: page`). */
  breakAfter?: boolean;
}

export class RectangleElement extends SizedPDFElement implements Fragmentable {
  private children: PDFElement[] = [];
  private color: Color;
  private backgroundColor?: Color;
  private borderWidth: number;
  private radius: number;
  private sideBorders?: SideBorders;
  private relative: boolean;
  private overflow: "hidden" | "visible";
  private breakBefore: boolean;
  private breakAfter: boolean;

  private sizeMemory!: {
    x: number;
    y: number;
    width?: number;
    height?: number;
    widthFactor?: number;
    heightFactor?: number;
  };

  constructor({
    children = [],
    color = new Color(0, 0, 0),
    backgroundColor,
    borderWidth,
    width,
    height,
    radius,
    sideBorders,
    relative,
    overflow,
    widthFactor,
    heightFactor,
    breakBefore,
    breakAfter,
  }: RectangleElementParams) {
    super({ x: 0, y: 0, width, height });

    this.children = children;
    this.color = color;
    this.backgroundColor = backgroundColor;
    // `?? 1` (not `|| 1`) so an explicit `0` means "no border" instead of snapping to 1.
    this.borderWidth = borderWidth ?? 1;
    this.radius = radius ?? 0;
    this.sideBorders = sideBorders;
    this.relative = relative ?? false;
    this.overflow = overflow ?? "visible";
    this.breakBefore = breakBefore ?? false;
    this.breakAfter = breakAfter ?? false;
    this.sizeMemory = { x: 0, y: 0, width, height, widthFactor, heightFactor };
  }

  override breaksBefore(): boolean {
    return this.breakBefore;
  }

  override breaksAfter(): boolean {
    return this.breakAfter;
  }

  /**
   * Splits the bordered box across pages (box-decoration-break: clone - every fragment
   * gets its own full border). The children stack is packed into the space left after
   * reserving the border on top and bottom; each fragment then shrink-wraps its own
   * content (explicit height = content + 2*border) so the border hugs the text instead of
   * filling the page. An explicit box height is intentionally overridden here - a split
   * box is sized by what it actually holds on each page.
   */
  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    // A percentage width resolves against the region width the page driver hands us, so a
    // paginating %-box keeps its fraction on every page.
    const boxWidth =
      this.sizeMemory.width ??
      (this.sizeMemory.widthFactor !== undefined ? width * this.sizeMemory.widthFactor : width);
    const innerWidth = Math.max(0, boxWidth - 2 * this.borderWidth);
    // Border-box: the content is inset by the border on top and bottom, so a fragment
    // holding `c` of content is `c + 2*border` tall. (Derived, not a fudge factor.)
    const innerMaxHeight = maxHeight - 2 * this.borderWidth;

    const { fitted, remainder, forceBreak } = packChildren(
      this.children,
      innerMaxHeight,
      innerWidth,
      ctx,
    );
    // Fits with no forced cut: return the whole box unchanged. A trailing forced break is the
    // exception - fall through so the box is rebuilt from the packed children (without the consumed
    // break marker), rather than handing back the original that still holds it.
    if (remainder.length === 0 && !forceBreak) return { fitted: this, remainder: null };

    const contentHeight = (kids: PDFElement[]): number =>
      kids.reduce(
        (sum, child) =>
          sum +
          child.calculateLayout(BoxConstraints.loose(innerWidth, Infinity), { x: 0, y: 0 }, ctx)
            .height,
        0,
      );

    return {
      fitted: this.cloneWithChildren(fitted, contentHeight(fitted) + 2 * this.borderWidth),
      // A trailing forced break leaves nothing to carry over: no remainder box, no extra page.
      // Only the CONTINUATION carries `breakAfter` (a box that splits still breaks after its LAST
      // fragment, not its first); `breakBefore` is dropped, already honoured before the split.
      remainder:
        remainder.length === 0
          ? null
          : this.cloneWithChildren(
              remainder,
              contentHeight(remainder) + 2 * this.borderWidth,
              this.breakAfter,
            ),
      forceBreak,
    };
  }

  override hasForcedBreak(): boolean {
    return childrenForceBreak(this.children);
  }

  private cloneWithChildren(
    children: PDFElement[],
    height: number,
    breakAfter = false,
  ): RectangleElement {
    return new RectangleElement({
      x: 0,
      y: 0,
      width: this.sizeMemory.width,
      widthFactor: this.sizeMemory.widthFactor,
      // A split box is sized by its per-page content (height passed in), so the height factor
      // is intentionally dropped here - box-decoration-break, same as an explicit height.
      height,
      children,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderWidth: this.borderWidth,
      radius: this.radius,
      sideBorders: this.sideBorders,
      relative: this.relative,
      overflow: this.overflow,
      breakAfter,
    });
  }

  override relativeSizeFactor(horizontal: boolean): number | undefined {
    return horizontal ? this.sizeMemory.widthFactor : this.sizeMemory.heightFactor;
  }

  /** A box has no flex children of its own, but it must not swallow the need of the stack inside it: a
   *  `Spacer` in a box can only resolve if the box itself was given a bounded extent to pass down. With an
   *  explicit size on an axis the box already knows its extent there and asks for nothing. */
  override needsBoundedMain(horizontal: boolean): boolean {
    const requested = horizontal
      ? [this.sizeMemory.width, this.sizeMemory.widthFactor]
      : [this.sizeMemory.height, this.sizeMemory.heightFactor];
    if (requested.some((v) => v !== undefined)) return false;
    return this.children.some((c) => c.needsBoundedMain(horizontal));
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    // An explicit extent is a fixed point size or a fraction of the offered box (relative sizing);
    // the fraction only resolves in a bounded region. `undefined` = fill / shrink-wrap below.
    const explicitWidth = resolveExtent(
      this.sizeMemory.width,
      this.sizeMemory.widthFactor,
      constraints.maxWidth,
      constraints.hasBoundedWidth,
    );
    const explicitHeight = resolveExtent(
      this.sizeMemory.height,
      this.sizeMemory.heightFactor,
      constraints.maxHeight,
      constraints.hasBoundedHeight,
    );

    // Width: an explicit size wins (clamped), else fill the offered box. (Without this a
    // fixed box would balloon to the parent's size.)
    this.width =
      explicitWidth !== undefined
        ? constraints.constrainWidth(explicitWidth)
        : constraints.hasBoundedWidth
          ? constraints.maxWidth
          : this.width;
    // Width shrink-wrap: no explicit width AND an unbounded region (e.g. a `Box` badge inside a
    // `Positioned`). Resolved after the children are measured, just below.
    const shrinkWrapWidth = explicitWidth === undefined && !constraints.hasBoundedWidth;
    // Height: explicit wins; otherwise FILL a bounded region (e.g. inside an Expanded) but
    // SHRINK-WRAP the content in an unbounded one (a note box in a stack). Shrink-wrap is
    // resolved after the children are measured, just below.
    const shrinkWrapHeight = explicitHeight === undefined && !constraints.hasBoundedHeight;
    this.height =
      explicitHeight !== undefined
        ? constraints.constrainHeight(explicitHeight)
        : constraints.hasBoundedHeight
          ? constraints.maxHeight
          : this.height;
    this.x = this.sizeMemory.x + offset.x;
    this.y = this.sizeMemory.y + offset.y;

    // A `relative` box is a positioning frame: thread a fresh frame to the subtree so any
    // `Positioned` descendant registers against it (out of flow), then drain it below once the
    // box is sized. A plain box leaves `ctx` untouched -> byte-identical.
    const frame: PositioningFrame | undefined = this.relative
      ? { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 }, place: [] }
      : undefined;
    const childCtx: LayoutContext = frame ? { ...ctx, frame } : ctx;

    // Lay out children stacked inside the border (inset by the border width). Width is finalized here;
    // height is left unbounded so each child sizes to its own content - EXCEPT for a child that cannot
    // lay itself out without a bound (a stack holding an `Expanded`/`Spacer`). That one gets the height
    // still free inside the box, so its flex child has real leftover space instead of an infinite one.
    const innerWidth = shrinkWrapWidth
      ? Infinity
      : Math.max(0, (this.width ?? 0) - 2 * this.borderWidth);
    const innerHeight = shrinkWrapHeight
      ? Infinity
      : Math.max(0, (this.height ?? 0) - 2 * this.borderWidth);
    let contentWidth = 0;
    let contentHeight = 0;
    let yCursor = this.y + this.borderWidth;
    for (const child of this.children) {
      const consumed = yCursor - (this.y + this.borderWidth);
      // Same rule the flex helper applies: a child gets a finite main extent when it cannot lay itself
      // out without one - a stack holding an `Expanded`/`Spacer`, or a child sized as a percentage of us.
      const needsBound =
        child.needsBoundedMain(false) || child.relativeSizeFactor(false) !== undefined;
      const childHeight = needsBound
        ? Math.max(0, innerHeight - consumed) // Infinity - consumed stays Infinity, as it should
        : Infinity;
      const childSize = child.calculateLayout(
        BoxConstraints.loose(innerWidth, childHeight),
        { x: this.x + this.borderWidth, y: yCursor },
        childCtx,
      );
      yCursor += childSize.height;
      contentHeight += childSize.height;
      contentWidth = Math.max(contentWidth, childSize.width);
    }

    // No explicit width and no bounded region: shrink-wrap to the widest child.
    if (shrinkWrapWidth) this.width = contentWidth + 2 * this.borderWidth;
    // No explicit height and no bounded region: the border hugs its content.
    if (shrinkWrapHeight) this.height = contentHeight + 2 * this.borderWidth;

    // The box is sized now: place any out-of-flow `Positioned` descendants against its box.
    if (frame) {
      frame.origin = { x: this.x, y: this.y };
      frame.size = { width: this.width ?? 0, height: this.height ?? 0 };
      for (const place of frame.place) place(frame, ctx);
    }

    // Border-box model: width/height ARE the outer box (the rect we draw); the content
    // is inset by the border on every side. Report the honest box size - no phantom
    // border added on (that asymmetric "+border" was the source of the magic-3 fudge in
    // fragment). Top-left coordinates; the Y-flip happens at the IR -> backend seam.
    return {
      width: this.width ?? 0,
      height: this.height ?? 0,
    };
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width!,
      height: this.height,
      children: this.children,
      color: this.color,
      backgroundColor: this.backgroundColor,
      borderWidth: this.borderWidth,
      radius: this.radius,
      sideBorders: this.sideBorders,
      overflow: this.overflow,
    };
  }
}
