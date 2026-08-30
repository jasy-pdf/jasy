import type { FontMetrics } from "../utils/font-metrics.ts";
import type { FontStyle } from "../utils/pdf-object-manager.ts";

/**
 * A code point the chosen font cannot draw becomes glyph 0 - which IS `.notdef`, and referencing it is
 * forbidden by PDF/A (ISO 19005-3, 6.2.11.8). So an invoice carrying a "✓" in its description is a
 * conforming file right up until someone validates it.
 *
 * The check has to be DYNAMIC, against the font actually resolved: which characters are missing is a
 * property of that font, not of Unicode. `@jasy/e-invoice` embeds Liberation, and its gaps look
 * arbitrary from the outside - "→" draws, "⇒" does not; "₴" draws, "₽" does not.
 *
 * What we do about it, in this order:
 *   1. The font has it        -> keep, untouched. This is every ordinary document, unchanged.
 *   2. A plain equivalent MEANS the same and the font has THAT -> substitute.
 *   3. Otherwise              -> drop it, and report it, so the application can say which character
 *                                went missing instead of shipping a box or a broken file.
 */

/**
 * Substitutes that keep the meaning. Deliberately tiny: only where dropping would CHANGE the text
 * rather than thin it. `E‑Rechnung` with a non-breaking hyphen must not become `ERechnung`.
 *
 * Not a list of "what Word pastes" - most of that (quotes, dashes, the ellipsis) is in WinAnsi and in
 * every normal font, so it never reaches rule 3. Entries earn their place by being measured, not
 * guessed: each one is a code point seen missing from a real embedded font.
 */
const EQUIVALENTS: Record<number, string> = {
  0x2010: "-", // hyphen
  0x2011: "-", // non-breaking hyphen - the one that turns E‑Rechnung into ERechnung
  0x2012: "-", // figure dash
  0x2015: "-", // horizontal bar
  0x2007: " ", // figure space
  0x2008: " ", // punctuation space
  0x2009: " ", // thin space
  0x200a: " ", // hair space
  0x202f: " ", // narrow no-break space
  0x2032: "'", // prime
  0x2033: '"', // double prime
  0x02bc: "'", // modifier letter apostrophe
};

export interface CoverageResult {
  /** The text as it can actually be drawn. */
  text: string;
  /** Code points that had to go - empty for every document that never hits this. */
  dropped: number[];
}

/**
 * Replaces or removes what `fontFamily` cannot draw. Returns the input unchanged (and no allocation
 * beyond the scan) when everything is drawable, which is the overwhelmingly common case.
 */
export function coverText(
  text: string,
  fontFamily: string,
  fontStyle: FontStyle,
  metrics: FontMetrics,
): CoverageResult {
  let out: string | null = null; // built only once something has to change
  const dropped: number[] = [];
  let index = 0;

  for (const char of text) {
    const cp = char.codePointAt(0)!;
    // A space and a line break are handled by the breaker, never drawn as a glyph.
    const drawable =
      cp === 0x20 ||
      cp === 0x0a ||
      metrics.hasGlyph(cp, fontFamily, fontStyle) ||
      // Colour emoji is drawn from a fallback font or an image, NOT from the text font - it is missing
      // there by design, and removing it would delete the very thing `Document({ emoji })` exists for.
      metrics.rendersAsEmoji?.(cp, fontFamily, fontStyle) === true;
    if (!drawable) {
      if (out === null) out = text.slice(0, index);
      const equivalent = EQUIVALENTS[cp];
      if (
        equivalent !== undefined &&
        metrics.hasGlyph(equivalent.codePointAt(0)!, fontFamily, fontStyle)
      ) {
        out += equivalent;
      } else {
        dropped.push(cp);
      }
    } else if (out !== null) {
      out += char;
    }
    index += char.length;
  }

  return out === null ? { text, dropped } : { text: out, dropped };
}

/** `U+2713` - how a dropped code point is named to the caller. */
export function formatCodePoint(cp: number): string {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
}
