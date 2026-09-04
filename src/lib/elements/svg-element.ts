import { readFileBytes } from "../platform/node-fs.ts";
import { svgSize, type SvgSize } from "../svg/index.ts";
import {
  BoxConstraints,
  Offset,
  Size,
  SizingParams,
  extentSpecs,
  resolveSize,
} from "../layout/box-constraints.ts";
import { LayoutContext, SizedPDFElement } from "./pdf-element.ts";

/** Markup, a file path (Node only), or the file's bytes. */
export type SvgSource = string | Uint8Array;

interface SvgElementParams extends SizingParams {
  source: SvgSource;
  /** Width/height as a fraction (0..1) of the offered box, for `"50%"`. */
  widthFactor?: number;
  heightFactor?: number;
  /** Alternate text for the tagged structure tree; makes the drawing a Figure rather than decoration. */
  alt?: string;
}

/** Markup is recognised by its first non-space character - anything else is treated as a path. */
const looksLikeMarkup = (value: string): boolean => /^\s*[<﻿]/.test(value);

/**
 * An SVG drawing placed in the layout like an image.
 *
 * Unlike a bitmap it needs no decoder, so its intrinsic size is known SYNCHRONOUSLY, in the
 * constructor - which also means a broken file fails on the line that asked for it rather than deep
 * inside a later render, the same bargain `addFont` makes.
 */
export class SvgElement extends SizedPDFElement {
  private source: string;
  private intrinsic: SvgSize;
  private alt?: string;
  private requested: { width?: number; height?: number };
  private sizing: SizingParams;
  private widthFactor?: number;
  private heightFactor?: number;

  constructor(params: SvgElementParams) {
    super({ x: 0, y: 0, width: params.width, height: params.height });
    const { source, alt, widthFactor, heightFactor, ...sizing } = params;
    this.widthFactor = widthFactor;
    this.heightFactor = heightFactor;
    this.source =
      typeof source === "string"
        ? looksLikeMarkup(source)
          ? source
          : new TextDecoder().decode(readFileBytes(source))
        : new TextDecoder().decode(source);
    // Parsed here on purpose: an unreadable file is an error where it was named.
    this.intrinsic = svgSize(this.source);
    this.alt = alt;
    this.sizing = sizing;
    this.requested = { width: params.width, height: params.height };
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      source: this.source,
      intrinsic: this.intrinsic,
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
    let w = resolved.width;
    let h = resolved.height;
    const bounds = resolved.constraints;

    // One pinned axis derives the other from the drawing's own ratio (CSS `width: 120; height: auto`).
    // A bitmap needs a decode pass before it can do this; an SVG knows it from its viewBox.
    if (
      this.sizing.aspectRatio === undefined &&
      this.intrinsic.width > 0 &&
      this.intrinsic.height > 0
    ) {
      const ratio = this.intrinsic.width / this.intrinsic.height;
      if (w !== undefined && h === undefined) h = bounds.constrainHeight(w / ratio);
      else if (h !== undefined && w === undefined) w = bounds.constrainWidth(h * ratio);
    }

    // Nothing pinned: draw at the intrinsic size, as an unsized `<img>` does - never fill the region,
    // which would blow a 24pt icon up to the whole page.
    this.width = w ?? bounds.constrainWidth(this.intrinsic.width);
    this.height = h ?? bounds.constrainHeight(this.intrinsic.height);
    return { width: this.width, height: this.height };
  }
}
