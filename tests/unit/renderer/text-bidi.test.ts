import { describe, it, expect } from "vitest";
import { TextRenderer } from "../../../src/lib/renderer/text-renderer.ts";
import { FontStyle, PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { HorizontalAlignment } from "../../../src/lib/elements/pdf-element.ts";
import { testMetrics } from "../support/metrics.ts";
import { DEFAULT_TEXT_STYLE, type ResolvedTextStyle } from "../../../src/lib/text/text-style.ts";
import type { TextRun } from "../../../src/lib/ir/display-list.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";

// What the bidi seam is worth only shows in the DISPLAY LIST: which run is drawn where. Every glyph
// is 10 wide here, so an x position is readable as "how many glyphs came before me".

const HE = "שלום";
const HE_VISUAL = [...HE].reverse().join("");

const om = () =>
  ({
    // The metric half comes from the shared helper, so this file only stubs what a RENDERER needs
    // beyond measuring. Every glyph is 10 wide at size 10, which makes an x readable as a glyph count.
    ...testMetrics({ getStringWidth: (t) => [...t].length * 10, getCharWidth: () => 10 }),
    struct: { enabled: false },
    shapeText: () => undefined,
    isCustomFont: () => false,
    getColorFont: () => undefined,
    getEmojiSource: () => undefined,
    getEmojiFont: () => undefined,
    getEmojiImageSource: () => undefined,
    // Not a real PDFObjectManager - the renderer only reaches for the members above.
  }) as unknown as PDFObjectManager;

/** The text runs a `TextElement` produces, in the order the page draws them. */
const drawn = async (
  el: TextElement,
  width = 400,
  textStyle?: ResolvedTextStyle,
): Promise<TextRun[]> => {
  el.calculateLayout(BoxConstraints.tight(width, 400), { x: 0, y: 0 }, {
    metrics: om(),
    textStyle,
  } as never);
  const nodes = await TextRenderer.render(el, om());
  return nodes.filter((n): n is TextRun => n.type === "text");
};

describe("a Hebrew word in a Latin sentence", () => {
  it("draws three runs, with the Hebrew reversed and in the middle", async () => {
    const runs = await drawn(
      new TextElement({ content: `Hi ${HE} there`, fontSize: 10, fontFamily: "Helvetica" }),
    );
    expect(runs.map((r) => r.text)).toEqual(["Hi ", HE_VISUAL, " there"]);
    // Each run starts exactly where the previous one ended - 3, then 4, then 6 glyphs of 10.
    expect(runs.map((r) => r.x)).toEqual([0, 30, 70]);
  });
});

describe("a right-to-left paragraph", () => {
  it("starts on the RIGHT without anyone asking for an alignment", async () => {
    // CSS `text-align` starts at `start`, which is the right edge in `rtl`. 3 glyphs of 10 in a 400pt
    // box therefore begin at 370.
    const runs = await drawn(
      new TextElement({ content: "abc", fontSize: 10, fontFamily: "Helvetica", direction: "rtl" }),
    );
    expect(runs.map((r) => r.x)).toEqual([370]);
  });

  it("still obeys an explicit alignment", async () => {
    const runs = await drawn(
      new TextElement({
        content: "abc",
        fontSize: 10,
        fontFamily: "Helvetica",
        direction: "rtl",
        textAlignment: HorizontalAlignment.left,
      }),
    );
    expect(runs.map((r) => r.x)).toEqual([0]);
  });

  it("leaves a left-to-right paragraph where it always was", async () => {
    const runs = await drawn(
      new TextElement({ content: "abc", fontSize: 10, fontFamily: "Helvetica" }),
    );
    expect(runs.map((r) => r.x)).toEqual([0]);
  });
});

describe("spans keep their own style through the reordering", () => {
  it("carries each run's colour and size from the span it came from", async () => {
    const runs = await drawn(
      new TextElement({
        fontSize: 10,
        fontFamily: "Helvetica",
        direction: "rtl",
        content: [
          { content: "abc", fontSize: 20 },
          { content: HE, fontStyle: FontStyle.Bold },
        ],
      }),
    );
    // The line starts on the RIGHT, so the first span written ends up rightmost and is drawn LAST.
    // Each run still carries its own span's settings - the point of attributing runs back to spans.
    expect(runs.map((r) => r.text)).toEqual([HE_VISUAL, "abc"]);
    expect(runs[0].fontStyle).toBe(FontStyle.Bold);
    expect(runs[1].fontSize).toBe(20);
  });
});

describe("direction inherits like every other text style", () => {
  it("is picked up from the cascade, not just from the element", async () => {
    const el = new TextElement({ content: "abc", fontSize: 10, fontFamily: "Helvetica" });
    // What `Document({ direction: "rtl" })` and `DefaultTextStyle` do: seed the cascade, which
    // reaches the element through the LayoutContext.
    const inherited = { ...DEFAULT_TEXT_STYLE, direction: "rtl" as const };
    expect((await drawn(el, 400, inherited)).map((r) => r.x)).toEqual([370]);
  });

  it("lets the element override the inherited direction", async () => {
    const el = new TextElement({
      content: "abc",
      fontSize: 10,
      fontFamily: "Helvetica",
      direction: "ltr",
    });
    const inherited = { ...DEFAULT_TEXT_STYLE, direction: "rtl" as const };
    expect((await drawn(el, 400, inherited)).map((r) => r.x)).toEqual([0]);
  });
});

describe("shaping sees the LOGICAL text, and its glyphs are drawn in visual order", () => {
  // The bug this pins: bidi reverses a right-to-left run for drawing, and shaping the REVERSED text
  // gives every letter the form of its mirror-image neighbours. Measured on Arabic in DejaVu Sans, a
  // word came out 42.5pt instead of 34.4pt - and both the measuring and the drawing were wrong
  // together, so nothing looked inconsistent. Shape the logical text, reverse the GLYPHS.
  const HE_LOGICAL = HE;

  const shapingOm = (seen: string[]) =>
    ({
      ...om(),
      // Pretend the font shapes: one glyph per code point, numbered so order is readable.
      shapeText: (text: string) => {
        seen.push(text);
        return [...text].map((c, i) => ({
          glyph: 1000 + i,
          advance: 10,
          codePoints: [c.codePointAt(0)!],
        }));
      },
    }) as unknown as PDFObjectManager;

  it("hands the shaper the text as it was written, not as it is drawn", async () => {
    const seen: string[] = [];
    const el = new TextElement({ content: HE_LOGICAL, fontSize: 10, fontFamily: "Helvetica" });
    el.calculateLayout(BoxConstraints.tight(400, 400), { x: 0, y: 0 }, {
      metrics: shapingOm(seen),
    } as never);
    await TextRenderer.render(el, shapingOm(seen));
    expect(seen).toContain(HE_LOGICAL);
    expect(seen).not.toContain([...HE_LOGICAL].reverse().join(""));
  });

  it("reverses the resulting glyphs, so a right-to-left run still draws right to left", async () => {
    const el = new TextElement({ content: HE_LOGICAL, fontSize: 10, fontFamily: "Helvetica" });
    const manager = shapingOm([]);
    el.calculateLayout(BoxConstraints.tight(400, 400), { x: 0, y: 0 }, {
      metrics: manager,
    } as never);
    const runs = (await TextRenderer.render(el, manager)).filter(
      (n): n is TextRun => n.type === "text",
    );
    // Shaped logically as 1000,1001,1002,1003 - drawn in the reverse of that.
    expect(runs[0].glyphs).toEqual([1003, 1002, 1001, 1000]);
  });
});

describe("a shaped run and the colour-emoji split", () => {
  it("is passed through whole, never cut into pieces that inherit the full glyph list", async () => {
    // The expansion walks CODE POINTS, while `glyphs` is a drawn-order list where a ligature is one
    // glyph for several of them - so no slice is correct, and spreading the run onto each piece would
    // draw every glyph again in each. Latin around the emoji, so bidi leaves it as ONE run and the
    // colour glyph is the only thing that could cut it.
    const colourFont = {
      unitsPerEm: 1000,
      getGlyphIndex: (cp: number) => (cp === 0x1f600 ? 7 : 0),
      getColorGlyph: (gid: number) =>
        gid === 7 ? [{ glyphId: 7, paint: { type: "solid", color: null } }] : null,
      getGlyphPath: () => [], // empty outline: the split is what matters, not the drawing
    };
    const manager = {
      ...om(),
      shapeText: (text: string) =>
        [...text].map((c, i) => ({
          glyph: 2000 + i,
          advance: 10,
          codePoints: [c.codePointAt(0)!],
        })),
      getColorFont: () => colourFont,
    } as unknown as PDFObjectManager;

    const content = "ab\u{1F600}cd";
    const el = new TextElement({ content, fontSize: 10, fontFamily: "Helvetica" });
    el.calculateLayout(BoxConstraints.tight(400, 400), { x: 0, y: 0 }, {
      metrics: manager,
    } as never);
    const runs = (await TextRenderer.render(el, manager)).filter(
      (n): n is TextRun => n.type === "text",
    );
    expect(runs).toHaveLength(1);
    // The whole run, not a piece of it: its own logical text and the full glyph sequence the stub
    // shaper produced (one glyph per code point, numbered in order).
    expect(runs[0].text).toBe(content);
    expect(runs[0].glyphs).toEqual([...content].map((_, i) => 2000 + i));
  });
});
