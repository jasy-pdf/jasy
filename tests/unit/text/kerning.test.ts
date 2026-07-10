import { describe, it, expect } from "vitest";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { runAdvance } from "../../../src/lib/text/advance";
import { Document, Page, Text, renderToBytes } from "../../../src/lib/api";

// Standard-14 kerning: measuring (runAdvance) and drawing (a TJ array) both read the SAME AFM pairs,
// so a kerned run is exactly as wide as it is drawn. OFF by default (embedded fonts are not kerned
// yet), so every existing document stays byte-identical.

const om = (kerning = false) => {
  const m = new PDFObjectManager();
  m.registerFont("Helvetica", FontStyle.Normal, "Helvetica");
  m.setKerning(kerning);
  return m;
};

describe("getKernPairs (AFM)", () => {
  it("returns the font's declared pairs, one per gap", () => {
    // Helvetica.afm: KPX A V -70, KPX V A -80. "AVA" has gaps A-V and V-A.
    expect(om().getKernPairs("AVA", "Helvetica", FontStyle.Normal)).toEqual([-70, -80]);
  });

  it("is zero next to a space (letters are never kerned against a space)", () => {
    const pairs = om().getKernPairs("A V", "Helvetica", FontStyle.Normal);
    expect(pairs).toEqual([0, 0]); // A-space, space-V
  });

  it("is empty for a run shorter than two glyphs", () => {
    expect(om().getKernPairs("A", "Helvetica", FontStyle.Normal)).toEqual([]);
  });
});

describe("runAdvance with kerning", () => {
  it("adds the kerning only when the document has it on", () => {
    const off = om(false);
    const on = om(true);
    const font = { fontFamily: "Helvetica", fontSize: 1000, fontStyle: FontStyle.Normal };
    const plain = off.getStringWidth("AV", "Helvetica", 1000, FontStyle.Normal);
    expect(runAdvance(off, "AV", font)).toBeCloseTo(plain, 6); // off: no kerning
    // on: A-V is -70 units at 1000pt em -> -70pt.
    expect(runAdvance(on, "AV", font)).toBeCloseTo(plain - 70, 6);
  });
});

describe("the backend emits a TJ that matches the measurement", () => {
  const streamOf = async (kerning: boolean): Promise<string> => {
    const bytes = await renderToBytes(
      Document([Page({ margin: 20 }, [Text("AVATAR", { size: 40 })])]),
      { compress: false, kerning },
    );
    return new TextDecoder("latin1").decode(bytes);
  };

  it("emits a plain Tj (no TJ) when kerning is off - byte-identical path", async () => {
    const pdf = await streamOf(false);
    expect(pdf).toContain("(AVATAR) Tj");
    expect(pdf).not.toContain("TJ");
  });

  it("emits a TJ with the negated kern units between glyph chunks", async () => {
    const pdf = await streamOf(true);
    // KPX A V -70, V A -80, A T -120, T A -120 (A R has no pair) -> negated: 70 80 120 120.
    expect(pdf).toMatch(/\[\(A\) 70 \(V\) 80 \(A\) 120 \(T\) 120 \(AR\)\] TJ/);
    expect(pdf).not.toContain("(AVATAR) Tj");
  });

  it("the TJ advance equals runAdvance (measured == drawn)", async () => {
    const m = om(true);
    const font = { fontFamily: "Helvetica", fontSize: 40, fontStyle: FontStyle.Normal };
    const measured = runAdvance(m, "AVATAR", font);
    const plain = m.getStringWidth("AVATAR", "Helvetica", 40, FontStyle.Normal);
    const kernUnits = m
      .getKernPairs("AVATAR", "Helvetica", FontStyle.Normal)
      .reduce((a, b) => a + b, 0);
    // measured = plain glyph widths + kerning (em/1000 * size). The TJ moves the pen by exactly the
    // same kern sum, so the drawn advance is identical.
    expect(measured).toBeCloseTo(plain + (kernUnits / 1000) * 40, 6);
  });
});
