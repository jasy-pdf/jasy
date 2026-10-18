import { BoxConstraints, Offset, Size } from "../../layout/box-constraints.ts";
import type { FragmentResult } from "../../layout/fragmentation.ts";
import { diagnose, pageOf } from "../../common/diagnostics.ts";
import { ContainerElement } from "../container-element.ts";
import { LayoutContext, PDFElement, SizedPDFElement } from "../pdf-element.ts";
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
        "one Region in the template.",
    );
    this.name = "FlowWithoutRegionError";
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

/** The Regions of a template, in tree order - the order the content flows through them. */
function regionsIn(root: PDFElement): RegionElement[] {
  const out: RegionElement[] = [];
  const visit = (el: PDFElement): void => {
    if (el instanceof RegionElement) out.push(el);
    else for (const child of el.layoutChildren()) visit(child);
  };
  visit(root);
  return out;
}

const SLACK_EPSILON = 1e-6;

/** One page of a Flow: its template, laid out once, with each Region holding its content. */
export class FlowPieceElement extends SizedPDFElement {
  constructor(
    private readonly template: PDFElement,
    private readonly size: Size,
  ) {
    super({ x: 0, y: 0, ...size });
  }

  calculateLayout(_constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;
    this.template.calculateLayout(
      BoxConstraints.loose(this.size.width, this.size.height),
      { x: 0, y: 0 },
      ctx,
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
  private piece?: FlowPieceElement;

  constructor({
    content,
    template,
    index = 0,
  }: {
    content: ContainerElement;
    template: FlowTemplate;
    index?: number;
  }) {
    super({ x: 0, y: 0 });
    this.content = content;
    this.template = template;
    this.index = index;
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
    const filled = this.fill(maxHeight, width, ctx);
    // Nothing fit: move on whole. On a fresh page the packer forces it on, so this always advances.
    if (!filled.placed) return { fitted: null, remainder: this };
    return {
      fitted: filled.piece,
      remainder: filled.rest
        ? new FlowElement({ content: filled.rest, template: this.template, index: this.index + 1 })
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
    const filled = this.fill(constraints.maxHeight, constraints.maxWidth, ctx);
    // Not paginated here (a box with a height): what does not fit is cut, as any overflow is.
    if (filled.rest) {
      diagnose(ctx.diagnostics, {
        code: "overflow-clipped",
        severity: "warning",
        message:
          "A Flow has more content than its Regions hold here, and it cannot continue on a next " +
          "page (it sits in a box with a height). The rest is cut off.",
        about: this,
        page: pageOf(ctx),
      });
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
    return this.fill(constraints.maxHeight, constraints.maxWidth, ctx).piece.measure(
      constraints,
      ctx,
    );
  }

  /**
   * The one place a page of the Flow is made: the template at `width` x `maxHeight`, the content
   * fragmented into its Regions in turn, and - when the content ends here - the template shrunk to
   * what it used.
   */
  private fill(maxHeight: number, width: number, ctx: LayoutContext) {
    const template = this.template({ index: this.index, pageNumber: pageOf(ctx) ?? 1 });
    const regions = regionsIn(template);
    if (regions.length === 0) throw new FlowWithoutRegionError();
    for (const region of regions) region.claim();
    const layOut = (height: number) =>
      template.calculateLayout(BoxConstraints.loose(width, height), { x: 0, y: 0 }, ctx);

    let size = layOut(maxHeight);
    let rest: ContainerElement | null = this.content;
    let placed = false;
    let forceBreak = false;
    for (const region of regions) {
      if (!rest) break;
      const { width: w, height: h } = region.getProps();
      if (!w || !h || w <= 0 || h <= 0) continue;
      // Each Region is a fragmentation region of its own: a page break inside it is measured by it.
      const split = rest.fragment(h, w, { ...ctx, pageBodyHeight: h, inFlowRegion: true });
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

    if (!rest && placed) size = this.shrink(template, regions, size, maxHeight, layOut, ctx);
    return { piece: new FlowPieceElement(template, size), rest, placed, forceBreak };
  }

  /**
   * The last page: take off the smallest slack any filled Region without a height of its own has left,
   * never below the template's own height (fixed Regions, `minHeight`). A template whose Regions do
   * not shrink with it (two stacked `Expanded`) keeps its full height rather than cut its content.
   */
  private shrink(
    template: PDFElement,
    regions: RegionElement[],
    full: Size,
    maxHeight: number,
    layOut: (height: number) => Size,
    ctx: LayoutContext,
  ): Size {
    const used = (region: RegionElement) =>
      region.held!.measure(BoxConstraints.loose(region.getProps().width!, Infinity), ctx).height;
    const flexible = regions.filter((r) => r.held && !r.hasOwnHeight());
    const slack = Math.min(...flexible.map((r) => r.getProps().height! - used(r)), Infinity);
    const own = template.measure(BoxConstraints.loose(full.width, Infinity), ctx).height;
    const target = Math.min(
      maxHeight,
      Math.max(own, Number.isFinite(slack) ? full.height - slack : own),
    );
    if (target >= full.height) return full;
    const shrunk = layOut(target);
    const fits = regions.every((r) => !r.held || r.getProps().height! + SLACK_EPSILON >= used(r));
    if (fits) return shrunk;
    return layOut(maxHeight);
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
