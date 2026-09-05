import { parseXml, type XmlElement, type XmlNode } from "./xml.ts";
import type { Gradient, IRNode } from "../ir/display-list.ts";
import type { Affine } from "../utils/ttf-parser.ts";
import { SvgParseError, SvgUnsupportedError } from "./errors.ts";
import { IDENTITY, isIdentity, multiply, parseTransform } from "./transform.ts";
import { shapeOf } from "./shapes.ts";
import { transformCommands } from "../vector/path.ts";
import type { PathCommand } from "../ir/display-list.ts";
import { declarationsFor, parseStylesheet, type CssRule } from "./css.ts";
import {
  ROOT_STYLE,
  isPaintRef,
  cascadedReader,
  paintAlpha,
  resolveStyle,
  type Attributes,
  type SvgStyle,
} from "./style.ts";
import { gradientsOf, resolveSvgGradient, type GradientDef } from "./gradients.ts";

export { SvgParseError, SvgUnsupportedError } from "./errors.ts";

/** Where the drawing goes on the page, in engine (top-left) points. */
export interface SvgTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The intrinsic size of an SVG: its `width`/`height`, else its `viewBox`. */
export interface SvgSize {
  width: number;
  height: number;
}

/**
 * Elements that carry no ink. They are SKIPPED rather than reported: they are legal, common, and
 * drawing nothing is the correct result. `<defs>` is here because its contents are only ever drawn
 * through a reference - and an unresolvable reference is reported where it is USED (`fill="url(#x)"`),
 * which is the place that can say what is missing. `<style>` is here only because its text is
 * collected BEFOREHAND (see `stylesheetOf`); skipping it without reading it turned an Illustrator
 * export black.
 */
const IGNORED = new Set([
  "defs",
  "title",
  "desc",
  "metadata",
  "style",
  "linearGradient",
  "radialGradient",
]);

/** What each unsupported element should tell the user to do instead. */
const HINTS: Record<string, string> = {
  text: "Convert the text to outlines in your editor - a PDF cannot lay out SVG text.",
  tspan: "Convert the text to outlines in your editor - a PDF cannot lay out SVG text.",
  use: "Expand the <use> in your editor (Illustrator/Inkscape can flatten it).",
  symbol: "Expand the <symbol> into plain shapes in your editor.",
  filter: "Filters are pixel operations; rasterise that part to a PNG instead.",
  mask: "Masks are pixel operations; flatten the artwork in your editor instead.",
  clipPath: "Flatten the clip in your editor for now.",
  image: "Place the bitmap with Image({ src }) instead of nesting it in the SVG.",
  foreignObject: "Not renderable in a PDF; remove it.",
};

const attributesOf = (node: XmlElement): Attributes => node.attributes;

/**
 * The tag without its namespace prefix, or null when the prefix is a FOREIGN one.
 *
 * Editors write their own state into the file - Inkscape's `<sodipodi:namedview>`, Adobe's `<i:pgf>`,
 * RDF licence blocks. None of it draws anything, so refusing it made 12 of 10,819 real files fail for
 * no reason. `svg:` itself is just the SVG namespace spelled out, so `<svg:rect>` is a rect.
 */
function localName(tagName: string): string | null {
  const colon = tagName.indexOf(":");
  if (colon === -1) return tagName;
  return tagName.slice(0, colon) === "svg" ? tagName.slice(colon + 1) : null;
}

/**
 * The text of every `<style>` block in the document, wherever it sits - commonly inside `<defs>`,
 * which the walk skips, so it has to be gathered in its own pass over the whole tree.
 */
function stylesheetOf(node: XmlNode, out: string[] = [], depth = 0): string[] {
  if (depth > MAX_DEPTH) return out;
  if (node.type === "element" && localName(node.tagName) === "style") {
    for (const child of node.children ?? []) {
      if (child.type === "text") out.push(child.value);
    }
    return out;
  }
  for (const child of elements(node)) stylesheetOf(child, out, depth + 1);
  return out;
}

/** The element children of a node; a text node is not one. */
const elements = (node: XmlNode): XmlElement[] =>
  node.type === "element"
    ? node.children.filter((child): child is XmlElement => child.type === "element")
    : [];

/**
 * Reads the root `<svg>` and returns the matrix that maps its user space onto `target`, plus the
 * intrinsic size. The `viewBox` scales UNIFORMLY and centres - SVG's default `preserveAspectRatio`
 * ("xMidYMid meet"). Choosing the target box is the caller's job, so `BoxFit` keeps meaning the same
 * thing it means for a bitmap.
 */
function rootMapping(root: XmlElement, target: SvgTarget): { matrix: Affine; size: SvgSize } {
  const attributes = attributesOf(root);
  const box = String(attributes["viewBox"] ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const hasBox =
    box.length === 4 && box.every((n) => Number.isFinite(n)) && box[2]! > 0 && box[3]! > 0;

  const declaredW = Number(attributes["width"]);
  const declaredH = Number(attributes["height"]);
  const size: SvgSize = {
    width:
      Number.isFinite(declaredW) && declaredW > 0 ? declaredW : hasBox ? box[2]! : target.width,
    height:
      Number.isFinite(declaredH) && declaredH > 0 ? declaredH : hasBox ? box[3]! : target.height,
  };

  // We always scale uniformly and centre, which is SVG's default "xMidYMid meet". Any other value
  // moves or crops the drawing, so it is named rather than quietly ignored.
  const par = String(attributes["preserveAspectRatio"] ?? "").trim();
  if (par !== "" && !/^xMidYMid(\s+meet)?$/.test(par)) {
    throw new SvgUnsupportedError(
      `preserveAspectRatio="${par}"`,
      'Only the default "xMidYMid meet" is honoured. Size the drawing through width/height instead.',
    );
  }

  const [vx, vy, vw, vh] = hasBox ? box : [0, 0, size.width, size.height];
  const scale = Math.min(target.width / vw!, target.height / vh!);
  const dx = target.x + (target.width - vw! * scale) / 2;
  const dy = target.y + (target.height - vh! * scale) / 2;
  // Place, then scale, then bring the viewBox origin to zero.
  return {
    matrix: multiply([scale, 0, 0, scale, dx, dy], [1, 0, 0, 1, -vx!, -vy!]),
    size,
  };
}

/**
 * Attributes that CHANGE the picture and that we cannot honour. Ignoring one does not lose a detail -
 * it draws something the file did not describe: a drop-shadow logo as a hard silhouette. `clip-path`
 * used to be listed here; it is resolved now, which is the honest version of the same rule.
 */
const REFUSED_ATTRIBUTES: Record<string, string> = {
  mask: "Masks are pixel operations; flatten the artwork in your editor instead.",
  filter: "Filters are pixel operations; rasterise that part to a PNG instead.",
};

function refuseAttributes(tagName: string, read: (name: string) => string | undefined): void {
  for (const [name, hint] of Object.entries(REFUSED_ATTRIBUTES)) {
    const value = read(name);
    // `none` is the explicit absence of one, which is nothing to refuse.
    if (value !== undefined && value.trim() !== "none") {
      throw new SvgUnsupportedError(`"${name}" on <${tagName}>`, hint);
    }
  }
}

interface ClipShape {
  commands: PathCommand[];
  fillRule?: "nonzero" | "evenodd";
}

/**
 * The `<clipPath>` definitions, by id. Their children are flattened into ONE command list, because a
 * clip is a single path in PDF - which is also what SVG means: several children clip to their union.
 *
 * A child's own `transform` is baked into the coordinates rather than left in the graphics state: a
 * clip is set from the path in the CURRENT space, so there is no state to put it in.
 */
function clipPathsOf(
  node: XmlNode,
  into = new Map<string, ClipShape>(),
  depth = 0,
): Map<string, ClipShape> {
  if (depth > MAX_DEPTH) return into;
  if (node.type === "element" && localName(node.tagName) === "clipPath") {
    const attributes = attributesOf(node);
    const id = attributes["id"] === undefined ? undefined : String(attributes["id"]);
    if (id !== undefined) {
      // `objectBoundingBox` units scale the clip to each user's bounding box - a different geometry,
      // not a harder one, and nothing in the corpus used it. Named rather than silently mistaken.
      if (String(attributes["clipPathUnits"] ?? "userSpaceOnUse") !== "userSpaceOnUse") {
        throw new SvgUnsupportedError(
          'clipPathUnits="objectBoundingBox"',
          "Only userSpaceOnUse is resolved. Flatten the clip in your editor.",
        );
      }
      const own = attributes["transform"]
        ? parseTransform(String(attributes["transform"]))
        : IDENTITY;
      const commands: PathCommand[] = [];
      let fillRule: "nonzero" | "evenodd" | undefined;
      for (const child of elements(node)) {
        const childAttributes = attributesOf(child);
        const shape = shapeOf(localName(child.tagName) ?? "", childAttributes);
        if (!shape) continue;
        const childTransform = childAttributes["transform"]
          ? parseTransform(String(childAttributes["transform"]))
          : IDENTITY;
        const matrix = multiply(own, childTransform);
        commands.push(...(isIdentity(matrix) ? shape : transformCommands(shape, matrix)));
        // SVG spells the clip's winding rule `clip-rule`; it sits on the child, not the clipPath.
        if (String(childAttributes["clip-rule"] ?? "") === "evenodd") fillRule = "evenodd";
      }
      into.set(id, { commands, fillRule });
    }
    return into;
  }
  for (const child of elements(node)) clipPathsOf(child, into, depth + 1);
  return into;
}

/** The shape's own `fill-opacity`/`opacity` multiply into the gradient's, exactly as they do into a
 *  solid colour's alpha. */
const gradientWithAlpha = (gradient: Gradient, alpha: number): Gradient =>
  alpha >= 1 ? gradient : { ...gradient, alpha: (gradient.alpha ?? 1) * alpha };

/** A referenced gradient, or a named error - SVG says an unresolvable paint reference is invalid. */
function gradientDef(defs: ReadonlyMap<string, GradientDef>, id: string): GradientDef {
  const def = defs.get(id);
  if (!def) {
    throw new SvgUnsupportedError(
      `fill="url(#${id})" - no gradient with that id in this file`,
      "It may be a <pattern>, which is not supported, or a broken reference.",
    );
  }
  return def;
}

/** The id inside a `url(#id)` reference, or null if the value is not one. */
function referenceId(value: string): string | null {
  return /^url\(\s*#([^)\s]+)\s*\)$/.exec(value.trim())?.[1] ?? null;
}

/**
 * How deep the element tree may nest. The walk is recursive, so a pathological file - generated,
 * corrupt, or hostile - would otherwise blow the call stack with a raw `RangeError` instead of an
 * error the caller can act on. Real drawings nest a couple of dozen deep at most.
 */
const MAX_DEPTH = 256;

function walk(
  node: XmlElement,
  parentStyle: SvgStyle,
  rules: readonly CssRule[],
  clips: ReadonlyMap<string, ClipShape>,
  gradients: ReadonlyMap<string, GradientDef>,
  out: IRNode[],
  depth = 0,
): void {
  if (depth > MAX_DEPTH) {
    throw new SvgParseError(
      `the SVG nests more than ${MAX_DEPTH} levels deep - it is not a drawing.`,
    );
  }
  const tagName = localName(node.tagName);
  if (tagName === null || IGNORED.has(tagName)) return;
  // A clipPath's own children are geometry for the clip, never ink.
  if (tagName === "clipPath") return;

  const attributes = attributesOf(node);
  const css = declarationsFor(rules, tagName, {
    class: attributes["class"],
    id: attributes["id"],
  });
  // Everything below reads through the cascade, not the raw attributes: `filter="url(#f)"` and
  // `style="filter:url(#f)"` are the same instruction, and a `<style>` rule can set either.
  const read = cascadedReader(attributes, css);
  refuseAttributes(tagName, read);
  const style = resolveStyle(parentStyle, attributes, css);
  const transform = attributes["transform"]
    ? parseTransform(String(attributes["transform"]))
    : IDENTITY;
  const wrapped = !isIdentity(transform);
  if (wrapped) out.push({ type: "transform-push", matrix: transform });

  // The clip is pushed INSIDE the element's own transform, because that is the space its `url(#id)`
  // reference is written in - the same rule SVG states for userSpaceOnUse.
  const clipValue = read("clip-path") ?? "";
  const clipId = clipValue.trim() === "none" ? null : referenceId(clipValue);
  const clip = clipId === null ? undefined : clips.get(clipId);
  if (clipId !== null && clip === undefined) {
    // Per SVG a reference to a missing clipPath makes the element invalid, so silently drawing it
    // unclipped would be the one thing we must not do.
    throw new SvgUnsupportedError(
      `clip-path="${clipValue}" - no <clipPath id="${clipId}"> in this file`,
      "The reference is broken; remove it or add the definition.",
    );
  }
  if (clip) {
    out.push({ type: "clip-path-push", commands: clip.commands, fillRule: clip.fillRule });
  }

  if (tagName === "svg") {
    // A nested <svg> establishes its own viewport: x/y/width/height plus a viewBox, and it clips.
    // Walking it as a plain group would place and scale its children wrong, silently. None of the
    // 10,819 files measured contains one, so it is named rather than built.
    throw new SvgUnsupportedError(
      "a nested <svg> element",
      "It establishes its own viewport. Flatten it into the outer drawing in your editor.",
    );
  }

  if (tagName === "g") {
    for (const child of elements(node)) walk(child, style, rules, clips, gradients, out, depth + 1);
  } else {
    const commands = shapeOf(tagName, attributes);
    if (commands === null) {
      throw new SvgUnsupportedError(
        `the SVG element <${tagName}>`,
        HINTS[tagName] ?? "It is not part of the supported subset yet.",
      );
    }
    // A shape with neither fill nor stroke, or with no geometry, paints nothing - and an empty Path
    // node would only cost bytes.
    if (commands.length > 0 && (style.fill || style.stroke)) {
      // A gradient is resolved HERE too, and for the same reason: in its default units its anchors
      // are fractions of the SHAPE's bounding box, which only exists at this point.
      const shapeAlpha = style.fillOpacity * style.opacity;
      const fill = isPaintRef(style.fill)
        ? gradientWithAlpha(
            resolveSvgGradient(gradientDef(gradients, style.fill.ref), gradients, commands),
            shapeAlpha,
          )
        : style.fill && paintAlpha(style.fill, shapeAlpha);
      // The opacities are applied HERE, once, on the shape that paints - see `paintAlpha`.
      out.push({
        type: "path",
        commands,
        fill,
        fillRule: style.fillRule,
        stroke: style.stroke && {
          ...style.stroke,
          color: paintAlpha(style.stroke.color, style.strokeOpacity * style.opacity),
        },
      });
    }
  }

  if (clip) out.push({ type: "clip-pop" });
  if (wrapped) out.push({ type: "transform-pop" });
}

/** Parses `source` and returns the root element, rejecting anything that is not an SVG document. */
function rootOf(source: string): XmlElement {
  // A file named .svg is not necessarily SVG - the corpus turned up build-cache blobs with that
  // extension. Say so here rather than let the parser die on the binary with a TypeError.
  if (!/<svg[\s>]/i.test(source)) {
    throw new SvgParseError(
      // oxlint-disable-next-line no-control-regex -- spotting control bytes is the whole point here.
      /[\u0000-\u0008\u000E-\u001F]/.test(source.slice(0, 200))
        ? "this is not an SVG file - it starts with binary data."
        : "no <svg> element found - is this really an SVG file?",
    );
  }
  const roots = parseXml(source);
  const root = roots.find((node) => localName(node.tagName) === "svg");
  if (!root) throw new SvgParseError("no root <svg> element - is this really an SVG file?");
  return root;
}

/** The intrinsic size, for sizing an `<Image>` that gives only one dimension (or none). */
export function svgSize(source: string): SvgSize {
  return rootMapping(rootOf(source), { x: 0, y: 0, width: 1, height: 1 }).size;
}

/**
 * An SVG document as display-list nodes, placed in `target`. Coordinates stay in the SVG's own user
 * space and the mapping rides in the graphics state, so a stroke scales with the drawing - which is
 * what SVG specifies and what a flattened implementation gets wrong.
 */
export function svgToIr(source: string, target: SvgTarget): IRNode[] {
  const root = rootOf(source);
  const { matrix } = rootMapping(root, target);
  // The outermost <svg> is a VIEWPORT: it clips to itself (CSS `overflow: hidden` on the root svg).
  // Without this a shape that pokes past the viewBox - a stroke on the edge, a rounded cap - bleeds
  // into whatever sits beside the drawing in the layout. Measured against headless Chrome, which
  // clips exactly here.
  const out: IRNode[] = [
    { type: "clip-push", x: target.x, y: target.y, width: target.width, height: target.height },
    { type: "transform-push", matrix },
  ];
  const rules = parseStylesheet(stylesheetOf(root).join("\n"));
  const clips = clipPathsOf(root);
  const gradients = gradientsOf(root);
  // The root <svg> carries presentation attributes of its own, and 778 of 10,819 real files put
  // `fill="none"` there - the Figma export default. Skipping them filled every shape that has no
  // fill of its own with BLACK, which covered the drawing underneath.
  const rootAttributes = attributesOf(root);
  const rootCss = declarationsFor(rules, "svg", {
    class: rootAttributes["class"],
    id: rootAttributes["id"],
  });
  // The root is held to the same rule as its children: a filter or mask on it changes the picture.
  refuseAttributes("svg", cascadedReader(rootAttributes, rootCss));
  const rootStyle = resolveStyle(ROOT_STYLE, rootAttributes, rootCss);
  for (const child of elements(root)) walk(child, rootStyle, rules, clips, gradients, out, 1);
  out.push({ type: "transform-pop" }, { type: "clip-pop" });
  return out;
}
