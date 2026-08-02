import bidiFactory from "bidi-js";

/**
 * Bidirectional text: turning ONE logical line into the runs that get drawn, left to right.
 *
 * This module is the whole seam. `bidi-js` implements UAX #9 (the Unicode Bidirectional Algorithm)
 * and nothing outside this file knows it exists, so replacing it with our own implementation later
 * is a change to this file alone - see the `todo.md` item.
 *
 * ORDERING only. Arabic additionally needs SHAPING (letters change form by position and join into
 * ligatures), which is a separate piece of work and not done here.
 */

const bidi = bidiFactory();

export type Direction = "ltr" | "rtl";

/** A piece of a line, already in the order it is drawn. */
export interface VisualRun {
  /** VISUAL order: hand it to the drawing code as it stands, left to right. */
  text: string;
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
 * Reorder one LINE of pieces into the runs to draw, left to right. The pieces are laid end to end and
 * the algorithm runs over the WHOLE line, which is what makes a Hebrew span next to a Latin one come
 * out in the right order rather than each being reordered inside itself.
 *
 * A run ends where the direction changes OR where the source piece does, so every returned run has
 * exactly one direction and exactly one origin.
 *
 * Breaking into lines happens BEFORE this, in logical order - what UAX #9 prescribes, since the
 * algorithm runs per finished line.
 */
export function visualRunsOf<T>(
  pieces: { text: string; source: T }[],
  base: Direction = "ltr",
): AttributedRun<T>[] {
  const text = pieces.map((p) => p.text).join("");
  // The fast path hands the pieces back VERBATIM - same count, same order, empty ones included - so a
  // caller that draws run by run produces exactly the bytes it did before bidi existed.
  if (text === "" || (base === "ltr" && !needsBidi(text))) {
    return pieces.map((p) => ({ ...p, rtl: false }));
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
  // `.levels`, NOT the result object: the function indexes its argument directly, while the library's
  // README shows the object. Passed the object it silently returns an EMPTY map and no bracket is ever
  // mirrored - which looks like working code right up to the moment someone reads the output.
  const mirrored = bidi.getMirroredCharactersMap(text, levels.levels);

  const runs: AttributedRun<T>[] = [];
  let current: string[] = [];
  let currentRtl = false;
  let currentOwner = -1;

  const flush = (): void => {
    if (current.length > 0) {
      runs.push({ text: current.join(""), rtl: currentRtl, source: pieces[currentOwner].source });
      current = [];
    }
  };

  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const rtl = (levels.levels[i] & 1) === 1;
    if (rtl !== currentRtl || owner[i] !== currentOwner) flush();
    currentRtl = rtl;
    currentOwner = owner[i];

    // A surrogate PAIR is two code units at the same level, so reversing a run splits it and the
    // astral character (an emoji in Hebrew text, say) turns into two broken halves. They arrive
    // adjacent and swapped, so putting them back is local.
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

/**
 * The same for one plain string. An EMPTY string still yields one (empty) run: a caller drawing line
 * by line would otherwise skip a blank line entirely, which is a different document.
 */
export const visualRuns = (text: string, base: Direction = "ltr"): VisualRun[] => {
  if (text === "") return [{ text, rtl: false }];
  return visualRunsOf([{ text, source: null }], base).map(({ text: t, rtl }) => ({ text: t, rtl }));
};
