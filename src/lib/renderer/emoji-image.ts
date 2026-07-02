import { CustomBytesImage } from "../elements/image-element.ts";
import { decodePngToRgbFlate } from "../utils/image-helper.ts";
import { bytesFromLatin1 } from "../utils/bytes.ts";
import { Image } from "../ir/display-list.ts";

// Per-URL fetch cache (process-wide): an emoji image is fetched once, however many times it appears.
const cache = new Map<string, Promise<Uint8Array | null>>();
const FETCH_TIMEOUT_MS = 5000; // a slow CDN must not stall the whole render

async function fetchBytes(url: string): Promise<Uint8Array | null> {
  const cached = cache.get(url);
  if (cached) return cached;

  const pending = (async (): Promise<Uint8Array | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: controller.signal });
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    } catch {
      return null; // offline / 404 / timeout -> null; the caller leaves a blank gap (graceful)
    } finally {
      clearTimeout(timer);
    }
  })();

  cache.set(url, pending);
  // Cache only SUCCESSFUL results: drop a failure so a transient error (offline) can be retried later.
  void pending.then((bytes) => {
    if (!bytes && cache.get(url) === pending) cache.delete(url);
  });
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
