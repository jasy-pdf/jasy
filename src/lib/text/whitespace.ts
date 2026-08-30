import type { TextSegment } from "../elements/text-element.ts";

/**
 * A character with no glyph is still ENCODED and DRAWN: it comes out as the font's .notdef box, and
 * veraPDF rejects the file for referencing .notdef (ISO 19005-3, 6.2.11.8). A `\n` in an invoice
 * description was the first case we hit; zero-width characters are the same fault and arrive far more
 * quietly - a paste out of Word or a web page carries them routinely.
 *
 * So nothing invisible survives into the breaker except `\n`, and that only because the breaker treats
 * it as a hard break. The mapping follows a browser's `white-space: normal` apart from `\n`: CSS
 * collapses that to a space, while a text COMPONENT breaks on it - Flutter's `Text` and react-pdf both
 * do, and it is what anyone writing `"a\nb"` expects.
 */

/** Everything that MEANS a line break. U+2028/U+2029 are Unicode's own line and paragraph separators. */
const LINE_BREAKS = /\r\n?|\u2028|\u2029/g;

/**
 * Invisible and inert: a zero-width space and a byte-order mark carry no meaning we act on, so they are
 * dropped rather than drawn. C0, C1 and DEL likewise.
 *
 * Deliberately NOT here: U+200C/U+200D (zero-width non-joiner and joiner) drive Arabic shaping and
 * emoji sequences, and U+200E/U+200F (the bidi marks) drive `text/bidi.ts`. Dropping those would
 * silently change how correct text is laid out - worse than the box they can still leave behind in a
 * run that neither shapes nor reorders.
 */
// oxlint-disable-next-line no-control-regex -- matching control characters is the whole point here.
const UNPRINTABLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\uFEFF]/g;

export function normalizeWhitespace(text: string): string {
  return (
    text
      // Every spelling of a break becomes `\n` first, so the breaker only ever sees one form.
      .replace(LINE_BREAKS, "\n")
      // A tab is collapsible whitespace; a PDF text operator has no tab stops to advance to.
      .replace(/\t/g, " ")
      .replace(UNPRINTABLE, "")
  );
}

/** The same, for content that may already be split into styled spans. */
export function normalizeContent(content: string | TextSegment[]): string | TextSegment[] {
  if (typeof content === "string") return normalizeWhitespace(content);
  return content.map((seg) => ({ ...seg, content: normalizeWhitespace(seg.content) }));
}
