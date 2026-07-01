import { describe, it, expect } from "vitest";
import { Document, Page, Column, Text, renderPdf } from "../../../src/lib/index";

const doc = () =>
  Document([Page({ margin: 40 }, [Column([Text("Heading"), Text("A paragraph of body text.")])])]);

describe("accessible tagging (PDF/UA foundation)", () => {
  it("emits a tagged structure tree when accessible", async () => {
    const pdf = await renderPdf(doc(), { accessible: true, lang: "de-DE", compress: false });
    expect(pdf).toContain("/MarkInfo << /Marked true >>");
    expect(pdf).toContain("/StructTreeRoot");
    expect(pdf).toContain("/Lang (de-DE)");
    expect(pdf).toContain("/StructParents");
    expect(pdf).toContain("/S /Document");
    expect(pdf).toContain("/S /P");
    expect(pdf).toMatch(/\/P <<\/MCID \d+>> BDC/);
    expect(pdf).toContain("EMC");
    expect(pdf).toContain("/ParentTree");
  });

  it("does not tag by default (gate off = no structure markers)", async () => {
    const off = await renderPdf(doc(), { compress: false });
    const on = await renderPdf(doc(), { accessible: true, compress: false });
    expect(off).not.toContain("/StructTreeRoot");
    expect(off).not.toContain("/MarkInfo");
    expect(off).not.toContain("BDC");
    expect(on).not.toBe(off); // sanity: tagging did change the output
  });
});
