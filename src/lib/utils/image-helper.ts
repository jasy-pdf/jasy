import { zlibSync } from "fflate";
import { latin1FromBytes } from "./bytes.ts";
import { pngToRgba } from "../platform/node-image.ts";

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
  // The view's own window: a `Uint8Array` may be a slice of a larger buffer (a Node `Buffer` usually is).
  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

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
 * chunks of filtered, zlib-compressed scanlines), so it must be decoded first. DeviceRGB has
 * no alpha itself, so any transparency rides alongside as a DeviceGray `/SMask` (the return's `smask`).
 */
export async function decodePngToRgbFlate(
  pngBuffer: Uint8Array,
): Promise<{ data: string; smask?: string; width: number; height: number }> {
  // The decode (PNG bytes → RGBA) is platform-specific: jimp on Node, an OffscreenCanvas in the browser
  // (`platform/{node,browser}-image.ts`, swapped by the package `browser` field). The split below is shared.
  const { width, height, rgba } = await pngToRgba(pngBuffer);

  // Raw DeviceRGB samples + (only when the PNG actually has transparency) a DeviceGray alpha channel that
  // rides as the XObject's /SMask. An opaque PNG yields the same raw RGB as before and no SMask, so it stays
  // byte-identical; a transparent one now composites correctly over whatever sits behind it.
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  let hasAlpha = false;
  for (let i = 0, j = 0, k = 0; i < rgba.length; i += 4, j += 3, k++) {
    rgb[j] = rgba[i];
    rgb[j + 1] = rgba[i + 1];
    rgb[j + 2] = rgba[i + 2];
    alpha[k] = rgba[i + 3];
    if (rgba[i + 3] !== 255) hasAlpha = true;
  }

  return {
    data: latin1FromBytes(zlibSync(rgb)),
    smask: hasAlpha ? latin1FromBytes(zlibSync(alpha)) : undefined,
    width,
    height,
  };
}

export async function convertImageToGrayscaleBuffer(imagePath: string): Promise<Uint8Array> {
  // We get the image from the buffer (jimp lazily loaded - see decodePngToRgbFlate).
  const { Jimp, JimpMime } = await import("jimp");
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

/** The drawn size of an image in its box, and where it sits there. */
export interface FitResult {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/** Where an image smaller or larger than its box sits in it, per axis: 0 = start, 0.5 = centre, 1 = end. */
export interface FitAlign {
  x: number;
  y: number;
}

const CENTRE: FitAlign = { x: 0.5, y: 0.5 };

/** The one place a fitted image is positioned: what is left over (or overhangs) is split by `align`. */
function placed(
  width: number,
  height: number,
  containerWidth: number,
  containerHeight: number,
  align: FitAlign,
): FitResult {
  return {
    width,
    height,
    offsetX: (containerWidth - width) * align.x,
    offsetY: (containerHeight - height) * align.y,
  };
}

/** Scaled by the width's or the height's factor; that axis takes the box's extent exactly. */
function scaled(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
  align: FitAlign,
  byWidthWins: (byWidth: number, byHeight: number) => boolean,
): FitResult {
  const byWidth = containerWidth / imageWidth;
  const byHeight = containerHeight / imageHeight;
  return byWidthWins(byWidth, byHeight)
    ? placed(containerWidth, imageHeight * byWidth, containerWidth, containerHeight, align)
    : placed(imageWidth * byHeight, containerHeight, containerWidth, containerHeight, align);
}

/** Scaled to fit inside the box, whole image visible. */
export function applyContainFit(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
  align: FitAlign = CENTRE,
): FitResult {
  return scaled(imageWidth, imageHeight, containerWidth, containerHeight, align, (w, h) => w < h);
}

/** Scaled to cover the box, the overhang cut off. */
export function applyCoverFit(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
  align: FitAlign = CENTRE,
): FitResult {
  return scaled(imageWidth, imageHeight, containerWidth, containerHeight, align, (w, h) => w >= h);
}

export function applyFillFit(containerWidth: number, containerHeight: number): FitResult {
  return { width: containerWidth, height: containerHeight, offsetX: 0, offsetY: 0 };
}

/** At its own size (1px = 1pt), the overhang cut off. */
export function applyFitNone(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
  align: FitAlign = CENTRE,
): FitResult {
  return placed(imageWidth, imageHeight, containerWidth, containerHeight, align);
}
