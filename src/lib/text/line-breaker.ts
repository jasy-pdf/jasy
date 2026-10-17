import type { FontStyle } from "../utils/pdf-object-manager.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";
import type { TextSegment } from "../elements/text-element.ts";
import { runAdvance, type RunFont, SOFT_HYPHEN, withoutSoftHyphens } from "./advance.ts";
import { HYPHEN, splitLongWord, type WordSplitting } from "./word-splitting.ts";
import { headAt, hyphenBreaks, mayBreak, NO_BREAKS } from "./hyphen-breaks.ts";

/**
 * How far a JUSTIFIED line's spaces may be squeezed to keep one more word on it.
 *
 * A quarter, because our breaker is GREEDY: it will use the whole allowance every time that saves a
 * line, so the limit has to be the tightest word space still worth reading - about three quarters of
 * natural, the usual typographic floor. TeX allows a third, but its badness model rarely spends it.
 * For reference, react-pdf reaches -19% in practice (measured: a 3.18pt space squeezed to 2.58pt),
 * which this covers. Its packing can still differ by a word, because it spreads the squeeze over the
 * CHARACTERS as well as the spaces.
 *
 * Only justified text uses it: under any other alignment a squeezed line would simply overflow.
 */
export const MAX_SPACE_SHRINK = 1 / 4;

/** The knobs that change where a line ENDS, beyond the font and the box. */
export interface LineOptions {
  /** Extra advance at every space (CSS `word-spacing`), in points. */
  wordSpacing?: number;
  /** How far the FIRST line starts in (CSS `text-indent`), in points - it has that much less room. */
  indent?: number;
  /** How far a justified line's spaces may be squeezed to keep one more word (0 = not justified). */
  shrink?: number;
  /** How a word wider than its box is split - hyphenation, break-word, or neither (the default). */
  splitting?: WordSplitting;
  /** Whether the run gets the font's ligatures. Changes which glyphs are drawn, hence the width. */
  ligatures?: boolean;
  /** Only the first N lines belong to this element: a paragraph split across pages, continued on the
   *  next one. Applied after `maxLines`, so every pass that breaks the text sees the same lines. */
  shownLines?: number;
}

/** What a span that does not set its own draws with: the paragraph's font and spacing. */
export interface RunDefaults {
  fontFamily: string;
  fontSize: number;
  fontStyle: FontStyle;
  /** Extra space after every glyph, in points; a segment may override it. Default 0. */
  letterSpacing?: number;
}

/** Everything the breaker reads besides the spans: what they inherit, and how lines end. */
export type SegmentDefaults = RunDefaults & LineOptions;

/** How one span is measured, broken and drawn. */
export interface RunStyle {
  font: RunFont;
  letterSpacing: number;
  wordSpacing: number;
  splitting: WordSplitting;
}

/**
 * A span's run style: what it sets itself, else what the paragraph sets. The ONE place a span inherits
 * it, so breaking, drawing and the element's own sizing ask the same question.
 */
export function runStyleOf(seg: TextSegment, defaults: SegmentDefaults): RunStyle {
  return {
    font: {
      fontFamily: seg.fontFamily || defaults.fontFamily,
      fontSize: seg.fontSize || defaults.fontSize,
      fontStyle: seg.fontStyle || defaults.fontStyle,
      ligatures: seg.ligatures ?? defaults.ligatures,
    },
    letterSpacing: seg.letterSpacing ?? defaults.letterSpacing ?? 0,
    wordSpacing: seg.wordSpacing ?? defaults.wordSpacing ?? 0,
    splitting: {
      breakWord: seg.breakWord ?? defaults.splitting?.breakWord,
      hyphenate: seg.hyphenate ?? defaults.splitting?.hyphenate,
    },
  };
}

/** What happens to text beyond `maxLines`: `"clip"` drops it, `"ellipsis"` ends the last kept line
 *  with an ellipsis. Mirrors Flutter's `TextOverflow`. */
export type TextOverflow = "clip" | "ellipsis";

/** Three ASCII dots, NOT the "…" glyph (U+2026): plain dots encode in every font - standard-14
 *  (WinAnsi) and any embedded TTF - whereas U+2026 needs a glyph the font may not carry. */
const ELLIPSIS = "...";

/** The spaces that end a line: they hang past its edge, neither drawn nor in its width. */
const TRAILING_SPACES = / +$/;

/** One laid-out line of segments. How TALL it is does not live here: the breaker owns the horizontal
 *  half, `text/line-metrics.ts` owns the vertical one and derives the box from the fonts on the line. */
export interface SegmentLine {
  segments: TextSegment[];
  width: number; // sum of word widths incl. spaces, used for alignment
  /** Where the line begins in the source: the span, and the offset in that span's content. */
  start: SegmentPosition;
  end: LineEnd;
}

export interface SegmentPosition {
  segment: number;
  offset: number;
}

/**
 * The width of `text` set as ONE line, accumulated in EXACTLY the order the breaker builds a line: the
 * first word, then `+ (space + word)` each time. The order matters because floating-point
 * addition is not associative - a box sized by a differently-grouped sum can be one bit too small for
 * the very line the breaker then measures, and the text wraps inside a box made to fit it. That is not
 * hypothetical: it is what split a footer sized to its own content.
 */
export function singleLineWidth(
  text: string,
  font: RunFont,
  metrics: FontMetrics,
  letterSpacing = 0,
  wordSpacing = 0,
): number {
  // A hard break makes this several lines; the natural width is the widest of them.
  if (text.includes("\n"))
    return Math.max(
      ...text.split("\n").map((p) => singleLineWidth(p, font, metrics, letterSpacing, wordSpacing)),
    );
  const space = runAdvance(metrics, " ", font, letterSpacing) + wordSpacing;
  return text
    .split(" ")
    .reduce(
      (width, word, i) =>
        i === 0
          ? runAdvance(metrics, word, font, letterSpacing)
          : width + (space + runAdvance(metrics, word, font, letterSpacing)),
      0,
    );
}

export function wrapStringIntoLines(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontStyle: FontStyle,
  maxWidth: number,
  metrics: FontMetrics,
  maxLines?: number,
  overflow?: TextOverflow,
  letterSpacing = 0,
  options: LineOptions = {},
): string[] {
  return breakStringIntoLines(
    text,
    fontFamily,
    fontSize,
    fontStyle,
    maxWidth,
    metrics,
    maxLines,
    overflow,
    letterSpacing,
    options,
  ).map((line) => line.text);
}

/** How a line ends - which is what justification and splitting a paragraph across pages need. */
export type LineEnd =
  | "soft" // broken at a space
  | "hard" // a `\n`
  | "split" // inside a word, nothing added (break-word)
  | "hyphen" // inside a word, a hyphen added (hyphenation)
  | "end"; // the end of the text

/** A broken line, and where it came from: `start` is the offset in the source text it begins at. */
export interface BrokenLine {
  text: string;
  start: number;
  end: LineEnd;
}

/** How a line that ends at break `k` of `word` ends: a soft hyphen adds a hyphen the source lacks. */
const endAt = (word: string, k: number): LineEnd =>
  word[k - 1] === SOFT_HYPHEN && word[k - 2] !== "-" ? "hyphen" : "soft";

/**
 * `wrapStringIntoLines`, with each line's source offset and ending. The ONE breaking pass both share,
 * so a line's position in the source can never disagree with the line itself.
 */
export function breakStringIntoLines(
  text: string,
  fontFamily: string,
  fontSize: number,
  fontStyle: FontStyle,
  maxWidth: number,
  metrics: FontMetrics,
  maxLines?: number,
  overflow?: TextOverflow,
  letterSpacing = 0,
  options: LineOptions = {},
): BrokenLine[] {
  // A string is one span: same breaker, same lines.
  return breakSegmentsIntoLines(
    [{ content: text }],
    { fontFamily, fontSize, fontStyle, letterSpacing, ...options },
    maxWidth,
    metrics,
    maxLines,
    overflow,
  ).map((line) => ({
    text: line.segments.map((segment) => segment.content).join(""),
    start: line.start.offset,
    end: line.end,
  }));
}

/**
 * Break text - spans; a plain string is one - into lines that fit within `maxWidth`, greedily: a word
 * stays on the current line unless it would overflow. Each line keeps the segments that landed on it,
 * which is what `line-metrics.ts` derives the line's height from. The one breaker: measuring,
 * fragmenting and drawing all call this.
 */
export function breakSegmentsIntoLines(
  segments: TextSegment[],
  defaults: SegmentDefaults,
  maxWidth: number,
  metrics: FontMetrics,
  maxLines?: number,
  overflow?: TextOverflow,
): SegmentLine[] {
  const lines: SegmentLine[] = [];
  const { indent = 0, shrink = 0 } = defaults;
  let width = 0;
  // The spaces on the line, summed - what a justified line can squeeze. Summed, not counted: each space
  // is as wide as its own span makes it.
  let gapWidth = 0;
  let lineSegments: TextSegment[] = [];
  let combined = "";
  let lineStart: SegmentPosition = { segment: 0, offset: 0 }; // where the current line begins
  // Whether the line holds a word yet - an empty one too: a space is text as written, so a leading one
  // and both of a double space count.
  let open = false;
  // Whether anything DRAWN is on the line. Only then does a word that does not fit start a new one:
  // a line of spaces alone is empty, and closing it would push a blank line before the word.
  let inked = false;
  let ink = 0; // the line's width up to its last drawn glyph - the spaces after it hang
  // A space that did not fit was not added (it hangs), so the line's text no longer shows that it ends
  // in a break opportunity - this does.
  let hung = false;
  // An empty piece (what a span leaves after its `\n`) has nothing to draw, and its font must not size
  // the line it lands on - a big span ending in `\n` made the next line as tall as itself. Only a blank
  // line keeps one: it is what gives that line its height.
  const close = (segs: TextSegment[], lineWidth: number, end: LineEnd, glued = false) => {
    let width = lineWidth;
    let ends = end;
    // A span boundary is a break too: a line that ends there right after a soft hyphen shows it as a real
    // hyphen, exactly as a break inside a word does. Only when `glued` - the next piece follows with no
    // space between; a line that breaks at a space ends there, and the soft hyphen stays invisible.
    let lastIndex = segs.length - 1;
    while (lastIndex >= 0 && segs[lastIndex]!.content === "") lastIndex--;
    const last = segs[lastIndex];
    if (
      glued &&
      last?.content.endsWith(SOFT_HYPHEN) &&
      !withoutSoftHyphens(last.content).endsWith("-")
    ) {
      const run = runStyleOf(last, defaults);
      width += runAdvance(metrics, HYPHEN, run.font, run.letterSpacing);
      segs = segs.map((seg, i) =>
        i === lastIndex ? { ...seg, content: withoutSoftHyphens(seg.content) + HYPHEN } : seg,
      );
      ends = "hyphen";
    }
    // The spaces the line ends in hang: not drawn, and `width` (the ink) already stops before them.
    for (let i = segs.length - 1; i >= 0; i--) {
      const kept = segs[i]!.content.replace(TRAILING_SPACES, "");
      if (kept !== segs[i]!.content)
        segs = segs.map((seg, j) => (j === i ? { ...seg, content: kept } : seg));
      if (kept !== "") break;
    }
    // Soft hyphens leave the line here - a blank line's piece included.
    const stripped = segs.map((seg) =>
      seg.content.includes(SOFT_HYPHEN)
        ? { ...seg, content: withoutSoftHyphens(seg.content) }
        : seg,
    );
    const drawn = stripped.filter((seg) => seg.content !== "");
    lines.push({
      segments: drawn.length > 0 ? drawn : stripped.slice(0, 1),
      width,
      start: lineStart,
      end: ends,
    });
  };

  // Where each piece of the line begins in the source: a word that runs across a span boundary can move
  // to the next line together with its earlier part, which then starts that line in an earlier span.
  const origin = new WeakMap<TextSegment, SegmentPosition>();
  const started = (piece: TextSegment, from: SegmentPosition): TextSegment => {
    origin.set(piece, from);
    return piece;
  };

  /** The width and ink of `pieces`, summed exactly as `placeWord` builds a line: word by word, a space
   *  joining the words inside a piece, nothing between pieces. */
  const measure = (pieces: TextSegment[]): { width: number; ink: number } => {
    let total = 0;
    let ink = 0;
    let open = false;
    for (const piece of pieces) {
      const { font, letterSpacing: spacing, wordSpacing } = runStyleOf(piece, defaults);
      const space = runAdvance(metrics, " ", font, spacing) + wordSpacing;
      piece.content.split(" ").forEach((word, i) => {
        total = total + ((open && i > 0 ? space : 0) + runAdvance(metrics, word, font, spacing));
        open = true;
        if (word !== "") ink = total;
      });
    }
    return { width: total, ink };
  };

  /**
   * The line is full and the next word follows the line's last piece with NO space: it continues a word
   * that began in an earlier span (`span("Rech") + span("nung")`). A span boundary is no break
   * opportunity, so the break belongs at the last one before that word - a space, or a hyphen or soft
   * hyphen ending a span - and the word's earlier part moves down with it. `null`: the line has none
   * before it, and the word stays, as the same text in one string would.
   */
  const gluedTail = (
    next: string,
    afterSpace: boolean,
  ): {
    keep: TextSegment[];
    moved: TextSegment[];
    from?: SegmentPosition;
    hyphen: boolean;
  } | null => {
    const pieces = lineSegments.slice(0, -1); // the last is the current span's own, still empty
    const moved: TextSegment[] = [];
    let following = next;
    const inks = (keep: TextSegment[]) =>
      keep.some((p) => withoutSoftHyphens(p.content).trim() !== "");
    if (afterSpace) return inks(pieces) ? { keep: pieces, moved, hyphen: false } : null;
    for (let i = pieces.length - 1; i >= 0; i--) {
      const piece = pieces[i]!;
      const c = piece.content;
      const soft = c.endsWith(SOFT_HYPHEN);
      if (c.endsWith(" ") || soft || (c.endsWith("-") && !/^\d/.test(following))) {
        const keep = pieces.slice(0, i + 1);
        return inks(keep)
          ? { keep, moved, from: moved[0] && origin.get(moved[0]), hyphen: soft }
          : null;
      }
      const space = c.lastIndexOf(" ");
      if (space >= 0) {
        const from = origin.get(piece)!;
        const head = started({ ...piece, content: c.slice(0, space + 1) }, from);
        const tail = started(
          { ...piece, content: c.slice(space + 1) },
          { segment: from.segment, offset: from.offset + space + 1 },
        );
        const keep = [...pieces.slice(0, i), head];
        return inks(keep)
          ? { keep, moved: [tail, ...moved], from: origin.get(tail), hyphen: false }
          : null;
      }
      moved.unshift(piece);
      following = c + following;
    }
    return null;
  };

  segments.forEach((segment, segmentIndex) => {
    const { font, letterSpacing, wordSpacing, splitting } = runStyleOf(segment, defaults);
    const family = font.fontFamily;
    const spaceWidth = runAdvance(metrics, " ", font, letterSpacing) + wordSpacing;
    const at = (offset: number): SegmentPosition => ({ segment: segmentIndex, offset });

    // A `\n` is a HARD break: close the line where it sits, whatever else was already on it, and start
    // the next one with this segment's style. An EMPTY paragraph still makes a line, or a deliberate
    // blank line between two blocks silently disappears.
    let paragraphStart = 0;
    segment.content.split("\n").forEach((paragraph, paragraphIndex) => {
      if (paragraphIndex > 0) {
        close(lineSegments, ink, "hard");
        width = 0;
        gapWidth = 0;
        open = false;
        inked = false;
        ink = 0;
        hung = false;
        lineSegments = [];
        lineStart = at(paragraphStart);
      }
      const words = paragraph.split(" ");
      let wordStart = paragraphStart;

      // Start this segment's piece empty; its content is filled word-by-word below. (Not
      // the original content - otherwise a segment whose FIRST word overflows would carry
      // its whole text into the line that just closed.)
      lineSegments.push(
        started({ ...segment, fontFamily: family, content: "" }, at(paragraphStart)),
      );
      combined = "";

      /** Close the line before a word whose earlier part (`glued.moved`) moves down with it. */
      const carryOver = (
        glued: {
          keep: TextSegment[];
          moved: TextSegment[];
          from?: SegmentPosition;
          hyphen: boolean;
        },
        wordAt: number,
      ): void => {
        close(glued.keep, measure(glued.keep).ink, "soft", glued.hyphen);
        const carried = measure(glued.moved);
        lineSegments = [
          ...glued.moved,
          started({ ...segment, fontFamily: family, content: "" }, at(wordAt)),
        ];
        combined = "";
        lineStart = glued.from!;
        width = carried.width;
        ink = carried.ink;
        gapWidth = 0;
        open = true;
        inked = true;
      };

      /**
       * No regular break before a word glued to the line, and it does not fit: Chrome's `overflow-wrap`
       * emergency break, where a break after a character is allowed by THAT character's own setting.
       * As much of the word as fits stays here if its span may split; else the line ends at the span
       * boundary if the span before it may split; else one character is forced on if this span may
       * split at all. `false`: none applies, and the word overflows on this line as before.
       */
      const emergencyBreak = (word: string, wordAt: number, room: number): boolean => {
        let before: TextSegment | undefined;
        for (let i = lineSegments.length - 1; i >= 0 && !before; i--)
          if (lineSegments[i]!.content !== "") before = lineSegments[i];
        const beforeMaySplit =
          before !== undefined && runStyleOf(before, defaults).splitting.breakWord === true;
        let head: number | null = null; // how much of the word's source stays on this line
        if (splitting.breakWord) {
          const split = splitLongWord(word, room - width, font, metrics, letterSpacing, {
            breakWord: true,
          });
          if (split) head = split[0]!.source;
        }
        if (head === null && beforeMaySplit) {
          close(lineSegments, ink, "split");
          startLine(wordAt);
          placeWord(word, wordAt, false);
          return true;
        }
        if (head === null && splitting.breakWord)
          head = String.fromCodePoint(word.codePointAt(0)!).length;
        if (head === null) return false;
        combined += word.slice(0, head);
        width += runAdvance(metrics, word.slice(0, head), font, letterSpacing);
        ink = width;
        lineSegments[lineSegments.length - 1]!.content = combined;
        close(lineSegments, ink, "split");
        startLine(wordAt + head);
        placeWord(word.slice(head), wordAt + head, false);
        return true;
      };

      /** An empty line, starting at source offset `startAt` in this segment. */
      const startLine = (startAt: number): void => {
        lineSegments = [started({ ...segment, fontFamily: family, content: "" }, at(startAt))];
        combined = "";
        width = 0;
        gapWidth = 0;
        open = false;
        inked = false;
        ink = 0;
        lineStart = at(startAt);
      };

      // One word, placed at source offset `wordAt`; `joined`: a space joins it to the word before.
      const placeWord = (word: string, wordAt: number, joined: boolean): void => {
        const afterSpace = hung;
        hung = false;
        // The space before this word hung past the edge, so the line is full: the word starts the next
        // one. It must not slip in behind the space it was written after, however narrow it is.
        if (afterSpace && inked && word !== "") {
          close(lineSegments, ink, "soft");
          startLine(wordAt);
        }
        // Only a word that follows something on this line is joined to it by the space.
        const joins = open && joined;
        const wordWidth = runAdvance(metrics, word, font, letterSpacing);
        // CSS `text-indent`: the FIRST line has the indent taken out of its room; the pieces of a split
        // word land on the first line only when it is still empty.
        const room = lines.length === 0 ? maxWidth - indent : maxWidth;

        // How much a JUSTIFIED line may be squeezed to keep one more word: the spaces already on the
        // line plus the one that would join it, each giving up at most `shrink` of its width. Zero for
        // every other alignment, where a squeezed line would simply overflow instead. The drawing
        // spreads the same total evenly over the gaps (`justifyExtra`).
        const squeeze = (gapWidth + (joins ? spaceWidth : 0)) * shrink;
        // A hyphen inside the word is a break opportunity, taken only when the whole word does not fit
        // here - the same test, squeeze included, as below.
        const fitsHere = (w: number): boolean =>
          !open ? w <= room : width + ((joins ? spaceWidth : 0) + w) - squeeze <= room;
        const breaks = mayBreak(word) ? hyphenBreaks(word) : NO_BREAKS;
        if (breaks.length > 0 && !fitsHere(wordWidth)) {
          let head = 0;
          for (const k of breaks) {
            if (!fitsHere(runAdvance(metrics, headAt(word, k), font, letterSpacing))) break;
            head = k;
          }
          if (head > 0) {
            const part = headAt(word, head);
            const joiner = joins ? spaceWidth : 0;
            if (!open) lineStart = at(wordAt);
            width += joiner + runAdvance(metrics, part, font, letterSpacing);
            ink = width;
            combined += joins ? " " + part : part;
            if (lineSegments.length === 0)
              lineSegments.push(
                started({ ...segment, fontFamily: family, content: "" }, at(wordAt)),
              );
            lineSegments[lineSegments.length - 1]!.content = combined;
            close(lineSegments, ink, endAt(word, head));
            startLine(wordAt + head);
            placeWord(word.slice(head), wordAt + head, false);
            return;
          }
          if (inked) {
            const glued = joined ? undefined : gluedTail(word, afterSpace);
            if (glued && glued.moved.length > 0) {
              carryOver(glued, wordAt);
              placeWord(word, wordAt, false);
              return;
            }
            if (glued !== null) {
              close(lineSegments, ink, "soft", !joined);
              startLine(wordAt);
              placeWord(word, wordAt, false);
              return;
            }
          }
          placeWord(headAt(word, breaks[0]!), wordAt, joined);
          close(lineSegments, ink, endAt(word, breaks[0]!));
          startLine(wordAt + breaks[0]!);
          placeWord(word.slice(breaks[0]), wordAt + breaks[0]!, false);
          return;
        }
        // A word glued to the line - it continues one from an earlier span - that does not fit here.
        if (!joined && !afterSpace && inked && word !== "" && !fitsHere(wordWidth)) {
          const glued = gluedTail(word, afterSpace);
          if (glued && glued.moved.length > 0) {
            carryOver(glued, wordAt);
            placeWord(word, wordAt, false);
            return;
          }
          if (glued === null && emergencyBreak(word, wordAt, room)) return;
        }
        const splitRoom = lines.length === 0 && !open ? room : maxWidth;

        // A word too wide for the box is split into pieces that fit (hyphenation first, break-word as
        // the floor). Each finished piece closes the line it sits on, keeping this segment's style. Off
        // by default, so a document that asks for neither never gets here.
        const split = splitLongWord(word, splitRoom, font, metrics, letterSpacing, splitting);
        if (split) {
          // Close whatever is already on the line FIRST: the pieces were measured against the full box,
          // not against what is left of this line.
          if (inked) {
            close(lineSegments, ink, "soft", !joined);
            lineSegments = [started({ ...segment, fontFamily: family, content: "" }, at(wordAt))];
            combined = "";
          }
          // Each piece starts where the source text of the previous one ended.
          let pieceAt = wordAt;
          for (const piece of split.slice(0, -1)) {
            lineSegments[lineSegments.length - 1]!.content = piece.text;
            lineStart = at(pieceAt);
            // The width a line REPORTS is what alignment and line-metrics work from: measure it.
            close(
              lineSegments,
              runAdvance(metrics, piece.text, font, letterSpacing),
              piece.hyphen ? "hyphen" : "split",
            );
            pieceAt += piece.source;
            lineSegments = [started({ ...segment, fontFamily: family, content: "" }, at(pieceAt))];
          }
          lineStart = at(pieceAt);
          combined = split[split.length - 1]!.text;
          width = runAdvance(metrics, combined, font, letterSpacing);
          gapWidth = 0;
          open = true;
          inked = true;
          ink = width;
          lineSegments[lineSegments.length - 1]!.content = combined;
          return;
        }
        // A space joins this word to what precedes it only INSIDE a segment; segments butt together
        // with nothing between them, which is what `span("a") + span("b")` draws.
        const joiner = joins ? spaceWidth : 0;
        // ONE expression for the test and for the running total, grouped exactly as `singleLineWidth`
        // groups it - see the note there. A width built any other way can be a bit off the one the box
        // was sized with, and the text wraps inside a box made to hold it.
        const candidate = width + (joiner + wordWidth);

        // Break before a word that won't fit - counting the space that would join it. A word wider than
        // the whole box still sits on its (empty) line and overflows, rather than pushing a phantom
        // empty line before it.
        if (candidate - squeeze > room && inked) {
          // A space that does not fit hangs past the edge, as in CSS. Closing the line on it would end
          // the paragraph's last line "soft" (stretched when justified) or push a blank line before `\n`.
          if (word === "") {
            hung = true;
            return;
          }
          const glued = joined ? undefined : gluedTail(word, afterSpace);
          if (glued && glued.moved.length > 0) {
            carryOver(glued, wordAt);
            placeWord(word, wordAt, false);
            return;
          }
          // `null`: nowhere to break before this word - it stays on the line, below.
          if (glued !== null) {
            close(lineSegments, ink, "soft", !joined);
            lineStart = at(wordAt);
            width = wordWidth;
            gapWidth = 0;
            ink = wordWidth;
            inked = true;
            lineSegments = [];
            combined = word;
            lineSegments.push(started({ ...segment, content: combined }, at(wordAt)));
            return;
          }
        }
        combined += joins ? " " + word : word;
        width = candidate;
        if (joins) gapWidth += spaceWidth;
        open = true;
        if (word !== "") {
          ink = width;
          inked = true;
        }
        if (lineSegments.length === 0) {
          lineSegments.push(
            started({ ...segment, fontFamily: family, content: combined }, at(wordAt)),
          );
        }
        lineSegments[lineSegments.length - 1].content = combined;
      };
      words.forEach((word, wordIndex) => {
        const wordAt = wordStart;
        wordStart += word.length + 1;
        placeWord(word, wordAt, wordIndex > 0);
      });
      paragraphStart += paragraph.length + 1;
    });
  });

  // Only if something actually landed on it: a text ending in `\n` is ONE line. An empty paragraph in
  // the MIDDLE still becomes a line; that one is pushed at the break, not here.
  if (lineSegments.some((seg) => seg.content !== "")) {
    close(lineSegments, ink, "end");
  }

  // Open-end by default; cap only when maxLines is set.
  let kept = lines;
  if (maxLines != null && lines.length > maxLines) {
    // The text ends at the cap, as far as this element goes: its last line is not a wrapped one.
    kept = lines.slice(0, maxLines);
    kept[kept.length - 1] = { ...kept[kept.length - 1]!, end: "end" };
    if (overflow === "ellipsis") {
      // The same room that line was broken against: the first one lost the indent to it.
      const room = kept.length === 1 ? maxWidth - indent : maxWidth;
      ellipsizeLine(kept[kept.length - 1]!, defaults, room, metrics);
    }
  }
  // A piece of a paragraph split across pages draws only its own lines.
  return defaults.shownLines === undefined ? kept : kept.slice(0, defaults.shownLines);
}

/** Appends "…" to a single line, dropping trailing words (then characters) until the line plus the
 *  ellipsis fits `maxWidth`. Falls back to a bare "…" if not even one character fits. */
function ellipsize(
  line: string,
  fontFamily: string,
  fontSize: number,
  fontStyle: FontStyle,
  maxWidth: number,
  metrics: FontMetrics,
  letterSpacing = 0,
  wordSpacing = 0,
  ligatures?: boolean,
): string {
  const font = { fontFamily, fontSize, fontStyle, ligatures };
  // Measured through `singleLineWidth`, so the ellipsised line is judged by the same sum that decides
  // every other line - word-spacing included.
  const fits = (s: string): boolean =>
    singleLineWidth(s + ELLIPSIS, font, metrics, letterSpacing, wordSpacing) <= maxWidth;
  if (fits(line)) return line + ELLIPSIS;

  const words = line.split(" ");
  while (words.length > 1) {
    words.pop();
    if (fits(words.join(" "))) return words.join(" ") + ELLIPSIS;
  }
  // Drop one code point at a time (not one UTF-16 unit) so an astral char is never split into a
  // lone surrogate. `chars` is the code-point view; rebuild the string from its shrinking prefix.
  const chars = [...(words[0] ?? "")];
  while (chars.length > 1) {
    chars.pop();
    const single = chars.join("");
    if (fits(single)) return single + ELLIPSIS;
  }
  return ELLIPSIS;
}

/** Ellipsizes the LAST segment of a truncated line in place (within the width left by the segments
 *  before it) and recomputes the line width. */
function ellipsizeLine(
  line: SegmentLine,
  defaults: SegmentDefaults,
  maxWidth: number,
  metrics: FontMetrics,
): void {
  const segs = line.segments;
  if (segs.length === 0) return;
  // Summed word by word, as the breaker sums a line - one owner for a line's width.
  const widthOf = (seg: TextSegment): number => {
    const run = runStyleOf(seg, defaults);
    return singleLineWidth(seg.content, run.font, metrics, run.letterSpacing, run.wordSpacing);
  };
  let prefix = 0;
  for (let i = 0; i < segs.length - 1; i++) prefix += widthOf(segs[i]);
  const last = segs[segs.length - 1];
  const run = runStyleOf(last, defaults);
  last.content = ellipsize(
    last.content,
    run.font.fontFamily,
    run.font.fontSize,
    run.font.fontStyle,
    maxWidth - prefix,
    metrics,
    run.letterSpacing,
    run.wordSpacing,
    run.font.ligatures,
  );
  line.width = prefix + widthOf(last);
}
