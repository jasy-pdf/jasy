import { getImageDimensions } from "../utils/image-helper";
import { BoxConstraints, Offset, Size } from "../layout/box-constraints";
import { LayoutContext, SizedPDFElement } from "./pdf-element";

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
  private fileBuffer!: Buffer;
  private fileRawData!: string;

  constructor(imagePath: string) {
    super();
    this.imagePath = imagePath;
  }

  async init(): Promise<void> {
    try {
      // Loading image and convert it to base64
      await this.loadImage(this.imagePath);
    } catch (error) {
      console.error("Error loading image:", error);
    }
  }

  async getImageType(): Promise<string> {
    const path = await import("path"); // Dynamic import
    const ext = path.extname(this.imagePath).toLowerCase();

    switch (ext) {
      case ".jpg":
      case ".jpeg":
        return "DCTDecode"; // For JPEG
      case ".png":
        return "FlateDecode"; // For PNG
      case ".bmp":
        throw new Error(
          "BMP is not directly supported. Please convert to PNG or JPEG."
        );
      case ".webp":
        throw new Error(
          "WebP is not directly supported. Please convert to PNG or JPEG."
        );
      default:
        throw new Error(`Unsupported image format: ${ext}`);
    }
  }

  private async loadImage(imagePath: string): Promise<Buffer> {
    const fs = await import("fs/promises"); // Dynamic import
    const result = await fs.readFile(imagePath);
    //const result = await convertImageToGrayscaleBuffer(imagePath);
    this.fileBuffer = result;
    this.fileRawData = result.toString("binary");

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

interface ImageElementParams {
  image: CustomImage; // binary image data
  width?: number;
  height?: number;
  fit?: BoxFit;
  /** Corner radius in points; rounds the image box (0 = sharp, default). */
  radius?: number;
}

export class ImageElement extends SizedPDFElement {
  private image: CustomImage;
  private fit: BoxFit;
  private radius: number;

  constructor({
    image,
    width,
    height,
    fit = BoxFit.none,
    radius,
  }: ImageElementParams) {
    super({ x: 0, y: 0, width });

    this.image = image;
    this.height = height;
    this.fit = fit;
    this.radius = radius ?? 0;
  }

  calculateLayout(
    constraints: BoxConstraints,
    offset: Offset,
    _ctx: LayoutContext
  ): Size {
    this.x = offset.x;
    this.y = offset.y;
    // A bounded axis overrides the intrinsic/explicit size; otherwise keep our own.
    if (constraints.hasBoundedWidth) this.width = constraints.maxWidth;
    if (constraints.hasBoundedHeight) this.height = constraints.maxHeight;

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
    };
  }
}
