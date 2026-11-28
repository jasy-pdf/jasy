import type { TextSegment } from "../elements/text-element.ts";
import { SOFT_HYPHEN, withoutSoftHyphens } from "./advance.ts";
import { NO_BREAKS } from "./hyphen-breaks.ts";
import { sourceLength, type Hyphenator } from "./word-splitting.ts";

// Where a hyphenator lets a word break - pure text, no font and no line. Filling lines with these points
// is `line-breaker.ts`.

// Per hyphenator, per word: a paragraph is broken several times (measure, fragment, draw), and the same
// word recurs. Bounded, as a server renders without end.
const pointsCache = new WeakMap<Hyphenator, Map<string, readonly number[]>>();
const CACHE_LIMIT = 50_000;

/**
 * Where `hyphenate` allows `word` to break, as offsets into it (after the character before each). The
 * hyphenator sees the word without its soft hyphens; one that returns other text than the word is not
 * splitting it and offers nothing.
 */
export function hyphenationPoints(word: string, hyphenate: Hyphenator): readonly number[] {
  let byWord = pointsCache.get(hyphenate);
  if (!byWord) pointsCache.set(hyphenate, (byWord = new Map()));
  let points = byWord.get(word);
  if (points === undefined) {
    if (byWord.size >= CACHE_LIMIT) byWord.clear();
    points = pointsOf(word, hyphenate);
    byWord.set(word, points);
  }
  return points;
}

function pointsOf(word: string, hyphenate: Hyphenator): readonly number[] {
  const parts = hyphenate(withoutSoftHyphens(word));
  if (parts.length < 2) return [];
  const out: number[] = [];
  let at = 0;
  for (const part of parts) {
    const n = sourceLength(word.slice(at), part);
    if (n === null) return [];
    at += n;
    out.push(at);
  }
  if (at !== word.length) return [];
  return out.slice(0, -1).filter((k) => k > 0);
}

/** Where the hyphenators of a paragraph's spans let its words break. */
export interface SpanHyphenation {
  /** Whether any span has a hyphenator: without one, the breaker never asks. */
  active: boolean;
  /** The points inside `length` characters of span `segment` from `from`, as offsets into that piece. */
  within(segment: number, from: number, length: number): readonly number[];
  /** Whether the break between offset - 1 and offset of span `segment` is a point - at a span's end, the
   *  word continuing in the next. */
  at(segment: number, offset: number): boolean;
}

const NONE: SpanHyphenation = { active: false, within: () => NO_BREAKS, at: () => false };
const isGap = (c: string | undefined) => c === undefined || c === " " || c === "\n";

/**
 * A word may run across spans (`span("Rech") + span("nung")`), so the points come from the WHOLE word,
 * and a point is allowed by the span of the character before it, as Chrome has it. Asked lazily, for a
 * word that does not fit, and kept per word.
 */
export function spanHyphenation(
  segments: TextSegment[],
  hyphenateOf: (segment: number) => Hyphenator | undefined,
): SpanHyphenation {
  let active = false;
  for (let i = 0; i < segments.length && !active; i++) active = hyphenateOf(i) !== undefined;
  if (!active) return NONE;
  const hyphenators = segments.map((_, i) => hyphenateOf(i));
  // The joined text is built on the first question, which only a word that does not fit asks.
  const starts: number[] = [];
  let text = "";
  const setUp = (): void => {
    if (starts.length > 0) return;
    for (const seg of segments) {
      starts.push(text.length);
      text += seg.content;
    }
  };
  // The span a character of the joined text belongs to.
  const owner = (p: number): number => {
    let i = segments.length - 1;
    while (i > 0 && starts[i]! > p) i--;
    return i;
  };
  const byWord = new Map<number, ReadonlySet<number>>();
  // The points of the word around character `p`, as positions in the joined text.
  const pointsAround = (p: number): ReadonlySet<number> => {
    let from = p;
    while (!isGap(text[from - 1])) from--;
    const known = byWord.get(from);
    if (known) return known;
    let to = p;
    while (!isGap(text[to])) to++;
    const word = text.slice(from, to);
    const out = new Set<number>();
    for (const hyphenate of new Set(hyphenators.slice(owner(from), owner(to - 1) + 1))) {
      if (!hyphenate) continue;
      for (const k of hyphenationPoints(word, hyphenate)) {
        const before = word[k - 1];
        // After a hyphen or a soft hyphen the word already breaks, without a hyphen added.
        if (before === "-" || before === SOFT_HYPHEN) continue;
        if (hyphenators[owner(from + k - 1)] === hyphenate) out.add(from + k);
      }
    }
    byWord.set(from, out);
    return out;
  };
  return {
    active: true,
    within(segment, from, length) {
      if (length < 2) return NO_BREAKS;
      setUp();
      const g = starts[segment]! + from;
      const points = [...pointsAround(g)].map((p) => p - g).filter((k) => k > 0 && k < length);
      return points.length === 0 ? NO_BREAKS : points.sort((a, b) => a - b);
    },
    at(segment, offset) {
      setUp();
      const g = starts[segment]! + offset;
      if (isGap(text[g - 1]) || isGap(text[g])) return false;
      return pointsAround(g - 1).has(g);
    },
  };
}
