import { getImageDimensions } from "../utils/image-helper";
import {
  LayoutConstraints,
  LayoutContext,
  SizedPDFElement,
} from "./pdf-element";

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
}

export class ImageElement extends SizedPDFElement {
  private image: CustomImage;
  private fit: BoxFit;

  constructor({
    image,
    width = Number.NaN,
    height = Number.NaN,
    fit = BoxFit.none,
  }: ImageElementParams) {
    super({ x: 0, y: 0, width: width });

    this.image = image;
    this.width = width;
    this.height = height;
    this.fit = fit;
  }

  calculateLayout(
    parentConstraints: LayoutConstraints | undefined,
    _ctx: LayoutContext
  ): LayoutConstraints {
    if (parentConstraints) {
      this.x = parentConstraints.x || this.x;
      this.y = parentConstraints.y || this.y;
      this.width = parentConstraints.width || this.width;
      this.height = parentConstraints.height || this.height || 0;
    }

    // Top-left coordinates; the fit logic (renderer) and the Y-flip (seam) run later.
    return { x: this.x, y: this.y, width: this.width, height: this.height };
  }

  override getProps() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      image: this.image,
      fit: this.fit,
    };
  }
}
