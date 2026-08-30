import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { wrapStringIntoLines } from "../../../src/lib/text/line-breaker.ts";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import { testMetrics } from "../support/metrics.ts";

// `hyphenate` is a HOOK: no pattern data ships in @jasy/pdf, because 732 KB for German alone is against
// the character of a library whose selling point is "no headless browser, no JVM". The docs therefore
// tell people to bring their own, and show one line to do it.
//
// This test runs THAT line, against the real package. A documented integration nobody executes is one
// that rots: two minor versions later the README still shows it and it no longer works. `hyphen` is a
// devDependency for exactly this - it reaches no user's bundle.
//
// Deliberately NOT what react-pdf does. It hyphenates with no configuration at all, using the patterns
// it bundles - which means German split by English rules, and German is the market. The honest default
// is not "hyphenate with whatever patterns are lying around" but "do not hyphenate until you name the
// language".

const require = createRequire(import.meta.url);
const { hyphenateSync } = require("hyphen/de") as { hyphenateSync: (w: string) => string };

/** The line that belongs in the docs, verbatim. `hyphen` marks its points with U+00AD. */
const german = (word: string): string[] => hyphenateSync(word).split("\u00AD");

const metrics = testMetrics();
const FONT = { fontFamily: "Helvetica", fontSize: 12, fontStyle: FontStyle.Normal };

describe("the documented one-line hyphenator adapter", () => {
  it("produces exactly the shape `Hyphenator` expects", () => {
    // The word from the roadmap card that started this.
    expect(german("Rechtsschutzversicherungsgesellschaften")).toEqual([
      "Rechts",
      "schutz",
      "ver",
      "si",
      "che",
      "rungs",
      "ge",
      "sell",
      "schaf",
      "ten",
    ]);
  });

  it("returns the word unsplit when there is nothing to split", () => {
    // A one-syllable word has no point; the hook must cope, and `splitLongWord` treats it as "no help".
    expect(german("Haus")).toEqual(["Haus"]);
  });

  it("actually breaks a line when passed to Text/the breaker", () => {
    const lines = wrapStringIntoLines(
      "Rechtsschutzversicherungsgesellschaften",
      FONT.fontFamily,
      FONT.fontSize,
      FONT.fontStyle,
      150,
      metrics,
      undefined,
      undefined,
      0,
      { splitting: { hyphenate: german } },
    );

    expect(lines.length).toBeGreaterThan(1);
    // Every line but the last ends with the hyphen that was drawn at the break.
    for (const line of lines.slice(0, -1)) expect(line.endsWith("-")).toBe(true);
    // And the text is intact: the pieces, minus those hyphens, spell the word again.
    expect(lines.map((l) => l.replace(/-$/, "")).join("")).toBe(
      "Rechtsschutzversicherungsgesellschaften",
    );
  });
});
