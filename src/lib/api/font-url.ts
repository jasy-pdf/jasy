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
  if (tag === "wOFF") return { ok: false, what: "a WOFF font, which jasy does not parse yet" };
  if (tag === "wOF2") return { ok: false, what: "a WOFF2 font, which jasy does not parse yet" };
  if (tag === "ttcf")
    return { ok: false, what: "a TrueType Collection, which jasy does not parse yet" };
  if (tag.startsWith("<") || tag === "%PDF") return { ok: false, what: "not a font at all" };
  return { ok: false, what: "not a font we recognise" };
}

/** Fetch one font file and hand back its bytes, refusing anything we could not embed. */
async function fetchFont(url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw new FontUrlError(
      `could not fetch the font at ${url}: ${String((e as Error)?.message ?? e)}`,
    );
  }
  if (!response.ok) {
    throw new FontUrlError(`the font at ${url} could not be fetched: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4) {
    throw new FontUrlError(`the font at ${url} is empty`);
  }
  const { ok, what } = describeSignature(bytes);
  if (!ok) {
    throw new FontUrlError(
      `the file at ${url} is ${what}. jasy embeds TrueType-flavoured fonts (.ttf)`,
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
