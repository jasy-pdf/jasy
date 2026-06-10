import { pageFormats, PageSize } from "../constants/page-sizes";
import { Orientation } from "../renderer/pdf-config";
import type { ColorMode, DefaultFont, Margin } from "../renderer";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
import { LayoutContext, PDFElement, WithChildren } from "./pdf-element";
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
}
export class PageElement extends PDFElement {
  // This page's own (partial) config; merged with the document defaults during layout.
  private config: PDFPageConfig;
  private children: PDFElement[];

  constructor({ children, config }: PDFPageParams) {
    super();
    this.children = children;
    this.config = config ?? {};
  }

  calculateLayout(
    _constraints: BoxConstraints,
    _offset: Offset,
    ctx: LayoutContext
  ): Size {
    // Merge the document defaults (carried in the context) with this page's overrides,
    // then hand descendants a context bound to THIS page's geometry. This is what
    // fixes the old last-page-wins global page-config bug.
    this.config = { ...ctx.pageConfig, ...this.config };
    const pageCtx: LayoutContext = {
      metrics: ctx.metrics,
      pageConfig: this.config,
    };

    const margin = this.config.margin!;
    let width =
      pageFormats[this.config.pageSize!][0] - margin.left - margin.right;
    let height =
      pageFormats[this.config.pageSize!][1] - margin.top - margin.bottom;
    if (this.config.orientation === Orientation.landscape) {
      [width, height] = [height, width];
    }

    // Children are placed at the top-left of the content box and may fill it.
    const origin: Offset = { x: margin.left, y: margin.top };
    const childConstraints = BoxConstraints.loose(width, height);
    this.children.forEach((child) =>
      child.calculateLayout(childConstraints, origin, pageCtx)
    );

    return { width, height };
  }

  override getProps(): PDFPageParams {
    return { children: this.children, config: this.config };
  }

  addTextElement(element: TextElement) {
    this.children.push(element);
    return this;
  }
}
