import type { FontStyle } from "../utils/pdf-object-manager.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";
import { runAdvance } from "./advance.ts";

/**
 * What to do with a word that is wider than the box it has to fit in.
 *
 * Until now: nothing. It stayed on its line and drew straight over whatever was beside it - which on an
 * invoice means a mandatory field (§14 UStG) painted across its own label. CSS overflows too, so this
 * was never a bug; it was a missing feature, and it is the one that bites in German.
 *
 * Two layers, and they are NOT alternatives - CSS stacks them the same way:
 *
 *   1. HYPHENATION splits a word at a linguistically valid point and marks it with a hyphen:
 *      `Rechtsschutzver-` / `sicherungsgesellschaften`. It needs language knowledge, which is why it is
 *      PLUGGABLE rather than bundled - no pattern data in this package, no licence question, nothing
 *      added to a bundle that never asks for it.
 *   2. BREAK-WORD is the floor: split wherever the box ends, no hyphen. It is what handles the things
 *      hyphenation cannot touch - an e-mail address, an IBAN, an invoice number. Those are single
 *      "words" with no valid point anywhere, and they are exactly what an invoice is full of.
 *
 * With both on, hyphenation is tried first and break-word catches what it cannot split.
 */

/** Splits one word into its hyphenation points, e.g. `["Rechts", "schutz", "ver", "siche", ...]`. */
export type Hyphenator = (word: string) => string[];

export interface WordSplitting {
  /** Language-aware splitting, with a hyphen at the break. Supply `hyphen`, `hyphenopoly`, your own. */
  hyphenate?: Hyphenator;
  /** Split anywhere as a last resort, without a hyphen. CSS `overflow-wrap: break-word`. */
  breakWord?: boolean;
}

/** The hyphen actually drawn at a hyphenation break. U+002D, in every font we can encode. */
export const HYPHEN = "-";

/**
 * One piece of a split word. `hyphen`: a hyphen was added at the break - it is not in the source.
 * `source`: how many characters of the word the piece covers, which is where the next piece starts.
 */
export interface WordPiece {
  text: string;
  hyphen: boolean;
  source: number;
}

/**
 * Splits `word` into pieces that each fit within `room`. Returns null when nothing applies - no
 * splitting configured, or the word fits anyway - and the caller keeps its current behaviour, so a
 * document that asks for neither is untouched.
 *
 * Every piece but the last is a finished line. The last is what carries on, so the caller keeps
 * filling it as usual. A piece says how much of the source it covers: a split paragraph needs that to
 * find where the next line starts, and the drawn text cannot tell (an added hyphen, a soft hyphen the
 * hyphenator dropped).
 */
export function splitLongWord(
  word: string,
  room: number,
  font: { fontFamily: string; fontSize: number; fontStyle: FontStyle },
  metrics: FontMetrics,
  letterSpacing: number,
  options: WordSplitting,
): WordPiece[] | null {
  const { hyphenate, breakWord } = options;
  if (!hyphenate && !breakWord) return null;
  if (room <= 0) return null;
  if (runAdvance(metrics, word, font, letterSpacing) <= room) return null;

  const width = (s: string) => runAdvance(metrics, s, font, letterSpacing);
  const pieces: WordPiece[] = [];
  let rest = word; // what is drawn
  let restSource = word; // the same text as it stands in the source

  // Bounded by construction: every pass either emits a piece and shortens `rest`, or gives up.
  while (width(rest) > room) {
    // The layering: a linguistically valid split if one is offered and reaches far enough, otherwise
    // the blunt one - which is what an e-mail address or an IBAN needs, having no valid point at all.
    const head =
      (hyphenate ? longestHyphenatedPrefix(rest, room, width, hyphenate) : null) ??
      (breakWord ? longestPrefix(rest, room, width) : null);
    // Nothing fits - not even one character, or hyphenation found nothing and break-word is off.
    // Leave the remainder whole and let it overflow, exactly as before.
    if (head === null) break;
    // A hyphenator that returns text other than the word is not splitting it: leave it whole.
    const source = sourceLength(restSource, head.taken);
    if (source === null) break;
    pieces.push({ text: head.text, hyphen: head.hyphen, source });
    rest = head.rest;
    restSource = restSource.slice(source);
  }

  if (pieces.length === 0) return null;
  return [...pieces, { text: rest, hyphen: false, source: restSource.length }];
}

const SOFT_HYPHEN = "\u00AD";

/**
 * How many characters of `source` the drawn `prefix` covers, with a soft hyphen at the break. A
 * hyphenator may drop the soft hyphens already in the text (the `hyphen` package does), so they are
 * skipped; anything else that does not match is null.
 */
function sourceLength(source: string, prefix: string): number | null {
  let i = 0;
  for (const char of prefix) {
    while (source[i] === SOFT_HYPHEN && char !== SOFT_HYPHEN) i++;
    if (!source.startsWith(char, i)) return null;
    i += char.length;
  }
  while (source[i] === SOFT_HYPHEN) i++;
  return i;
}

/** The longest prefix that fits, plus a hyphen - split only where the hyphenator allows. */
function longestHyphenatedPrefix(
  word: string,
  room: number,
  width: (s: string) => number,
  hyphenate: Hyphenator,
): { text: string; taken: string; rest: string; hyphen: boolean } | null {
  const parts = hyphenate(word);
  if (parts.length < 2) return null;

  let taken = "";
  let best: { text: string; taken: string; rest: string; hyphen: boolean } | null = null;
  for (let i = 0; i < parts.length - 1; i++) {
    taken += parts[i];
    // The hyphen has to fit too, or the line it lands on overflows by exactly that hyphen.
    if (width(taken + HYPHEN) > room) break;
    best = { text: taken + HYPHEN, taken, rest: parts.slice(i + 1).join(""), hyphen: true };
  }
  return best;
}

/** The longest prefix that fits, split anywhere. Code points, so an astral character stays whole. */
function longestPrefix(
  word: string,
  room: number,
  width: (s: string) => number,
): { text: string; taken: string; rest: string; hyphen: boolean } | null {
  const chars = [...word];
  let taken = "";
  let count = 0;
  for (const char of chars) {
    if (width(taken + char) > room) break;
    taken += char;
    count += 1;
  }
  // Not even one character fits: the box is narrower than a single glyph. Splitting cannot help, and
  // looping on it would never terminate.
  if (count === 0 || count === chars.length) return null;
  return { text: taken, taken, rest: chars.slice(count).join(""), hyphen: false };
}
