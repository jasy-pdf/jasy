import { SvgUnsupportedError } from "./errors.ts";

/**
 * Reading NUMBERS out of an SVG.
 *
 * `Number.parseFloat` is the wrong tool on its own: it stops at the first character it cannot use and
 * returns what it had, so `"10px"` is 10 and `"20abc"` is 20. That is convenient exactly once and
 * wrong everywhere else - a length we silently misread draws a shape the file did not describe.
 *
 * So the rules here are explicit: a plain number is a number, `px` is the user unit and means the
 * same thing, a percentage is only valid where a ratio is expected, and anything else is NAMED. In
 * 10,819 real files, 53 use `px` on a shape attribute (we drew nothing for them) and one uses a
 * percentage opacity.
 */

/** Absolute CSS units are defined against the user unit, which SVG pins to 1/96 inch. */
const ABSOLUTE: Record<string, number> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const WITH_UNIT = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z%]+)$/;

/** A plain number, with nothing else in the string. */
export function strictNumber(text: string): number | undefined {
  const t = text.trim();
  if (!NUMBER.test(t)) return undefined;
  const n = Number(t);
  // `1e400` matches the grammar and overflows to Infinity. A non-finite number reaches the content
  // stream as the literal text `Infinity`, which viewers discard the rest of the page over.
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A length in user units. `undefined` and `""` mean "not given" and return `fallback`; a resolvable
 * absolute unit is converted; a relative one (`%`, `em`, `rem`, `ex`, `ch`, `vw`, …) is NAMED,
 * because resolving it needs a font or a viewport that a shape attribute does not carry.
 */
export function length(value: string | undefined, where: string, fallback = 0): number {
  if (value === undefined || value.trim() === "") return fallback;
  const plain = strictNumber(value);
  if (plain !== undefined) return plain;

  const parts = WITH_UNIT.exec(value.trim());
  if (parts) {
    const factor = ABSOLUTE[parts[2]!.toLowerCase()];
    if (factor !== undefined) return Number(parts[1]) * factor;
    throw new SvgUnsupportedError(
      `the length "${value.trim()}" on ${where}`,
      "Only absolute units (px, pt, pc, in, cm, mm, q) and plain numbers are resolved.",
    );
  }
  // Not a number at all: the file is malformed here. Treat it as absent rather than as zero-with-a-
  // shrug, so a caller sees the same thing as for a missing attribute.
  return fallback;
}

/** A 0..1 ratio, written as a number or a percentage, clamped - an opacity outside the range is a
 *  malformed file, and CSS clamps rather than rejecting. */
export function ratio(value: string | undefined, fallback = 1): number {
  if (value === undefined || value.trim() === "") return fallback;
  const t = value.trim();
  const raw = t.endsWith("%") ? strictNumber(t.slice(0, -1)) : strictNumber(t);
  if (raw === undefined) return fallback;
  const scaled = t.endsWith("%") ? raw / 100 : raw;
  return Math.max(0, Math.min(1, scaled));
}
