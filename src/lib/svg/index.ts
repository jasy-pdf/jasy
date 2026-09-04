import { parse, type SvgAstNode, type SvgElementNode } from "svg-parser";
import type { IRNode } from "../ir/display-list.ts";
import type { Affine } from "../utils/ttf-parser.ts";
import { SvgParseError, SvgUnsupportedError } from "./errors.ts";
import { IDENTITY, isIdentity, multiply, parseTransform } from "./transform.ts";
import { shapeOf } from "./shapes.ts";
import { ROOT_STYLE, paintAlpha, resolveStyle, type Attributes, type SvgStyle } from "./style.ts";

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
 * which is the place that can say what is missing.
 */
const IGNORED = new Set(["defs", "title", "desc", "metadata", "style"]);

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

const attributesOf = (node: SvgElementNode): Attributes => node.properties ?? {};

const elements = (node: SvgAstNode): SvgElementNode[] =>
  (("children" in node && node.children) || []).filter(
    (child): child is SvgElementNode => child.type === "element",
  );

/**
 * Reads the root `<svg>` and returns the matrix that maps its user space onto `target`, plus the
 * intrinsic size. The `viewBox` scales UNIFORMLY and centres - SVG's default `preserveAspectRatio`
 * ("xMidYMid meet"). Choosing the target box is the caller's job, so `BoxFit` keeps meaning the same
 * thing it means for a bitmap.
 */
function rootMapping(root: SvgElementNode, target: SvgTarget): { matrix: Affine; size: SvgSize } {
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

function walk(node: SvgElementNode, parentStyle: SvgStyle, out: IRNode[]): void {
  const tagName = node.tagName ?? "";
  if (IGNORED.has(tagName)) return;

  const attributes = attributesOf(node);
  const style = resolveStyle(parentStyle, attributes);
  const transform = attributes["transform"]
    ? parseTransform(String(attributes["transform"]))
    : IDENTITY;
  const wrapped = !isIdentity(transform);
  if (wrapped) out.push({ type: "transform-push", matrix: transform });

  if (tagName === "g" || tagName === "svg") {
    for (const child of elements(node)) walk(child, style, out);
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
      // The opacities are applied HERE, once, on the shape that paints - see `paintAlpha`.
      out.push({
        type: "path",
        commands,
        fill: style.fill && paintAlpha(style.fill, style.fillOpacity * style.opacity),
        fillRule: style.fillRule,
        stroke: style.stroke && {
          ...style.stroke,
          color: paintAlpha(style.stroke.color, style.strokeOpacity * style.opacity),
        },
      });
    }
  }

  if (wrapped) out.push({ type: "transform-pop" });
}

/** Parses `source` and returns the root element, rejecting anything that is not an SVG document. */
function rootOf(source: string): SvgElementNode {
  let tree;
  try {
    tree = parse(source);
  } catch (error) {
    throw new SvgParseError(`the SVG could not be parsed: ${(error as Error).message}`);
  }
  const root = elements(tree).find((node) => node.tagName === "svg");
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
  const out: IRNode[] = [{ type: "transform-push", matrix }];
  for (const child of elements(root)) walk(child, ROOT_STYLE, out);
  out.push({ type: "transform-pop" });
  return out;
}
