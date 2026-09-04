/**
 * SVG is a document format, not a graphics format: it carries CSS, text layout, filters, masks and
 * animation. Filters and masks are PIXEL operations, so no vector backend can express them - which is
 * why every complete SVG renderer owns a rasterizer, and why every PDF library ships a subset instead.
 *
 * We ship a subset too. The difference is what happens at its edge: an element we cannot draw is a
 * NAMED ERROR, never a silent skip. Two reasons, and the second is the important one.
 *
 * 1. A silently dropped element leaves a logo that renders and is quietly wrong - the fill missing,
 *    the icon half there - and nobody finds out. (react-pdf skips, and its `<style>` handling loses
 *    every fill of an Illustrator export made with the default "Internal CSS" option.)
 * 2. It keeps every later stage a MINOR. Supporting something new turns an error into a picture, which
 *    can never break a document that worked. Going the other way - from silently skipping to drawing -
 *    would change existing output.
 */

/** An element or attribute value we deliberately do not support yet. */
export class SvgUnsupportedError extends Error {
  constructor(
    readonly feature: string,
    hint: string,
  ) {
    super(`@jasy/pdf: ${feature} is not supported yet. ${hint}`);
    this.name = "SvgUnsupportedError";
  }
}

/** The file is not SVG we can read at all - malformed, or with no root `<svg>`. */
export class SvgParseError extends Error {
  constructor(message: string) {
    super(`@jasy/pdf: ${message}`);
    this.name = "SvgParseError";
  }
}
