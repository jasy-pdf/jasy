import { describe, it, expect, vi } from "vitest";
import { TextRenderer } from "../../../src/lib/renderer/text-renderer.ts";
import { FontStyle, PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { HorizontalAlignment } from "../../../src/lib/elements/pdf-element.ts";
import { unitVerticals } from "../support/metrics.ts";
import { DEFAULT_TEXT_STYLE, type ResolvedTextStyle } from "../../../src/lib/text/text-style.ts";
import type { TextRun } from "../../../src/lib/ir/display-list.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";

// What the bidi seam is worth only shows in the DISPLAY LIST: which run is drawn where. Every glyph
// is 10 wide here, so an x position is readable as "how many glyphs came before me".

const HE = "שלום";
const HE_VISUAL = [...HE].reverse().join("");

const om = () =>
  ({
    getStringWidth: vi.fn((t: string) => [...t].length * 10),
    getCharWidth: vi.fn(() => 10),
    getFontVerticals: unitVerticals,
    getFontDecoration: () => ({
      underlinePosition: -0.1,
      underlineThickness: 0.05,
      capHeight: 0.7,
      xHeight: 0.5,
    }),
    kerningEnabled: false,
    getKernPairs: (t: string) => Array.from({ length: Math.max(0, [...t].length - 1) }, () => 0),
    struct: { enabled: false },
    isCustomFont: () => false,
    getColorFont: () => undefined,
    getEmojiSource: () => undefined,
    getEmojiFont: () => undefined,
    getEmojiImageSource: () => undefined,
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
