import { Color } from "../common/color.ts";
import { toColor } from "../api/color.ts";
import type { Gradient, GradientStop, PathCommand } from "../ir/display-list.ts";
import type { Affine } from "../utils/ttf-parser.ts";
import { SvgUnsupportedError } from "./errors.ts";
import { IDENTITY, isIdentity, parseTransform } from "./transform.ts";
import type { Attributes } from "./style.ts";
import type { XmlElement, XmlNode } from "./xml.ts";

/**
 * `<linearGradient>` and `<radialGradient>`.
 *
 * The backend has painted shadings since colour emoji, and `Box({ bg: linearGradient(...) })` uses
 * the same node - so this file only has to turn a `url(#id)` reference into that node. Two things
 * make it more than a lookup:
 *
 * - **`gradientUnits` defaults to `objectBoundingBox`**, i.e. the coordinates are fractions of the
 *   SHAPE's bounding box, not of the page. So a gradient cannot be resolved where it is defined,
 *   only where it is used - which is why this takes the shape's commands.
 * - **`href` chains.** Illustrator emits one gradient with the stops and a second that references it
 *   and only moves the coordinates. Missing that leaves a shape with no stops at all.
 */

export interface GradientDef {
  kind: "linear" | "radial";
  attributes: Attributes;
  stops: GradientStop[];
  /** The `stop-opacity` of each stop, in the same order. */
  opacities: number[];
  /** The id this definition inherits from (`href` / `xlink:href`), without the `#`. */
  href?: string;
}

const localName = (tagName: string): string => {
  const colon = tagName.indexOf(":");
  return colon === -1 ? tagName : tagName.slice(colon + 1);
};

const num = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return value.trim().endsWith("%") ? n / 100 : n;
};

/** One `<stop>`, plus its own opacity - which is kept apart because only a UNIFORM one survives. */
function readStop(element: XmlElement): { stop: GradientStop; opacity: number } {
  const attributes = element.attributes;
  const style: Record<string, string> = {};
  for (const declaration of (attributes["style"] ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon !== -1)
      style[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
  }
  const read = (name: string): string | undefined => style[name] ?? attributes[name];

  const raw = read("stop-opacity");
  const parsed = raw === undefined ? 1 : Number.parseFloat(raw);
  const opacity = Number.isFinite(parsed) ? parsed : 1;
  const colorText = read("stop-color") ?? "#000000";
  return {
    stop: {
      offset: num(read("offset"), 0),
      color: colorText === "currentColor" ? new Color(0, 0, 0) : toColor(colorText),
    },
    opacity,
  };
}

/** Every gradient definition in the document, by id - they are referenced, not drawn in place. */
export function gradientsOf(
  node: XmlNode,
  into = new Map<string, GradientDef>(),
): Map<string, GradientDef> {
  if (node.type !== "element") return into;
  const name = localName(node.tagName);
  if (name === "linearGradient" || name === "radialGradient") {
    const id = node.attributes["id"];
    if (id !== undefined) {
      const href = node.attributes["href"] ?? node.attributes["xlink:href"];
      const read = node.children
        .filter((c): c is XmlElement => c.type === "element" && localName(c.tagName) === "stop")
        .map(readStop);
      into.set(id, {
        kind: name === "linearGradient" ? "linear" : "radial",
        attributes: node.attributes,
        stops: read.map((r) => r.stop),
        opacities: read.map((r) => r.opacity),
        href: href?.startsWith("#") ? href.slice(1) : undefined,
      });
    }
    return into;
  }
  for (const child of node.children) gradientsOf(child, into);
  return into;
}

/** Walks the `href` chain: the nearest definition wins for each attribute, stops come from the first
 *  ancestor that has any. A cycle stops the walk rather than hanging. */
function inherited(
  def: GradientDef,
  defs: ReadonlyMap<string, GradientDef>,
): { attributes: Attributes; stops: GradientStop[]; opacities: number[] } {
  const attributes: Attributes = {};
  let stops: GradientStop[] = [];
  let opacities: number[] = [];
  const seen = new Set<GradientDef>();
  let current: GradientDef | undefined = def;
  while (current && !seen.has(current)) {
    seen.add(current);
    for (const [key, value] of Object.entries(current.attributes)) {
      if (attributes[key] === undefined) attributes[key] = value;
    }
    if (stops.length === 0) {
      stops = current.stops;
      opacities = current.opacities;
    }
    current = current.href === undefined ? undefined : defs.get(current.href);
  }
  return { attributes, stops, opacities };
}

/** The bounding box of a shape, for `objectBoundingBox` units. Control points are included, which
 *  overstates a curve slightly - the same approximation every renderer makes here. */
function boundsOf(commands: readonly PathCommand[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const c of commands) {
    const points =
      c.op === "c"
        ? ([
            [c.x1, c.y1],
            [c.x2, c.y2],
            [c.x, c.y],
          ] as const)
        : c.op === "z"
          ? ([] as const)
          : ([[c.x, c.y]] as const);
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const SPREAD: Record<string, Gradient["extend"]> = {
  pad: "pad",
  repeat: "repeat",
  reflect: "reflect",
};

/**
 * Resolves a reference into an IR gradient positioned on `commands`.
 *
 * The anchors are mapped into the shape's own space, then through `gradientTransform` - so they end
 * up in the SAME coordinates as the path, which is what the backend and the Y-flip both assume.
 */
export function resolveSvgGradient(
  def: GradientDef,
  defs: ReadonlyMap<string, GradientDef>,
  commands: readonly PathCommand[],
): Gradient {
  const { attributes, stops, opacities } = inherited(def, defs);
  if (stops.length === 0) {
    throw new SvgUnsupportedError(
      "a gradient with no <stop> of its own or inherited",
      "Add stops, or replace the fill with a solid colour.",
    );
  }
  // A PDF shading is DeviceRGB and has no alpha channel. One opacity across all stops IS
  // expressible - it is just the shape's fill alpha - and 87 of the 125 real files that use
  // `stop-opacity` at all are that case. Stops with DIFFERENT opacities would need a soft-mask
  // luminosity group, so that stays named rather than drawn opaque.
  const alpha = opacities[0] ?? 1;
  if (opacities.some((o) => o !== alpha)) {
    throw new SvgUnsupportedError(
      "a gradient whose stops have DIFFERENT stop-opacity values",
      "A PDF shading has no alpha channel; only one opacity for the whole gradient is expressible.",
    );
  }

  const box = boundsOf(commands);
  const onBox = (attributes["gradientUnits"] ?? "objectBoundingBox") === "objectBoundingBox";
  // In objectBoundingBox units every coordinate is a FRACTION of the shape's box.
  const px = (v: number) => (onBox ? box.x + v * box.width : v);
  const py = (v: number) => (onBox ? box.y + v * box.height : v);
  // A radius in box units is a fraction of the box's diagonal-ish size, per the SVG formula.
  const pr = (v: number) => (onBox ? v * Math.sqrt((box.width ** 2 + box.height ** 2) / 2) : v);

  const matrix: Affine = attributes["gradientTransform"]
    ? parseTransform(attributes["gradientTransform"])
    : IDENTITY;
  const skewed =
    !isIdentity(matrix) && (matrix[1] !== 0 || matrix[2] !== 0 || matrix[0] !== matrix[3]);
  const point = (x: number, y: number): [number, number] => [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
  const scale = Math.abs(matrix[0]);

  const extend = SPREAD[attributes["spreadMethod"] ?? "pad"] ?? "pad";

  if (def.kind === "linear") {
    // Both anchors go through the transform, so a rotation or a shear lands correctly by itself.
    const [x0, y0] = point(px(num(attributes["x1"], 0)), py(num(attributes["y1"], 0)));
    const [x1, y1] = point(px(num(attributes["x2"], 1)), py(num(attributes["y2"], 0)));
    return { type: "linear", x0, y0, x1, y1, stops, extend, alpha };
  }

  if (skewed) {
    // A sheared or non-uniformly scaled radial gradient is an ELLIPSE. PDF's radial shading is
    // circles only, so it cannot be expressed - naming it beats drawing a different shape.
    throw new SvgUnsupportedError(
      `a radial gradient with gradientTransform="${attributes["gradientTransform"]}"`,
      "A non-uniform transform makes it elliptical, which a PDF shading cannot express.",
    );
  }
  const cx = px(num(attributes["cx"], 0.5));
  const cy = py(num(attributes["cy"], 0.5));
  const r = pr(num(attributes["r"], 0.5)) * scale;
  // The focal point defaults to the centre; it is where the gradient starts, at radius 0.
  const [fx, fy] = point(
    attributes["fx"] === undefined ? cx : px(num(attributes["fx"], 0.5)),
    attributes["fy"] === undefined ? cy : py(num(attributes["fy"], 0.5)),
  );
  const [ox, oy] = point(cx, cy);
  return { type: "radial", x0: fx, y0: fy, r0: 0, x1: ox, y1: oy, r1: r, stops, extend, alpha };
}
