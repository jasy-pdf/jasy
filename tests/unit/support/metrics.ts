import type { FontVerticals } from "../../../src/lib/text/line-metrics.ts";
import type { FontMetrics } from "../../../src/lib/utils/font-metrics.ts";

/**
 * Vertical metrics for the deterministic test fonts: 3/4 em above the baseline, 1/4 em below, no
 * lineGap. The natural line box is then exactly 1 em, so a test can keep doing arithmetic in whole
 * font sizes - and both fractions are exact in binary, so `ascent + descent` is 1.0 and not
 * 1.0000000000000002. A real font's numbers come from its AFM/hhea (see `getFontVerticals`).
 */
export const UNIT_VERTICALS: FontVerticals = { ascent: 0.75, descent: 0.25, lineGap: 0 };

export const unitVerticals = (): FontVerticals => UNIT_VERTICALS;

/**
 * A complete `FontMetrics` for layout tests: every glyph is 10pt wide at size 10, a space is free,
 * kerning is off. Only the parts a test actually cares about need overriding - the rest exist so the
 * object satisfies the interface rather than a cast, which is what lets a real type error show up.
 */
export const testMetrics = (over: Partial<FontMetrics> = {}): FontMetrics => ({
  getStringWidth: (text, _family, fontSize) =>
    [...text].reduce((w, c) => w + (c === " " ? 0 : fontSize), 0),
  getCharWidth: (char, fontSize) => (char === " " ? 0 : fontSize),
  getFontVerticals: unitVerticals,
  getFontDecoration: () => ({
    underlinePosition: -0.1,
    underlineThickness: 0.05,
    capHeight: 0.7,
    xHeight: 0.5,
  }),
  kerningEnabled: false,
  getKernPairs: (text) => Array.from({ length: Math.max(0, [...text].length - 1) }, () => 0),
  ...over,
});
