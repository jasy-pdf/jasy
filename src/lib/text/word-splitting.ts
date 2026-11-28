import type { FontStyle } from "../common/font-style.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";
import { runAdvance, SOFT_HYPHEN } from "./advance.ts";

/**
 * How a word may break inside itself, beyond its own hyphens and soft hyphens. Two layers, stacked as CSS
 * stacks them:
 *
 *   1. HYPHENATION (`hyphens: auto`): the hyphenator's points are break opportunities at the line's end,
 *      taken only when the word does not fit there, with a hyphen drawn at the break. It needs language
 *      knowledge, which is why it is PLUGGABLE - no pattern data in this package.
 *   2. BREAK-WORD (`overflow-wrap: break-word`) is the floor for a word the box cannot hold: split
 *      wherever the box ends, no hyphen. An e-mail address, an IBAN, an invoice number.
 */

/** Splits one word into its hyphenation points, e.g. `["Rechts", "schutz", "ver", "siche", ...]`. */
export type Hyphenator = (word: string) => string[];

export interface WordSplitting {
  /** Language-aware break points, with a hyphen at the break. Supply `hyphen`, `hyphenopoly`, your own. */
  hyphenate?: Hyphenator;
  /** Split anywhere as a last resort, without a hyphen. CSS `overflow-wrap: break-word`. */
  breakWord?: boolean;
}

/** The hyphen actually drawn at a hyphenation break. U+002D, in every font we can encode. */
export const HYPHEN = "-";

/** One piece of a split word. `source`: how many characters of the word it covers, which is where the
 *  next piece starts. */
export interface WordPiece {
  text: string;
  source: number;
}

/**
 * Splits `word` into pieces that each fit within `room`, anywhere (break-word). Returns null when the
 * word fits anyway, or cannot be split further.
 *
 * Every piece but the last is a finished line. The last is what carries on, so the caller keeps
 * filling it as usual. A piece says how much of the source it covers: a split paragraph needs that to
 * find where the next line starts, and the drawn text cannot tell (a soft hyphen in the word).
 */
export function splitLongWord(
  word: string,
  room: number,
  font: { fontFamily: string; fontSize: number; fontStyle: FontStyle },
  metrics: FontMetrics,
  letterSpacing: number,
): WordPiece[] | null {
  if (room <= 0) return null;
  const width = (s: string) => runAdvance(metrics, s, font, letterSpacing);
  if (width(word) <= room) return null;

  const pieces: WordPiece[] = [];
  let rest = word; // what is drawn
  let restSource = word; // the same text as it stands in the source

  // Bounded by construction: every pass either emits a piece and shortens `rest`, or gives up.
  while (width(rest) > room) {
    const head = longestPrefix(rest, room, width);
    // One character is all that is left: leave it and let it overflow.
    if (head === null) break;
    const source = sourceLength(restSource, head.taken);
    if (source === null) break;
    pieces.push({ text: head.text, source });
    rest = head.rest;
    restSource = restSource.slice(source);
  }

  if (pieces.length === 0) return null;
  return [...pieces, { text: rest, source: restSource.length }];
}

/**
 * How many characters of `source` the drawn `prefix` covers, with a soft hyphen at the break. A
 * hyphenator may drop the soft hyphens already in the text (the `hyphen` package does), so they are
 * skipped; anything else that does not match is null.
 */
export function sourceLength(source: string, prefix: string): number | null {
  let i = 0;
  for (const char of prefix) {
    while (source[i] === SOFT_HYPHEN && char !== SOFT_HYPHEN) i++;
    if (!source.startsWith(char, i)) return null;
    i += char.length;
  }
  while (source[i] === SOFT_HYPHEN) i++;
  return i;
}

/** The longest prefix that fits, split anywhere. Code points, so an astral character stays whole. */
function longestPrefix(
  word: string,
  room: number,
  width: (s: string) => number,
): { text: string; taken: string; rest: string } | null {
  const chars = [...word];
  let taken = "";
  let count = 0;
  for (const char of chars) {
    if (width(taken + char) > room) break;
    taken += char;
    count += 1;
  }
  if (count === chars.length) return null;
  // Not even one character fits - the box is narrower than a glyph: one character per line, as CSS
  // `overflow-wrap` sets it. Each pass still takes one, so the loop ends.
  if (count === 0) {
    if (chars.length === 1) return null;
    taken = chars[0]!;
    count = 1;
  }
  return { text: taken, taken, rest: chars.slice(count).join("") };
}
