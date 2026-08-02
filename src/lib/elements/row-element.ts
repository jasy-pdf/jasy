import {
  BoxConstraints,
  Offset,
  Size,
  SizingParams,
  extentSpecs,
  resolveSize,
} from "../layout/box-constraints.ts";
import { FlexLayoutHelper, HORIZONTAL_AXIS, MainAlign, CrossAlign } from "../utils/flex-layout.ts";
import {
  FlexiblePDFElement,
  LayoutContext,
  PDFElement,
  SizedPDFElement,
  WithChildren,
} from "./pdf-element.ts";

interface RowElementParams extends WithChildren {
  /** Space inserted between children, in points. */
  gap?: number;
  /** Horizontal distribution of the children (main axis). */
  main?: MainAlign;
  /** Vertical alignment of each child (cross axis); defaults to `stretch`. */
  cross?: CrossAlign;
  /** Lay the children out backwards along the main axis (CSS `row-reverse`). */
  reverse?: boolean;
  /** Let the children flow onto further lines when they do not fit (CSS `flex-wrap`). */
  wrap?: boolean;
  /** How the block of wrapped lines sits across the axis (CSS `align-content`). */
  alignContent?: MainAlign;
  /** Width/height as points (fixed) or a fraction (0..1) of the offered box (relative sizing). */
  width?: number;
  height?: number;
  widthFactor?: number;
  heightFactor?: number;
  /** Lower / upper bounds per axis, in points or as a fraction; see `SizingParams`. */
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  minWidthFactor?: number;
  maxWidthFactor?: number;
  minHeightFactor?: number;
  maxHeightFactor?: number;
  /** width / height; derives whichever axis is left open (CSS `aspect-ratio`). */
  aspectRatio?: number;
  /** Start this row on a fresh page (CSS `break-before: page`). */
  breakBefore?: boolean;
  /** Start everything after this row on a fresh page (CSS `break-after: page`). */
  breakAfter?: boolean;
}

/**
 * Horizontal stack: the mirror of `ContainerElement` (Column). Children are laid out
 * left-to-right via the shared `FlexLayoutHelper` on the horizontal axis; fixed children
 * take their natural width, `ExpandedElement`/Spacer children split the leftover width by
 * `flex`, and `gap` is inserted between them. The row fills the width it is offered and
 * shrink-wraps its height to the tallest child (unless a height is forced on it).
 *
 * Cross/main alignment is the next foundation slice; today children sit at the top-left
 * (cross start, main start). The row is atomic w.r.t. pagination - it reflows whole if it
 * does not fit (handled by the parent's `packChildren`); synchronized cell splitting is a
 * Grid/Table concern.
 */
export class RowElement extends SizedPDFElement {
  private children: PDFElement[];
  private gap: number;
  private main: MainAlign;
  private cross: CrossAlign;
  private reverse: boolean;
  private wrap: boolean;
  private alignContent?: MainAlign;
  private breakBefore: boolean;
  private breakAfter: boolean;
  // The requested size (fixed points or a fraction), kept separate from the laid-out this.width/height.
  private requested!: SizingParams;

  constructor({
    children,
    gap,
    main,
    cross,
    reverse,
    wrap,
    alignContent,
    width,
    height,
    breakBefore,
    breakAfter,
    ...sizing
  }: RowElementParams) {
    super({ x: 0, y: 0 });
    this.children = children;
    this.gap = gap ?? 0;
    this.main = main ?? "start";
    this.cross = cross ?? "stretch";
    this.reverse = reverse ?? false;
    this.wrap = wrap ?? false;
    this.alignContent = alignContent;
    this.requested = { ...sizing, width, height };
    this.breakBefore = breakBefore ?? false;
    this.breakAfter = breakAfter ?? false;
  }

  override breaksBefore(): boolean {
    return this.breakBefore;
  }

  override breaksAfter(): boolean {
    return this.breakAfter;
  }

  override relativeSizeFactor(horizontal: boolean): number | undefined {
    return horizontal ? this.requested.widthFactor : this.requested.heightFactor;
  }

  /** The mirror of `ContainerElement`: a Row's OWN flex child needs a bounded width, and the need of any
   *  descendant propagates on both axes (see the Column for the reasoning). */
  override needsBoundedMain(horizontal: boolean): boolean {
    const requested = horizontal
      ? [this.requested.width, this.requested.widthFactor]
      : [this.requested.height, this.requested.heightFactor];
    if (requested.some((v) => v !== undefined)) return false;
    const ownFlexChild = horizontal && this.children.some((c) => c instanceof FlexiblePDFElement);
    return ownFlexChild || this.children.some((c) => c.needsBoundedMain(horizontal));
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;

    // Relative sizing: a pinned extent (fixed or a fraction of the offered box, clamped) wins; else
    // width fills the offered space (flex children split the leftover) and height is the tallest child.
    const specs = extentSpecs(this.requested);
    const resolved = resolveSize(
      specs.width,
      specs.height,
      this.requested.aspectRatio,
      constraints,
    );
    const { width: explicitWidth, height: explicitHeight, constraints: bounds } = resolved;
    // Fill-or-shrink-wrap is decided by the constraints we were GIVEN; a min/max only caps the result.
    const boundedWidth =
      explicitWidth !== undefined
        ? bounds.constrainWidth(explicitWidth)
        : constraints.hasBoundedWidth
          ? bounds.maxWidth
          : undefined;
    const boundedHeight =
      explicitHeight !== undefined
        ? bounds.constrainHeight(explicitHeight)
        : constraints.hasBoundedHeight
          ? bounds.maxHeight
          : undefined;

    // Horizontal stack: main = width (children fill it), cross = height (children can stretch to it).
    const mainAvail = boundedWidth ?? Infinity;
    const crossAvail = boundedHeight ?? Infinity;

    let result = { mainUsed: 0, crossUsed: 0 };
    if (this.children.length > 0) {
      result = FlexLayoutHelper.layout(
        this.children,
        HORIZONTAL_AXIS,
        mainAvail,
        crossAvail,
        this.x,
        this.y,
        {
          gap: this.gap,
          main: this.main,
          cross: this.cross,
          reverse: this.reverse,
          wrap: this.wrap,
          alignContent: this.alignContent,
        },
        ctx,
      );
    }

    this.width = boundedWidth ?? result.mainUsed;
    this.height = boundedHeight ?? result.crossUsed;

    return { width: this.width, height: this.height };
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      children: this.children,
      gap: this.gap,
      main: this.main,
      cross: this.cross,
      reverse: this.reverse,
      wrap: this.wrap,
      alignContent: this.alignContent,
    };
  }
}
