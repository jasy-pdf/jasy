import { describe, it, expect } from "vitest";
import { TextElement } from "../../../src/lib/elements/text-element.ts";
import type { LayoutContext } from "../../../src/lib/elements/pdf-element.ts";
import type { FontMetrics } from "../../../src/lib/utils/font-metrics.ts";
import { unitVerticals } from "../support/metrics.ts";
import {
  adjustForOrphansWidows,
  DEFAULT_ORPHANS,
  DEFAULT_WIDOWS,
} from "../../../src/lib/text/orphans-widows.ts";

// An ORPHAN is the first line of a paragraph left alone at the bottom of a page; a WIDOW is the last
// line pushed alone to the top of the next. Splitting at line boxes prevents neither, so this
// corrects the split INDEX the fragmenter arrived at.

const rule = { orphans: DEFAULT_ORPHANS, widows: DEFAULT_WIDOWS };
const cut = (fitted: number, total: number, r = rule) => adjustForOrphansWidows(fitted, total, r);

describe("the defaults match CSS and every browser", () => {
  it("is 2 lines each way", () => {
    expect([DEFAULT_ORPHANS, DEFAULT_WIDOWS]).toEqual([2, 2]);
  });
});

describe("the limits themselves are checked", () => {
  // Both are LINE COUNTS and end up as a slice index. A fraction would be truncated somewhere
  // downstream instead of here, and anything below 1 silently disables the rule it belongs to - so
  // they are named at the boundary rather than quietly tolerated.
  it("refuses a fraction", () => {
    expect(() => cut(3, 10, { orphans: 2.5, widows: 2 })).toThrow(/orphans/);
    expect(() => cut(3, 10, { orphans: 2, widows: 1.5 })).toThrow(/widows/);
  });

  it("refuses zero and negatives", () => {
    for (const bad of [0, -1]) {
      expect(() => cut(3, 10, { orphans: bad, widows: 2 })).toThrow(/whole number of at least 1/);
      expect(() => cut(3, 10, { orphans: 2, widows: bad })).toThrow(/whole number of at least 1/);
    }
  });

  it("says what the value MEANS, so 1 reads as the way to switch it off", () => {
    expect(() => cut(3, 10, { orphans: 0, widows: 2 })).toThrow(/1 means no protection/);
  });

  it("takes 1 - the documented way to switch the protection off", () => {
    expect(() => cut(3, 10, { orphans: 1, widows: 1 })).not.toThrow();
  });
});

describe("nothing to protect", () => {
  it("passes a split that already leaves enough on both sides", () => {
    expect(cut(5, 10)).toBe(5);
  });

  it("leaves 'nothing fits' alone - the caller decides", () => {
    expect(cut(0, 10)).toBe(0);
  });

  it("leaves 'it all fits' alone", () => {
    expect(cut(10, 10)).toBe(10);
    expect(cut(12, 10)).toBe(10);
  });
});

describe("orphans - too few would stay behind", () => {
  it("moves the whole paragraph when only one line would remain", () => {
    // The classic: a heading's paragraph starting on the last line of a page.
    expect(cut(1, 10)).toBe(0);
  });

  it("keeps the split as soon as the minimum is met", () => {
    expect(cut(2, 10)).toBe(2);
  });
});

describe("widows - too few would carry over", () => {
  it("pulls the cut back so exactly `widows` lines go over", () => {
    // 9 of 10 fit; one line would be a widow, so 8 stay and 2 carry.
    expect(cut(9, 10)).toBe(8);
  });

  it("moves the whole paragraph when pulling back would strand the orphans instead", () => {
    // 3 lines, 2 fit: pulling back to 1 line would break the orphan rule, so it all moves.
    expect(cut(2, 3)).toBe(0);
  });
});

describe("paragraphs too short to satisfy both ends", () => {
  it("moves a 3-line paragraph whole rather than breaking it badly", () => {
    expect(cut(1, 3)).toBe(0);
    expect(cut(2, 3)).toBe(0);
  });

  it("still terminates: the answer is never MORE lines than fit", () => {
    // The page driver's guard force-places a paragraph that fits nowhere; this must never ask for
    // more room than it was offered, or that guard could not do its job.
    for (let total = 1; total <= 12; total++) {
      for (let fitted = 0; fitted <= total; fitted++) {
        expect(cut(fitted, total)).toBeLessThanOrEqual(Math.max(fitted, 0));
      }
    }
  });
});

describe("turning it off", () => {
  it("1 and 1 reproduces the old, unprotected split exactly", () => {
    const off = { orphans: 1, widows: 1 };
    for (let total = 1; total <= 12; total++) {
      for (let fitted = 1; fitted < total; fitted++) {
        expect(cut(fitted, total, off)).toBe(fitted);
      }
    }
  });

  it("takes a stricter rule too", () => {
    const strict = { orphans: 3, widows: 3 };
    expect(cut(2, 10, strict)).toBe(0); // 2 would stay, 3 required
    expect(cut(8, 10, strict)).toBe(7); // 2 would carry, pull back to 3
    expect(cut(4, 10, strict)).toBe(4);
  });
});

describe("through TextElement.fragment", () => {
  // The deterministic metrics from the fragment suite: each glyph is 10 wide, spaces are 0, so with
  // maxWidth 50 a six-word paragraph of two-letter words breaks into exactly three lines of ten high.
  const metrics: FontMetrics = {
    getStringWidth: (text: string) => [...text].reduce((w, c) => w + (c === " " ? 0 : 10), 0),
    getCharWidth: (c: string) => (c === " " ? 0 : 10),
    getFontVerticals: unitVerticals,
  };
  const ctx = { metrics } as LayoutContext;
  const para = (orphans?: number, widows?: number) =>
    new TextElement({ fontSize: 10, content: "aa bb cc dd ee ff", orphans, widows });

  it("refuses to strand one line, and moves the paragraph whole", () => {
    // Room for exactly one of three lines. Unprotected that is a split; protected it is an orphan.
    expect(para(1, 1).fragment(10, 50, ctx).fitted).not.toBeNull();
    const guarded = para().fragment(10, 50, ctx);
    expect(guarded.fitted).toBeNull();
    expect(guarded.remainder).not.toBeNull();
  });

  it("refuses to push one line over, and moves the paragraph whole", () => {
    // Room for two of three lines: the third would be a widow. Three lines cannot satisfy 2+2, so it
    // moves rather than breaking badly.
    expect(para(1, 1).fragment(20, 50, ctx).fitted).not.toBeNull();
    expect(para().fragment(20, 50, ctx).fitted).toBeNull();
  });

  it("still splits when both sides get enough", () => {
    // Six lines, room for four: two stay over, four behind - both minimums met.
    const long = new TextElement({ fontSize: 10, content: "aa bb cc dd ee ff gg hh ii jj kk ll" });
    const split = long.fragment(40, 50, ctx);
    expect(split.fitted).not.toBeNull();
    expect(split.remainder).not.toBeNull();
  });
});
