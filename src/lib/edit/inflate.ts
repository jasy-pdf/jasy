import { Unzlib, unzlibSync } from "fflate";

/**
 * Inflating a stream with a ceiling, so a zip bomb cannot exhaust memory.
 *
 * fflate's `unzlibSync(data, { out })` is NOT usable for this: it truncates silently instead of failing.
 * Hence the streamed form - input in slices, so the total can be checked while it grows.
 */

/** Thrown when a stream expands past the ceiling; distinct from a stream that simply will not decode. */
export class PdfStreamTooLargeError extends Error {
  constructor(
    readonly limit: number,
    message: string,
  ) {
    super(`@jasy/pdf: ${message}`);
  }
}

export const DEFAULT_MAX_STREAM_SIZE = 64 * 1024 * 1024;

/** Only the granularity of the check: fflate buffers internally, so the abort lands one block past. */
const INPUT_SLICE = 16 * 1024;

/** DEFLATE's maximum expansion (a 258-byte match in its shortest encoding). A format property. */
const MAX_DEFLATE_RATIO = 1032;

export function inflateBounded(data: Uint8Array, limit: number): Uint8Array {
  // Too small to reach the ceiling even at maximum compression, so checking as it grows is pointless.
  // Nearly every stream in a real PDF lands here, which is why the guard costs nothing.
  if (data.length <= limit / MAX_DEFLATE_RATIO) return unzlibSync(data);

  const parts: Uint8Array[] = [];
  let total = 0;

  const inflater = new Unzlib();
  inflater.ondata = (chunk: Uint8Array) => {
    total += chunk.length;
    if (total > limit) {
      throw new PdfStreamTooLargeError(
        limit,
        `a stream in this PDF expands past the ${limit} byte limit for a single stream; if the file is ` +
          `genuinely that large, raise it with { maxStreamSize }`,
      );
    }
    parts.push(chunk);
  };

  for (let at = 0; at < data.length; at += INPUT_SLICE) {
    const end = Math.min(at + INPUT_SLICE, data.length);
    inflater.push(data.subarray(at, end), end >= data.length);
  }

  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
