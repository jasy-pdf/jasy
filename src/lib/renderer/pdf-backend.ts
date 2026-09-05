import {
  IRNode,
  Radii,
  isRounded,
  type PathCommand,
  type StrokeStyle,
} from "../ir/display-list.ts";
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
        case "rect": {
          // A gradient fill carries its own page-space anchors; flip them with the box (see "path").
          const fill =
            node.fill === undefined || node.fill instanceof Color
              ? node.fill
              : { ...node.fill, y0: pageHeight - node.fill.y0, y1: pageHeight - node.fill.y1 };
          return { ...node, y: pageHeight - node.y - node.height, fill };
        }
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
        case "clip-path-push":
          // Its commands live in the same space as a Path's, so they flip the same way.
          return {
            ...node,
            commands: node.commands.map((c) => {
              if (c.op === "z") return c;
              if (c.op === "c") {
                return { ...c, y1: pageHeight - c.y1, y2: pageHeight - c.y2, y: pageHeight - c.y };
              }
              return { ...c, y: pageHeight - c.y };
            }),
          };
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
            node.fill === undefined || node.fill instanceof Color
              ? node.fill
              : { ...node.fill, y0: pageHeight - node.fill.y0, y1: pageHeight - node.fill.y1 };
          return { ...node, commands, fill };
        }
        case "link":
          // A link's clickable rect flips around its bottom edge, exactly like a rect.
          return { ...node, y: pageHeight - node.y - node.height };
        case "formfield":
          // A form field's box flips around its bottom edge, exactly like a link rect.
          return { ...node, y: pageHeight - node.y - node.height };
        case "outline":
          // An outline anchor is a single point (the target's top); flip it like a text baseline.
          return { ...node, y: pageHeight - node.y };
        case "anchor":
          // A named-destination anchor is a single point (the target's top), flipped like a baseline.
          return { ...node, y: pageHeight - node.y };
        case "transform-push": {
          // The child nodes are flipped from top-left to bottom-left by F = [1,0,0,-1,0,H] (F is its
          // own inverse). For a matrix authored in top-left space to act correctly on them, conjugate
          // it by that flip: M_pdf = F · M · F. Worked out for [a,b,c,d,e,f] with H = pageHeight:
          const [a, b, c, d, e, f] = node.matrix;
          const H = pageHeight;
          return {
            ...node,
            matrix: [a, -b, -c, d, H * c + e, H - H * d - f] as [
              number,
              number,
              number,
              number,
              number,
              number,
            ],
          };
        }
        case "transform-pop":
          return node; // no coordinates to flip
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
  /**
   * Every number reaching the backend must be finite. A non-finite coordinate is a layout bug, but
   * silence turns it into a corrupt PDF: `Infinity` is written into the operator stream verbatim, and a
   * viewer then discards everything from that point on - including the footer, which is drawn last. That
   * failure is invisible until somebody opens the file, so we refuse instead.
   *
   * Checks the node's numbers, not the serialized text: a document containing the WORD "Infinity" is
   * perfectly legal and must not trip this.
   */
  private static assertFinite(node: IRNode): void {
    const finite = (value: unknown): boolean => {
      if (typeof value === "number") return Number.isFinite(value);
      if (Array.isArray(value)) return value.every(finite);
      if (value !== null && typeof value === "object") return Object.values(value).every(finite);
      return true;
    };
    if (!finite(node)) {
      throw new Error(
        `Layout produced a non-finite number on a "${node.type}" node, refusing to emit a corrupt ` +
          `content stream. This is a bug in an element's calculateLayout (a size resolved to Infinity ` +
          `or NaN), not in your document.`,
      );
    }
  }

  static serialize(nodes: IRNode[], om: PDFObjectManager, struct?: PageStructContext): string {
    return nodes
      .map((node) => {
        PdfBackend.assertFinite(node);
        const ops = PdfBackend.serializeNode(node, om);
        // Two kinds of node skip the marked-content wrapper, both because they carry no tag and never
        // draw: GRAPHICS-STATE nodes (clip / transform push+pop) only save/restore state around the
        // drawables they enclose, and SIDE-CHANNEL nodes (link, outline, anchor) become annotations /
        // catalog entries instead of content-stream operators.
        if (
          !struct ||
          node.type === "clip-push" ||
          node.type === "clip-path-push" ||
          node.type === "clip-pop" ||
          node.type === "transform-push" ||
          node.type === "transform-pop" ||
          node.type === "link" ||
          node.type === "outline" ||
          node.type === "anchor" ||
          node.type === "formfield" ||
          ops === ""
        )
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
   * Builds the `[ ... ]` operand of a `TJ` from a run and its per-gap kern adjustments (em/1000, the
   * sign the font declares). Generic over the UNIT so the same chunking serves both paths: characters
   * for a WinAnsi run, glyph ids for a shaped one - a shaped run cannot be expressed as text.
   * A `TJ` number moves the pen LEFT, so it is the NEGATED kern. Consecutive un-kerned glyphs stay in
   * one encoded chunk, so `[(T) 40 (otal)]` rather than one chunk per glyph. `kerns[i]` is the
   * adjustment AFTER code point `i`.
   */
  static kernedArray<T>(
    units: readonly T[],
    kerns: number[],
    encode: (chunk: T[]) => string,
  ): string {
    const gaps = Math.max(0, units.length - 1);
    if (kerns.length !== gaps) {
      // The loop walks the GAPS, so a short list would drop the units past it - silently, and only the
      // last glyph, which is exactly the kind of thing nobody notices until a word reads wrong. An
      // empty run has no gaps at all, so any adjustment for one is a disagreement too.
      throw new Error(
        `@jasy/pdf: ${kerns.length} kern adjustments for ${units.length} units - expected ${gaps}.`,
      );
    }
    let out = "";
    let chunk: T[] = units.length > 0 ? [units[0]!] : [];
    for (let i = 0; i < kerns.length; i++) {
      if (kerns[i] === 0) {
        chunk.push(units[i + 1]!);
      } else {
        out += encode(chunk) + ` ${-kerns[i]} `;
        chunk = [units[i + 1]!];
      }
    }
    return `[${out}${encode(chunk)}]`;
  }

  /** The path-construction operators for a command list. Shared by a filled path and by a clip. */
  private static pathOps(commands: readonly PathCommand[]): string {
    const f = (n: number) => n.toFixed(3);
    let out = "";
    for (const c of commands) {
      if (c.op === "m") out += `${f(c.x)} ${f(c.y)} m\n`;
      else if (c.op === "l") out += `${f(c.x)} ${f(c.y)} l\n`;
      else if (c.op === "c")
        out += `${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)} c\n`;
      else out += `h\n`;
    }
    return out;
  }

  /**
   * The graphics-state operators for a stroke, in the order a content stream wants them. Only what
   * differs from the PDF default is emitted, EXCEPT the miter limit: SVG's initial value is 4 and
   * PDF's is 10, so a mitered join has to say so or a sharp corner grows a spike the source never had.
   * The caller isolates these in a q/Q - `d` in particular would otherwise dash every later stroke.
   */
  private static strokeState(stroke: StrokeStyle): string {
    const CAPS = { butt: 0, round: 1, square: 2 };
    const JOINS = { miter: 0, round: 1, bevel: 2 };
    let ops = `${stroke.width} w\n${stroke.color.toPDFColorString()} RG\n`;
    if (stroke.cap && stroke.cap !== "butt") ops += `${CAPS[stroke.cap]} J\n`;
    const join = stroke.join ?? "miter";
    if (join !== "miter") ops += `${JOINS[join]} j\n`;
    else ops += `${stroke.miterLimit ?? 4} M\n`;
    // A dash array of all zeros means "solid" in SVG but is an error in PDF, so it is dropped.
    if (stroke.dash && stroke.dash.length > 0 && stroke.dash.some((n) => n > 0)) {
      ops += `[${stroke.dash.join(" ")}] ${stroke.dashOffset ?? 0} d\n`;
    }
    return ops;
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
    radius: number | Radii,
  ): string {
    // Per corner, in PDF coordinates (y up). With all four equal this emits exactly the operators the
    // single-radius version did - the byte-identity guard for every document that never asks for one.
    const r = PdfBackend.clampRadii(radius, w, h);
    const k = 0.5523; // control-point offset that approximates a quarter circle
    const f = (n: number) => n.toFixed(3);
    const xw = x + w;
    const yh = y + h;
    return (
      `${f(x + r.bl)} ${f(y)} m\n` +
      `${f(xw - r.br)} ${f(y)} l\n` +
      `${f(xw - r.br + r.br * k)} ${f(y)} ${f(xw)} ${f(y + r.br - r.br * k)} ${f(xw)} ${f(y + r.br)} c\n` +
      `${f(xw)} ${f(yh - r.tr)} l\n` +
      `${f(xw)} ${f(yh - r.tr + r.tr * k)} ${f(xw - r.tr + r.tr * k)} ${f(yh)} ${f(xw - r.tr)} ${f(yh)} c\n` +
      `${f(x + r.tl)} ${f(yh)} l\n` +
      `${f(x + r.tl - r.tl * k)} ${f(yh)} ${f(x)} ${f(yh - r.tl + r.tl * k)} ${f(x)} ${f(yh - r.tl)} c\n` +
      `${f(x)} ${f(y + r.bl)} l\n` +
      `${f(x)} ${f(y + r.bl - r.bl * k)} ${f(x + r.bl - r.bl * k)} ${f(y)} ${f(x + r.bl)} ${f(y)} c\n` +
      `h`
    );
  }

  /**
   * Clamp the four radii into the box. Each is capped at half the box, and two radii sharing an edge
   * are scaled down together when they would overlap - the CSS rule, and what keeps the path from
   * folding back on itself.
   */
  private static clampRadii(radius: number | Radii, w: number, h: number): Required<Radii> {
    const n = typeof radius === "number" ? radius : 0;
    const cap = Math.max(0, Math.min(w, h) / 2);
    const at = (v: number | undefined) => Math.max(0, Math.min(v ?? n, cap));
    const r =
      typeof radius === "number"
        ? { tl: at(radius), tr: at(radius), br: at(radius), bl: at(radius) }
        : { tl: at(radius.tl), tr: at(radius.tr), br: at(radius.br), bl: at(radius.bl) };
    // Per-edge overlap: scale the whole set by the tightest edge, so the corners stay proportional.
    // An edge whose two corners are both 0 constrains NOTHING - it must not contribute a ratio of 0,
    // which would scale every other corner away with it.
    const ratio = (extent: number, a: number, b: number) =>
      a + b > 0 ? extent / (a + b) : Infinity;
    const scale = Math.min(
      1,
      ratio(w, r.tl, r.tr),
      ratio(w, r.bl, r.br),
      ratio(h, r.tl, r.bl),
      ratio(h, r.tr, r.br),
    );
    if (scale >= 1) return r;
    return { tl: r.tl * scale, tr: r.tr * scale, br: r.br * scale, bl: r.bl * scale };
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
        // Rounded corners emit a Bézier path; sharp corners keep the plain `re`
        // (byte-identical when no radius is set).
        const path = isRounded(node.radius)
          ? PdfBackend.roundedRectPath(node.x, node.y, node.width, node.height, node.radius!)
          : `${node.x} ${node.y} ${node.width} ${node.height} re`;

        // A gradient cannot be a fill COLOUR - PDF paints one with `sh`, which floods the current
        // clip. So the box becomes the clip, the shading is painted inside it, and a border is
        // stroked afterwards on its own. Solid fills keep the plain operators, byte for byte.
        const gradient =
          node.fill !== undefined && !(node.fill instanceof Color) ? node.fill : undefined;
        if (gradient) {
          const shading = om.registerShading(gradient);
          const gsFill = PdfBackend.alphaPrefix(om, gradient.alpha ?? 1, 1);
          let out = `q\n${gsFill}${path} W n\n/${shading} sh\nQ\n`;
          if (doStroke) {
            const gsStroke = PdfBackend.alphaPrefix(om, 1, node.stroke!.getAlpha());
            const stroke =
              `${node.strokeWidth} w\n${node.stroke!.toPDFColorString()} RG\n` + `${path} S\n`;
            out += gsStroke ? `q\n${gsStroke}${stroke}Q\n` : stroke;
          }
          return out;
        }

        const fill = node.fill as Color | undefined;
        let ops = "";
        if (doStroke) {
          ops += `${node.strokeWidth} w\n${node.stroke!.toPDFColorString()} RG\n`;
        }
        if (fill) ops += `${fill.toPDFColorString()} rg\n`;
        const paint = fill ? (doStroke ? "B" : "f") : "S";
        const body = ops + `${path} ${paint}\n`;
        // Transparency needs an isolating q/Q so the state does not leak; opaque rects
        // keep their bare operators (byte-identical).
        const gs = PdfBackend.alphaPrefix(
          om,
          fill?.getAlpha() ?? 1,
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
        const encode = (t: string): string =>
          isCustom
            ? `<${om.encodeCustomText(node.fontFamily, t, node.fontStyle, false)}>`
            : `(${PdfBackend.escapePdfString(t)})`;
        // A shaped run brings its own glyphs, already in drawing order - they cannot be derived from
        // the text here.
        const shapedHex =
          node.glyphs && isCustom
            ? om.registerGlyphs(node.fontFamily, node.glyphs, node.fontStyle)
            : undefined;
        // Kerning (if the document has it on): a `TJ` array with the font's per-pair adjustments
        // between glyph chunks, measured into the layout by the SAME numbers (runAdvance). A plain
        // `Tj` when the run has no kerning, byte-identical.
        // A shaped run brings its glyphs along, so kern those directly rather than re-deriving them
        // from the text - which would also have to guess the run's ligature setting.
        const kerns = !om.kerningEnabled
          ? []
          : node.glyphs && isCustom
            ? om.getGlyphKernPairs(node.glyphs, node.fontFamily, node.fontStyle)
            : // No glyph list means the run was NOT shaped, whatever the document asks for - so take the
              // character path explicitly. Letting it default would shape here, and a pair count that
              // does not match the character count silently drops the last one.
              om.getKernPairs(node.text, node.fontFamily, node.fontStyle, false);
        // A shaped run kerns too, over its SHAPED glyphs - `getKernPairs` returns one adjustment per
        // adjacent drawn pair either way, so both paths use the same numbers `runAdvance` measured.
        const showOp =
          node.glyphs && isCustom
            ? kerns.some((k) => k !== 0)
              ? `${PdfBackend.kernedArray(node.glyphs, kerns, (chunk) => `<${om.registerGlyphs(node.fontFamily, chunk, node.fontStyle)}>`)} TJ`
              : `<${shapedHex}> Tj`
            : kerns.some((k) => k !== 0)
              ? `${PdfBackend.kernedArray([...node.text], kerns, (chunk) => encode(chunk.join("")))} TJ`
              : `${encode(node.text)} Tj`;
        // letterSpacing is the `Tc` operator: extra advance after EVERY glyph (an embedded
        // Identity-H font too - that is `Tw`, word spacing, which only touches single-byte code 32).
        const spacing = node.letterSpacing ? `${node.letterSpacing.toFixed(3)} Tc\n` : "";
        const block =
          `BT\n` +
          `${node.color.toPDFColorString()} rg ` +
          `/F${font.fontIndex} ${node.fontSize} Tf ` +
          `${node.x.toFixed(3)} ${node.y.toFixed(3)} Td ` +
          `${showOp}\n` +
          `ET\n`;
        const gs = PdfBackend.alphaPrefix(om, node.color.getAlpha(), 1);
        // `Tc` is graphics state and would leak into the next run, so isolate it in q/Q - the same
        // reason transparent text is isolated. A run with neither stays byte-identical.
        return gs || spacing ? `q\n${gs}${spacing}${block}Q\n` : block;
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
        const clipPath = isRounded(node.radius)
          ? PdfBackend.roundedRectPath(c.x, c.y, c.width, c.height, node.radius!)
          : `${c.x} ${c.y} ${c.width} ${c.height} re `;
        return `q\n${clipPath}\nW n \n` + draw + `Q\n`;
      }
      case "clip-push": {
        // Save the graphics state and intersect the clip with this (rounded) rect. Everything
        // drawn until the matching clip-pop is cropped to it.
        const path = isRounded(node.radius)
          ? PdfBackend.roundedRectPath(node.x, node.y, node.width, node.height, node.radius!)
          : `${node.x} ${node.y} ${node.width} ${node.height} re`;
        return `q\n${path}\nW n\n`;
      }
      case "path": {
        // A vector path: a color-glyph layer (fill only) or an SVG shape (fill and/or stroke). Emit
        // the subpath ops once, then pick the painting operator from what the node actually carries.
        const path = PdfBackend.pathOps(node.commands);
        // The even-odd variants of the fill and clip operators are the same letter plus a star.
        const star = node.fillRule === "evenodd" ? "*" : "";
        const stroke = node.stroke;

        if (node.fill !== undefined && !(node.fill instanceof Color)) {
          // Gradient: clip to the path (W n keeps it as the clip without painting it), then paint
          // the registered shading across that clip. The q/Q isolates the clip. Note: per-stop alpha
          // is not represented (a DeviceRGB shading has no alpha channel - that would need a soft-mask
          // group); COLR gradient stops are opaque in real fonts, so they render correctly.
          // A stroke cannot share that q/Q: the clip would cut the outline in half, because a stroke
          // straddles the edge. So it is drawn afterwards, over the same path.
          const shading = om.registerShading(node.fill);
          const gsFill = PdfBackend.alphaPrefix(om, node.fill.alpha ?? 1, 1);
          const filled = `q\n${gsFill}${path}W${star} n\n/${shading} sh\nQ\n`;
          if (!stroke) return filled;
          const gsStroke = PdfBackend.alphaPrefix(om, 1, stroke.color.getAlpha());
          return `${filled}q\n${gsStroke}${PdfBackend.strokeState(stroke)}${path}S\nQ\n`;
        }

        // No fill and no stroke: a shape that paints nothing. Emitting the path without an operator
        // would leave it pending in the content stream and swallow whatever is drawn next.
        if (node.fill === undefined && !stroke) return "";

        if (stroke) {
          // A stroked path always gets its own q/Q. Unlike a rect it can set `J`, `j`, `M` and `d`,
          // and those would otherwise stay on for every later stroke on the page - a dash pattern
          // leaking into the next table rule. Existing IR carries no stroke, so nothing moves.
          const paint = node.fill !== undefined ? `B${star}` : "S";
          const color = node.fill !== undefined ? `${node.fill.toPDFColorString()} rg\n` : "";
          const gs = PdfBackend.alphaPrefix(
            om,
            node.fill !== undefined ? node.fill.getAlpha() : 1,
            stroke.color.getAlpha(),
          );
          return `q\n${gs}${color}${PdfBackend.strokeState(stroke)}${path}${paint}\nQ\n`;
        }

        const body = `${node.fill!.toPDFColorString()} rg\n${path}f${star}\n`;
        const gs = PdfBackend.alphaPrefix(om, node.fill!.getAlpha(), 1);
        return gs ? `q\n${gs}${body}Q\n` : body;
      }
      case "clip-path-push": {
        // `W n` sets the clip from the current path without painting it; the q is closed by clip-pop.
        const star = node.fillRule === "evenodd" ? "*" : "";
        return `q\n${PdfBackend.pathOps(node.commands)}W${star} n\n`;
      }
      case "clip-pop":
        return `Q\n`;
      case "transform-push": {
        // Save the graphics state, then apply the affine; everything until transform-pop paints through it.
        const f = (n: number) => n.toFixed(3);
        return `q\n${node.matrix.map(f).join(" ")} cm\n`;
      }
      case "transform-pop":
        return `Q\n`;
      case "link":
        // A link draws nothing in the content stream - it becomes a page /Annot (built in PageRenderer).
        return "";
      case "outline":
        // An outline anchor draws nothing - it becomes a /Outlines entry (built in PageRenderer/PDFRenderer).
        return "";
      case "anchor":
        // A named destination draws nothing - it becomes a /Names /Dests entry (built in PageRenderer/PDFRenderer).
        return "";
      case "formfield":
        // A form field draws nothing in the content stream - it becomes a Widget /Annot + /AcroForm field
        // (built in PageRenderer via forms/acroform.ts).
        return "";
      default: {
        // Exhaustiveness guard: if a new IRNode variant is added, this fails to compile.
        const unknown: never = node;
        throw new Error(`PdfBackend: unhandled IR node ${JSON.stringify(unknown)}`);
      }
    }
  }
}
