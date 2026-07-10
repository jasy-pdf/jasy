import { pageFormats, PageSize } from "../constants/page-sizes.ts";
import { Orientation } from "../renderer/pdf-config.ts";
import type { ColorMode, DefaultFont, Margin } from "../renderer/index.ts";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints.ts";
import { LayoutContext, PDFElement, PositioningFrame, WithChildren } from "./pdf-element.ts";
import { TextElement } from "./text-element.ts";

export interface PDFPageConfig {
  pageSize?: PageSize;
  /** Explicit [width, height] in points; overrides `pageSize` (e.g. a custom label format). */
  customSize?: [number, number];
  orientation?: Orientation;
  margin?: Margin;
  colorMode?: ColorMode;
  defaultFont?: DefaultFont;
}

interface PDFPageParams extends WithChildren {
  config?: PDFPageConfig;
  /** Laid out at the TOP of the content box, repeated on every physical page. */
  header?: PDFElement;
  /** Laid out at the BOTTOM of the content box, repeated on every physical page. */
  footer?: PDFElement;
}

/**
 * The full page (media box) size in points, orientation applied. This is what a `PageBuilder` sees as
 * `pageSize`; `resolvePageContentBox` below then subtracts the margins.
 */
export function resolvePageSize(config: PDFPageConfig): { width: number; height: number } {
  // Defaults to A4 when the config is not fully resolved, matching what PageRenderer does for the MediaBox.
  const [pageW, pageH] = config.customSize ?? pageFormats[config.pageSize ?? PageSize.A4];
  return config.orientation === Orientation.landscape
    ? { width: pageH, height: pageW }
    : { width: pageW, height: pageH };
}

/**
 * The content box of a page (inside the margins, orientation applied) for a fully
 * resolved config. Single source of truth, shared by `PageElement` layout and the page
 * driver so they can never drift.
 */
export function resolvePageContentBox(config: PDFPageConfig): {
  origin: Offset;
  width: number;
  height: number;
} {
  const margin = config.margin!;
  const [pageW, pageH] = config.customSize ?? pageFormats[config.pageSize!];
  let width = pageW - margin.left - margin.right;
  let height = pageH - margin.top - margin.bottom;
  if (config.orientation === Orientation.landscape) {
    [width, height] = [height, width];
  }
  return { origin: { x: margin.left, y: margin.top }, width, height };
}

/** The body region of a page once the (optional) header/footer bands are subtracted. */
export interface PageBands {
  bodyOrigin: Offset;
  bodyWidth: number;
  bodyHeight: number;
  headerHeight: number;
  footerHeight: number;
}

/**
 * Lays out the header (top) and footer (bottom) of a page and returns the body band left
 * in between. Header/footer take their natural height against the content width; the body
 * gets `contentHeight - headerHeight - footerHeight`. Shared by `PageElement.calculateLayout`
 * (placement) and the page driver (so its fragmentation `maxHeight` matches exactly). With
 * no header/footer the bands are zero and the body equals the full content box - identical
 * to a page without them.
 */
/**
 * The page's positioning frame: its CONTENT box (paper minus margins). Header, footer and body all
 * resolve a `Positioned` against this same box, so `top`/`bottom` mean the same thing in each.
 *
 * `layoutPageBands` lays the bands out, so its caller must hand it a context carrying this frame -
 * otherwise a `Positioned` in a band has nothing to resolve against (ISSUE-4). A caller that only
 * wants the band HEIGHTS may throw the frame away without draining it: an out-of-flow child
 * contributes no height.
 */
export function pageFrame(config: PDFPageConfig): PositioningFrame {
  const { origin, width, height } = resolvePageContentBox(config);
  return { origin, size: { width, height }, place: [] };
}

export function layoutPageBands(
  config: PDFPageConfig,
  header: PDFElement | undefined,
  footer: PDFElement | undefined,
  ctx: LayoutContext,
): PageBands {
  const { origin, width, height } = resolvePageContentBox(config);

  let headerHeight = 0;
  if (header) {
    headerHeight = header.calculateLayout(
      BoxConstraints.loose(width, Infinity),
      origin,
      ctx,
    ).height;
  }

  let footerHeight = 0;
  if (footer) {
    // Measure first to learn its height, then place it flush against the bottom edge.
    footerHeight = footer.calculateLayout(
      BoxConstraints.loose(width, Infinity),
      origin,
      ctx,
    ).height;
    footer.calculateLayout(
      BoxConstraints.loose(width, Infinity),
      { x: origin.x, y: origin.y + height - footerHeight },
      ctx,
    );
  }

  return {
    bodyOrigin: { x: origin.x, y: origin.y + headerHeight },
    bodyWidth: width,
    bodyHeight: Math.max(0, height - headerHeight - footerHeight),
    headerHeight,
    footerHeight,
  };
}
export class PageElement extends PDFElement {
  // This page's own (partial) config; merged with the document defaults during layout.
  private config: PDFPageConfig;
  private children: PDFElement[];
  private header?: PDFElement;
  private footer?: PDFElement;

  constructor({ children, config, header, footer }: PDFPageParams) {
    super();
    this.children = children;
    this.config = config ?? {};
    this.header = header;
    this.footer = footer;
  }

  calculateLayout(_constraints: BoxConstraints, _offset: Offset, ctx: LayoutContext): Size {
    // Merge the document defaults (carried in the context) with this page's overrides,
    // then hand descendants a context bound to THIS page's geometry. This is what
    // fixes the old last-page-wins global page-config bug.
    this.config = { ...ctx.pageConfig, ...this.config };
    const pageCtx: LayoutContext = {
      metrics: ctx.metrics,
      pageConfig: this.config,
      textStyle: ctx.textStyle,
      onOverflow: ctx.onOverflow,
      pageInfo: ctx.pageInfo, // the render pass supplies it; absent during pagination
    };

    // The PAGE is a positioning frame, and the frame is the content box - not the body region left
    // over between the bands. So `Positioned` means the same thing in the header, in the footer and
    // in the body, `bottom: 0` is the foot of the page rather than the top of the footer, and adding
    // a header no longer shifts a page-level `Positioned` that nobody touched. A `relative` Box
    // still overrides it for its own subtree.
    //
    // Built BEFORE the bands are laid out: they need to see it, and their heights are not known yet
    // anyway. (That is the whole of ISSUE-4 - a `Positioned` in a band had no frame to resolve
    // against, so it silently stayed at the page's top-left corner.)
    const frame = pageFrame(this.config);
    const frameCtx: LayoutContext = { ...pageCtx, frame };

    // Place the header/footer bands; the body gets the region left in between (the whole
    // content box when there is neither - byte-identical to a plain page).
    const bands = layoutPageBands(this.config, this.header, this.footer, frameCtx);
    const childConstraints = BoxConstraints.loose(bands.bodyWidth, bands.bodyHeight);

    this.children.forEach((child) =>
      child.calculateLayout(childConstraints, bands.bodyOrigin, frameCtx),
    );

    // Drained last, once every band and the body have registered: an out-of-flow child is placed
    // against the final frame box and paints on top of the flow content.
    for (const place of frame.place) place(frame, pageCtx);

    return { width: frame.size.width, height: frame.size.height };
  }

  override getProps(): PDFPageParams {
    return {
      children: this.children,
      config: this.config,
      header: this.header,
      footer: this.footer,
    };
  }

  addTextElement(element: TextElement) {
    this.children.push(element);
    return this;
  }
}
