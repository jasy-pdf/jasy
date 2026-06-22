import { LineElement } from "../elements/line-element";
import { PaddingElement } from "../elements/layout/padding-element";
import { ImageElement, CustomImage, CustomLocalImage, BoxFit } from "../elements/image-element";
import { PDFElement } from "../elements/pdf-element";
import { ColorInput, toColor } from "./color";
import { Insets, toEdges } from "./insets";

/** A horizontal rule (locked §4). */
export interface DividerOptions {
  /** Line color (default a light gray). */
  color?: ColorInput;
  /** Line thickness in points (default 1). */
  thickness?: number;
  /** Space above/below the rule (default a small vertical gap). */
  margin?: Insets;
}

const DEFAULT_DIVIDER_COLOR: ColorInput = "lightgray";
const DEFAULT_DIVIDER_MARGIN: Insets = { y: 6 };

/**
 * A horizontal rule that spans the parent's width. Maps to a `LineElement` (hiding its
 * `xEnd`/`yEnd` mechanics) wrapped in a `PaddingElement` - the line has no height of its
 * own, so the padding gives it vertical room and centers the rule. Use inside a Column.
 */
export function Divider(opts: DividerOptions = {}): PDFElement {
  const line = new LineElement({
    x: 0,
    y: 0,
    xEnd: 0, // resolved to the parent's width at layout time
    yEnd: 0, // horizontal: no vertical span
    color: toColor(opts.color ?? DEFAULT_DIVIDER_COLOR),
    strokeWidth: opts.thickness ?? 1,
  });
  return new PaddingElement({
    margin: toEdges(opts.margin ?? DEFAULT_DIVIDER_MARGIN),
    child: line,
  });
}

/** An image source: a local file path, or a `CustomImage` (e.g. a browser-supplied image). */
export type ImageSource = string | CustomImage;

/** How the image fills its box (locked §4). Mirrors CSS `object-fit`. */
export type ImageFit = "none" | "contain" | "cover" | "fill";

const FIT: Record<ImageFit, BoxFit> = {
  none: BoxFit.none,
  contain: BoxFit.contain,
  cover: BoxFit.cover,
  fill: BoxFit.fill,
};

export interface ImageOptions {
  width?: number;
  height?: number;
  /** Fit within the box (default `none`). */
  fit?: ImageFit;
  /** Corner radius in points (rounds the image box). */
  radius?: number;
}

/**
 * An image. `src` is a local file path (wrapped in a `CustomLocalImage`) or a ready
 * `CustomImage` for non-filesystem sources. Maps to an `ImageElement`.
 */
export function Image(src: ImageSource, opts: ImageOptions = {}): ImageElement {
  return new ImageElement({
    image: typeof src === "string" ? new CustomLocalImage(src) : src,
    width: opts.width,
    height: opts.height,
    fit: opts.fit ? FIT[opts.fit] : undefined,
    radius: opts.radius,
  });
}
