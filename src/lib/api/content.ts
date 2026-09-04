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
import {
  BoundsInput,
  SizeInput,
  toBounds,
  toDimension,
  RadiusInput,
  toRadius,
} from "./dimension.ts";
import { SvgElement, type SvgSource } from "../elements/svg-element.ts";

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

/** Options for `Svg`. The same sizing and bounds as an image; `fit` and `radius` do not apply yet. */
export interface SvgOptions extends BoundsInput {
  width?: SizeInput;
  height?: SizeInput;
  /** Alternate text (tagged PDF). With it the drawing is a `Figure`; without it, decoration. */
  alt?: string;
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

export interface ImageOptions extends BoundsInput {
  /** Size on each axis: points (fixed) or a percentage string like `"50%"` (a fraction of the offered
   *  space). Pin exactly ONE axis and the other follows the image's aspect ratio (CSS `height: auto`). */
  width?: SizeInput;
  height?: SizeInput;
  /** Fit within the box. Default `none`, except where the box was DERIVED rather than given outright -
   *  exactly one axis pinned, or an `aspectRatio` - which defaults to `fill` so the image scales into it. */
  fit?: ImageFit;
  /** Corner radius in points (rounds the image box). */
  radius?: RadiusInput;
  /** Alternate text for accessibility (tagged PDF): describes the image for screen readers. With `alt`
   *  the image is a `Figure`; without it (and when rendered `accessible`) it counts as decoration. */
  alt?: string;
}

/**
 * A vector drawing from SVG. `source` is markup, a file path (Node) or the file's bytes. It is read
 * and parsed HERE, not at render time, so a broken file fails on the line that named it.
 *
 * With no size it draws at its intrinsic size; pin one axis and the other follows the `viewBox`. The
 * drawing is scaled uniformly and centred inside its box - SVG's own `preserveAspectRatio` default,
 * which is `fit: "contain"` by another name.
 */
export function Svg(source: SvgSource, opts: SvgOptions = {}): SvgElement {
  const w = opts.width !== undefined ? toDimension(opts.width) : undefined;
  const h = opts.height !== undefined ? toDimension(opts.height) : undefined;
  return new SvgElement({
    source,
    width: w?.points,
    height: h?.points,
    widthFactor: w?.factor,
    heightFactor: h?.factor,
    ...toBounds(opts),
    alt: opts.alt,
  })
    .withAlignSelf(opts.alignSelf)
    .withOrder(opts.order)
    .withFlexShrink(opts.flexShrink) as SvgElement;
}

/** SVG is recognised by its extension or by its own opening bytes - never by a caller having to say. */
function isSvg(src: ImageSource): src is string | Uint8Array {
  if (typeof src === "string") {
    return /\.svgz?$/i.test(src.trim()) || /^\s*[<\ufeff]/.test(src);
  }
  if (src instanceof Uint8Array) {
    const head = new TextDecoder().decode(src.subarray(0, 200)).trimStart();
    return head.startsWith("<?xml") || head.startsWith("<svg");
  }
  return false;
}

/**
 * An image. `src` is a local file path (wrapped in a `CustomLocalImage`) or a ready
 * `CustomImage` for non-filesystem sources. Maps to an `ImageElement`.
 *
 * An SVG source is routed to `Svg` instead, so `Image({ src: "logo.svg" })` just works and a logo
 * stays a VECTOR in the PDF rather than becoming a bitmap.
 */
export function Image(src: ImageSource, opts: ImageOptions = {}): ImageElement | SvgElement {
  if (isSvg(src)) {
    if (opts.fit !== undefined && opts.fit !== "contain") {
      throw new Error(
        `@jasy/pdf: fit: "${opts.fit}" is not supported for an SVG yet - it is always drawn ` +
          `contained, which is SVG's own default. Remove the fit, or rasterise the file.`,
      );
    }
    if (opts.radius !== undefined) {
      throw new Error(
        "@jasy/pdf: radius is not supported for an SVG yet - wrap it in a Box instead.",
      );
    }
    return Svg(src, opts);
  }
  return rasterImage(src, opts);
}

function rasterImage(src: ImageSource, opts: ImageOptions = {}): ImageElement {
  const w = opts.width !== undefined ? toDimension(opts.width) : undefined;
  const h = opts.height !== undefined ? toDimension(opts.height) : undefined;
  // ANY explicit size scales the image into the box (fit: fill), which is what `<img width height>`
  // does in HTML and what react-pdf does. Two pinned axes used to keep `none` - drawing the image at
  // its pixel size regardless - so a logo asked for at 48x48 spanned a third of the page.
  // An image with NO size given still draws at its intrinsic size, as an unsized `<img>` does.
  const sized =
    opts.width !== undefined || opts.height !== undefined || opts.aspectRatio !== undefined;
  const fit = opts.fit ? FIT[opts.fit] : sized ? BoxFit.fill : undefined;

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
    ...toBounds(opts),
    fit,
    radius: opts.radius !== undefined ? toRadius(opts.radius) : undefined,
    alt: opts.alt,
  })
    .withAlignSelf(opts.alignSelf)
    .withOrder(opts.order)
    .withFlexShrink(opts.flexShrink);
}
