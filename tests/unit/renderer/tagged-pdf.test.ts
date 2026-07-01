import { describe, it, expect } from "vitest";
import { Document, Page, Column, Box, Text, Table, mm, renderPdf } from "../../../src/lib/index";

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
  it("tags heading roles and auto-marks decoration as an artifact", async () => {
    const doc = Document([
      Page({ margin: 40 }, [
        Column([
          Text("Title", { role: "h1" }),
          Text("Body paragraph."),
          Box({ bg: "#eeeeee", padding: 8 }, [Text("Boxed text.")]),
        ]),
      ]),
    ]);
    const pdf = await renderPdf(doc, { accessible: true, compress: false });
    expect(pdf).toContain("/S /H1");
    expect(pdf).toContain("/S /P");
    expect(pdf).toMatch(/\/H1 <<\/MCID \d+>> BDC/);
    expect(pdf).toContain("/Artifact BMC"); // the box background rect
  });

  it("keeps a paragraph split across pages as ONE P element (Acrobat-level)", async () => {
    const long = Array.from(
      { length: 60 },
      (_, i) => `Sentence number ${i} of a long paragraph.`,
    ).join(" ");
    const doc = Document([Page({ size: mm(80, 45), margin: 8 }, [Text(long)])]);
    const pdf = await renderPdf(doc, { accessible: true, compress: false });
    // It paginates onto several physical pages...
    expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    // ...but the structure tree has exactly ONE P (its content marked across those pages).
    expect((pdf.match(/\/S \/P\b/g) ?? []).length).toBe(1);
  });

  it("tags a table as Table > TR > TH/TD, ONE logical Table across pages", async () => {
    const rows = Array.from({ length: 24 }, (_, i) => [`Item ${i}`, `${i} EUR`]);
    const doc = Document([
      Page({ size: mm(95, 55), margin: 8 }, [
        Table({ columns: ["1fr", "auto"], header: ["Item", "Price"], cellPadding: 4 }, rows),
      ]),
    ]);
    const pdf = await renderPdf(doc, { accessible: true, compress: false });
    expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1); // paginates
    expect((pdf.match(/\/S \/Table\b/g) ?? []).length).toBe(1); // ONE logical <Table>
    expect(pdf).toContain("/S /TR");
    expect(pdf).toContain("/S /TH");
    expect(pdf).toContain("/S /TD");
  });
});
