import { describe, it, expect } from "vitest";
import { Document, Page, Text, renderPdf } from "../../../src/lib/api";
import { buildTestTtf } from "../utils/ttf-fixture";

describe("Document font registry - addFont / getFonts / hasFont", () => {
  it("registers, queries, chains and overwrites by name", () => {
    const doc = Document([Page({ size: "A4" }, [Text("AB")])]);
    expect(doc.getFonts()).toEqual([]);
    expect(doc.hasFont("Brand")).toBe(false);

    const returned = doc.addFont("Brand", buildTestTtf());
    expect(returned).toBe(doc); // chainable
    expect(doc.hasFont("Brand")).toBe(true);
    expect(doc.getFonts()).toEqual(["Brand"]);

    doc.addFont("Brand", buildTestTtf()); // re-adding a name overwrites, never duplicates
    expect(doc.getFonts()).toEqual(["Brand"]);
  });

  it("embeds a registered font that IS used", async () => {
    const doc = Document([Page({ size: "A4" }, [Text("AB", { font: "Brand" })])]);
    doc.addFont("Brand", buildTestTtf());

    const pdf = await renderPdf(doc);
    expect(pdf).toContain("Brand"); // the embedded font's /BaseFont
  });

  it("DROPS a registered font that is NOT used (auto-drop, byte-identical)", async () => {
    const plain = Document([Page({ size: "A4" }, [Text("AB")])]);
    const withUnused = Document([Page({ size: "A4" }, [Text("AB")])]);
    withUnused.addFont("Brand", buildTestTtf()); // registered, but no Text uses it

    const unusedPdf = await renderPdf(withUnused);
    expect(unusedPdf).not.toContain("Brand"); // not embedded
    expect(unusedPdf).toBe(await renderPdf(plain)); // identical to never registering it
  });
});
