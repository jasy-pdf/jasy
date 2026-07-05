import { getImageDimensions } from "../utils/image-helper.ts";
import { latin1FromBytes } from "../utils/bytes.ts";
import { readFileBytesAsync } from "../platform/node-fs.ts";
import { BoxConstraints, Offset, Size, resolveExtent } from "../layout/box-constraints.ts";
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
  abstract init(): void | Promise<void>;
  abstract getImageType(): string | Promise<string>;
  abstract getFileData(): string | Promise<string>;
  abstract getImageDimensions(): Promise<{ width: number; height: number }>;
}

export class CustomLocalImage extends CustomImage {
  private imagePath: string;
  private fileBuffer!: Uint8Array;
  private fileRawData!: string;

  constructor(imagePath: string) {
    super();
    this.imagePath = imagePath;
  }

  async init(): Promise<void> {
    if (this.fileBuffer) return; // idempotent: the pre-layout size pass and the renderer both call init()
    try {
      // Loading image and convert it to base64
      await this.loadImage(this.imagePath);
    } catch (error) {
      console.error("Error loading image:", error);
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
    if (!this.fileBuffer) {
      throw new Error("You must first call the `loadAndConvertImage` method");
    }

    // Since now (30.09.2024) we using "Jimp" - So we don't need our custom method to get the image dimension.
    // But at the moment I let it still here...
    const dimensions = await getImageDimensions(this.fileBuffer);
    return dimensions;
  }
}

/**
 * An image straight from raw bytes (a browser upload / fetch, no filesystem). The PDF filter is sniffed
 * from the magic bytes: JPEG embeds raw (DCTDecode, no decode step), PNG is decoded to RGB (FlateDecode).
 */
export class CustomBytesImage extends CustomImage {
  private fileRawData: string;
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
    return getImageDimensions(this.bytes);
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
  fit?: BoxFit;
  /** Corner radius in points; rounds the image box (0 = sharp, default). */
  radius?: number;
  /** Alternate text for accessibility (tagged PDF). With `alt` the image is a Figure; without, decoration. */
  alt?: string;
}

export class ImageElement extends SizedPDFElement {
  private image: CustomImage;
  private widthFactor?: number;
  private heightFactor?: number;
  private fit: BoxFit;
  private radius: number;
  private readonly alt?: string;
  // Intrinsic pixel size, resolved asynchronously before layout (see resolveIntrinsicSize). Layout
  // reads it to derive a proportional height for a width-only image (and vice versa).
  private intrinsic?: { width: number; height: number };

  constructor({
    image,
    width,
    height,
    widthFactor,
    heightFactor,
    fit = BoxFit.none,
    radius,
    alt,
  }: ImageElementParams) {
    super({ x: 0, y: 0, width });

    this.image = image;
    this.height = height;
    this.widthFactor = widthFactor;
    this.heightFactor = heightFactor;
    this.fit = fit;
    this.radius = radius ?? 0;
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
      await this.image.init();
      this.intrinsic = await this.image.getImageDimensions();
    } catch {
      // leave intrinsic undefined - aspect derivation simply doesn't fire
    }
  }

  calculateLayout(constraints: BoxConstraints, offset: Offset, _ctx: LayoutContext): Size {
    this.x = offset.x;
    this.y = offset.y;

    // Relative sizing: a fixed size or a fraction of the offered box (fraction only in a bounded axis).
    let w = resolveExtent(this.width, this.widthFactor, constraints.maxWidth, constraints.hasBoundedWidth);
    let h = resolveExtent(this.height, this.heightFactor, constraints.maxHeight, constraints.hasBoundedHeight);

    // Aspect auto-size: when the user pinned exactly ONE axis, derive the other from the intrinsic
    // ratio (CSS `width: 50%; height: auto`). Only fires once the pre-pass resolved the pixel size.
    if (this.intrinsic && this.intrinsic.width > 0 && this.intrinsic.height > 0) {
      const ratio = this.intrinsic.width / this.intrinsic.height;
      if (w !== undefined && h === undefined) h = w / ratio;
      else if (h !== undefined && w === undefined) w = h * ratio;
    }

    // Fall back to the prior behavior for an unpinned axis: a bounded axis fills, otherwise keep our own.
    this.width = w ?? (constraints.hasBoundedWidth ? constraints.maxWidth : this.width);
    this.height = h ?? (constraints.hasBoundedHeight ? constraints.maxHeight : this.height);

    // Top-left coordinates; the fit logic (renderer) and the Y-flip (seam) run later.
    return { width: this.width ?? 0, height: this.height ?? 0 };
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
      alt: this.alt,
    };
  }
}
