import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import { reportClipped, type FragmentResult } from "../../layout/fragmentation.ts";
import { Diagnostics, pageOf } from "../../common/diagnostics.ts";
import { ContainerElement } from "../container-element.ts";
import { LayoutContext, PDFElement, SizedPDFElement } from "../pdf-element.ts";
import { PageBuilderElement } from "./page-builder-element.ts";
import { RegionElement } from "./region-element.ts";

/** What a template is built from: `index` counts THIS Flow's pages (0 = where it starts). */
export interface FlowPage {
  index: number;
  pageNumber: number;
}

export type FlowTemplate = (page: FlowPage) => PDFElement;

/** A template with no `Region` would place nothing on every page, forever. */
export class FlowWithoutRegionError extends Error {
  constructor() {
    super(
      "@jasy/pdf: a Flow's template holds no Region, so the content has nowhere to go. Put at least " +
        "one Region in the template (in @jasy/vue: the #page slot).",
    );
    this.name = "FlowWithoutRegionError";
  }
}

/** A template that leaves every Region without room, where the Flow cannot move on to find more. */
export class FlowRegionsEmptyError extends Error {
  constructor(width: number, height: number) {
    super(
      `@jasy/pdf: a Flow's template leaves its Regions no room in ${Math.round(width)} x ` +
        `${Math.round(height)}pt - every Region is 0 wide or 0 tall (too many columns or gaps for the ` +
        "width, or the rest of the template is taller than the space). Give the Regions room." +
        (height <= 0
          ? " In a wrapping Row a line is only as tall as its content - give the Row around the " +
            "Flow a height."
          : ""),
    );
    this.name = "FlowRegionsEmptyError";
  }
}

/** Laid out with no height to fill: every line would land in the first Region. */
export class FlowUnboundedError extends Error {
  constructor() {
    super(
      "@jasy/pdf: a Flow takes its height from where it sits - the page, or a box with a height. " +
        "Here it has none (in a Row without a height, for instance). Give the Row or a Box around " +
        "the Flow a height.",
    );
    this.name = "FlowUnboundedError";
  }
}

/** A PageBuilder builds again for the page it is drawn on, so Regions inside it lose their content. */
export class RegionInPageBuilderError extends Error {
  constructor() {
    super(
      "@jasy/pdf: a Region inside a PageBuilder - it builds again for the page it is drawn on, and " +
        "its Regions would come back empty. A Flow's template is built for every page already and " +
        "gets { index, pageNumber }: build the Regions there.",
    );
    this.name = "RegionInPageBuilderError";
  }
}

/** The Regions of a laid-out template, in tree order - the order the content flows through them. */
function regionsIn(root: PDFElement): RegionElement[] {
  const out: RegionElement[] = [];
  const visit = (el: PDFElement, built: boolean): void => {
    if (el instanceof RegionElement) {
      if (built) throw new RegionInPageBuilderError();
      out.push(el);
    } else {
      const inBuilder = built || el instanceof PageBuilderElement;
      for (const child of el.layoutChildren()) visit(child, inBuilder);
    }
  };
  visit(root, false);
  return out;
}

const room = (r: RegionElement) => r.getProps().width! > 0 && r.getProps().height! > 0;

const SLACK_EPSILON = 1e-6;
// How close the last page's height gets to the tightest one that holds the content, in points.
const SHRINK_PRECISION = 0.01;

/**
 * One page of a Flow: its template, with each Region holding its content. It is drawn laid out at the
 * height it was filled at - not at its own size, which a template that does not fill (`50%`) differs from.
 */
export class FlowPieceElement extends SizedPDFElement {
  constructor(
    private readonly template: PDFElement,
    private readonly size: Size,
    private readonly bound: number,
    private readonly page: object,
  ) {
    super({ x: 0, y: 0, ...size });
  }

  calculateLayout(_constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;
    this.template.calculateLayout(
      BoxConstraints.loose(this.size.width, this.bound),
      { x: 0, y: 0 },
      { ...ctx, flowPage: this.page },
    );
    return this.size;
  }

  protected override computeSize(): Size {
    return this.size;
  }

  override layoutChildren(): readonly PDFElement[] {
    return [this.template];
  }

  override getProps() {
    return { x: this.x, y: this.y, ...this.size, child: this.template };
  }
}

/**
 * Content flowing through the Regions of a template, page after page. It has no height of its own -
 * like an `Expanded`, it takes what it is given: the rest of the page when it is fragmented, the rest
 * of a box with a height otherwise. On its last page it shrinks to what the content used.
 */
export class FlowElement extends SizedPDFElement {
  private readonly content: ContainerElement;
  private readonly template: FlowTemplate;
  private readonly index: number;
  private readonly balance: boolean;
  private piece?: FlowPieceElement;

  constructor({
    content,
    template,
    index = 0,
    balance = false,
  }: {
    content: ContainerElement;
    template: FlowTemplate;
    index?: number;
    balance?: boolean;
  }) {
    super({ x: 0, y: 0 });
    this.content = content;
    this.template = template;
    this.index = index;
    this.balance = balance;
  }

  override needsRegion(): boolean {
    return true;
  }

  /** Its height comes from the parent, as an `Expanded`'s does. */
  override needsBoundedMain(horizontal: boolean): boolean {
    return !horizontal;
  }

  /** The template is built from the page it lands on. */
  override dependsOnPage(): boolean {
    return true;
  }

  fragment(maxHeight: number, width: number, ctx: LayoutContext): FragmentResult {
    // Below other content, a template with no room here may find it on the next page.
    const filled = this.fill(maxHeight, width, ctx, !ctx.belowContent);
    // Nothing fit: move on whole. On a fresh page the packer forces it on, so this always advances.
    if (!filled.placed) return { fitted: null, remainder: this };
    return {
      fitted: filled.piece,
      remainder: filled.rest
        ? new FlowElement({
            content: filled.rest,
            template: this.template,
            index: this.index + 1,
            balance: this.balance,
          })
        : null,
      forceBreak: filled.forceBreak,
    };
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    if (!constraints.hasBoundedHeight || !constraints.hasBoundedWidth) {
      throw new FlowUnboundedError();
    }
    this.x = offset.x;
    this.y = offset.y;
    const filled = this.fill(constraints.maxHeight, constraints.maxWidth, ctx, true);
    // Not paginated here (a box with a height): what does not fit is cut, as any overflow is.
    if (filled.rest) {
      reportClipped(
        this,
        "a Flow has more content than its Regions hold here, and it cannot continue on a next " +
          "page (it sits in a box with a height) - give the box more height, or let the Flow " +
          "continue on the page.",
        ctx,
      );
    }
    this.piece = filled.piece;
    const size = this.piece.calculateLayout(constraints, { x: 0, y: 0 }, ctx);
    this.width = size.width;
    this.height = size.height;
    return size;
  }

  /** Unbounded, it has no height of its own (a parent that bounds it asks again); bounded, it fills. */
  protected override computeSize(constraints: BoxConstraints, ctx: LayoutContext): Size {
    if (!constraints.hasBoundedHeight || !constraints.hasBoundedWidth) {
      return { width: constraints.hasBoundedWidth ? constraints.maxWidth : 0, height: 0 };
    }
    return this.fill(constraints.maxHeight, constraints.maxWidth, ctx, false).piece.measure(
      constraints,
      ctx,
    );
  }

  /**
   * The one place a page of the Flow is made: the template at `width` x `maxHeight`, the content
   * fragmented into its Regions in turn, and - when the content ends here - the template shrunk to
   * what it used, or balanced.
   */
  private fill(maxHeight: number, width: number, ctx: LayoutContext, final: boolean) {
    const template = this.template({ index: this.index, pageNumber: pageOf(ctx) ?? 1 });
    // Laid out as this page of the Flow, its Regions claim themselves - wherever the template made
    // them, a PageBuilder or a Table included - and are collected from the laid-out tree.
    const pageCtx = { ...ctx, flowPage: this };
    const layOut = (height: number) =>
      template.calculateLayout(BoxConstraints.loose(width, height), { x: 0, y: 0 }, pageCtx);

    const size = layOut(maxHeight);
    const regions = regionsIn(template);
    if (regions.length === 0) throw new FlowWithoutRegionError();
    // No room here: every Region is empty, or the rest of the template (its height with the Regions
    // empty) is taller than the space.
    const own = template.measure(BoxConstraints.loose(width, Infinity), ctx).height;
    if (own > maxHeight + SLACK_EPSILON || !regions.some(room)) {
      if (final) throw new FlowRegionsEmptyError(width, maxHeight);
      const piece = new FlowPieceElement(template, size, maxHeight, this);
      return { piece, rest: this.content, placed: false, forceBreak: false };
    }
    const { rest, placed, forceBreak } = this.pour(regions, ctx);
    const ends = !rest && placed;
    const last = !ends
      ? null
      : this.balance && regions.filter(room).length > 1
        ? this.balanced(regions, own, maxHeight, layOut, ctx)
        : this.shrink(regions, own, maxHeight, layOut, ctx);
    const piece = last
      ? new FlowPieceElement(template, last.size, last.bound, this)
      : new FlowPieceElement(template, size, maxHeight, this);
    return { piece, rest, placed, forceBreak };
  }

  /**
   * The content fragmented into the laid-out Regions in turn; each holds its piece. `fresh` is how tall
   * each Region is on a full page - what a block that does not fit here may wait for.
   */
  private pour(regions: RegionElement[], ctx: LayoutContext, fresh?: Map<RegionElement, number>) {
    let rest: ContainerElement | null = this.content;
    let placed = false;
    let forceBreak = false;
    for (const region of regions) region.hold(null);
    for (const region of regions) {
      if (!rest) break;
      if (!room(region)) continue;
      const { width: w, height: h } = region.getProps() as Size;
      // Each Region is a fragmentation region of its own: a page break inside it is measured by it.
      const split = rest.fragment(h, w, {
        ...ctx,
        pageBodyHeight: fresh?.get(region) ?? h,
        inFlowRegion: true,
        flowPage: undefined,
      });
      region.hold(split.fitted);
      if (split.fitted) placed = true;
      rest = split.remainder as ContainerElement | null;
      // A column break is this Flow's: on to the next Region (or the next page's first).
      if (split.forceBreak === "column") continue;
      if (split.forceBreak) {
        forceBreak = true;
        break;
      }
    }
    return { rest, placed, forceBreak };
  }

  /**
   * The last page, balanced: the smallest height at which the content, poured again, still ends here,
   * so the Regions come out about equally full. Every candidate is a real pour - breaks,
   * `keepTogether` and orphans hold as on any page - and the last one poured is the one drawn. A
   * candidate is silent, and one that had to clip a block it could not break is too low.
   */
  private balanced(
    regions: RegionElement[],
    own: number,
    maxHeight: number,
    layOut: (height: number) => Size,
    ctx: LayoutContext,
  ): { size: Size; bound: number } {
    const fresh = new Map(regions.map((r) => [r, r.getProps().height!]));
    const endsAt = (bound: number) => {
      layOut(bound);
      let clipped = false;
      const trial = new Diagnostics();
      trial.setHandler((d) => (clipped ||= d.code === "overflow-clipped"));
      const poured = this.pour(
        regions,
        { ...ctx, onOverflow: "ignore", diagnostics: trial },
        fresh,
      );
      return !poured.rest && poured.placed && !clipped;
    };
    let low = Math.min(maxHeight, own);
    let high = maxHeight;
    while (high - low > SHRINK_PRECISION) {
      const mid = (low + high) / 2;
      if (endsAt(mid)) high = mid;
      else low = mid;
    }
    const size = layOut(high);
    this.pour(regions, ctx, fresh);
    return { size, bound: high };
  }

  /**
   * The last page: the smallest height at which every filled Region still holds what it was given.
   * Only a layout knows how a template's Regions answer a height (`%`, stacked, `minHeight`, fixed), so
   * each candidate is laid out and checked. The first is exact for Regions side by side (the full bound
   * less the smallest slack); below it the bound is searched, down to the template's own height.
   * Content that overflowed its Region at full height asks for no more than it had there.
   */
  private shrink(
    regions: RegionElement[],
    own: number,
    maxHeight: number,
    layOut: (height: number) => Size,
    ctx: LayoutContext,
  ): { size: Size; bound: number } {
    const filled = regions.filter((r) => r.held);
    const needed = new Map(
      filled.map((r) => {
        const { width, height } = r.getProps();
        const used = r.held!.measure(BoxConstraints.loose(width!, Infinity), ctx).height;
        return [r, Math.min(used, height!)] as const;
      }),
    );
    const slack = Math.min(...filled.map((r) => r.getProps().height! - needed.get(r)!));
    const fitsAt = (bound: number) => {
      const size = layOut(bound);
      const fits = filled.every((r) => r.getProps().height! + SLACK_EPSILON >= needed.get(r)!);
      return fits ? { size, bound } : null;
    };
    let low = Math.min(maxHeight, own);
    let high = maxHeight;
    const exact = fitsAt(Math.max(low, maxHeight - slack));
    if (exact) {
      if (exact.bound === low) return exact;
      high = exact.bound;
    }
    while (high - low > SHRINK_PRECISION) {
      const mid = (low + high) / 2;
      if (fitsAt(mid)) high = mid;
      else low = mid;
    }
    return { size: layOut(high), bound: high };
  }

  override layoutChildren(): readonly PDFElement[] {
    return [this.content];
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      child: this.content,
      piece: this.piece,
    };
  }
}
