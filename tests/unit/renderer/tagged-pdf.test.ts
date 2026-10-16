import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Column,
  Box,
  Text,
  Table,
  Link,
  Anchor,
  TextField,
  mm,
  renderPdf,
} from "../../../src/lib/index";

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

  it("declares PDF/UA-1: metadata, DisplayDocTitle, page Tabs, TH scope, title", async () => {
    const doc = Document([
      Page({ margin: 40 }, [
        Text("Title", { role: "h1" }),
        Table({ columns: ["1fr", "auto"], header: ["Name", "Value"] }, [["a", "1"]]),
      ]),
    ]);
    const pdf = await renderPdf(doc, {
      accessible: true,
      title: "My Doc",
      lang: "de-DE",
      compress: false,
    });
    expect(pdf).toContain("<pdfuaid:part>1</pdfuaid:part>"); // PDF/UA-1 identification (XMP)
    expect(pdf).toContain("/ViewerPreferences << /DisplayDocTitle true >>");
    expect(pdf).toContain("/Tabs /S"); // logical tab/reading order on the page
    expect(pdf).toContain("/Scope /Column"); // header cells carry a Scope
    expect(pdf).toContain("My Doc"); // dc:title
  });
});

// PDF/UA 7.18: every annotation sits in the structure tree. A link goes into a /Link element that also
// holds its text and describes itself (/Contents); a form widget goes into a /Form element with a name.
describe("annotations in the structure tree (PDF/UA 7.18)", () => {
  /** The dictionary of indirect object `num`. */
  const objectOf = (pdf: string, num: string) =>
    pdf.match(new RegExp(`(?:^|\\n)${num} 0 obj\\s*([\\s\\S]*?)endobj`))?.[1] ?? "";
  /** Object numbers of every annotation of the given subtype. */
  const annots = (pdf: string, subtype: string) =>
    [...pdf.matchAll(new RegExp(`(\\d+) 0 obj\\s*<< [^\\n]*?/Subtype /${subtype}\\b`, "g"))].map(
      (m) => m[1]!,
    );
  /** The structure elements whose /K holds an /OBJR to `annot`. */
  const ownersOf = (pdf: string, annot: string) =>
    [...pdf.matchAll(/<< \/Type \/StructElem \/S \/(\w+)[^\n]*/g)]
      .filter((m) => m[0].includes(`/Type /OBJR`) && new RegExp(`/Obj ${annot} 0 R`).test(m[0]))
      .map((m) => m[1]);

  it("a link is a /Link element holding its annotation, and says what it links", async () => {
    const doc = Document([
      Page([
        Column([Link({ to: "end" }, Text("Read the terms")), Anchor({ name: "end" }, Text("End"))]),
      ]),
    ]);
    const pdf = await renderPdf(doc, { accessible: true, compress: false });
    const [link] = annots(pdf, "Link");
    const dict = objectOf(pdf, link!);
    expect(dict).toMatch(/\/StructParent \d+/);
    expect(dict).toContain("/Contents (Read the terms)");
    expect(ownersOf(pdf, link!)).toEqual(["Link"]);
    // The ParentTree maps the annotation's StructParent straight to that element.
    const structParent = dict.match(/\/StructParent (\d+)/)![1];
    const nums = pdf.match(/\/Nums \[ ([\s\S]*?) \] >>/)![1]!;
    expect(nums).toMatch(new RegExp(`(^| )${structParent} \\d+ 0 R`));
  });

  it("a link split over two pages is ONE /Link element with both annotations", async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence ${i} of a long linked paragraph.`);
    const doc = Document([
      Page({ size: mm(80, 45), margin: 8 }, [
        Link({ href: "https://jasy.dev" }, Text(long.join(" "))),
      ]),
    ]);
    const pdf = await renderPdf(doc, { accessible: true, compress: false });
    const links = annots(pdf, "Link");
    expect(links.length).toBeGreaterThan(1);
    expect((pdf.match(/\/S \/Link\b/g) ?? []).length).toBe(1);
    for (const link of links) expect(ownersOf(pdf, link)).toEqual(["Link"]);
  });

  it("a form widget is a /Form element, named by its field when it has no tooltip", async () => {
    const doc = Document([
      Page([Column([Text("Contact"), TextField({ name: "email", width: 200, height: 20 })])]),
    ]);
    const pdf = await renderPdf(doc, { accessible: true, compress: false });
    const [widget] = annots(pdf, "Widget");
    expect(objectOf(pdf, widget!)).toMatch(/\/StructParent \d+/);
    expect(ownersOf(pdf, widget!)).toEqual(["Form"]);
    expect(pdf).toMatch(/\/S \/Form [^\n]*\/Alt \(email\)/);
  });

  it("an untagged document keeps its annotations exactly as before", async () => {
    const doc = Document([Page([Link({ href: "https://jasy.dev" }, Text("jasy"))])]);
    const pdf = await renderPdf(doc, { compress: false });
    const [link] = annots(pdf, "Link");
    expect(objectOf(pdf, link!)).not.toMatch(/\/StructParent|\/Contents/);
    expect(pdf).not.toContain("/OBJR");
  });
});
