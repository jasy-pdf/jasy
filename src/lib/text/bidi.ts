import bidiFactory from "bidi-js";

/**
 * Bidirectional text (UAX #9): one logical line in, the runs to draw left to right out. ORDERING
 * only - joining letters into shapes is `text/shape.ts`.
 *
 * The whole seam to `bidi-js`: nothing outside this file knows it exists, so replacing it with our
 * own is a change here alone (`todo.md`).
 */

const bidi = bidiFactory();

export type Direction = "ltr" | "rtl";

/** A piece of a line, already in the order it is drawn. */
export interface VisualRun {
  /** VISUAL order: hand it to the drawing code as it stands, left to right. */
  text: string;
  /**
   * The same characters in LOGICAL order. SHAPING must use this: a letter's form comes from its
   * neighbours, and reversing swaps them - shaping the visual text gives every letter the wrong form
   * (measured: a word 8pt too wide). Shape this, then reverse the GLYPHS.
   */
  logical: string;
  /** True when this run came out of right-to-left text - the caller may need it for alignment. */
  rtl: boolean;
}

/** A run that remembers which input piece it came from, so a span keeps its font and colour. */
export interface AttributedRun<T> extends VisualRun {
  source: T;
}

// Every block whose script runs right to left, plus the explicit bidi control characters. Used only
// as a fast path: no match and a left-to-right base means the algorithm cannot reorder anything.
const RTL_OR_CONTROL =
  /[\u0590-\u08FF\u200F\u202B\u202E\u2067\uFB1D-\uFDFF\uFE70-\uFEFF]|[\uD802\uD803\uD83A\uD83B][\uDC00-\uDFFF]/;

/** Whether this text could be reordered at all. Cheap, and false for every Latin-only document. */
export const needsBidi = (text: string): boolean => RTL_OR_CONTROL.test(text);

const isHighSurrogate = (c: string): boolean => c >= "\uD800" && c <= "\uDBFF";
const isLowSurrogate = (c: string): boolean => c >= "\uDC00" && c <= "\uDFFF";

/**
 * Reorder one LINE of pieces into the runs to draw. The algorithm runs over the pieces JOINED, not
 * each on its own, or a Hebrew span beside a Latin one would stay in source order. A run ends where
 * the direction or the source piece changes.
 *
 * Line breaking happens before this, in logical order - what UAX #9 prescribes.
 */
export function visualRunsOf<T>(
  pieces: { text: string; source: T }[],
  base: Direction = "ltr",
): AttributedRun<T>[] {
  const text = pieces.map((p) => p.text).join("");
  // Verbatim - same count, same order, empty pieces included - so untouched documents stay
  // byte-identical.
  if (text === "" || (base === "ltr" && !needsBidi(text))) {
    return pieces.map((p) => ({ ...p, logical: p.text, rtl: false }));
  }

  // Which piece each code unit came from, so a visual run can be traced back to its span.
  const owner = new Int32Array(text.length);
  let at = 0;
  pieces.forEach((piece, index) => {
    owner.fill(index, at, at + piece.text.length);
    at += piece.text.length;
  });

  const levels = bidi.getEmbeddingLevels(text, base);
  const order = bidi.getReorderedIndices(text, levels);
  // `.levels`, NOT the result object the library's README passes: it indexes its argument directly,
  // and given the object it silently returns an empty map - no bracket ever mirrored.
  const mirrored = bidi.getMirroredCharactersMap(text, levels.levels);

  const runs: AttributedRun<T>[] = [];
  let current: string[] = [];
  let currentRtl = false;
  let currentOwner = -1;

  const flush = (): void => {
    if (current.length > 0) {
      const text = current.join("");
      runs.push({
        text,
        logical: currentRtl ? [...text].reverse().join("") : text,
        rtl: currentRtl,
        source: pieces[currentOwner].source,
      });
      current = [];
    }
  };

  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const rtl = (levels.levels[i] & 1) === 1;
    if (rtl !== currentRtl || owner[i] !== currentOwner) flush();
    currentRtl = rtl;
    currentOwner = owner[i];

    // A surrogate pair is two code units at one level, so reversing splits an astral character (an
    // emoji in Hebrew text) into two broken halves. They arrive adjacent and swapped.
    const next = k + 1 < order.length ? order[k + 1] : -1;
    if (isLowSurrogate(text[i]) && next === i - 1 && isHighSurrogate(text[next])) {
      current.push(text[next], text[i]);
      k++;
      continue;
    }
    current.push(mirrored.get(i) ?? text[i]);
  }
  flush();
  return runs;
}

/** The same for one plain string. An empty string still yields one run, or a blank line would vanish. */
export const visualRuns = (text: string, base: Direction = "ltr"): VisualRun[] => {
  if (text === "") return [{ text, logical: text, rtl: false }];
  return visualRunsOf([{ text, source: null }], base).map(({ text: t, logical, rtl }) => ({
    text: t,
    logical,
    rtl,
  }));
};
