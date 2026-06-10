import { Color } from "../common/color";
import { TextRenderer } from "../renderer";
import { FontStyle } from "../utils/pdf-object-manager";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
import {
  HorizontalAlignment,
  LayoutContext,
  SizedPDFElement,
} from "./pdf-element";
export interface TextSegment {
  content: string;
  fontStyle?: FontStyle;
  fontColor?: Color;
  fontFamily?: string;
  fontSize?: number;
}

interface TextElementParams {
  id?: string;
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
    constraints: BoxConstraints,
    offset: Offset,
    ctx: LayoutContext
  ): Size {
    this.x = offset.x;
    this.y = offset.y;
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;

    const wrapWidth = this.width ?? 0;
    this.height = TextRenderer.calculateTextHeight(
      this.content,
      this.fontSize,
      this.fontFamily,
      this.fontStyle,
      ctx.metrics,
      wrapWidth
    );

    // Top-left coordinates (y = top of the text box). The baseline offset and the
    // Y-flip are applied downstream (the line-builder positions baselines, the seam
    // flips to PDF), so the element stays coordinate-system-blind.
    return { width: wrapWidth, height: this.height };
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
