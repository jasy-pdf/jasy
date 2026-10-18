import {
  BoxConstraints,
  Offset,
  Size,
  SizingParams,
  extentSpecs,
  resolveSize,
} from "../../layout/box-constraints.ts";
import { LayoutContext, PDFElement, SizedPDFElement } from "../pdf-element.ts";

interface RegionElementParams extends SizingParams {
  widthFactor?: number;
  heightFactor?: number;
}

/** A `Region` was laid out somewhere no `Flow` claimed it: outside a template, or inside the content. */
export class RegionOutsideFlowError extends Error {
  constructor() {
    super(
      "@jasy/pdf: a Region only means something in a Flow's template - it marks where the content " +
        "flows. Put it in the template, not in the content or anywhere else.",
    );
    this.name = "RegionOutsideFlowError";
  }
}

/**
 * A place in a `Flow`'s template that the content flows through. It has no size of its own: the layout
 * around it sizes it (`Expanded`, `width`, `height`, `%`), and with nothing given it fills what it is
 * offered, as a Canvas does. The Flow claims it, then hands it the piece of content that fits.
 */
export class RegionElement extends SizedPDFElement {
  private requested: { width?: number; height?: number };
  private sizing: SizingParams;
  private widthFactor?: number;
  private heightFactor?: number;
  private claimed = false;
  private content: PDFElement | null = null;

  constructor(params: RegionElementParams = {}) {
    super({ x: 0, y: 0, width: params.width, height: params.height });
    const { widthFactor, heightFactor, ...sizing } = params;
    this.widthFactor = widthFactor;
    this.heightFactor = heightFactor;
    this.sizing = sizing;
    this.requested = { width: params.width, height: params.height };
  }

  /** Marks it as part of a Flow's template - laid out anywhere else, it throws. */
  claim(): void {
    this.claimed = true;
  }

  /** The content it holds on this page (`null`: the content ran out before it). */
  hold(content: PDFElement | null): void {
    this.content = content;
  }

  get held(): PDFElement | null {
    return this.content;
  }

  /** A height the author gave (points or `%`): kept on the Flow's last page instead of shrinking. */
  hasOwnHeight(): boolean {
    return this.requested.height !== undefined || this.heightFactor !== undefined;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, ctx: LayoutContext): Size {
    if (!this.claimed) throw new RegionOutsideFlowError();
    const size = this.sizeFor(constraints);
    this.x = offset.x;
    this.y = offset.y;
    this.width = size.width;
    this.height = size.height;
    this.content?.calculateLayout(
      BoxConstraints.loose(size.width, size.height),
      { x: 0, y: 0 },
      ctx,
    );
    return size;
  }

  protected override computeSize(constraints: BoxConstraints): Size {
    return this.sizeFor(constraints);
  }

  /** Its size under these constraints - the one computation both `measure` and layout use. */
  private sizeFor(constraints: BoxConstraints): Size {
    const specs = extentSpecs({
      ...this.sizing,
      width: this.requested.width,
      height: this.requested.height,
      widthFactor: this.widthFactor,
      heightFactor: this.heightFactor,
    });
    const resolved = resolveSize(specs.width, specs.height, this.sizing.aspectRatio, constraints);
    const bounds = resolved.constraints;
    return {
      width: resolved.width ?? (bounds.hasBoundedWidth ? bounds.maxWidth : 0),
      height: resolved.height ?? (bounds.hasBoundedHeight ? bounds.maxHeight : 0),
    };
  }

  override layoutChildren(): readonly PDFElement[] {
    return this.content ? [this.content] : [];
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      // Only when it holds something: the pre-layout walks read `child` as an element.
      ...(this.content ? { child: this.content } : {}),
    };
  }
}
