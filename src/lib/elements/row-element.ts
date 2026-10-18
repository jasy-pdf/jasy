import { flexibleOf, hasPercentPaddingItem } from "../layout/flex-item.ts";
import {
  BoxConstraints,
  Offset,
  Size,
  SizingParams,
  extentSpecs,
  resolveSize,
} from "../layout/box-constraints.ts";
import {
  FlexLayoutHelper,
  HORIZONTAL_AXIS,
  MainAlign,
  CrossAlign,
  type FlexMode,
} from "../utils/flex-layout.ts";
import { stackMinIntrinsic, withDeclaredExtent } from "../layout/min-intrinsic.ts";
import { diagnose, pageOf } from "../common/diagnostics.ts";
import {
  LayoutContext,
  PDFElement,
  SizedPDFElement,
  WithChildren,
  withPaddingBase,
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
/** How far a line may run past its box before it is reported, in points (floating-point slack). */
const WIDE_EPSILON = 0.01;

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

  override maxExtent(horizontal: boolean): number {
    return (horizontal ? this.requested.maxWidth : this.requested.maxHeight) ?? Infinity;
  }

  /** The mirror of `ContainerElement`: a Row's OWN flex child needs a bounded width, and the need of any
   *  descendant propagates on both axes (see the Column for the reasoning). */
  override needsBoundedMain(horizontal: boolean): boolean {
    const requested = horizontal
      ? [this.requested.width, this.requested.widthFactor]
      : [this.requested.height, this.requested.heightFactor];
    if (requested.some((v) => v !== undefined)) return false;
    const ownFlexChild = horizontal && this.children.some((c) => flexibleOf(c) !== undefined);
    return ownFlexChild || this.children.some((c) => c.needsBoundedMain(horizontal));
  }

  /** A Row lays out side by side, so widths add up (gaps included) and heights overlap. */
  override minIntrinsicMain(horizontal: boolean, ctx: LayoutContext): number {
    const content = stackMinIntrinsic(
      this.children,
      this.gap,
      horizontal,
      horizontal,
      ctx,
      this.wrap,
    );
    return withDeclaredExtent(
      content,
      horizontal ? this.requested.width : this.requested.height,
      horizontal ? this.requested.minWidth : this.requested.minHeight,
    );
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;
    this.reportIgnoredBreak(ctx);
    const size = this.sizeWith(constraints, ctx, "layout");
    this.width = size.width;
    this.height = size.height;
    return size;
  }

  protected override computeSize(constraints: BoxConstraints, ctx: LayoutContext): Size {
    return this.sizeWith(constraints, ctx, "measure");
  }

  /** The first element inside this row that asks for a page break by flag, once found (or `null`). */
  private declaredBreak?: PDFElement | null;

  /**
   * A row is one line: nothing inside it starts a new page. A `breakBefore` / `breakAfter` in a cell
   * (a table row is a Row too) is therefore ignored - say so. A `PageBreak` reports itself.
   */
  private reportIgnoredBreak(ctx: LayoutContext): void {
    if (this.declaredBreak === undefined) {
      const find = (el: PDFElement, depth: number): PDFElement | null => {
        if (el.breaksBefore() || el.breaksAfter()) return el;
        if (depth > 64) return null;
        for (const child of el.layoutChildren()) {
          const hit = find(child, depth + 1);
          if (hit) return hit;
        }
        return null;
      };
      this.declaredBreak = null;
      for (const child of this.layoutChildren()) {
        this.declaredBreak = find(child, 0);
        if (this.declaredBreak) break;
      }
    }
    if (!this.declaredBreak) return;
    diagnose(ctx.diagnostics, {
      code: "break-ignored",
      severity: "warning",
      message:
        "breakBefore / breakAfter inside a Row (or a table row) has no effect: a row is one line and " +
        "never starts a new page. Put the break on the Row itself, or on a child of a Column.",
      about: this.declaredBreak,
      page: pageOf(ctx),
    });
  }

  /** The one sizing path: `layout` places the children (relative to this box), `measure` only sizes them. */
  private sizeWith(constraints: BoxConstraints, ctx: LayoutContext, mode: FlexMode): Size {
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
        {
          gap: this.gap,
          main: this.main,
          cross: this.cross,
          reverse: this.reverse,
          wrap: this.wrap,
          alignContent: this.alignContent,
        },
        this.childContext(ctx, mainAvail),
        mode,
      );
    }

    if (mode === "layout" && result.mainUsed > mainAvail + WIDE_EPSILON) {
      diagnose(ctx.diagnostics, {
        code: "overflow-wide",
        severity: "warning",
        message:
          `A Row's children need ${Math.round(result.mainUsed)}pt but it is ` +
          `${Math.round(mainAvail)}pt wide; they are drawn past its edge. Let them wrap ` +
          '(`breakWord`, `wrap`), make room, or clip with a Box\'s `overflow: "hidden"`.',
        about: this,
        page: pageOf(ctx),
        fallback: "silent",
      });
    }
    return { width: boundedWidth ?? result.mainUsed, height: boundedHeight ?? result.crossUsed };
  }

  private percentPaddingChild?: boolean;

  /** A child's `%` padding resolves against this Row's width (CSS: the containing block), which the Row
   *  never offers - its children get their natural size - so it is told. Only when a child uses it,
   *  since every key below would otherwise change with the Row's width. */
  private childContext(ctx: LayoutContext, mainAvail: number): LayoutContext {
    this.percentPaddingChild ??= this.children.some(hasPercentPaddingItem);
    if (!this.percentPaddingChild) return ctx;
    return withPaddingBase(ctx, Number.isFinite(mainAvail) ? mainAvail : undefined);
  }

  override layoutChildren(): readonly PDFElement[] {
    return this.children;
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
