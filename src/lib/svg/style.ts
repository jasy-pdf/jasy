import { Color } from "../common/color.ts";
import { toColor } from "../api/color.ts";
import type { StrokeStyle } from "../ir/display-list.ts";
import { SvgParseError, SvgUnsupportedError } from "./errors.ts";
import { length, ratio } from "./units.ts";

/**
 * The presentation style of one element, resolved against its parent's.
 *
 * SVG styles two ways at once: presentation ATTRIBUTES (`fill="red"`) and a CSS `style=""` bag, with
 * the style bag winning. Most of them INHERIT, which is what lets a logo set `fill` once on the root
 * `<g>`. A `<style>` block with class selectors is a third way and is not resolved yet - it is a
 * NAMED error, not a silent loss, because that is exactly the case that leaves a logo blank.
 */
/** A paint is a colour, or a `url(#id)` reference that only the SHAPE can resolve - a gradient in
 *  the default `objectBoundingBox` units is positioned on the bounding box of the thing it fills. */
export type PaintRef = { ref: string };
export type SvgPaint = Color | PaintRef;
export const isPaintRef = (paint: SvgPaint | undefined): paint is PaintRef =>
  paint !== undefined && !(paint instanceof Color);

export interface SvgStyle {
  /** Absent = `fill="none"`. The RAW paint - see `paintAlpha` for why the opacity is not in it. */
  fill?: SvgPaint;
  fillRule: "nonzero" | "evenodd";
  stroke?: StrokeStyle;
  /** `currentColor` resolves to this; set by the `color` attribute, black at the root. */
  color: Color;
  /**
   * `fill-opacity` / `stroke-opacity` (both inherit) and the accumulated `opacity` of this element
   * and its ancestors. They are kept OUT of the colours and applied once, at the leaf that paints:
   * folding them in at every level would multiply a group's opacity in again for each generation.
   */
  fillOpacity: number;
  strokeOpacity: number;
  opacity: number;
}

/** The colour a shape actually paints with: its raw colour, times the opacities that reached it. */
export function paintAlpha(color: Color, opacity: number): Color {
  if (opacity >= 1) return color;
  const [r, g, b] = color.toArray();
  return new Color(r, g, b, color.getAlpha() * opacity);
}

export const ROOT_STYLE: SvgStyle = {
  fill: new Color(0, 0, 0),
  fillRule: "nonzero",
  stroke: undefined,
  color: new Color(0, 0, 0),
  fillOpacity: 1,
  strokeOpacity: 1,
  opacity: 1,
};

/** The stroke properties an element may set; they inherit individually, so they are kept apart. */
interface StrokeParts {
  color?: Color;
  width: number;
  cap?: StrokeStyle["cap"];
  join?: StrokeStyle["join"];
  miterLimit?: number;
  dash?: number[];
  dashOffset?: number;
}

/** Raw attributes, exactly as written. Our own XML reader never coerces them (`svg-parser` did,
 *  turning `id="58310095e0"` into a number). */
export type Attributes = Record<string, string | undefined>;

/** Splits a `style=""` bag into declarations. It wins over both other sources, as in CSS. */
function styleBag(value: string | number | undefined): Record<string, string> {
  if (typeof value !== "string") return {};
  const out: Record<string, string> = {};
  for (const declaration of value.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const property = declaration.slice(0, colon).trim();
    if (property) out[property] = declaration.slice(colon + 1).trim();
  }
  return out;
}

/**
 * Reads a property from all three sources, in CSS order: a presentation attribute is the weakest, a
 * matching `<style>` rule beats it, and the inline `style=""` bag beats both.
 *
 * Exported because anything that INSPECTS a property has to see the same value the style resolver
 * would - `filter="url(#f)"` and `style="filter:url(#f)"` are the same instruction, and checking only
 * the attribute lets the second one through unnoticed.
 */
export function cascadedReader(
  attributes: Attributes,
  css: Record<string, string> = {},
): (name: string) => string | undefined {
  const bag = styleBag(attributes["style"]);
  return (name) => {
    const value = bag[name] ?? css[name] ?? attributes[name];
    return value === undefined ? undefined : String(value);
  };
}

const dashNumbers = (list: string): number[] => {
  const found = list.match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g);
  return found ? found.map(Number) : [];
};

/**
 * A paint value. `none` is the absence of paint, which is NOT the same as transparent black - a shape
 * with `fill="none"` and a stroke draws its outline only. A `url(#...)` reference means a gradient or
 * pattern, which we do not resolve yet and therefore name.
 */
function paint(value: string, current: Color): SvgPaint | undefined {
  const v = value.trim();
  if (v === "none") return undefined;
  if (v === "currentColor") return current;
  const reference = /^url\(\s*#([^)\s]+)\s*\)/.exec(v);
  // A paint reference may name a fallback after it (`url(#g) red`), which is what a renderer uses
  // when the reference is broken - so it is kept as the reference, and resolution decides.
  if (reference) return { ref: reference[1]! };
  if (v.startsWith("url(")) {
    throw new SvgUnsupportedError(
      `the paint "${v}"`,
      "Only a `url(#id)` reference to a gradient is resolved.",
    );
  }
  return svgColor(v);
}

/**
 * A colour, with the value quoted in the message. `toColor` throws a bare `Unknown color: "x"`, which
 * inside a 900-element logo says nothing about WHERE - and a malformed file reaches here with pieces
 * of its own markup as the value, so the raw error is actively misleading.
 */
export function svgColor(value: string): Color {
  try {
    return toColor(value);
  } catch {
    throw new SvgParseError(
      `"${value}" is not a colour this SVG can use - expected a name, #hex, rgb() or hsl().`,
    );
  }
}

/**
 * Resolves one element's style against its parent's. Everything SVG inherits is inherited; `opacity`
 * is the exception - it applies to the element itself, so it is MULTIPLIED down and folded into the
 * paint of each leaf. That differs from a browser for a `<g opacity>` whose children OVERLAP (a real
 * group needs one transparency group), and is the one approximation in this file.
 */
export function resolveStyle(
  parent: SvgStyle,
  attributes: Attributes,
  css: Record<string, string> = {},
): SvgStyle {
  const read = cascadedReader(attributes, css);

  const color = read("color") !== undefined ? svgColor(read("color")!) : parent.color;
  // `Number("50%")` is NaN and `Number("")` is 0, both of which travel silently into the paint.
  const opacity = parent.opacity * ratio(read("opacity"));

  const fillValue = read("fill");
  const strokeValue = read("stroke");
  const dashValue = read("stroke-dasharray");

  const strokePaint = strokeValue !== undefined ? paint(strokeValue, color) : parent.stroke?.color;
  if (isPaintRef(strokePaint)) {
    // PDF strokes with a colour, never with a shading; painting the outline solid would be a colour
    // the file did not name.
    throw new SvgUnsupportedError(
      "a gradient on a stroke",
      "PDF strokes with a colour only. Use a solid stroke, or convert the outline to a filled shape.",
    );
  }
  const parts: StrokeParts = {
    color: strokePaint,
    width: length(read("stroke-width"), 'the "stroke-width" attribute', parent.stroke?.width ?? 1),
    cap: (read("stroke-linecap") as StrokeStyle["cap"]) ?? parent.stroke?.cap,
    join: (read("stroke-linejoin") as StrokeStyle["join"]) ?? parent.stroke?.join,
    miterLimit: length(
      read("stroke-miterlimit"),
      'the "stroke-miterlimit" attribute',
      parent.stroke?.miterLimit ?? 4,
    ),
    dash:
      dashValue !== undefined
        ? dashValue.trim() === "none"
          ? undefined
          : dashNumbers(dashValue)
        : parent.stroke?.dash,
    dashOffset: length(
      read("stroke-dashoffset"),
      'the "stroke-dashoffset" attribute',
      parent.stroke?.dashOffset ?? 0,
    ),
  };

  return {
    fill: fillValue !== undefined ? paint(fillValue, color) : parent.fill,
    fillRule: (read("fill-rule") as SvgStyle["fillRule"]) ?? parent.fillRule,
    // A stroke with no colour or no width paints nothing; dropping it here keeps every consumer from
    // having to ask twice.
    stroke:
      parts.color && parts.width > 0
        ? {
            color: parts.color,
            width: parts.width,
            cap: parts.cap,
            join: parts.join,
            miterLimit: parts.miterLimit,
            dash: parts.dash,
            dashOffset: parts.dashOffset,
          }
        : undefined,
    color,
    fillOpacity: ratio(read("fill-opacity"), parent.fillOpacity),
    strokeOpacity: ratio(read("stroke-opacity"), parent.strokeOpacity),
    opacity,
  };
}
