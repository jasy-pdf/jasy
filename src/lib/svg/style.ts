import { Color } from "../common/color.ts";
import { toColor } from "../api/color.ts";
import type { StrokeStyle } from "../ir/display-list.ts";
import { SvgUnsupportedError } from "./errors.ts";

/**
 * The presentation style of one element, resolved against its parent's.
 *
 * SVG styles two ways at once: presentation ATTRIBUTES (`fill="red"`) and a CSS `style=""` bag, with
 * the style bag winning. Most of them INHERIT, which is what lets a logo set `fill` once on the root
 * `<g>`. A `<style>` block with class selectors is a third way and is not resolved yet - it is a
 * NAMED error, not a silent loss, because that is exactly the case that leaves a logo blank.
 */
export interface SvgStyle {
  /** Absent = `fill="none"`. The RAW colour - see `paintAlpha` for why the opacity is not in it. */
  fill?: Color;
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

export type Attributes = Record<string, string | number | undefined>;

/** Splits a `style=""` bag into declarations. It wins over the presentation attributes, as in CSS. */
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

const numbers = (list: string): number[] => {
  const found = list.match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g);
  return found ? found.map(Number) : [];
};

/**
 * A paint value. `none` is the absence of paint, which is NOT the same as transparent black - a shape
 * with `fill="none"` and a stroke draws its outline only. A `url(#...)` reference means a gradient or
 * pattern, which we do not resolve yet and therefore name.
 */
function paint(value: string, current: Color): Color | undefined {
  const v = value.trim();
  if (v === "none") return undefined;
  if (v === "currentColor") return current;
  if (v.startsWith("url(")) {
    throw new SvgUnsupportedError(
      `a "${v}" paint reference (gradient or pattern)`,
      "Flatten it to a solid colour, or wait for gradient support.",
    );
  }
  return toColor(v);
}

/**
 * Resolves one element's style against its parent's. Everything SVG inherits is inherited; `opacity`
 * is the exception - it applies to the element itself, so it is MULTIPLIED down and folded into the
 * paint of each leaf. That differs from a browser for a `<g opacity>` whose children OVERLAP (a real
 * group needs one transparency group), and is the one approximation in this file.
 */
export function resolveStyle(parent: SvgStyle, attributes: Attributes): SvgStyle {
  const bag = styleBag(attributes["style"]);
  const read = (name: string): string | undefined => {
    const value = bag[name] ?? attributes[name];
    return value === undefined ? undefined : String(value);
  };

  const color = read("color") !== undefined ? toColor(read("color")!) : parent.color;
  const opacity = parent.opacity * Number(read("opacity") ?? 1);

  const fillValue = read("fill");
  const strokeValue = read("stroke");
  const dashValue = read("stroke-dasharray");

  const parts: StrokeParts = {
    color: strokeValue !== undefined ? paint(strokeValue, color) : parent.stroke?.color,
    width: Number(read("stroke-width") ?? parent.stroke?.width ?? 1),
    cap: (read("stroke-linecap") as StrokeStyle["cap"]) ?? parent.stroke?.cap,
    join: (read("stroke-linejoin") as StrokeStyle["join"]) ?? parent.stroke?.join,
    miterLimit: Number(read("stroke-miterlimit") ?? parent.stroke?.miterLimit ?? 4),
    dash:
      dashValue !== undefined
        ? dashValue.trim() === "none"
          ? undefined
          : numbers(dashValue)
        : parent.stroke?.dash,
    dashOffset: Number(read("stroke-dashoffset") ?? parent.stroke?.dashOffset ?? 0),
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
    fillOpacity: Number(read("fill-opacity") ?? parent.fillOpacity),
    strokeOpacity: Number(read("stroke-opacity") ?? parent.strokeOpacity),
    opacity,
  };
}
