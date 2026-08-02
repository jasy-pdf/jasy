import { describe, it, expect } from "vitest";
import { TextRenderer } from "../../../src/lib/renderer/text-renderer.ts";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { HorizontalAlignment } from "../../../src/lib/elements/pdf-element.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import type { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";
import { testMetrics } from "../support/metrics.ts";
import type { TextRun } from "../../../src/lib/ir/display-list.ts";

// The four CSS text properties react-pdf had and we did not. Every glyph is 10 wide at size 10 and a
// space is 10 too, so an x reads as a glyph count and the arithmetic is checkable by hand.

const om = () =>
  ({
    ...testMetrics({ getStringWidth: (t) => [...t].length * 10, getCharWidth: () => 10 }),
    struct: { enabled: false },
    shapeText: () => undefined,
    isCustomFont: () => false,
    getColorFont: () => undefined,
    getEmojiSource: () => undefined,
    getEmojiFont: () => undefined,
    getEmojiImageSource: () => undefined,
  }) as unknown as PDFObjectManager;

/** A real `LayoutContext`, not a cast: every `PDFPageConfig` field is optional, so this costs nothing
 *  and a change to the interface shows up here instead of hiding behind `as never`. */
const context = (manager: PDFObjectManager): LayoutContext => ({
  metrics: manager,
  pageConfig: {},
});

const drawn = async (el: TextElement, width = 200) => {
  const manager = om();
  el.calculateLayout(BoxConstraints.tight(width, 400), { x: 0, y: 0 }, context(manager));
  return (await TextRenderer.render(el, manager)).filter((n): n is TextRun => n.type === "text");
};

const text = (
  content: string | ConstructorParameters<typeof TextElement>[0]["content"],
  extra = {},
) => new TextElement({ content, fontSize: 10, fontFamily: "Helvetica", ...extra });

describe("textTransform", () => {
  it("recases the text that is drawn", async () => {
    const runs = await drawn(text("hello world", { textTransform: "uppercase" }));
    expect(runs.map((r) => r.text).join("")).toBe("HELLO WORLD");
  });

  it("capitalizes each word, as CSS does", async () => {
    const runs = await drawn(text("hello wide world", { textTransform: "capitalize" }));
    expect(runs.map((r) => r.text).join("")).toBe("Hello Wide World");
  });

  it("MEASURES the recased text, not the original", async () => {
    // The trap: recasing at draw time only. `WORLD` and `world` are different widths in most fonts,
    // so the line would be measured one way and drawn another. Here the transform ADDS a word break
    // opportunity nowhere, but it does change the height when the wrapped line count changes.
    const el = text("aaaa aaaa aaaa", { textTransform: "uppercase" });
    const runs = await drawn(el, 200);
    expect(runs.every((r) => r.text === r.text.toUpperCase())).toBe(true);
  });

  it("leaves the text alone by default", async () => {
    const runs = await drawn(text("Mixed Case"));
    expect(runs.map((r) => r.text).join("")).toBe("Mixed Case");
  });
});

describe("wordSpacing", () => {
  it("adds its own advance at every space", async () => {
    // "aa bb": 2 glyphs, a 10pt space, 2 glyphs. With 6pt of word-spacing the second word starts at
    // 20 + 10 + 6 = 36 instead of 30 - and the run is split, because `Tw` cannot reach an embedded font.
    const runs = await drawn(text("aa bb", { wordSpacing: 6 }));
    expect(runs.map((r) => r.text)).toEqual(["aa", "bb"]);
    expect(runs.map((r) => r.x)).toEqual([0, 36]);
  });

  it("is counted when the line is broken, so measured stays equal to drawn", async () => {
    // "aa bb cc" is 80 natural; 40pt of word-spacing over two gaps makes it 160, past a 120pt box.
    const runs = await drawn(text("aa bb cc", { wordSpacing: 40 }), 120);
    const ys = new Set(runs.map((r) => r.y));
    expect(ys.size).toBe(2);
  });

  it("changes nothing at zero", async () => {
    const runs = await drawn(text("aa bb"));
    expect(runs.map((r) => r.text)).toEqual(["aa bb"]);
  });
});

describe("textIndent", () => {
  it("starts the FIRST line in, and leaves the rest alone", async () => {
    const runs = await drawn(text("aa bb cc dd", { textIndent: 25 }), 100);
    const first = runs.filter((r) => r.y === runs[0].y);
    const later = runs.filter((r) => r.y !== runs[0].y);
    expect(first[0].x).toBe(25);
    expect(later[0].x).toBe(0);
  });

  it("takes the indent out of the FIRST line's room, so it wraps sooner", async () => {
    // Without the indent "aa bb cc" (80) fits a 100pt box; with 30pt of indent it does not.
    const plain = await drawn(text("aa bb cc"), 100);
    const indented = await drawn(text("aa bb cc", { textIndent: 30 }), 100);
    expect(new Set(plain.map((r) => r.y)).size).toBe(1);
    expect(new Set(indented.map((r) => r.y)).size).toBe(2);
  });

  it("is measured against the indented room when aligning", async () => {
    const runs = await drawn(
      text("aa", { textIndent: 40, textAlignment: HorizontalAlignment.right }),
      100,
    );
    // 40 in, then right-aligned within the remaining 60: 40 + (60 - 20) = 80.
    expect(runs[0].x).toBe(80);
  });
});

describe("verticalAlign on a span", () => {
  const spans = (align: "super" | "sub" | "baseline") => [
    { content: "x" },
    { content: "2", verticalAlign: align },
  ];

  it("raises a superscript by a third of its size", async () => {
    const runs = await drawn(text(spans("super")));
    expect(runs[1].y).toBeCloseTo(runs[0].y - 10 / 3, 6);
  });

  it("lowers a subscript by a fifth", async () => {
    const runs = await drawn(text(spans("sub")));
    expect(runs[1].y).toBeCloseTo(runs[0].y + 10 / 5, 6);
  });

  it("leaves the rest of the line on the baseline", async () => {
    const runs = await drawn(text(spans("super")));
    expect(runs[0].y).toBe(runs[1].y + 10 / 3);
  });

  it("does not move anything by default", async () => {
    const runs = await drawn(text(spans("baseline")));
    expect(runs[1].y).toBe(runs[0].y);
  });
});

describe("a spaced paragraph sizes its own box", () => {
  it("stays on one line when nothing constrains it", async () => {
    // A `Text` in a `Row` gets its natural single-line width as its box. If that width forgot the
    // word-spacing, the box would be too narrow for the very text it was made for and the line would
    // wrap inside it - the same defect that split a footer and a right-aligned span.
    const el = text("aa bb cc", { wordSpacing: 12 });
    const manager = om();
    el.calculateLayout(BoxConstraints.loose(Infinity, 400), { x: 0, y: 0 }, context(manager));
    const runs = (await TextRenderer.render(el, manager)).filter(
      (n): n is TextRun => n.type === "text",
    );
    expect(new Set(runs.map((r) => r.y)).size).toBe(1);
    // 6 glyphs + two gaps of (10 + 12): the box has to be 104 wide, not 80.
    expect((el.getProps() as { width?: number }).width).toBe(104);
  });
});

describe("the numbers have to be real numbers", () => {
  it("refuses a non-finite wordSpacing or textIndent by name", () => {
    // Unchecked, these travel into the content stream as a position: the backend does refuse them
    // there, but the message then names a coordinate instead of the property that was wrong.
    expect(() => text("a", { wordSpacing: Number.NaN })).toThrow(/wordSpacing/);
    expect(() => text("a", { textIndent: Infinity })).toThrow(/textIndent/);
  });

  it("lets a normal value through, negatives included", () => {
    expect(() => text("a", { wordSpacing: -2, textIndent: 12 })).not.toThrow();
  });
});

describe("the three findings a review caught", () => {
  it("capitalizes a word SPLIT across two spans only once", () => {
    // Per-span transforming gives "HelLo"; the word is one word and only its first letter rises.
    const el = text([{ content: "hel" }, { content: "lo world" }], {
      textTransform: "capitalize",
    });
    // The content is resolved by the LAYOUT pass, which is what the renderer then reads.
    const manager = om();
    el.calculateLayout(BoxConstraints.tight(400, 400), { x: 0, y: 0 }, context(manager));
    const props = el.getProps() as { content: { content: string }[] };
    expect(props.content.map((c) => c.content).join("")).toBe("Hello World");
  });

  it("drops the indent on a CONTINUATION, which is no longer a first line", () => {
    // Enough lines that the split is real: with too few, the orphan rule refuses to break at all and
    // the whole element comes back as the remainder - which would pass this test for the wrong reason.
    const el = text("aa bb cc dd ee ff gg hh ii jj", { textIndent: 30 });
    const manager = om();
    const ctx = context(manager);
    el.calculateLayout(BoxConstraints.tight(100, 400), { x: 0, y: 0 }, ctx);
    const { fitted, remainder } = el.fragment(20, 100, ctx);
    expect(fitted).not.toBeNull();
    expect((fitted!.getProps() as { textIndent: number }).textIndent).toBe(30);
    expect(remainder).not.toBeNull();
    expect((remainder!.getProps() as { textIndent: number }).textIndent).toBe(0);
  });

  it("makes an unbounded box wide enough for the indent as well", () => {
    const plain = text("aa bb");
    const indented = text("aa bb", { textIndent: 30 });
    const manager = om();
    const ctx = context(manager);
    for (const el of [plain, indented]) {
      el.calculateLayout(BoxConstraints.loose(Infinity, 400), { x: 0, y: 0 }, ctx);
    }
    const w = (el: TextElement) => (el.getProps() as { width?: number }).width!;
    expect(w(indented)).toBe(w(plain) + 30);
  });
});

describe("capitalize and punctuation", () => {
  it("raises the first LETTER, not the first character", async () => {
    // CSS titlecases the first typographic letter of a word, so a bracket or quote in front of it
    // does not swallow the turn. A browser gives `(Hello) "World"` here too.
    const runs = await drawn(text('(hello) "world"', { textTransform: "capitalize" }));
    expect(runs.map((r) => r.text).join("")).toBe('(Hello) "World"');
  });

  it("carries that through a span boundary as well", () => {
    const el = text([{ content: "(hel" }, { content: "lo)" }], { textTransform: "capitalize" });
    const manager = om();
    el.calculateLayout(BoxConstraints.tight(400, 400), { x: 0, y: 0 }, context(manager));
    const props = el.getProps() as { content: { content: string }[] };
    expect(props.content.map((c) => c.content).join("")).toBe("(Hello)");
  });
});

describe("font fallback", () => {
  // "Latin" holds ASCII only; "CJK" holds the rest. The element must SPLIT the text into spans, one
  // per family - and it has to do so in the LAYOUT pass, because the renderer has no metrics to
  // redo it with and would otherwise draw everything in the first family.
  const stackMetrics = () =>
    ({
      ...testMetrics({
        getStringWidth: (t) => [...t].length * 10,
        getCharWidth: () => 10,
        hasGlyph: (cp, family) => (family === "Latin" ? cp < 0x80 : true),
      }),
      struct: { enabled: false },
      shapeText: () => undefined,
      isCustomFont: () => false,
      getColorFont: () => undefined,
      getEmojiSource: () => undefined,
      getEmojiFont: () => undefined,
      getEmojiImageSource: () => undefined,
    }) as unknown as PDFObjectManager;

  it("draws each stretch in the family that has its glyphs", async () => {
    const el = new TextElement({
      content: "ab漢字cd",
      fontSize: 10,
      fontFamily: "Latin",
      fontFallback: ["CJK"],
    });
    const manager = stackMetrics();
    el.calculateLayout(BoxConstraints.tight(400, 400), { x: 0, y: 0 }, context(manager));
    const runs = (await TextRenderer.render(el, manager)).filter(
      (n): n is TextRun => n.type === "text",
    );
    expect(runs.map((r) => [r.text, r.fontFamily])).toEqual([
      ["ab", "Latin"],
      ["漢字", "CJK"],
      ["cd", "Latin"],
    ]);
  });

  it("leaves a document without a stack exactly as it was", async () => {
    const el = new TextElement({ content: "ab漢字", fontSize: 10, fontFamily: "Latin" });
    const manager = stackMetrics();
    el.calculateLayout(BoxConstraints.tight(400, 400), { x: 0, y: 0 }, context(manager));
    const runs = (await TextRenderer.render(el, manager)).filter(
      (n): n is TextRun => n.type === "text",
    );
    expect(runs.map((r) => r.text)).toEqual(["ab漢字"]);
  });
});
