/**
 * How wide a run of text is: the horizontal counterpart to `line-metrics.ts` (how tall a line is)
 * and `line-breaker.ts` (where a line breaks). The ONE canonical answer to "how far does the pen
 * move", so measuring and drawing can never disagree about it.
 *
 * An advance has three parts, each with its own PDF mechanism:
 *
 *     advance = sum(glyph widths)  +  sum(kerning)  +  n * letterSpacing
 *                  /Widths             TJ array          Tc
 *
 * `letterSpacing` is added after EVERY code point, the last one included - exactly what the `Tc`
 * operator does, and exactly what CSS `letter-spacing` does (which is why right-aligned spaced text
 * looks a hair offset: a spacing hangs off the final glyph). Measuring `(n - 1)` spacings while `Tc`
 * applies `n` would make every line draw one spacing wider than it was wrapped - text out of its box.
 *
 * Kerning is added ONLY when the document has it on (`metrics.kerningEnabled`), and then the backend
 * emits a `TJ` with the same per-pair adjustments - so a measured advance always equals the drawn
 * one. With kerning off, `getStringWidth` is the whole advance (its plain glyph sum), byte-identical
 * to before. Folding kerning into the measurement while the output ignored it was the 2026-07-10 bug.
 */

import type { FontStyle } from "../utils/pdf-object-manager.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";

/** The font a run is set in. */
export interface RunFont {
  fontFamily: string;
  fontSize: number;
  fontStyle: FontStyle;
  /** Whether this run gets the font's ligatures. Part of the FONT, because it changes which glyphs are
   *  drawn and therefore how wide the run is - measuring without it would not match the drawing. */
  ligatures?: boolean;
}

/** Number of Unicode code points (not UTF-16 units): an astral char is ONE, so it takes one
 *  letter-spacing, not two. Matches how `getStringWidth` iterates. */
export function codePointCount(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/**
 * Glyph widths plus kerning, memoised per metrics object - the line breaker asks for the same run
 * many times over.
 *
 * Keyed by nested maps on primitives, never a composed string key: building one allocates per call,
 * which costs more than the lookup saves.
 *
 * `letterSpacing` is not in the key: it is added outside, so a spaced and an unspaced run share the
 * width. Font size IS in it - scaling a cached em width drifts in the last bit, which is enough to
 * move a line break. Kerning is a flag on the metrics rather than a key, so the entry records it and
 * is thrown away when it flips; the same document can be rendered twice with different options.
 */
const ADVANCE_CACHE = new WeakMap<
  FontMetrics,
  {
    epoch: number;
    kerning: boolean;
    byFamily: Map<string, Map<FontStyle, Map<unknown, Map<number, Map<string, number>>>>>;
  }
>();

/**
 * The innermost map a `RunFont` resolves to, remembered on the font object itself. The breaker builds
 * one font per run and asks for every word with it, so without this each word walks five maps of which
 * four hold a single entry.
 */
const BY_FONT = new WeakMap<
  RunFont,
  {
    entry: object;
    family: string;
    size: number;
    style: FontStyle;
    ligatures?: boolean;
    byText: Map<string, number>;
  }
>();

function baseAdvance(metrics: FontMetrics, text: string, font: RunFont): number {
  let entry = ADVANCE_CACHE.get(metrics);
  const epoch = metrics.fontEpoch ?? 0;
  const kerning = metrics.kerningEnabled;
  // A face registered since we measured makes a family name mean something else; a flipped kerning
  // flag makes every width wrong. Either way the answers are stale.
  if (!entry || entry.epoch !== epoch || entry.kerning !== kerning) {
    entry = { epoch, kerning, byFamily: new Map() };
    ADVANCE_CACHE.set(metrics, entry);
  }
  // Same font object as last time, and the metrics entry has not been replaced: the map is already known.
  // Its FIELDS are compared, not just its identity: a caller that reuses one object and changes the
  // size on it would otherwise be handed the previous size's map.
  const known = BY_FONT.get(font);
  if (
    known?.entry === entry &&
    known.family === font.fontFamily &&
    known.size === font.fontSize &&
    known.style === font.fontStyle &&
    known.ligatures === font.ligatures
  ) {
    const seen = known.byText.get(text);
    if (seen !== undefined) return seen;
    return measureAndStore(metrics, text, font, known.byText);
  }

  let byStyle = entry.byFamily.get(font.fontFamily);
  if (!byStyle) entry.byFamily.set(font.fontFamily, (byStyle = new Map()));
  let byLigatures = byStyle.get(font.fontStyle);
  if (!byLigatures) byStyle.set(font.fontStyle, (byLigatures = new Map()));
  let bySize = byLigatures.get(font.ligatures);
  if (!bySize) byLigatures.set(font.ligatures, (bySize = new Map()));
  let byText = bySize.get(font.fontSize);
  if (!byText) bySize.set(font.fontSize, (byText = new Map()));

  BY_FONT.set(font, {
    entry,
    family: font.fontFamily,
    size: font.fontSize,
    style: font.fontStyle,
    ligatures: font.ligatures,
    byText,
  });

  const hit = byText.get(text);
  if (hit !== undefined) return hit;
  return measureAndStore(metrics, text, font, byText);
}

/** The measurement itself, once a miss has found the map it belongs in. */
function measureAndStore(
  metrics: FontMetrics,
  text: string,
  font: RunFont,
  byText: Map<string, number>,
): number {
  let advance = metrics.getStringWidth(
    text,
    font.fontFamily,
    font.fontSize,
    font.fontStyle,
    font.ligatures,
  );
  if (metrics.kerningEnabled) {
    let units = 0;
    for (const k of metrics.getKernPairs(text, font.fontFamily, font.fontStyle, font.ligatures))
      units += k;
    advance += (units / 1000) * font.fontSize; // kern units are em/1000
  }
  byText.set(text, advance);
  return advance;
}

/** The advance of `text` in points: the plain glyph widths, plus kerning (if the document has it on),
 *  plus one `letterSpacing` per code point. */
export function runAdvance(
  metrics: FontMetrics,
  text: string,
  font: RunFont,
  letterSpacing = 0,
): number {
  let advance = baseAdvance(metrics, text, font);
  if (letterSpacing !== 0) {
    // Per DRAWN glyph, which is what `Tc` applies to; only a ligature makes that differ.
    const glyphs =
      metrics.shapedGlyphCount?.(text, font.fontFamily, font.fontStyle, font.ligatures) ??
      codePointCount(text);
    advance += glyphs * letterSpacing;
  }

  return advance;
}
