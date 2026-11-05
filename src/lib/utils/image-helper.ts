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

/** Dots per inch, per axis. */
export interface Resolution {
  x: number;
  y: number;
}

export interface ImageDimensions {
  /** In pixels - what the XObject declares. */
  width: number;
  height: number;
  /** The resolution the file declares; absent when it declares none. */
  dpi?: Resolution;
}

/** The resolution of a file that declares none: CSS's reference pixel, 1/96 inch. */
export const DEFAULT_DPI = 96;

/** An image's own size in points: its pixels at the resolution the file declares, else 96 dpi. */
export function naturalSize(dims: ImageDimensions): { width: number; height: number } {
  return {
    width: (dims.width * 72) / (dims.dpi?.x ?? DEFAULT_DPI),
    height: (dims.height * 72) / (dims.dpi?.y ?? DEFAULT_DPI),
  };
}

/** A resolution only counts if both axes are real numbers above zero; anything else is no declaration. */
function resolution(x: number, y: number): Resolution | undefined {
  return Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0 ? { x, y } : undefined;
}

/** PNG `pHYs`: pixels per unit, and only unit 1 (meter) is a physical size - 0 is an aspect ratio. */
function pngResolution(view: DataView): Resolution | undefined {
  for (let offset = 8; offset + 8 <= view.byteLength; ) {
    const length = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    if (type === 0x49444154) return undefined; // IDAT: pHYs must come before it
    if (type === 0x70485973 && length >= 9 && offset + 17 <= view.byteLength) {
      if (view.getUint8(offset + 16) !== 1) return undefined;
      return resolution(view.getUint32(offset + 8) * 0.0254, view.getUint32(offset + 12) * 0.0254);
    }
    offset += 12 + length;
  }
  return undefined;
}

/** JFIF `APP0`: units 1 = dots per inch, 2 = per centimeter, 0 = an aspect ratio only. */
function jfifResolution(view: DataView, data: number): Resolution | undefined {
  if (view.getUint32(data) !== 0x4a464946 || view.getUint8(data + 4) !== 0) return undefined; // "JFIF\0"
  const units = view.getUint8(data + 7);
  const scale = units === 1 ? 1 : units === 2 ? 2.54 : 0;
  if (scale === 0) return undefined;
  return resolution(view.getUint16(data + 8) * scale, view.getUint16(data + 10) * scale);
}

/** The first IFD of a TIFF block (EXIF), as tag → the entry's offset in `view`. */
function tiffEntries(view: DataView, tiff: number): { entries: Map<number, number>; le: boolean } {
  const le = view.getUint16(tiff) === 0x4949; // "II"
  const ifd = tiff + view.getUint32(tiff + 4, le);
  const entries = new Map<number, number>();
  const count = view.getUint16(ifd, le);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    entries.set(view.getUint16(entry, le), entry);
  }
  return { entries, le };
}

/** EXIF `APP1`: XResolution / YResolution (rationals) in ResolutionUnit, 2 = inch (the default), 3 = cm. */
function exifResolution(view: DataView, data: number): Resolution | undefined {
  if (view.getUint32(data) !== 0x45786966 || view.getUint16(data + 4) !== 0) return undefined; // "Exif\0\0"
  const tiff = data + 6;
  const { entries, le } = tiffEntries(view, tiff);
  const rational = (tag: number): number => {
    const entry = entries.get(tag);
    if (entry === undefined) return NaN;
    const at = tiff + view.getUint32(entry + 8, le);
    return view.getUint32(at, le) / view.getUint32(at + 4, le);
  };
  const unitEntry = entries.get(0x0128);
  const unit = unitEntry === undefined ? 2 : view.getUint16(unitEntry + 8, le);
  const scale = unit === 2 ? 1 : unit === 3 ? 2.54 : 0;
  if (scale === 0) return undefined;
  return resolution(rational(0x011a) * scale, rational(0x011b) * scale);
}

/** A declared resolution is metadata: a malformed one is no declaration, never a failed image. */
function tryRead(read: () => Resolution | undefined): Resolution | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** What a JPEG's header says about it: its frame, how it is coded, and what it declares. */
interface JpegHeader {
  width: number;
  height: number;
  /** 1 = gray, 3 = RGB (YCbCr), 4 = CMYK (or YCCK). */
  components: number;
  /** The start-of-frame marker: how the image is coded. */
  sof: number;
  /** An Adobe `APP14` segment: Photoshop stores CMYK inverted. */
  adobe: boolean;
  dpi?: Resolution;
}

/** Start-of-frame markers; the rest of 0xFFC0..0xFFCF are tables (DHT C4, JPG C8, DAC CC). */
const isSof = (marker: number) =>
  marker >= 0xffc0 &&
  marker <= 0xffcf &&
  marker !== 0xffc4 &&
  marker !== 0xffc8 &&
  marker !== 0xffcc;

/** Markers without a length: TEM and the restart markers. */
const isStandalone = (marker: number) =>
  marker === 0xff01 || (marker >= 0xffd0 && marker <= 0xffd7);

function jpegHeader(view: DataView): JpegHeader {
  // JFIF is the container's own declaration and wins; EXIF is what a camera writes.
  let jfif: Resolution | undefined;
  let exif: Resolution | undefined;
  let adobe = false;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset + 1) === 0xff) {
      offset++; // a fill byte before the marker
      continue;
    }
    const marker = view.getUint16(offset);
    offset += 2;
    if (isStandalone(marker)) continue;
    if (isSof(marker)) {
      const dpi = jfif ?? exif;
      return {
        height: view.getUint16(offset + 3),
        width: view.getUint16(offset + 5),
        components: view.getUint8(offset + 7),
        sof: marker,
        adobe,
        ...(dpi ? { dpi } : {}),
      };
    }
    if (marker === 0xffe0) jfif ??= tryRead(() => jfifResolution(view, offset + 2));
    if (marker === 0xffe1) exif ??= tryRead(() => exifResolution(view, offset + 2));
    // "Adobe"
    if (
      marker === 0xffee &&
      view.getUint32(offset + 2) === 0x41646f62 &&
      view.getUint8(offset + 6) === 0x65
    )
      adobe = true;
    offset += view.getUint16(offset);
  }
  throw new Error("Unsupported image format");
}

/** Thrown for a JPEG we cannot embed as it is. Says what it is and what to do. */
export class JpegFormatError extends Error {
  constructor(message: string) {
    super(`@jasy/pdf: ${message}`);
  }
}

/** Baseline, extended sequential and progressive: the codings a PDF viewer's DCTDecode reads. */
const DCT_CODINGS = new Set([0xffc0, 0xffc1, 0xffc2]);

/** How a JPEG is embedded as it is (`DCTDecode`): its color space, and a `/Decode` for Adobe CMYK. */
export interface JpegColor {
  colorSpace: "DeviceGray" | "DeviceRGB" | "DeviceCMYK";
  decode?: number[];
}

export function jpegColor(bytes: Uint8Array): JpegColor {
  const header = jpegHeader(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  if (!DCT_CODINGS.has(header.sof)) {
    throw new JpegFormatError(
      "this JPEG is lossless, hierarchical or arithmetic-coded, which PDF viewers cannot decode. " +
        "Save it again as a baseline or progressive JPEG, or as a PNG.",
    );
  }
  switch (header.components) {
    case 1:
      return { colorSpace: "DeviceGray" };
    case 3:
      return { colorSpace: "DeviceRGB" };
    case 4:
      return header.adobe
        ? { colorSpace: "DeviceCMYK", decode: [1, 0, 1, 0, 1, 0, 1, 0] }
        : { colorSpace: "DeviceCMYK" };
    default:
      throw new JpegFormatError(
        `this JPEG has ${header.components} color channels; only gray, RGB and CMYK are embedded.`,
      );
  }
}

/** Read from the header alone, synchronously - layout can ask it. */
export function getImageDimensions(buffer: Uint8Array): ImageDimensions {
  // The view's own window: a `Uint8Array` may be a slice of a larger buffer (a Node `Buffer` usually is).
  const dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  if (dataView.getUint16(0) === 0xffd8) {
    const { width, height, dpi } = jpegHeader(dataView);
    return { width, height, ...(dpi ? { dpi } : {}) };
  }

  // Check for PNG (0x89504E47 is the PNG signature)
  if (dataView.getUint32(0) === 0x89504e47) {
    const dpi = tryRead(() => pngResolution(dataView));
    return {
      width: dataView.getUint32(16, false),
      height: dataView.getUint32(20, false),
      ...(dpi ? { dpi } : {}),
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

/** At its own size (`naturalSize`), the overhang cut off. */
export function applyFitNone(
  imageWidth: number,
  imageHeight: number,
  containerWidth: number,
  containerHeight: number,
  align: FitAlign = CENTRE,
): FitResult {
  return placed(imageWidth, imageHeight, containerWidth, containerHeight, align);
}
