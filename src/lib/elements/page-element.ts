import { pageFormats, PageSize } from "../constants/page-sizes";
import { Orientation } from "../renderer/pdf-config";
import type { ColorMode, DefaultFont, Margin } from "../renderer";
import {
  LayoutConstraints,
  LayoutContext,
  PDFElement,
  WithChildren,
} from "./pdf-element";
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
    _parentConstraints: LayoutConstraints | undefined,
    ctx: LayoutContext
  ): LayoutConstraints {
    // Merge the document defaults (carried in the context) with this page's overrides,
    // then hand descendants a context bound to THIS page's geometry. This is what
    // fixes the old last-page-wins global page-config bug.
    this.config = { ...ctx.pageConfig, ...this.config };
    const pageCtx: LayoutContext = {
      metrics: ctx.metrics,
      pageConfig: this.config,
    };

    const result = {
      x: 0 + this.config.margin!.left,
      y: 0 + this.config.margin!.top,
      width:
        pageFormats[this.config.pageSize!][0] -
        this.config.margin!.left -
        this.config.margin!.right,
      height:
        pageFormats[this.config.pageSize!][1] -
        this.config.margin!.top -
        this.config.margin!.bottom,
    };
    if (this.config.orientation === Orientation.landscape) {
      const _width = result.width;
      result.width = result.height;
      result.height = _width;
    }
    this.children.forEach((child) => child.calculateLayout(result, pageCtx));
    return result;
  }

  override getProps(): PDFPageParams {
    return { children: this.children, config: this.config };
  }

  addTextElement(element: TextElement) {
    this.children.push(element);
    return this;
  }
}
