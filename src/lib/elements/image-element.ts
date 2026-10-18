import type { Radii } from "../ir/display-list.ts";
import { getImageDimensions, type FitAlign } from "../utils/image-helper.ts";
import { latin1FromBytes } from "../utils/bytes.ts";
import { readFileBytesAsync } from "../platform/node-fs.ts";
import { fetchBytes } from "../utils/fetch-bytes.ts";
import {
  BoxConstraints,
  Offset,
  Size,
  SizingParams,
  extentSpecs,
  resolveSize,
} from "../layout/box-constraints.ts";
import { LayoutContext, SizedPDFElement } from "./pdf-element.ts";

// path.extname without node:path (browser-safe): the substring from the last dot, if it sits after the
// last slash (so a dot in a directory name does not count). Enough for image file extensions.
function extname(p: string): string {
  const dot = p.lastIndexOf(".");
  const slash = p.lastIndexOf("/");
  return dot > slash + 1 ? p.slice(dot) : "";
}

export enum BoxFit {
  none = "NONE",
  contain = "CONTAIN",
  cover = "COVER",
  fill = "FILL",
}

export abstract class CustomImage {
  /** Loads the image. `fresh`: a new render begins - a load that failed in an earlier one is tried again. */
  abstract init(fresh?: boolean): void | Promise<void>;
  abstract getImageType(): string | Promise<string>;
  abstract getFileData(): string | Promise<string>;
  abstract getImageDimensions(): Promise<{ width: number; height: number }>;
}

export class CustomLocalImage extends CustomImage {
  private imagePath: string;
  private fileBuffer!: Uint8Array;
  private fileRawData!: string;
  private dims?: { width: number; height: number }; // memoized so the decode happens once

  constructor(imagePath: string) {
    super();
    this.imagePath = imagePath;
  }

  async init(): Promise<void> {
    if (this.fileBuffer) return; // idempotent: the pre-layout size pass and the renderer both call init()
    try {
      await this.loadImage(this.imagePath);
    } catch (e) {
      throw new Error(
        `@jasy/pdf: could not read the image at ${this.imagePath}: ${String((e as Error)?.message ?? e)}`,
      );
    }
  }

  async getImageType(): Promise<string> {
    const ext = extname(this.imagePath).toLowerCase();

    switch (ext) {
      case ".jpg":
      case ".jpeg":
        return "DCTDecode"; // For JPEG
      case ".png":
        return "FlateDecode"; // For PNG
      case ".bmp":
        throw new Error("BMP is not directly supported. Please convert to PNG or JPEG.");
      case ".webp":
        throw new Error("WebP is not directly supported. Please convert to PNG or JPEG.");
      default:
        throw new Error(`Unsupported image format: ${ext}`);
    }
  }

  private async loadImage(imagePath: string): Promise<Uint8Array> {
    const result = await readFileBytesAsync(imagePath);
    //const result = await convertImageToGrayscaleBuffer(imagePath);
    this.fileBuffer = result;
    this.fileRawData = latin1FromBytes(result);

    return result;
  }

  getFileData(): string {
    return this.fileRawData;
  }

  async getImageDimensions(): Promise<{ width: number; height: number }> {
    if (this.dims) return this.dims; // reuse: the pre-layout size pass and the renderer both ask
    if (!this.fileBuffer) throw new Error("@jasy/pdf: an image was measured before it was loaded");
    this.dims = await getImageDimensions(this.fileBuffer);
    return this.dims;
  }
}

/**
 * An image straight from raw bytes (a browser upload / fetch, no filesystem). The PDF filter is sniffed
 * from the magic bytes: JPEG embeds raw (DCTDecode, no decode step), PNG is decoded to RGB (FlateDecode).
 */
export class CustomBytesImage extends CustomImage {
  private fileRawData: string;
  private dims?: { width: number; height: number }; // memoized so the decode happens once
  constructor(private bytes: Uint8Array) {
    super();
    this.fileRawData = latin1FromBytes(bytes);
  }

  async init(): Promise<void> {}

  async getImageType(): Promise<string> {
    const b = this.bytes;
    if (b[0] === 0xff && b[1] === 0xd8) return "DCTDecode"; // JPEG
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "FlateDecode"; // PNG
    throw new Error("Unsupported image bytes (only JPEG and PNG are supported).");
  }

  getFileData(): string {
    return this.fileRawData;
  }

  async getImageDimensions(): Promise<{ width: number; height: number }> {
    if (!this.dims) this.dims = await getImageDimensions(this.bytes); // reuse across pre-pass + render
    return this.dims;
  }
}

/** Thrown when an image could not be fetched or is not one we can embed. Always says which URL. */
export class ImageUrlError extends Error {
  constructor(message: string) {
    super(`@jasy/pdf: ${message}`);
  }
}

/** How long an image from a URL may take, and how large it may be - a raster image and an SVG alike. */
export const IMAGE_FETCH_LIMITS = { timeoutMs: 15_000, maxBytes: 32 * 1024 * 1024 };

/** Whether an image source string is an address to fetch rather than a file path. */
export const isImageUrl = (src: string): boolean => /^(https?:|data:)/i.test(src.trim());

/**
 * An image from a URL - `http(s):` or a `data:` URL - fetched in the async pass before layout, with
 * the same timeout and size ceiling as a font. What it IS comes from its bytes, never from the
 * address, so `.../photo?id=7` works. A dead link stops the render with an `ImageUrlError` naming it.
 */
export class CustomUrlImage extends CustomImage {
  private loading?: Promise<CustomBytesImage>;
  private loaded?: CustomBytesImage;
  private failed = false;

  constructor(private readonly url: string) {
    super();
  }

  // One fetch per render, however often it is asked: the pre-layout size pass and the renderer both
  // call init(). A failure sticks for that render only - the next one asks again (`fresh`).
  async init(fresh = false): Promise<void> {
    if (fresh && this.failed) this.loading = undefined;
    this.loading ??= this.load().then(
      (image) => ((this.failed = false), image),
      (e: unknown) => {
        this.failed = true;
        throw e;
      },
    );
    this.loaded = await this.loading;
  }

  private async load(): Promise<CustomBytesImage> {
    const bytes = await fetchBytes(this.url, "image", ImageUrlError, IMAGE_FETCH_LIMITS);
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    if (!jpeg && !png) {
      // An error page answers with a 200 often enough to name it rather than fail deep inside.
      const looksLikeMarkup =
        new TextDecoder().decode(bytes.subarray(0, 64)).trimStart()[0] === "<";
      throw new ImageUrlError(
        `the file at ${this.url} is ${looksLikeMarkup ? "markup (an HTML page, or an SVG - pass that to Svg(url))" : "not an image we can embed"} - jasy embeds PNG and JPEG`,
      );
    }
    return new CustomBytesImage(bytes);
  }

  private image(): CustomBytesImage {
    if (!this.loaded) throw new Error("@jasy/pdf: an image was measured before it was loaded");
    return this.loaded;
  }

  getImageType(): Promise<string> {
    return this.image().getImageType();
  }

  getFileData(): string {
    return this.image().getFileData();
  }

  getImageDimensions(): Promise<{ width: number; height: number }> {
    return this.image().getImageDimensions();
  }
}

interface ImageElementParams {
  image: CustomImage; // binary image data
  width?: number;
  height?: number;
  /** Width as a fraction (0..1) of the offered width instead of a fixed `width` (relative sizing). */
  widthFactor?: number;
  /** Height as a fraction (0..1) of the offered height; see `widthFactor`. */
  heightFactor?: number;
  /** Lower / upper bounds per axis, in points or as a fraction; see `SizingParams`. */
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  minWidthFactor?: number;
  maxWidthFactor?: number;
  minHeightFactor?: number;
  maxHeightFactor?: number;
  /** width / height; overrides the image's OWN ratio (CSS `aspect-ratio`), `fit` then places it. */
  aspectRatio?: number;
  /** How the image fills its box (CSS `object-fit`); `fill` by default, as in CSS. */
  fit?: BoxFit;
  /** Corner radius in points - one number or per corner; rounds the image box (0 = sharp, default). */
  radius?: number | Radii;
  /** Where the image sits in its box when `fit` leaves space or cuts it: 0 = start, 1 = end per axis. */
  align?: FitAlign;
  /** Alternate text for accessibility (tagged PDF). With `alt` the image is a Figure; without, decoration. */
  alt?: string;
}

export class ImageElement extends SizedPDFElement {
  private image: CustomImage;
  private widthFactor?: number;
  private heightFactor?: number;
  private fit: BoxFit;
  private radius: number | Radii;
  private align?: FitAlign;
  private readonly alt?: string;
  // The requested size (fixed points), kept separate from the laid-out this.width/height so a
  // re-layout (fragmentation measures more than once) still resolves the factor, instead of
  // freezing to the first pass's result. Mirrors ContainerElement / RowElement.
  private requested: { width?: number; height?: number };
  /** min/max/aspectRatio, kept as given so every layout pass re-resolves them. */
  private sizing: SizingParams;
  // Intrinsic pixel size, resolved asynchronously before layout (see resolveIntrinsicSize). Layout
  // reads it to derive a proportional height for a width-only image (and vice versa).
  private intrinsic?: { width: number; height: number };

  constructor({
    image,
    width,
    height,
    widthFactor,
    heightFactor,
    fit = BoxFit.fill,
    radius,
    align,
    alt,
    ...sizing
  }: ImageElementParams) {
    // Seed this.width/height from the request so getProps() reflects it before layout; calculateLayout
    // then reads `requested` (never the mutated fields) and overwrites these with the laid-out size.
    super({ x: 0, y: 0, width });

    this.image = image;
    this.height = height;
    this.requested = { width, height };
    this.widthFactor = widthFactor;
    this.heightFactor = heightFactor;
    this.sizing = sizing;
    this.fit = fit;
    this.radius = radius ?? 0;
    this.align = align;
    this.alt = alt;
  }

  /**
   * Loads the image and records its intrinsic pixel size. Runs in the async pre-layout pass (layout
   * itself is synchronous and cannot await jimp) so `calculateLayout` can turn a width-only image
   * into a proportional box. Best-effort: a load failure leaves the size unresolved (the renderer
   * surfaces the real error) and the image just keeps whatever explicit size it was given.
   */
  async resolveIntrinsicSize(): Promise<void> {
    try {
      await this.image.init(true); // a render begins here
      this.intrinsic = await this.image.getImageDimensions();
    } catch {
      // leave intrinsic undefined - aspect derivation simply doesn't fire
    }
  }

  override relativeSizeFactor(horizontal: boolean): number | undefined {
    return horizontal ? this.widthFactor : this.heightFactor;
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, _ctx: LayoutContext): Size {
    const size = this.sizeFor(constraints);
    this.x = offset.x;
    this.y = offset.y;
    // Kept as resolved, `undefined` included: the renderer reads an unset axis differently from 0.
    this.width = size.width;
    this.height = size.height;
    return { width: size.width ?? 0, height: size.height ?? 0 };
  }

  protected override computeSize(constraints: BoxConstraints): Size {
    const size = this.sizeFor(constraints);
    return { width: size.width ?? 0, height: size.height ?? 0 };
  }

  /** Its size under these constraints - the one computation both `measure` and layout use. */
  private sizeFor(constraints: BoxConstraints): { width?: number; height?: number } {
    // Relative sizing: a fixed size or a fraction of the offered box (fraction only in a bounded axis).
    // Read from `requested` (not this.width/height, which we overwrite below) so every pass re-resolves.
    const specs = extentSpecs({
      ...this.sizing,
      width: this.requested.width,
      height: this.requested.height,
      widthFactor: this.widthFactor,
      heightFactor: this.heightFactor,
    });
    // An explicit `aspectRatio` wins over the image's own.
    const resolved = resolveSize(specs.width, specs.height, this.sizing.aspectRatio, constraints);
    let w = resolved.width;
    let h = resolved.height;
    const bounds = resolved.constraints;

    // Aspect auto-size: when exactly ONE axis is pinned, derive the other from the intrinsic ratio
    // (CSS `width: 50%; height: auto`). Only fires once the pre-pass resolved the pixel size.
    if (
      this.sizing.aspectRatio === undefined &&
      this.intrinsic &&
      this.intrinsic.width > 0 &&
      this.intrinsic.height > 0
    ) {
      const ratio = this.intrinsic.width / this.intrinsic.height;
      // Neither pinned: its own size (1px = 1pt), scaled down to what is offered - never up, and never
      // past the cap, which is what keeps anything from running off the page. The width clamp does the
      // width; a height cap is turned into a width at the image's ratio.
      if (w === undefined && h === undefined) {
        w = bounds.constrainWidth(Math.min(this.intrinsic.width, bounds.maxHeight * ratio));
      }
      if (w !== undefined && h === undefined) h = bounds.constrainHeight(w / ratio);
      else if (h !== undefined && w === undefined) w = bounds.constrainWidth(h * ratio);
    }

    // Still unpinned (no intrinsic size known): a bounded axis fills; an unbounded one takes the image's
    // own extent (1px = 1pt). Read from `requested`, never the mutated this.width/height.
    const width =
      w ??
      (bounds.hasBoundedWidth
        ? bounds.maxWidth
        : (this.requested.width ?? this.ownExtent(bounds, "width")));
    const height =
      h ??
      (bounds.hasBoundedHeight
        ? bounds.maxHeight
        : (this.requested.height ?? this.ownExtent(bounds, "height")));

    // Top-left coordinates; the fit logic (renderer) and the Y-flip (seam) run later.
    return { width, height };
  }

  /** The image's own pixel extent on one axis, clamped by its min/max; unknown before the pre-pass. */
  private ownExtent(bounds: BoxConstraints, axis: "width" | "height"): number | undefined {
    const own = this.intrinsic?.[axis];
    if (own === undefined) return undefined;
    return axis === "width" ? bounds.constrainWidth(own) : bounds.constrainHeight(own);
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      image: this.image,
      fit: this.fit,
      radius: this.radius,
      align: this.align,
      alt: this.alt,
    };
  }
}
