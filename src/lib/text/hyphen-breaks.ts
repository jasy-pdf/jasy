import { SOFT_HYPHEN } from "./advance.ts";
import { HYPHEN } from "./word-splitting.ts";

// Where a word MAY break inside itself - pure text rules, no font and no line. Filling lines is
// `line-breaker.ts`; this only answers which offsets are allowed.

export const NO_BREAKS: readonly number[] = [];

/** Whether a word holds anything it may break after: a hyphen or a soft hyphen. */
export const mayBreak = (word: string): boolean => word.includes("-") || word.includes(SOFT_HYPHEN);

/**
 * Where a word may break, as offsets into it - after a hyphen (U+002D) as UAX #14 has it: never before
 * it, never before a digit ("CODE-2", "2026-10-16", "-5" stay whole), never after one that starts the
 * word; and after a soft hyphen (U+00AD), the break its author marked.
 */
export function hyphenBreaks(word: string): number[] {
  const out: number[] = [];
  for (let i = 1; i < word.length - 1; i++) {
    const next = word[i + 1]!;
    if (NO_BREAK_BEFORE.has(next)) continue;
    if (word[i] === SOFT_HYPHEN) {
      out.push(i + 1);
      continue;
    }
    if (word[i] !== "-") continue;
    if (next === "-" || (next >= "0" && next <= "9")) continue;
    out.push(i + 1);
  }
  return out;
}

// UAX #14 never breaks before closing punctuation, a slash or a quote (LB13, LB19): "Lohn-, Gehalts-",
// "(well-known)", "Ein-/Ausgang" stay together.
const NO_BREAK_BEFORE = new Set(")]}!?,.:;/\"'«»‘’“”");

/**
 * What the line ending at break `k` draws of `word`: everything before it, and at a soft hyphen a REAL
 * hyphen in its place - the only time a soft hyphen shows. The breaker draws this; measuring it measures
 * what is drawn.
 */
export function headAt(word: string, k: number): string {
  if (word[k - 1] !== SOFT_HYPHEN) return word.slice(0, k);
  // A soft hyphen right after a real one adds nothing: "ab-" + "cd", not "ab--".
  return word[k - 2] === "-" ? word.slice(0, k - 1) : word.slice(0, k - 1) + HYPHEN;
}

/** A word cut at its break opportunities: the pieces no line can split, as they are drawn. */
export function hyphenPieces(word: string): string[] {
  const breaks = mayBreak(word) ? hyphenBreaks(word) : NO_BREAKS;
  if (breaks.length === 0) return [word];
  return [0, ...breaks].map((from, k) => {
    const to = breaks[k];
    return to === undefined ? word.slice(from) : headAt(word, to).slice(from);
  });
}
