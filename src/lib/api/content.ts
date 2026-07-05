import { LineElement } from "../elements/line-element.ts";
import { PaddingElement } from "../elements/layout/padding-element.ts";
import {
  ImageElement,
  CustomImage,
  CustomLocalImage,
  CustomBytesImage,
  BoxFit,
} from "../elements/image-element.ts";
import { PDFElement } from "../elements/pdf-element.ts";
import { ColorInput, toColor } from "./color.ts";
import { Insets, toEdges } from "./insets.ts";
import { SizeInput, toDimension } from "./dimension.ts";

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

/** An image source: a local file path (Node), raw bytes (e.g. a browser fetch/upload), or a `CustomImage`. */
export type ImageSource = string | Uint8Array | CustomImage;

/** How the image fills its box (locked §4). Mirrors CSS `object-fit`. */
export type ImageFit = "none" | "contain" | "cover" | "fill";

const FIT: Record<ImageFit, BoxFit> = {
  none: BoxFit.none,
  contain: BoxFit.contain,
  cover: BoxFit.cover,
  fill: BoxFit.fill,
};

export interface ImageOptions {
  /** Size on each axis: points (fixed) or a percentage string like `"50%"` (a fraction of the offered
   *  space). Pin exactly ONE axis and the other follows the image's aspect ratio (CSS `height: auto`). */
  width?: SizeInput;
  height?: SizeInput;
  /** Fit within the box (default `none`; `fill` when exactly one axis is pinned so it scales to fit). */
  fit?: ImageFit;
  /** Corner radius in points (rounds the image box). */
  radius?: number;
  /** Alternate text for accessibility (tagged PDF): describes the image for screen readers. With `alt`
   *  the image is a `Figure`; without it (and when rendered `accessible`) it counts as decoration. */
  alt?: string;
}

/**
 * An image. `src` is a local file path (wrapped in a `CustomLocalImage`) or a ready
 * `CustomImage` for non-filesystem sources. Maps to an `ImageElement`.
 */
export function Image(src: ImageSource, opts: ImageOptions = {}): ImageElement {
  const w = opts.width !== undefined ? toDimension(opts.width) : undefined;
  const h = opts.height !== undefined ? toDimension(opts.height) : undefined;
  // Exactly one axis pinned -> the other is derived from the aspect ratio, so scale the image to the
  // resulting box (fit: fill). Both or neither pinned keeps the default fit (none).
  const autoScale = (opts.width !== undefined) !== (opts.height !== undefined);
  const fit = opts.fit ? FIT[opts.fit] : autoScale ? BoxFit.fill : undefined;

  return new ImageElement({
    image:
      typeof src === "string"
        ? new CustomLocalImage(src)
        : src instanceof Uint8Array
          ? new CustomBytesImage(src)
          : src,
    width: w?.points,
    height: h?.points,
    widthFactor: w?.factor,
    heightFactor: h?.factor,
    fit,
    radius: opts.radius,
    alt: opts.alt,
  });
}
