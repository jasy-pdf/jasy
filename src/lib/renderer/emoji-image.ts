import { CustomBytesImage } from "../elements/image-element.ts";
import { decodePngToRgbFlate } from "../utils/image-helper.ts";
import { bytesFromLatin1 } from "../utils/bytes.ts";
import { Image } from "../ir/display-list.ts";

// Per-URL fetch cache (process-wide): an emoji image is fetched once, however many times it appears.
const cache = new Map<string, Promise<Uint8Array | null>>();

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? new Uint8Array(b) : null))
      .catch(() => null); // offline / 404 -> null, the caller leaves a blank gap (graceful)
    cache.set(url, pending);
  }
  return pending;
}

// Twemoji-style URL: base + lowercase hex code point + "." + format (e.g. ".../1f600.png"). Single
// code points only - multi-code-point sequences (flags, ZWJ) are out of scope for now.
export function emojiImageUrl(codePoint: number, source: { url: string; format: string }): string {
  return `${source.url}${codePoint.toString(16)}.${source.format}`;
}

// Builds an `Image` IR node for an emoji drawn as a 1em square seated on the baseline (mostly above
// it, a little below - like a text glyph), or null when the fetch/decode fails.
export async function emojiImageNode(
  codePoint: number,
  source: { url: string; format: string },
  x: number,
  baselineY: number,
  em: number,
): Promise<Image | null> {
  const bytes = await fetchBytes(emojiImageUrl(codePoint, source));
  if (!bytes) return null;

  const img = new CustomBytesImage(bytes);
  const imageType = await img.getImageType();
  const fileData = await img.getFileData();
  const dims = await img.getImageDimensions();

  // JPEG embeds raw; PNG is decoded to DeviceRGB + an /SMask alpha channel (transparency).
  let data = fileData;
  let smask: string | undefined;
  if (imageType === "FlateDecode") {
    const decoded = await decodePngToRgbFlate(bytesFromLatin1(fileData));
    data = decoded.data;
    smask = decoded.smask;
  }

  return {
    type: "image",
    x,
    y: baselineY - em * 0.82,
    width: em,
    height: em,
    intrinsicWidth: dims.width,
    intrinsicHeight: dims.height,
    data,
    imageType,
    ...(smask ? { smask } : {}),
  };
}
