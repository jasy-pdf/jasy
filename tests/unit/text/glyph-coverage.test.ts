import { describe, it, expect } from "vitest";
import { coverText } from "../../../src/lib/text/glyph-coverage.ts";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager.ts";
import { testMetrics } from "../support/metrics.ts";

// A code point the chosen font cannot draw becomes glyph 0, which IS `.notdef` - and referencing it is
// forbidden by PDF/A (ISO 19005-3, 6.2.11.8). An invoice with a "✓" in its description was a
// conforming file right up until someone validated it.
//
// The check is DYNAMIC on purpose: which characters are missing is a property of the font, not of
// Unicode. @jasy/e-invoice embeds Liberation, whose gaps look arbitrary from outside - "→" draws,
// "⇒" does not.

/** A font that can draw ASCII and nothing else - the shape of the real problem, in miniature. */
const asciiOnly = () => {
  const m = testMetrics();
  return { ...m, hasGlyph: (cp: number) => cp < 0x80 };
};

const cover = (text: string) => coverText(text, "Helvetica", FontStyle.Normal, asciiOnly());

describe("what the font can draw is left alone", () => {
  it("returns the very same string when everything is drawable", () => {
    const text = "Rechnung 2026-029";
    // Identity, not just equality: an ordinary document must not even be rebuilt, so its bytes cannot
    // drift. Every existing gallery case depends on this.
    expect(cover(text).text).toBe(text);
    expect(cover(text).dropped).toEqual([]);
  });

  it("keeps a character the font DOES have, however exotic", () => {
    const m = { ...testMetrics(), hasGlyph: () => true };
    expect(coverText("✓ 北 🙂", "Any", FontStyle.Normal, m).dropped).toEqual([]);
    expect(coverText("✓ 北 🙂", "Any", FontStyle.Normal, m).text).toBe("✓ 北 🙂");
  });
});

describe("what it cannot draw", () => {
  it("substitutes where a plain equivalent means the same", () => {
    // The one that matters: dropping it would turn E‑Rechnung into ERechnung - a silent change to the
    // text of a document that counts legally.
    const out = cover("E‑Rechnung");
    expect(out.text).toBe("E-Rechnung");
    expect(out.dropped).toEqual([]);
  });

  it("drops what has no equivalent, and reports it", () => {
    const out = cover("OK ✓ fertig");
    expect(out.text).toBe("OK  fertig");
    expect(out.dropped).toEqual([0x2713]);
  });

  it("reports every distinct code point it removed", () => {
    expect(cover("₽ ⇒ 北").dropped).toEqual([0x20bd, 0x21d2, 0x5317]);
  });

  it("handles an astral character as ONE code point, not two halves", () => {
    const out = cover("a\u{1F642}b");
    expect(out.text).toBe("ab");
    expect(out.dropped).toEqual([0x1f642]);
  });

  it("leaves the space and the hard break to the breaker", () => {
    // Neither is ever drawn as a glyph, so neither may be treated as missing.
    const out = cover("a b\nc");
    expect(out.text).toBe("a b\nc");
    expect(out.dropped).toEqual([]);
  });
});
