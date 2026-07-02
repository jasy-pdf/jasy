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
import { IRNode, TextRun, PathCommand, Gradient } from "../ir/display-list.ts";
import { isEmojiCodePoint } from "../text/emoji-codepoints.ts";
import { emojiImageNode } from "./emoji-image.ts";
import {
  wrapStringIntoLines,
  breakSegmentsIntoLines,
  SegmentLine,
  TextOverflow,
} from "../text/line-breaker.ts";

// Distance from the top of a line down to its baseline, as a fraction of the font
// size. ~0.683 is the standard-14 ascent ratio used to seat the first baseline.
const BASELINE_RATIO = 683 / 1000;

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
    lineHeight = 1,
  ): number {
    // Plain string: one line box (fontSize * lineHeight) per wrapped line.
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
      return lines.length * fontSize * lineHeight;
    }

    // Segments: each line contributes its own (tallest-on-line) leading, scaled by lineHeight.
    const lines = breakSegmentsIntoLines(
      content,
      { fontFamily, fontSize, fontStyle },
      maxWidth,
      objectManager,
      maxLines,
      overflow,
    );
    return lines.reduce((total, line) => total + line.maxFontSize * lineHeight, 0);
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
      role,
    } = textElement.getProps();

    // Component -> display list. Wrapping and positioning stay here; the backend
    // turns each run into BT/Tf/Td/Tj/ET. The wrapping algorithm is unchanged from
    // the original renderer - unifying it into the engine is Phase 3.
    const runs = TextRenderer._buildRuns(
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
    return (
      await Promise.all(runs.map((run) => TextRenderer._expandColorGlyphs(run, objectManager)))
    ).flat();
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
    lineHeight = 1,
  ): TextRun[] {
    const runs: TextRun[] = [];

    // Horizontal offset of a line of the given width under the current alignment.
    const alignmentOffset = (lineWidth: number): number => {
      if (textAlignment === HorizontalAlignment.center) return (maxWidth - lineWidth) / 2;
      if (textAlignment === HorizontalAlignment.right) return maxWidth - lineWidth;
      return 0;
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
      // yPosition is the top of the text box (top-left); seat line 0's baseline below it, then step
      // DOWN by one line box (fontSize * lineHeight) per line. The lineHeight EXTRA leading is split
      // half above / half below (CSS/Flutter "half-leading"), so the text sits centered in its line
      // box instead of clinging to the top. At lineHeight 1 the half-leading is 0 -> byte-identical.
      const halfLeading = (fontSize * (lineHeight - 1)) / 2;
      const baseline = yPosition + halfLeading + fontSize * BASELINE_RATIO;
      lines.forEach((line, index) => {
        const lineWidth = objectManager.getStringWidth(line, fontFamily, fontSize, fontStyle);
        runs.push({
          type: "text",
          x: initialX + alignmentOffset(lineWidth),
          y: baseline + fontSize * lineHeight * index,
          text: line,
          fontFamily,
          fontStyle,
          fontSize,
          color,
        });
      });
      return runs;
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
        runs.push({
          type: "text",
          x,
          y: lineY,
          text: segment.content,
          fontFamily: family,
          fontStyle: style,
          fontSize: size,
          color: segment.fontColor || color,
        });
        x += advanceNoKerning(segment.content, family, size, style);
      });
    };

    // The overall tallest font seats the first baseline; each line then steps DOWN by
    // its own leading. yPosition is the top of the text box (top-left); the seam flips
    // the whole thing to PDF space.
    let overallMaxFont = fontSize;
    for (const segment of content) {
      const size = segment.fontSize || fontSize;
      if (size > overallMaxFont) overallMaxFont = size;
    }

    let lineY = yPosition + overallMaxFont * BASELINE_RATIO;
    for (const line of breakSegmentsIntoLines(
      content,
      { fontFamily, fontSize, fontStyle },
      maxWidth,
      objectManager,
      maxLines,
      overflow,
    )) {
      // Half-leading: shift this line's baseline down by half its own extra leading, so the line
      // sits centered in its box (CSS/Flutter). At lineHeight 1 the shift is 0 -> byte-identical.
      const halfLeading = (line.maxFontSize * (lineHeight - 1)) / 2;
      pushLine(line, lineY + halfLeading);
      lineY += line.maxFontSize * lineHeight;
    }

    return runs;
  }
}
