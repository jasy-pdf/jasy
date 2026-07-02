import { IRNode } from "../ir/display-list.ts";
import { Color } from "../common/color.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import type { PageStructContext } from "../utils/struct-tree.ts";

/**
 * PDF backend - turns display-list primitives into content-stream operators.
 *
 * This is "the renderer" in the pure sense: it consumes only `IRNode`s and knows
 * nothing about components. Each primitive maps to the exact operators previously
 * emitted inline by the per-element renderers, so output stays byte-identical while
 * the renderers are migrated onto the IR one at a time.
 */
export class PdfBackend {
  /**
   * Flip a display list from the engine's top-left origin (y grows downward) to PDF's
   * bottom-left origin (y grows upward). This is the ONE place the Y axis is flipped -
   * elements above this seam are coordinate-system-blind. Each primitive flips around
   * its own anchor: a rect/image around its bottom edge, a text baseline / line point
   * directly. (image is migrated in a later slice and still arrives pre-flipped.)
   */
  static flipY(nodes: IRNode[], pageHeight: number): IRNode[] {
    return nodes.map((node) => {
      switch (node.type) {
        case "rect":
          return { ...node, y: pageHeight - node.y - node.height };
        case "line":
          return {
            ...node,
            y1: pageHeight - node.y1,
            y2: pageHeight - node.y2,
          };
        case "text":
          // node.y is the baseline measured from the page top; flip it directly.
          return { ...node, y: pageHeight - node.y };
        case "image": {
          // Flip the placement box (and the clip frame, if any) around its bottom edge.
          const flipped = { ...node, y: pageHeight - node.y - node.height };
          if (node.clip) {
            flipped.clip = {
              ...node.clip,
              y: pageHeight - node.clip.y - node.clip.height,
            };
          }
          return flipped;
        }
        case "clip-push":
          // Flip the clip rect around its bottom edge, like a rect.
          return { ...node, y: pageHeight - node.y - node.height };
        case "clip-pop":
          return node;
        case "path": {
          // Flip every point's y directly (like a line endpoint); `z` carries no coordinates.
          const commands = node.commands.map((c) => {
            if (c.op === "z") return c;
            if (c.op === "c") {
              return { ...c, y1: pageHeight - c.y1, y2: pageHeight - c.y2, y: pageHeight - c.y };
            }
            return { ...c, y: pageHeight - c.y };
          });
          // A gradient fill carries its own page-space anchor points; flip their y too (radii and
          // x stay). A solid Color fill has no geometry.
          const fill =
            node.fill instanceof Color
              ? node.fill
              : { ...node.fill, y0: pageHeight - node.fill.y0, y1: pageHeight - node.fill.y1 };
          return { ...node, commands, fill };
        }
        default: {
          const unknown: never = node;
          return unknown;
        }
      }
    });
  }

  /** Serialize a whole display list into one content stream (page-level entry point). When a
   *  `PageStructContext` is given (accessible tagging on), each drawable node is wrapped in a marked-content
   *  sequence (`/Role <</MCID n>> BDC … EMC`, or `/Artifact` when untagged); graphics-state and empty nodes
   *  pass through untouched, so untagged output stays byte-identical. */
  static serialize(nodes: IRNode[], om: PDFObjectManager, struct?: PageStructContext): string {
    return nodes
      .map((node) => {
        const ops = PdfBackend.serializeNode(node, om);
        if (!struct || node.type === "clip-push" || node.type === "clip-pop" || ops === "")
          return ops;
        const { open, close } = struct.mark(node.tag);
        return open + ops + close;
      })
      .join("");
  }

  /**
   * Escapes a string for a PDF literal string `( ... )`. The backslash must be doubled
   * first, then the parentheses that delimit the string. Without this, a ")" in the
   * text closes the string early and the remaining characters leak as raw operators.
   */
  static escapePdfString(text: string): string {
    return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  /**
   * Returns the `/GSx gs` operator that selects a transparency state, or `""` when both
   * alphas are fully opaque. Opaque draws emit nothing here, so output stays
   * byte-identical until transparency is actually used.
   */
  private static alphaPrefix(om: PDFObjectManager, fillAlpha: number, strokeAlpha: number): string {
    if (fillAlpha >= 1 && strokeAlpha >= 1) return "";
    return `/${om.registerExtGState(fillAlpha, strokeAlpha)} gs\n`;
  }

  /**
   * Path operators for a rounded rectangle: bottom-left at (x,y), size w×h, corner
   * radius `radius` (clamped to half the smaller side). Corners are 90° Bézier arcs
   * (kappa ≈ 0.5523). Returns m/l/c/h ops WITHOUT the paint operator.
   */
  private static roundedRectPath(
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
  ): string {
    const r = Math.min(radius, w / 2, h / 2);
    const c = r * 0.5523; // control-point offset that approximates a quarter circle
    const f = (n: number) => n.toFixed(3);
    const xr = x + r;
    const xwr = x + w - r;
    const xw = x + w;
    const yr = y + r;
    const yhr = y + h - r;
    const yh = y + h;
    return (
      `${f(xr)} ${f(y)} m\n` +
      `${f(xwr)} ${f(y)} l\n` +
      `${f(xwr + c)} ${f(y)} ${f(xw)} ${f(yr - c)} ${f(xw)} ${f(yr)} c\n` +
      `${f(xw)} ${f(yhr)} l\n` +
      `${f(xw)} ${f(yhr + c)} ${f(xwr + c)} ${f(yh)} ${f(xwr)} ${f(yh)} c\n` +
      `${f(xr)} ${f(yh)} l\n` +
      `${f(xr - c)} ${f(yh)} ${f(x)} ${f(yhr + c)} ${f(x)} ${f(yhr)} c\n` +
      `${f(x)} ${f(yr)} l\n` +
      `${f(x)} ${f(yr - c)} ${f(xr - c)} ${f(y)} ${f(xr)} ${f(y)} c\n` +
      `h`
    );
  }

  /**
   * Serialize a single display-list node to its content-stream operators.
   * `om` is used only by primitives that allocate PDF resources (images, fonts).
   */
  static serializeNode(node: IRNode, om: PDFObjectManager): string {
    switch (node.type) {
      case "line":
        // q/Q isolates the graphics state; "[] 0 d" resets the dash pattern to solid.
        return (
          `q\n` +
          PdfBackend.alphaPrefix(om, 1, node.stroke.getAlpha()) +
          `${node.strokeWidth} w\n` +
          `${node.stroke.toPDFColorString()} RG\n` +
          `[] 0 d\n` +
          `${node.x1} ${node.y1} m\n` +
          `${node.x2} ${node.y2} l\n` +
          `S\n` +
          `Q\n`
        );
      case "rect": {
        // Stroke only with a stroke color AND a positive width - a 0-width border means
        // "no border" (e.g. a filled box with no outline). Nothing to paint at all (no
        // fill, no border) draws nothing. Paint: B = fill+stroke, f = fill, S = stroke.
        const doStroke = !!node.stroke && (node.strokeWidth ?? 0) > 0;
        if (!node.fill && !doStroke) return "";
        let ops = "";
        if (doStroke) {
          ops += `${node.strokeWidth} w\n${node.stroke!.toPDFColorString()} RG\n`;
        }
        if (node.fill) ops += `${node.fill.toPDFColorString()} rg\n`;
        const paint = node.fill ? (doStroke ? "B" : "f") : "S";
        // Rounded corners emit a Bézier path; sharp corners keep the plain `re`
        // (byte-identical when no radius is set).
        const path =
          (node.radius ?? 0) > 0
            ? PdfBackend.roundedRectPath(node.x, node.y, node.width, node.height, node.radius!)
            : `${node.x} ${node.y} ${node.width} ${node.height} re`;
        const body = ops + `${path} ${paint}\n`;
        // Transparency needs an isolating q/Q so the state does not leak; opaque rects
        // keep their bare operators (byte-identical).
        const gs = PdfBackend.alphaPrefix(
          om,
          node.fill?.getAlpha() ?? 1,
          doStroke ? node.stroke!.getAlpha() : 1,
        );
        return gs ? `q\n${gs}${body}Q\n` : body;
      }
      case "text": {
        // One self-contained text block per run. The producer has already resolved
        // absolute position, font and color; the backend only allocates the font
        // resource and emits the operators. The text is escaped for PDF literal-string
        // syntax so parentheses/backslashes can't break out of the string.
        // Embedded (custom) fonts: pick the family variant for this style (falling back to the
        // family's Normal), select its Identity-H Type0 resource and emit hex glyph ids - both
        // from the SAME variant. Standard fonts keep the WinAnsi literal string, byte-identical.
        const isCustom = om.isCustomFont(node.fontFamily, node.fontStyle);
        const font = isCustom
          ? om.getCustomFontResource(node.fontFamily, node.fontStyle)!
          : om.registerFont(node.fontFamily, node.fontStyle);
        const textOp = isCustom
          ? `<${om.encodeCustomText(node.fontFamily, node.text, node.fontStyle)}>`
          : `(${PdfBackend.escapePdfString(node.text)})`;
        const block =
          `BT\n` +
          `${node.color.toPDFColorString()} rg ` +
          `/F${font.fontIndex} ${node.fontSize} Tf ` +
          `${node.x.toFixed(3)} ${node.y.toFixed(3)} Td ` +
          `${textOp} Tj\n` +
          `ET\n`;
        // Transparent text gets an isolating q/Q + gs; opaque text is byte-identical.
        const gs = PdfBackend.alphaPrefix(om, node.color.getAlpha(), 1);
        return gs ? `q\n${gs}${block}Q\n` : block;
      }
      case "image": {
        // The backend owns PDF resource creation: register the XObject (using the
        // source pixel dimensions) and then place it with a scaling matrix.
        const ref = om.registerImage(
          node.intrinsicWidth,
          node.intrinsicHeight,
          node.imageType,
          node.data,
          node.smask,
        );
        const draw =
          `q\n${node.width} 0 0 ${node.height} ${node.x} ${node.y} cm\n` + `/IM${ref} Do\nQ\n`;
        if (!node.clip) return draw;
        // Clip to the frame (re … W n); rounded when a radius is set. The rectangular
        // path is byte-identical to before.
        const c = node.clip;
        const clipPath =
          (node.radius ?? 0) > 0
            ? PdfBackend.roundedRectPath(c.x, c.y, c.width, c.height, node.radius!)
            : `${c.x} ${c.y} ${c.width} ${c.height} re `;
        return `q\n${clipPath}\nW n \n` + draw + `Q\n`;
      }
      case "clip-push": {
        // Save the graphics state and intersect the clip with this (rounded) rect. Everything
        // drawn until the matching clip-pop is cropped to it.
        const path =
          (node.radius ?? 0) > 0
            ? PdfBackend.roundedRectPath(node.x, node.y, node.width, node.height, node.radius!)
            : `${node.x} ${node.y} ${node.width} ${node.height} re`;
        return `q\n${path}\nW n\n`;
      }
      case "path": {
        // A filled vector path (one color-glyph layer). Emit the subpath ops, then either a solid
        // nonzero fill (a Color) or, for a gradient, clip to the path and paint a shading inside it.
        const f = (n: number) => n.toFixed(3);
        let path = "";
        for (const c of node.commands) {
          if (c.op === "m") path += `${f(c.x)} ${f(c.y)} m\n`;
          else if (c.op === "l") path += `${f(c.x)} ${f(c.y)} l\n`;
          else if (c.op === "c")
            path += `${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)} c\n`;
          else path += `h\n`;
        }
        if (!(node.fill instanceof Color)) {
          // Gradient: clip to the path (W n keeps it as the clip without painting it), then paint
          // the registered shading across that clip. The q/Q isolates the clip. Note: per-stop alpha
          // is not represented (a DeviceRGB shading has no alpha channel - that would need a soft-mask
          // group); COLR gradient stops are opaque in real fonts, so they render correctly.
          const shading = om.registerShading(node.fill);
          return `q\n${path}W n\n/${shading} sh\nQ\n`;
        }
        const body = `${node.fill.toPDFColorString()} rg\n${path}f\n`;
        const gs = PdfBackend.alphaPrefix(om, node.fill.getAlpha(), 1);
        return gs ? `q\n${gs}${body}Q\n` : body;
      }
      case "clip-pop":
        return `Q\n`;
      default: {
        // Exhaustiveness guard: if a new IRNode variant is added, this fails to compile.
        const unknown: never = node;
        throw new Error(`PdfBackend: unhandled IR node ${JSON.stringify(unknown)}`);
      }
    }
  }
}
