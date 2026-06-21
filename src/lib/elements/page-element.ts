import { pageFormats, PageSize } from "../constants/page-sizes";
import { Orientation } from "../renderer/pdf-config";
import type { ColorMode, DefaultFont, Margin } from "../renderer";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
import { LayoutContext, PDFElement, PositioningFrame, WithChildren } from "./pdf-element";
import { TextElement } from "./text-element";

export interface PDFPageConfig {
  pageSize?: PageSize;
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
  let width = pageFormats[config.pageSize!][0] - margin.left - margin.right;
  let height = pageFormats[config.pageSize!][1] - margin.top - margin.bottom;
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
    };

    // Place the header/footer bands; the body gets the region left in between (the whole
    // content box when there is neither - byte-identical to a plain page).
    const bands = layoutPageBands(this.config, this.header, this.footer, pageCtx);
    const childConstraints = BoxConstraints.loose(bands.bodyWidth, bands.bodyHeight);

    // The page body is itself a positioning frame: a `Positioned` with no `relative` ancestor
    // resolves against the content box (a `relative` Box overrides it for its own subtree). Drained
    // after the body is laid out, so a page-level Positioned isn't a silent no-op.
    const frame: PositioningFrame = {
      origin: bands.bodyOrigin,
      size: { width: bands.bodyWidth, height: bands.bodyHeight },
      place: [],
    };
    const bodyCtx: LayoutContext = { ...pageCtx, frame };
    this.children.forEach((child) =>
      child.calculateLayout(childConstraints, bands.bodyOrigin, bodyCtx),
    );
    for (const place of frame.place) place(frame, pageCtx);

    const { width, height } = resolvePageContentBox(this.config);
    return { width, height };
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
