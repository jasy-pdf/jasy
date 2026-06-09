import { Color } from "../common/color";
import { pageFormats } from "../constants/page-sizes";
import { Orientation } from "../renderer/pdf-config";
import { TextRenderer } from "../renderer";
import { FontStyle } from "../utils/pdf-object-manager";
import {
  HorizontalAlignment,
  LayoutConstraints,
  LayoutContext,
  SizedPDFElement,
} from "./pdf-element";
import type { PDFPageConfig } from "./page-element";
export interface TextSegment {
  content: string;
  fontStyle?: FontStyle;
  fontColor?: Color;
  fontFamily?: string;
  fontSize?: number;
}

interface TextElementParams {
  id?: string;
  output?: any;
  fontSize: number;
  fontFamily?: string;
  fontStyle?: FontStyle;
  content: string | TextSegment[];
  color?: Color; // optional param
  textAlignment?: HorizontalAlignment;
}

export class TextElement extends SizedPDFElement {
  private fontSize: number;
  private fontFamily: string;
  private fontStyle: FontStyle;
  private color: Color;
  private content: string | TextSegment[];
  private textAlignment: HorizontalAlignment;

  constructor({
    fontSize,
    content,
    fontFamily = "Helvetica",
    fontStyle = FontStyle.Normal,
    color = new Color(0, 0, 0),
    textAlignment = HorizontalAlignment.left,
  }: TextElementParams) {
    super({ x: 0, y: 0 });

    this.fontSize = fontSize;
    this.fontFamily = fontFamily;
    this.fontStyle = fontStyle;
    this.color = color;
    this.content = content;
    this.textAlignment = textAlignment;
  }

  calculateLayout(
    parentConstraints: LayoutConstraints | undefined,
    ctx: LayoutContext
  ): LayoutConstraints {
    if (parentConstraints) {
      this.x = parentConstraints.x;
      this.y = parentConstraints.y;
      if (parentConstraints.width) {
        this.width = parentConstraints.width - this.x + parentConstraints.x;
      }
      const textHeight = TextRenderer.calculateTextHeight(
        this.content,
        this.fontSize,
        this.fontFamily,
        this.fontStyle,
        ctx.metrics,
        this.width || 0
      );

      this.height = textHeight;
    }

    this.normalizeCoordinates(ctx.pageConfig);

    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  normalizeCoordinates(pageConfig: PDFPageConfig) {
    const pageHeight =
      pageFormats[pageConfig.pageSize!][
        pageConfig.orientation === Orientation.landscape ? 0 : 1
      ];
    let maxLineHeight = this.fontSize;
    if (Array.isArray(this.content)) {
      this.content.forEach((segment) => {
        if ((segment.fontSize || this.fontSize) > maxLineHeight)
          maxLineHeight = segment.fontSize || this.fontSize;
      });
    }

    this.y = pageHeight - this.y - maxLineHeight * (683 / 1000);
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      fontSize: this.fontSize,
      fontFamily: this.fontFamily,
      fontStyle: this.fontStyle,
      color: this.color,
      content: this.content,
      textAlignment: this.textAlignment,
    };
  }
}
