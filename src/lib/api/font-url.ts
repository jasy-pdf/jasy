/**
 * Loading a font over the network for `doc.addFontFromUrl(...)`.
 *
 * `addFont` resolves its source AT REGISTRATION - a path is read there and then - and this keeps the
 * same contract, differing only in being async. So the failure lands where you asked for the font,
 * not somewhere inside a later render.
 *
 * `fetch` is used directly: it is in every browser and in Node since 18, so this needs no platform
 * port, unlike the filesystem read beside it.
 */

/** One font file by URL, or a styled family of them. Mirrors `FontSource`, with strings meaning URLs. */
export type UrlFontSource =
  | string
  | { normal: string; bold?: string; italic?: string; boldItalic?: string };

/** Thrown when a font could not be fetched or is not one we can parse. Always says which URL. */
export class FontUrlError extends Error {
  constructor(message: string) {
    super(`@jasy/pdf: ${message}`);
  }
}

/**
 * What the first four bytes of an sfnt file say it is. Checked here because `TTFParser` does not look
 * at them: it goes straight for the table directory, so an HTML error page or a WOFF would fail deep
 * inside with `missing required table "head"` instead of saying what the file actually is.
 */
function describeSignature(bytes: Uint8Array): { ok: boolean; what: string } {
  const tag = String.fromCharCode(...bytes.subarray(0, 4));
  const v = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  if (v === 0x00010000 || tag === "true") return { ok: true, what: "TrueType" };
  if (tag === "OTTO")
    return { ok: false, what: "an OpenType/CFF font, which jasy does not parse yet" };
  if (tag === "wOFF") return { ok: true, what: "WOFF" };
  if (tag === "wOF2") return { ok: true, what: "WOFF2" };
  if (tag === "ttcf")
    return { ok: false, what: "a TrueType Collection, which jasy does not parse yet" };
  if (tag.startsWith("<") || tag === "%PDF") return { ok: false, what: "not a font at all" };
  return { ok: false, what: "not a font we recognise" };
}

/** How long one font may take to arrive before we give up. A hung server must not hang a render. */
const TIMEOUT_MS = 15_000;

/**
 * How large a font file may be. Generous on purpose - a full CJK face is tens of megabytes and is a
 * legitimate thing to embed - but not unbounded: a URL pointing at the wrong file (a video, a disk
 * image) would otherwise be read into memory in full before anyone notices it is not a font.
 */
const MAX_BYTES = 32 * 1024 * 1024;

/** Read the body with a running ceiling, so an oversized response is dropped WHILE it arrives. */
async function readBounded(response: Response, url: string): Promise<Uint8Array> {
  // `Content-Length` is the cheap early exit; a server may omit or misstate it, so it is a hint only
  // and the real ceiling is enforced below while reading.
  const declared = Number(response.headers?.get?.("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new FontUrlError(`the font at ${url} is ${declared} bytes; the limit is ${MAX_BYTES}`);
  }

  const body = response.body;
  if (!body?.getReader) {
    // No streaming body (an older runtime, or a stubbed response): fall back to reading it whole and
    // checking afterwards. Weaker, but never worse than not checking at all.
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.length > MAX_BYTES) {
      throw new FontUrlError(`the font at ${url} is larger than the ${MAX_BYTES} byte limit`);
    }
    return whole;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new FontUrlError(`the font at ${url} is larger than the ${MAX_BYTES} byte limit`);
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Fetch one font file and hand back its bytes, refusing anything we could not embed. */
async function fetchFont(url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    const why =
      (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError"
        ? `it did not respond within ${TIMEOUT_MS} ms`
        : String((e as Error)?.message ?? e);
    throw new FontUrlError(`could not fetch the font at ${url}: ${why}`);
  }
  if (!response.ok) {
    throw new FontUrlError(`the font at ${url} could not be fetched: HTTP ${response.status}`);
  }

  // Everything past here still talks to the network, so a failure mid-body must not escape as a raw
  // TypeError - a caller catching FontUrlError would miss it.
  let bytes: Uint8Array;
  try {
    bytes = await readBounded(response, url);
  } catch (e) {
    if (e instanceof FontUrlError) throw e;
    throw new FontUrlError(
      `the font at ${url} could not be read: ${String((e as Error)?.message ?? e)}`,
    );
  }

  if (bytes.length < 4) {
    throw new FontUrlError(`the font at ${url} is empty`);
  }
  const { ok, what } = describeSignature(bytes);
  if (!ok) {
    throw new FontUrlError(
      `the file at ${url} is ${what}. jasy embeds TrueType-flavoured fonts ` +
        `(.ttf, .woff and .woff2)`,
    );
  }
  return bytes;
}

/** Fetch a whole `UrlFontSource`, in parallel for a family. */
export async function loadFontFromUrl(
  source: UrlFontSource,
): Promise<
  | Uint8Array
  | { normal: Uint8Array; bold?: Uint8Array; italic?: Uint8Array; boldItalic?: Uint8Array }
> {
  if (typeof source === "string") return fetchFont(source);

  const styles = ["normal", "bold", "italic", "boldItalic"] as const;
  const wanted = styles.filter((s) => source[s] !== undefined);
  const loaded = await Promise.all(wanted.map((s) => fetchFont(source[s]!)));
  const family = { normal: new Uint8Array() } as {
    normal: Uint8Array;
    bold?: Uint8Array;
    italic?: Uint8Array;
    boldItalic?: Uint8Array;
  };
  wanted.forEach((s, i) => (family[s] = loaded[i]));
  return family;
}
