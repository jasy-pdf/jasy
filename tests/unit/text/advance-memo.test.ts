// `runAdvance` memoises what it measures; this pins that its key covers every property which changes
// a width. Asserting one combination's number would pass with a broken key, so each is read alone,
// then read again through a metrics object that has measured all the others in between.
import { describe, it, expect } from "vitest";
import { runAdvance } from "../../../src/lib/text/advance.ts";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import type { FontMetrics } from "../../../src/lib/utils/font-metrics.ts";
import { testMetrics } from "../support/metrics.ts";

const TEXT = "Waffle office five";

/** Metrics whose width differs for every property the memo must tell apart - the shared `testMetrics`
 *  varies only with the size, so a broken key would slip through it. */
const discriminating = () => {
  let epoch = 0;
  const m = testMetrics({
    getStringWidth: (text, family, size, style, ligatures) =>
      text.length * size +
      family.length * 100 +
      String(style).charCodeAt(0) * 7 +
      (ligatures === false ? 3 : 0),
    kerningEnabled: true,
    getKernPairs: (text, family, style) =>
      [...text].slice(1).map(() => family.length + String(style).charCodeAt(0)),
  });
  return Object.defineProperty(m, "fontEpoch", {
    get: () => epoch,
    configurable: true,
  }) as FontMetrics & { bump(): void };
};

const COMBOS = [
  { fontFamily: "Helvetica", fontSize: 10, fontStyle: FontStyle.Normal, ligatures: true },
  { fontFamily: "Helvetica", fontSize: 10, fontStyle: FontStyle.Normal, ligatures: false },
  { fontFamily: "Helvetica", fontSize: 24, fontStyle: FontStyle.Normal, ligatures: true },
  { fontFamily: "Helvetica", fontSize: 10, fontStyle: FontStyle.Bold, ligatures: true },
  { fontFamily: "Times", fontSize: 10, fontStyle: FontStyle.Normal, ligatures: true },
  { fontFamily: "Times", fontSize: 24, fontStyle: FontStyle.Italic, ligatures: false },
];

describe("the run-advance memo", () => {
  it("keys on every property that changes a width", () => {
    // The truth, each read through a metrics object that has measured nothing else.
    const alone = COMBOS.map((font) => runAdvance(discriminating(), TEXT, font));

    // The same readings through ONE object, with every other combination measured in between.
    const shared = discriminating();
    for (const font of COMBOS) runAdvance(shared, TEXT, font);
    const together = COMBOS.map((font) => runAdvance(shared, TEXT, font));

    for (const [i, font] of COMBOS.entries()) {
      expect(
        together[i],
        `${font.fontFamily} ${font.fontSize} ${font.fontStyle} lig=${font.ligatures}`,
      ).toBeCloseTo(alone[i]!, 10);
    }
    // ...and the combinations differ, or the check above proves nothing.
    expect(new Set(alone.map((a) => a.toFixed(6))).size).toBe(COMBOS.length);
  });

  it("adds letterSpacing on top of the shared cached width", () => {
    const m = discriminating();
    const font = COMBOS[0]!;
    const plain = runAdvance(m, TEXT, font);
    const spaced = runAdvance(m, TEXT, font, 2);
    // Not part of the key: added outside, so both readings share one cached width.
    expect(spaced).toBeGreaterThan(plain);
    expect(runAdvance(m, TEXT, font)).toBeCloseTo(plain, 10);
  });

  it("forgets what it measured when a face is registered under a name it has seen", () => {
    let epoch = 0;
    const m = testMetrics({
      getStringWidth: (text, _f, size) => text.length * size + epoch * 1000,
    });
    Object.defineProperty(m, "fontEpoch", { get: () => epoch });
    const font = COMBOS[0]!;
    const before = runAdvance(m, TEXT, font);
    // What `registerFont` does.
    epoch = 1;
    expect(runAdvance(m, TEXT, font)).toBeCloseTo(before + 1000, 10);
  });

  it("forgets what it measured when kerning is switched off", () => {
    // `setKerning` runs on every render, and a document keeps its metrics object - so the same
    // document rendered twice with different options flips this under a warm cache.
    let kerning = true;
    const m = testMetrics({
      getStringWidth: (text, _f, size) => text.length * size,
      getKernPairs: (text) => [...text].slice(1).map(() => -50),
    });
    Object.defineProperty(m, "kerningEnabled", { get: () => kerning });
    const font = COMBOS[0]!;

    const kerned = runAdvance(m, TEXT, font);
    kerning = false;
    const plain = runAdvance(m, TEXT, font);
    kerning = true;

    expect(plain).toBeGreaterThan(kerned); // the pairs are negative, so dropping them widens the run
    expect(runAdvance(m, TEXT, font)).toBeCloseTo(kerned, 10);
  });
});
