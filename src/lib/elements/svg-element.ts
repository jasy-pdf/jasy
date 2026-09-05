import { readFileBytes } from "../platform/node-fs.ts";
import { SvgParseError, svgSize, svgToIr, type SvgSize } from "../svg/index.ts";
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
 * Reads the file, or says what went wrong in the caller's terms. A string that is neither markup nor
 * a readable path would otherwise surface as a bare `ENOENT`, which never mentions that the argument
 * was taken as a PATH in the first place.
 */
function readSource(path: string): Uint8Array {
  try {
    return readFileBytes(path);
  } catch (error) {
    const shown = path.length > 80 ? `${path.slice(0, 77)}...` : path;
    throw new SvgParseError(
      `could not read "${shown}" as an SVG file. It does not start with "<", so it was taken as a ` +
        `path: ${(error as Error).message}`,
    );
  }
}

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
          : new TextDecoder().decode(readSource(source))
        : new TextDecoder().decode(source);
    // Parsed here on purpose: an unreadable file is an error where it was NAMED, not inside a render
    // three call frames later. The whole document is walked, not just its root, so an element outside
    // the subset surfaces here too - which is what makes the error predictable rather than a lottery
    // between construction and render time. A logo parses in well under a millisecond.
    this.intrinsic = svgSize(this.source);
    svgToIr(this.source, { x: 0, y: 0, width: 1, height: 1 });
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
