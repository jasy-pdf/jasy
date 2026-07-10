import { Color } from "../common/color.ts";
import { HorizontalAlignment } from "../elements/pdf-element.ts";
import { TextElement, TextSegment } from "../elements/text-element.ts";
import { FontStyle, PDFObjectManager } from "../utils/pdf-object-manager.ts";
import type { FontMetrics } from "../utils/font-metrics.ts";
import type {
  GlyphPathCommand,
  Paint,
  Affine,
  TTFParser,
  ColorGlyphLayer,
} from "../utils/ttf-parser.ts";
import { IRNode, TextRun, PathCommand, Gradient, Line, Link } from "../ir/display-list.ts";
import { isEmojiCodePoint } from "../text/emoji-codepoints.ts";
import { emojiImageNode } from "./emoji-image.ts";
import {
  wrapStringIntoLines,
  breakSegmentsIntoLines,
  SegmentLine,
  TextOverflow,
} from "../text/line-breaker.ts";
import { lineBoxForSegmentLine, lineBoxForString } from "../text/line-metrics.ts";
import {
  DecorationStroke,
  skipInkSegments,
  strikethroughStroke,
  underlineStroke,
} from "../text/text-decoration.ts";

export class TextRenderer {
  // Measuring only needs metrics, not the full object manager. (The render pass below
  // still receives the manager because it also registers fonts/images.)
  public static calculateTextHeight(
    content: string | TextSegment[],
    fontSize: number,
    fontFamily: string,
    fontStyle: FontStyle,
    objectManager: FontMetrics,
    maxWidth: number,
    maxLines?: number,
    overflow?: TextOverflow,
    lineHeight?: number,
  ): number {
    // Plain string: every wrapped line gets the same box.
    if (typeof content === "string") {
      const lines = wrapStringIntoLines(
        content,
        fontFamily,
        fontSize,
        fontStyle,
        maxWidth,
        objectManager,
        maxLines,
        overflow,
      );
      const box = lineBoxForString(objectManager, fontFamily, fontStyle, fontSize, lineHeight);
      return lines.length * box.height;
    }

    // Segments: each line's box comes from the fonts actually on it.
    const defaults = { fontFamily, fontSize, fontStyle };
    const lines = breakSegmentsIntoLines(
      content,
      defaults,
      maxWidth,
      objectManager,
      maxLines,
      overflow,
    );
    return lines.reduce(
      (total, line) =>
        total + lineBoxForSegmentLine(line, defaults, objectManager, lineHeight).height,
      0,
    );
  }

  static async render(
    textElement: TextElement,
    objectManager: PDFObjectManager,
  ): Promise<IRNode[]> {
    const {
      x,
      y,
      width,
      fontSize,
      color,
      content,
      fontFamily,
      fontStyle,
      textAlignment,
      maxLines,
      overflow,
      lineHeight,
      underline,
      strikethrough,
      skipInk,
      role,
    } = textElement.getProps();

    // Component -> display list. Wrapping and positioning stay here; the backend
    // turns each run into BT/Tf/Td/Tj/ET. The wrapping algorithm is unchanged from
    // the original renderer - unifying it into the engine is Phase 3.
    const { runs, links, decorations } = TextRenderer._buildRuns(
      content,
      fontSize,
      fontFamily,
      fontStyle,
      objectManager,
      width ?? Number.NaN,
      textAlignment,
      color,
      x,
      y,
      maxLines,
      overflow,
      lineHeight,
      underline,
      strikethrough,
      skipInk,
    );

    // Accessible tagging: this whole text block is one structure element (a paragraph P, or a heading
    // from `role`); each run's text lands under it. Emoji sub-nodes produced below stay untagged (drawn
    // as artifacts). Keyed by structId so a block split across pages stays one element.
    if (objectManager.struct.enabled) {
      const pdfRole = role ? role.toUpperCase() : "P"; // "h1" -> "H1"; default paragraph
      const key = objectManager.struct.openElement(textElement.structId, pdfRole);
      for (const run of runs) run.tag = { role: pdfRole, key };
    }

    // Color fonts (COLR/CPAL): expand each run's emoji into filled vector layers (or fetched images
    // for an image emoji source); plain runs and monochrome fonts pass straight through unchanged.
    const drawn = (
      await Promise.all(runs.map((run) => TextRenderer._expandColorGlyphs(run, objectManager)))
    ).flat();
    // Underline / strikethrough go on TOP of the glyphs (a strikethrough must), and stay untagged,
    // so the structure tree treats them as artifacts rather than as text.
    // Inline hyperlinks (href spans) ride along as /Link annotations - they draw nothing, so order
    // vs the drawn runs does not matter; the page renderer peels them off into /Annots.
    return [...drawn, ...decorations, ...links];
  }

  // Splits a text run into normal text sub-runs + filled `Path` layers for any COLR color glyphs,
  // walking code point by code point and advancing the pen by each glyph's width. Returns `[run]`
  // untouched when the font has no color glyphs (the common case).
  private static async _expandColorGlyphs(run: TextRun, om: PDFObjectManager): Promise<IRNode[]> {
    // The run's own font (if it's a color font) draws emoji directly; otherwise a document-level
    // emoji source (`Document({ emoji })`) supplies them - a fallback FONT (color glyphs, native
    // vector) or an IMAGE source (fetched emoji images) - for code points the run's font lacks, so
    // `Text("Hallo 😅")` works in one string. No emoji source at all -> pass the run through.
    const own = om.getColorFont(run.fontFamily, run.fontStyle);
    const emojiName = om.getEmojiFont();
    const fallback =
      emojiName && emojiName !== run.fontFamily
        ? om.getColorFont(emojiName, run.fontStyle)
        : undefined;
    const imageSource = om.getEmojiImageSource();
    if (!own && !fallback && !imageSource) return [run];

    const nodes: IRNode[] = [];
    let cursorX = run.x; // absolute x of the next glyph
    let pending = ""; // run of consecutive non-color characters
    let pendingX = run.x; // where that run started

    const flushPending = (): void => {
      if (pending) {
        nodes.push({ ...run, x: pendingX, text: pending });
        pending = "";
      }
    };

    for (const ch of run.text) {
      const cp = ch.codePointAt(0)!;
      // Which color font renders this code point: the run's own font first, then the emoji fallback.
      let source: TTFParser | undefined;
      let layers: ColorGlyphLayer[] | null = null;
      if (own) {
        const l = own.getColorGlyph(own.getGlyphIndex(cp));
        if (l) [source, layers] = [own, l];
      }
      if (!layers && fallback) {
        const l = fallback.getColorGlyph(fallback.getGlyphIndex(cp));
        if (l) [source, layers] = [fallback, l];
      }
      // The advance matches measuring (getCharWidth applies the same emoji fallback).
      const advance = om.getCharWidth(ch, run.fontSize, undefined, run.fontFamily, run.fontStyle);

      if (source && layers) {
        flushPending();
        const scale = run.fontSize / source.unitsPerEm;
        for (const layer of layers) {
          const commands = TextRenderer._glyphToPath(
            source.getGlyphPath(layer.glyphId),
            cursorX,
            run.y,
            scale,
            layer.transform,
          );
          if (commands.length === 0) continue; // an empty layer outline draws nothing
          const paint = layer.paint;
          let fill;
          if (paint.type === "solid") {
            const c = paint.color;
            fill = c ? new Color(c.r, c.g, c.b, c.a / 255) : run.color; // null -> foreground
          } else {
            fill = TextRenderer._toGradient(
              paint,
              cursorX,
              run.y,
              scale,
              run.color,
              layer.transform,
            );
          }
          nodes.push({ type: "path", commands, fill });
        }
      } else if (imageSource && isEmojiCodePoint(cp)) {
        // Image emoji source: fetch + embed a 1em square. The emoji breaks the text run either way;
        // a failed fetch (offline/404) leaves a blank em gap (advance already applied) rather than
        // drawing a broken glyph.
        flushPending();
        const node = await emojiImageNode(cp, imageSource, cursorX, run.y, run.fontSize);
        if (node) nodes.push(node);
      } else {
        if (!pending) pendingX = cursorX;
        pending += ch;
      }
      cursorX += advance;
    }
    flushPending();
    return nodes;
  }

  // Maps a glyph outline (font units, y-up) to absolute IR path commands at the pen origin, scaling
  // by `scale` and flipping the axis into the engine's top-left space (the seam flips it once more
  // to PDF space). TrueType quadratics become cubics: C1 = P0 + 2/3(C-P0), C2 = P1 + 2/3(C-P1).
  private static _glyphToPath(
    cmds: GlyphPathCommand[],
    originX: number,
    baselineY: number,
    scale: number,
    transform?: Affine,
  ): PathCommand[] {
    // Apply the layer's affine (font units) first, then scale to points, position at the pen origin
    // and flip into engine space. `mapX`/`mapY` take BOTH glyph coords because an affine mixes them.
    const [a, b, c, d, e, f] = transform ?? [1, 0, 0, 1, 0, 0];
    const mapX = (gx: number, gy: number): number => originX + (a * gx + c * gy + e) * scale;
    const mapY = (gx: number, gy: number): number => baselineY - (b * gx + d * gy + f) * scale;
    const out: PathCommand[] = [];
    let curX = 0;
    let curY = 0;
    for (const cmd of cmds) {
      if (cmd.type === "M") {
        curX = mapX(cmd.x, cmd.y);
        curY = mapY(cmd.x, cmd.y);
        out.push({ op: "m", x: curX, y: curY });
      } else if (cmd.type === "L") {
        curX = mapX(cmd.x, cmd.y);
        curY = mapY(cmd.x, cmd.y);
        out.push({ op: "l", x: curX, y: curY });
      } else if (cmd.type === "Q") {
        const ctrlX = mapX(cmd.cx, cmd.cy);
        const ctrlY = mapY(cmd.cx, cmd.cy);
        const endX = mapX(cmd.x, cmd.y);
        const endY = mapY(cmd.x, cmd.y);
        out.push({
          op: "c",
          x1: curX + (2 / 3) * (ctrlX - curX),
          y1: curY + (2 / 3) * (ctrlY - curY),
          x2: endX + (2 / 3) * (ctrlX - endX),
          y2: endY + (2 / 3) * (ctrlY - endY),
          x: endX,
          y: endY,
        });
        curX = endX;
        curY = endY;
      } else {
        out.push({ op: "z" });
      }
    }
    return out;
  }

  // Maps a COLR v1 gradient paint (font-unit coordinates) into an IR `Gradient` positioned at the
  // pen origin, using the SAME scale + baseline flip as the glyph outline so the gradient axis lines
  // up with the shape. Radii scale uniformly (the em scale is uniform). A null stop color (the COLR
  // "use foreground" sentinel) becomes the text color.
  private static _toGradient(
    paint: Exclude<Paint, { type: "solid" }>,
    originX: number,
    baselineY: number,
    scale: number,
    foreground: Color,
    transform?: Affine,
  ): Gradient {
    const [a, b, c, d, e, f] = transform ?? [1, 0, 0, 1, 0, 0];
    const mapX = (gx: number, gy: number): number => originX + (a * gx + c * gy + e) * scale;
    const mapY = (gx: number, gy: number): number => baselineY - (b * gx + d * gy + f) * scale;
    // A radius has no single value under a general affine (a circle can shear into an ellipse); use
    // the affine's geometric-mean scale sqrt(|det|) times the em scale - exact for uniform scaling.
    const radiusScale = scale * Math.sqrt(Math.abs(a * d - b * c));
    const stops = paint.stops.map((s) => ({
      offset: s.offset,
      color: s.color ? new Color(s.color.r, s.color.g, s.color.b, s.color.a / 255) : foreground,
    }));

    if (paint.type === "linearGradient") {
      return {
        type: "linear",
        x0: mapX(paint.p0[0], paint.p0[1]),
        y0: mapY(paint.p0[0], paint.p0[1]),
        x1: mapX(paint.p1[0], paint.p1[1]),
        y1: mapY(paint.p1[0], paint.p1[1]),
        stops,
        extend: paint.extend,
      };
    }
    return {
      type: "radial",
      x0: mapX(paint.c0[0], paint.c0[1]),
      y0: mapY(paint.c0[0], paint.c0[1]),
      r0: paint.c0[2] * radiusScale,
      x1: mapX(paint.c1[0], paint.c1[1]),
      y1: mapY(paint.c1[0], paint.c1[1]),
      r1: paint.c1[2] * radiusScale,
      stops,
      extend: paint.extend,
    };
  }

  // Lay the content out into absolutely-positioned text runs. Glyph positions match
  // the previous hand-written operators exactly (verified by pixel-identical render);
  // only the output form changed from PDF strings to `TextRun`s.
  private static _buildRuns(
    content: string | TextSegment[],
    fontSize: number,
    fontFamily: string,
    fontStyle: FontStyle,
    objectManager: PDFObjectManager,
    maxWidth: number,
    textAlignment: HorizontalAlignment,
    color: Color,
    initialX: number,
    yPosition: number,
    maxLines?: number,
    overflow?: TextOverflow,
    lineHeight?: number,
    underline = false,
    strikethrough = false,
    skipInk = false,
  ): { runs: TextRun[]; links: Link[]; decorations: Line[] } {
    const runs: TextRun[] = [];
    // /Link annotation rects for any `href` spans, collected as we place segments. Empty for the
    // common (no-href) case, so plain text keeps producing exactly the runs it did before.
    const links: Link[] = [];
    // Underline / strikethrough strokes, one per decorated run (so a wrapped paragraph gets one
    // per line, and a decorated span only spans its own glyphs).
    const decorations: Line[] = [];

    // Horizontal offset of a line of the given width under the current alignment.
    const alignmentOffset = (lineWidth: number): number => {
      if (textAlignment === HorizontalAlignment.center) return (maxWidth - lineWidth) / 2;
      if (textAlignment === HorizontalAlignment.right) return maxWidth - lineWidth;
      return 0;
    };

    // The decoration strokes for one drawn run, at the geometry ITS OWN font declares. A mixed-size
    // line therefore gets a thicker line under the bigger span, which is what a browser does too.
    const decorate = (
      text: string,
      runX: number,
      runWidth: number,
      baselineY: number,
      family: string,
      style: FontStyle,
      size: number,
      runColor: Color,
      wantsUnderline: boolean,
      wantsStrikethrough: boolean,
    ): void => {
      if ((!wantsUnderline && !wantsStrikethrough) || runWidth <= 0) return;
      const metrics = objectManager.getFontDecoration(family, style);

      const push = (from: number, to: number, stroke: DecorationStroke): void => {
        decorations.push({
          type: "line",
          x1: runX + from,
          y1: stroke.y,
          x2: runX + to,
          y2: stroke.y,
          stroke: runColor,
          strokeWidth: stroke.thickness,
        });
      };

      if (wantsUnderline) {
        const stroke = underlineStroke(metrics, size, baselineY);
        for (const [from, to] of underlineSegments(
          text,
          runWidth,
          baselineY,
          size,
          family,
          style,
          stroke,
        )) {
          push(from, to, stroke);
        }
      }
      // A strikethrough crosses the letters by definition, so it is never interrupted.
      if (wantsStrikethrough) {
        const stroke = strikethroughStroke(metrics, size, baselineY);
        push(0, runWidth, stroke);
      }
    };

    // The x-ranges the underline actually draws. Without `skipInk` that is the whole run; with it,
    // the descenders are cut out of it (which needs the real outlines, i.e. an embedded font).
    const underlineSegments = (
      text: string,
      runWidth: number,
      baselineY: number,
      size: number,
      family: string,
      style: FontStyle,
      stroke: DecorationStroke,
    ): Array<[number, number]> => {
      if (!skipInk) return [[0, runWidth]];
      if (!objectManager.isCustomFont(family, style)) {
        throw new Error(
          `skipInk needs an embedded font, but "${family}" is a standard-14 font whose glyph outlines ` +
            `live in the PDF viewer, not in the document - we cannot see where its ink is. Register a ` +
            `font (the document's \`fonts\` option) or drop \`skipInk\`.`,
        );
      }
      // The band the stroke covers, in points from the baseline, y UP (so both values are negative).
      const below = stroke.y - baselineY;
      const half = stroke.thickness / 2;
      const inkSpans = objectManager.getInkSpansInBand(
        text,
        size,
        family,
        style,
        -below + half,
        -below - half,
      );
      return skipInkSegments(runWidth, inkSpans, stroke.thickness);
    };

    // Advance width WITHOUT kerning. This is how Tj moves the text cursor, so
    // segments flowing after each other land here. (Standard-14 fonts carry no
    // /Widths array; the viewer advances by the AFM widths - same source as below.)
    const advanceNoKerning = (
      text: string,
      family: string,
      size: number,
      style: FontStyle,
    ): number => {
      let width = 0;
      for (const ch of text) {
        width += objectManager.getCharWidth(ch, size, undefined, family, style);
      }
      return width;
    };

    // --- Plain string: one run per wrapped line. ---
    if (typeof content === "string") {
      const lines = wrapStringIntoLines(
        content,
        fontFamily,
        fontSize,
        fontStyle,
        maxWidth,
        objectManager,
        maxLines,
        overflow,
      );
      // yPosition is the top of the text box (top-left). The line box seats its own baseline; lines
      // then stack by that box's height. Same numbers as calculateTextHeight, by construction.
      const box = lineBoxForString(objectManager, fontFamily, fontStyle, fontSize, lineHeight);
      lines.forEach((line, index) => {
        const lineWidth = objectManager.getStringWidth(line, fontFamily, fontSize, fontStyle);
        const x = initialX + alignmentOffset(lineWidth);
        const baseline = yPosition + box.baseline + box.height * index;
        runs.push({
          type: "text",
          x,
          y: baseline,
          text: line,
          fontFamily,
          fontStyle,
          fontSize,
          color,
        });
        decorate(
          line,
          x,
          lineWidth,
          baseline,
          fontFamily,
          fontStyle,
          fontSize,
          color,
          underline,
          strikethrough,
        );
      });
      return { runs, links, decorations };
    }

    // --- Segments: break into lines (shared breaker), then emit one run per segment.
    // Segment 0 starts at the aligned line origin; each following segment is offset by
    // the previous segment's kerning-free advance. Each line drops by its OWN leading
    // (tallest font on that line), so mixed-font lines space correctly and the drawn
    // height matches the measured height.
    const pushLine = (line: SegmentLine, lineY: number): void => {
      let x = initialX + alignmentOffset(line.width);
      line.segments.forEach((segment) => {
        const family = segment.fontFamily || fontFamily;
        const size = segment.fontSize || fontSize;
        const style = segment.fontStyle || fontStyle;
        const advance = advanceNoKerning(segment.content, family, size, style);
        const runColor = segment.fontColor || color;
        runs.push({
          type: "text",
          x,
          y: lineY,
          text: segment.content,
          fontFamily: family,
          fontStyle: style,
          fontSize: size,
          color: runColor,
        });
        decorate(
          segment.content,
          x,
          advance,
          lineY,
          family,
          style,
          size,
          runColor,
          segment.underline ?? underline,
          segment.strikethrough ?? strikethrough,
        );
        // An href/to span becomes a /Link annotation over exactly this run's glyph box: from its own
        // ascent above the baseline down to its own descender. A span wrapped across lines yields
        // one rect per line.
        if (segment.href !== undefined || segment.dest !== undefined) {
          const v = objectManager.getFontVerticals(family, style);
          links.push({
            type: "link",
            x,
            y: lineY - v.ascent * size,
            width: advance,
            height: (v.ascent + v.descent) * size,
            href: segment.href,
            dest: segment.dest,
          });
        }
        x += advance;
      });
    };

    // yPosition is the top of the text box (top-left). Each line seats its own baseline inside its
    // own box (tallest ascent / deepest descent ON THAT LINE), then the next line starts below it.
    // The seam flips the whole thing to PDF space.
    const defaults = { fontFamily, fontSize, fontStyle };
    let top = yPosition;
    for (const line of breakSegmentsIntoLines(
      content,
      defaults,
      maxWidth,
      objectManager,
      maxLines,
      overflow,
    )) {
      const box = lineBoxForSegmentLine(line, defaults, objectManager, lineHeight);
      pushLine(line, top + box.baseline);
      top += box.height;
    }

    return { runs, links, decorations };
  }
}
