import { describe, it, expect } from "vitest";
import { joiningType, joiningForms, needsJoining } from "../../../src/lib/text/arabic.ts";

// Joining decides WHICH of the four forms a letter takes; GSUB then decides which glyph that form is.
// These tests are about the first half only, so they read as letters and forms, never as glyph ids.

const cps = (text: string): number[] => [...text].map((c) => c.codePointAt(0)!);
const forms = (text: string): string[] => joiningForms(cps(text)).map((f) => f ?? "-");

describe("the joining type of a character", () => {
  it("knows the three kinds that matter", () => {
    expect(joiningType(0x0628)).toBe("D"); // beh joins on both sides
    expect(joiningType(0x0627)).toBe("R"); // alef joins only to its right
    expect(joiningType(0x0041)).toBe("U"); // a Latin A joins nothing
  });

  it("knows the two that are invisible to joining", () => {
    expect(joiningType(0x064b)).toBe("T"); // fathatan, a mark sitting on a letter
    expect(joiningType(0x0640)).toBe("C"); // tatweel, which causes a join without being a letter
    expect(joiningType(0x200d)).toBe("C"); // ZWJ, the same thing by other means
  });

  it("covers the scripts beyond Arabic that join the same way", () => {
    expect(joiningType(0x0710)).toBe("R"); // Syriac alaph
    expect(joiningType(0x0712)).toBe("D"); // Syriac beth
    expect(joiningType(0x07ca)).toBe("D"); // N'Ko a
    expect(joiningType(0x1e900)).toBe("D"); // Adlam alif
  });

  it("says U for anything outside the table, which is the standard's own default", () => {
    expect(joiningType(0x0020)).toBe("U");
    expect(joiningType(0x1f600)).toBe("U");
    expect(joiningType(0x05d0)).toBe("U"); // Hebrew does not join
  });
});

describe("the four forms of a word", () => {
  it("shapes a plain dual-joining word", () => {
    // beh-beh-beh: first joins left only, middle joins both, last joins right only.
    expect(forms("ببب")).toEqual(["init", "medi", "fina"]);
  });

  it("breaks the join after a right-joining letter", () => {
    // alef joins to what precedes it but NOT to what follows, so the beh after it starts fresh.
    expect(forms("باب")).toEqual(["init", "fina", "isol"]);
  });

  it("leaves a lone letter isolated", () => {
    expect(forms("ب")).toEqual(["isol"]);
    expect(forms("ا")).toEqual(["isol"]);
  });

  it("does not join across a space", () => {
    expect(forms("بب بب")).toEqual(["init", "fina", "-", "init", "fina"]);
  });

  it("shapes a real sentence the way the font's own presentation forms do", () => {
    // "marhaban bil'alam". Checked letter by letter against the glyphs NotoNaskhArabic, NotoSansArabic
    // and DejaVuSans map their U+FExx presentation-form code points to.
    expect(forms("مرحبا بالعالم")).toEqual([
      "init",
      "fina",
      "init",
      "medi",
      "fina",
      "-",
      "init",
      "fina",
      "init",
      "medi",
      "fina",
      "init",
      "fina",
    ]);
  });
});

describe("the characters that are invisible to joining", () => {
  it("lets a letter join straight through a combining mark", () => {
    // A fatha on the first beh must not break the join to the second - the mark is transparent.
    expect(forms("بَب")).toEqual(["init", "-", "fina"]);
  });

  it("joins through a tatweel, which is what a keshide is for", () => {
    // The tatweel takes no form of its own but makes both neighbours behave as if joined.
    expect(forms("بـب")).toEqual(["init", "-", "fina"]);
  });

  it("lets ZWJ force a joining form on a letter standing alone", () => {
    expect(forms("ب‍")).toEqual(["init", "-"]);
    expect(forms("‍ب")).toEqual(["-", "fina"]);
  });
});

describe("the fast path", () => {
  it("is false for text with nothing to join", () => {
    expect(needsJoining(cps("Invoice 2026"))).toBe(false);
    expect(needsJoining(cps("שלום"))).toBe(false); // Hebrew is right-to-left but does not join
  });

  it("is true as soon as one joining letter appears", () => {
    expect(needsJoining(cps("total مرحبا"))).toBe(true);
  });
});
