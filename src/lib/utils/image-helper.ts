import { Jimp, JimpMime } from "jimp";
import { zlibSync } from "fflate";
import { latin1FromBytes } from "./bytes.ts";

// Declare the new method in the DataView interface
declare global {
  interface DataView {
    getUint24(byteOffset: number, littleEndian?: boolean): number;
  }
}

// Implement the method to handle 24-bit integers
DataView.prototype.getUint24 = function (
  byteOffset: number,
  littleEndian: boolean = false,
): number {
  const b1 = this.getUint8(byteOffset);
  const b2 = this.getUint8(byteOffset + 1);
  const b3 = this.getUint8(byteOffset + 2);
  return littleEndian ? (b3 << 16) | (b2 << 8) | b1 : (b1 << 16) | (b2 << 8) | b3;
};

interface ImageDimensions {
  width: number;
  height: number;
}

export async function getImageDimensions(buffer: Uint8Array): Promise<ImageDimensions> {
  const dataView = new DataView(
    buffer.buffer,
    // buffer.byteOffset,
    // buffer.byteLength
  );

  // Check for JPEG (0xFFD8 is the start of JPEG file)
  if (dataView.getUint16(0) === 0xffd8) {
    let offset = 2;
    while (offset < buffer.byteLength) {
      const marker = dataView.getUint16(offset, false);
      offset += 2;
      if (marker === 0xffc0 || marker === 0xffc2) {
        // SOF0 or SOF2
        return {
          height: dataView.getUint16(offset + 3, false),
          width: dataView.getUint16(offset + 5, false),
        };
      } else {
        offset += dataView.getUint16(offset, false);
      }
    }
  }

  // Check for PNG (0x89504E47 is the PNG signature)
  if (dataView.getUint32(0) === 0x89504e47) {
    return {
      width: dataView.getUint32(16, false),
      height: dataView.getUint32(20, false),
    };
  }

  // Check for BMP (0x424D is the BMP signature)
  if (dataView.getUint16(0) === 0x424d) {
    return {
      width: dataView.getUint32(18, true),
      height: dataView.getUint32(22, true),
    };
  }

  // Check for WebP (0x52494646 is the WebP signature 'RIFF')
  if (dataView.getUint32(0) === 0x52494646 && dataView.getUint32(8) === 0x57454250) {
    // 'WEBP'
    if (dataView.getUint32(12) === 0x56503820) {
      // 'VP8 '
      return {
        width: dataView.getUint16(26, true),
        height: dataView.getUint16(28, true),
      };
    } else if (dataView.getUint32(12) === 0x56503858) {
      // 'VP8X'
      return {
        width: dataView.getUint24(24, true) + 1,
        height: dataView.getUint24(27, true) + 1,
      };
    }
  }

  throw new Error("Unsupported image format");
}

/**
 * Converts the given image to grayscale and returns its binary data.
 * @param imagePath Path to the input image file.
 * @returns Promise that resolves with the binary data of the grayscale image.
 */
/**
 * Decodes a PNG into raw DeviceRGB samples, Flate-compressed, ready to embed as a PDF
 * image XObject. A PNG file is NOT a valid `/FlateDecode` stream (it's a signature plus
 * chunks of filtered, zlib-compressed scanlines), so it must be decoded first. PDF has
 * no alpha channel for DeviceRGB, so transparent pixels are composited over white.
 */
export async function decodePngToRgbFlate(
  pngBuffer: Uint8Array,
): Promise<{ data: string; width: number; height: number }> {
  // jimp (Node-only) wants a Buffer view; the future browser path will decode via canvas instead.
  const image = await Jimp.fromBuffer(
    Buffer.from(pngBuffer.buffer, pngBuffer.byteOffset, pngBuffer.byteLength),
  );
  const { width, height, data: rgba } = image.bitmap;

  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    const alpha = rgba[i + 3] / 255;
    rgb[j] = Math.round(rgba[i] * alpha + 255 * (1 - alpha));
    rgb[j + 1] = Math.round(rgba[i + 1] * alpha + 255 * (1 - alpha));
    rgb[j + 2] = Math.round(rgba[i + 2] * alpha + 255 * (1 - alpha));
  }

  // Compress so the existing `/Filter /FlateDecode` XObject path embeds it correctly.
  return { data: latin1FromBytes(zlibSync(rgb)), width, height };
}

export async function convertImageToGrayscaleBuffer(imagePath: string): Promise<Uint8Array> {
  // We get the image from the buffer
  const image = await Jimp.read(imagePath);

  // Get MIME type. If emtpy throw error
  const mime = image.mime;
  if (!mime) throw new Error("Cannot read MIME type");

  // We need to check the MIME type (the exact union `getBuffer` accepts).
  let mimeType: Parameters<typeof image.getBuffer>[0];
  switch (mime) {
    case JimpMime.png:
    case JimpMime.jpeg:
    case JimpMime.bmp:
      mimeType = mime;
      break;
    default:
      throw new Error("Unsupported MIME type");
  }

  image.greyscale();

  // Convert the image back to buffer with current MIME type
  const grayscaleBuffer = await image.getBuffer(mimeType);

  return grayscaleBuffer;
}

// Helper for caluclating sizes (contain, cover..)
export interface FitResult {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function applyContainFit(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
): FitResult {
  const imageAspectRatio = imageWidth / imageHeight;
  const containerAspectRatio = containerWidth / containerHeight;
  let width, height, offsetX, offsetY;

  if (imageAspectRatio > containerAspectRatio) {
    // The images width is bigger than the containers width
    const scaleFactor = containerWidth / imageWidth;
    width = containerWidth;
    height = imageHeight * scaleFactor;
    offsetX = 0;
    offsetY = (containerHeight - height) / 2; // Center vertically
  } else {
    // THe images height is bigge rthan the containers height
    const scaleFactor = containerHeight / imageHeight;
    width = imageWidth * scaleFactor;
    height = containerHeight;
    offsetX = (containerWidth - width) / 2; // Center horizontally
    offsetY = 0;
  }

  return {
    width,
    height,
    offsetX,
    offsetY,
  };
}

export function applyCoverFit(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
): FitResult {
  const imageAspectRatio = imageWidth / imageHeight;
  const containerAspectRatio = containerWidth / containerHeight;
  let width, height, offsetX, offsetY;

  if (imageAspectRatio > containerAspectRatio) {
    // The images width is bigger than containers width
    const scaleFactor = containerHeight / imageHeight;
    width = imageWidth * scaleFactor;
    height = containerHeight;
    offsetX = (containerWidth - width) / 2; // Center horizontally
    offsetY = 0;
  } else {
    // The images height is bigger than containers height
    const scaleFactor = containerWidth / imageWidth;
    width = containerWidth;
    height = imageHeight * scaleFactor;
    offsetX = 0;
    offsetY = (containerHeight - height) / 2; // Center vertically
  }

  return {
    width,
    height,
    offsetX,
    offsetY,
  };
}

export function applyFillFit(containerWidth: number, containerHeight: number): FitResult {
  return {
    width: containerWidth,
    height: containerHeight,
    offsetX: 0,
    offsetY: 0,
  };
}

export function applyFitNone(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
) {
  const offsetX = (containerWidth - imageWidth) / 2; // Center horizontally
  const offsetY = (containerHeight - imageHeight) / 2; // Center vertically

  return {
    width: imageWidth, // Hold orignal image size
    height: imageHeight,
    offsetX: offsetX > 0 ? offsetX : 0, // Dont move outside the container...
    offsetY: offsetY > 0 ? offsetY : 0,
  };
}
