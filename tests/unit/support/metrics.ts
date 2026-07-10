import type { FontVerticals } from "../../../src/lib/text/line-metrics";

/**
 * Vertical metrics for the deterministic test fonts: 3/4 em above the baseline, 1/4 em below, no
 * lineGap. The natural line box is then exactly 1 em, so a test can keep doing arithmetic in whole
 * font sizes - and both fractions are exact in binary, so `ascent + descent` is 1.0 and not
 * 1.0000000000000002. A real font's numbers come from its AFM/hhea (see `getFontVerticals`).
 */
export const UNIT_VERTICALS: FontVerticals = { ascent: 0.75, descent: 0.25, lineGap: 0 };

export const unitVerticals = (): FontVerticals => UNIT_VERTICALS;
