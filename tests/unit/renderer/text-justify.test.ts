import { describe, it, expect } from "vitest";
import { TextRenderer } from "../../../src/lib/renderer/text-renderer.ts";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import { HorizontalAlignment } from "../../../src/lib/elements/pdf-element.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { testMetrics } from "../support/metrics.ts";
import type { TextRun } from "../../../src/lib/ir/display-list.ts";

// Justification spreads a line's leftover space into its SPACES. Every glyph here is 10 wide at size
// 10 and a space is 10 too, so a run's x reads as "how many glyphs came before me" and the stretch is
// arithmetic anyone can check by hand.

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

/** The text runs of a paragraph laid out in a box `width` wide, in drawing order. */
const drawn = async (content: string, width: number, align?: HorizontalAlignment) => {
  const el = new TextElement({
    content,
    fontSize: 10,
    fontFamily: "Helvetica",
    textAlignment: align,
  });
  const manager = om();
  el.calculateLayout(BoxConstraints.tight(width, 400), { x: 0, y: 0 }, {
    metrics: manager,
  } as never);
  const runs = (await TextRenderer.render(el, manager)).filter(
    (n): n is TextRun => n.type === "text",
  );
  return runs.map((r) => ({ x: r.x, y: r.y, text: r.text }));
};

/** Lines, as the y they sit on. */
const byLine = (runs: { x: number; y: number; text: string }[]) => {
  const lines = new Map<number, { x: number; text: string }[]>();
  for (const r of runs) lines.set(r.y, [...(lines.get(r.y) ?? []), { x: r.x, text: r.text }]);
  return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
};

describe("a justified paragraph", () => {
  // "aa bb cc" is 8 glyphs = 80pt natural; in a 100pt box there is 20pt of slack and two spaces,
  // so each space grows by 10 - the words land at 0, 40 and 80.
  it("spreads the slack evenly into the spaces, so the line fills the box", async () => {
    const runs = await drawn("aa bb cc dd", 100, HorizontalAlignment.justify);
    const lines = byLine(runs);
    expect(lines[0].map((r) => r.text)).toEqual(["aa", "bb", "cc"]);
    expect(lines[0].map((r) => r.x)).toEqual([0, 40, 80]);
  });

  it("leaves the LAST line alone, as print and CSS do", async () => {
    // The last line must have a SPACE of its own, or the rule is never reached and the test is hollow.
    // "aa bb cc" fills line one; "dd ee" is the last and keeps its natural 50pt instead of filling 100.
    const lines = byLine(await drawn("aa bb cc dd ee", 100, HorizontalAlignment.justify));
    expect(lines).toHaveLength(2);
    // ONE run, spaces and all: a justified line is split into words, so a single run IS the proof
    // that this one was left alone.
    expect(lines[1]).toEqual([{ x: 0, text: "dd ee" }]);
  });

  it("emits one run per word, which is what an embedded font needs", async () => {
    // `Tw` only reaches the single byte 32, so an Identity-H font could never be stretched that way.
    // Moving the pen per word works for every font.
    const lines = byLine(await drawn("aa bb cc dd", 100, HorizontalAlignment.justify));
    expect(lines[0]).toHaveLength(3);
  });
});

describe("when justification must NOT kick in", () => {
  it("leaves a line without spaces alone", async () => {
    const lines = byLine(await drawn("aaaa", 100, HorizontalAlignment.justify));
    expect(lines[0]).toEqual([{ x: 0, text: "aaaa" }]);
  });

  it("leaves a too-long word alone, which is the only way a line can overflow", async () => {
    // The breaker only ever overflows a SINGLE word, and a single word has no spaces - so a justified
    // line can never be asked to shrink. That is why the clamp in `justifyExtra` has no reachable
    // path; it is kept as a guard, not as behaviour, and this test pins the reason.
    const lines = byLine(await drawn("aaaaaa bb", 40, HorizontalAlignment.justify));
    expect(lines[0]).toEqual([{ x: 0, text: "aaaaaa" }]);
  });

  it("changes nothing for the default alignment", async () => {
    const plain = await drawn("aa bb cc dd", 100);
    expect(byLine(plain)[0]).toEqual([{ x: 0, text: "aa bb cc" }]);
  });
});

describe("squeezing a line to keep one more word", () => {
  // Four words of 20 with three spaces of 10 is 110 natural. The allowance is a quarter of each
  // space, 7.5 in total, so the line fits a box of 105 but not one of 100.
  it("keeps the word when the squeeze is enough, and the spaces come in", async () => {
    // A line AFTER it, or the squeezed one would be the last and keep its natural spacing.
    const lines = byLine(await drawn("aa bb cc dd ee ff", 105, HorizontalAlignment.justify));
    expect(lines[0].map((r) => r.text)).toEqual(["aa", "bb", "cc", "dd"]);
    // 5pt short over three gaps: each space gives up 1.67 and lands at 8.33 instead of 10.
    expect(lines[0].map((r) => Math.round(r.x * 100) / 100)).toEqual([0, 28.33, 56.67, 85]);
  });

  it("gives up when the squeeze is not enough", async () => {
    // The same words in a 100pt box: 110 natural minus the 7.5 allowance is still over.
    const lines = byLine(await drawn("aa bb cc dd ee ff", 100, HorizontalAlignment.justify));
    expect(lines[0].map((r) => r.text)).toEqual(["aa", "bb", "cc"]);
  });

  it("never squeezes text that is not justified - it would just overflow", async () => {
    const lines = byLine(await drawn("aa bb cc dd", 105));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual([{ x: 0, text: "aa bb cc" }]);
  });
});

describe("the measure pass and the draw pass must agree", () => {
  it("counts the same lines it draws, squeeze included", async () => {
    // The squeeze changes how many lines a paragraph takes. If only the DRAW pass knew about it, the
    // element would reserve one line too many and every following element would sit too low - the
    // "measured equals drawn" rule, one feature further on.
    // Eight words: four to a line when squeezed (2 lines), three when not (3 lines). So the line
    // COUNT differs, which is what makes this test able to fail.
    const content = "aa bb cc dd ee ff gg hh";
    const el = new TextElement({
      content,
      fontSize: 10,
      fontFamily: "Helvetica",
      textAlignment: HorizontalAlignment.justify,
    });
    const manager = om();
    el.calculateLayout(BoxConstraints.tight(105, 400), { x: 0, y: 0 }, {
      metrics: manager,
    } as never);

    const measured = (el.getProps() as { height: number }).height;
    const drawnLines = byLine(await drawn(content, 105, HorizontalAlignment.justify)).length;
    // The unit-metrics line box is exactly one em, so the height IS the line count times the size.
    expect(measured).toBe(drawnLines * 10);
  });
});

describe("a squeezed LAST line", () => {
  it("is drawn squeezed, because that is how the breaker packed it", async () => {
    // Eight words of 20 with spaces of 10: four fit a 105pt box only when squeezed. The SECOND line
    // is the last, and it was packed with that same allowance - drawing it at natural spacing would
    // push it 5pt out of the box.
    const lines = byLine(await drawn("aa bb cc dd ee ff gg hh", 105, HorizontalAlignment.justify));
    expect(lines).toHaveLength(2);
    expect(lines[1].map((r) => r.text)).toEqual(["ee", "ff", "gg", "hh"]);
    const last = lines[1];
    expect(last[last.length - 1].x + 20).toBeLessThanOrEqual(105);
  });
});
