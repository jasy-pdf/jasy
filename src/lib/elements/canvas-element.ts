import {
  BoxConstraints,
  Offset,
  Size,
  SizingParams,
  extentSpecs,
  resolveSize,
} from "../layout/box-constraints.ts";
import type { CanvasPainter, CanvasSize } from "../canvas/painter.ts";
import { LayoutContext, SizedPDFElement } from "./pdf-element.ts";

/** What the user draws. Runs at RENDER time, once the box is known. */
export type CanvasPaint = (painter: CanvasPainter, size: CanvasSize) => void;

interface CanvasElementParams extends SizingParams {
  paint: CanvasPaint;
  widthFactor?: number;
  heightFactor?: number;
  /** Alternate text (tagged PDF): with it the drawing is a Figure, without it decoration. */
  alt?: string;
}

/**
 * A box in the layout that the caller draws into.
 *
 * It has no children and no intrinsic size, so unlike an image it FILLS what it is offered when no
 * size is given - there is nothing to derive one from. That is also why the callback is handed the
 * resolved size: a drawing written against `size.width` works at any box.
 */
export class CanvasElement extends SizedPDFElement {
  private paintFn: CanvasPaint;
  private alt?: string;
  private requested: { width?: number; height?: number };
  private sizing: SizingParams;
  private widthFactor?: number;
  private heightFactor?: number;

  constructor(params: CanvasElementParams) {
    super({ x: 0, y: 0, width: params.width, height: params.height });
    const { paint, alt, widthFactor, heightFactor, ...sizing } = params;
    this.paintFn = paint;
    this.alt = alt;
    this.widthFactor = widthFactor;
    this.heightFactor = heightFactor;
    this.sizing = sizing;
    this.requested = { width: params.width, height: params.height };
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      paint: this.paintFn,
      alt: this.alt,
    };
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, _ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;

    const specs = extentSpecs({
      ...this.sizing,
      width: this.requested.width,
      height: this.requested.height,
      widthFactor: this.widthFactor,
      heightFactor: this.heightFactor,
    });
    const resolved = resolveSize(specs.width, specs.height, this.sizing.aspectRatio, constraints);
    const bounds = resolved.constraints;

    this.width = resolved.width ?? (bounds.hasBoundedWidth ? bounds.maxWidth : 0);
    this.height = resolved.height ?? (bounds.hasBoundedHeight ? bounds.maxHeight : 0);
    return { width: this.width, height: this.height };
  }
}
