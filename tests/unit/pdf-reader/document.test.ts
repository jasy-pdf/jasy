import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PdfDocument } from "../../../src/lib/pdf-reader/document";
import { readAcroForm } from "../../../src/lib/pdf-reader/acroform-reader";
import { get, nameOf, numberOf } from "../../../src/lib/pdf-reader/objects";
import { Document, Page, Text, renderToBytes } from "../../../src/lib/api";

// Opening a PDF is not "read it, decompress it". The index sits at the END of the file, exists in two
// formats, may chain back through incremental updates, and objects may be packed inside object streams.
// These tests run against SIX files from five independent producers, because every producer lays those
// structures out differently - and that is exactly where a reader breaks.

const load = (name: string) =>
  PdfDocument.load(new Uint8Array(readFileSync(`tests/fixtures/forms/${name}.pdf`)));

const ALL = [
  "jasy-form",
  "pdflib-form",
  "pdflib-form-classic",
  "pdfkit-form",
  "reactpdf-form",
  "gov-w9",
] as const;

describe("document - loading every producer", () => {
  for (const name of ALL) {
    it(`opens ${name}.pdf through its own cross-reference index`, () => {
      const doc = load(name);
      // Read for real, not rebuilt: a recovered index would mean we failed to understand the real one.
      expect(doc.recovered).toBe(false);
      expect(doc.objectNumbers().length).toBeGreaterThan(5);

      const catalog = doc.catalog;
      expect(catalog).toBeDefined();
      expect(nameOf(get(catalog, "Type"))).toBe("Catalog");

      // The page tree resolves, so reference following works across the whole file.
      const pages = doc.lookup(catalog, "Pages");
      expect(numberOf(doc.lookup(pages, "Count")) ?? 0).toBeGreaterThan(0);
    });
  }

  it("reads an xref STREAM with object streams exactly like the classic table", () => {
    // The two pdf-lib files hold the same document, saved once with object streams and once without.
    // Anything the reader gets wrong about either path shows up as a difference here.
    const modern = readAcroForm(load("pdflib-form"));
    const classic = readAcroForm(load("pdflib-form-classic"));
    expect(modern).toBeDefined();
    expect(classic).toBeDefined();
    expect(modern!.fields.map((f) => [f.name, f.type, f.value])).toEqual(
      classic!.fields.map((f) => [f.name, f.type, f.value]),
    );
    expect(modern!.fields.length).toBe(6);
  });

  it("follows a /Prev chain and undoes a PNG predictor (the real IRS form)", () => {
    // gov-w9 has three xref streams chained by /Prev, `/W [1 3 1]`, several /Index subsections and
    // `/Predictor 12`. Getting any of those wrong yields garbage offsets and no catalog at all.
    const doc = load("gov-w9");
    expect(doc.recovered).toBe(false);
    expect(doc.objectNumbers().length).toBeGreaterThan(1000);
    expect(numberOf(doc.lookup(doc.lookup(doc.catalog, "Pages"), "Count"))).toBe(6);
  });

  it("decompresses a Flate stream to usable content", () => {
    const doc = load("jasy-form");
    const kids = doc.lookup(doc.lookup(doc.catalog, "Pages"), "Kids");
    expect(Array.isArray(kids)).toBe(true);
    const page = doc.resolve(Array.isArray(kids) ? kids[0] : undefined);
    const stream = doc.lookup(page, "Contents");
    expect(stream).toBeDefined();
    const text = new TextDecoder("latin1").decode(
      doc.streamData(stream as Parameters<typeof doc.streamData>[0]),
    );
    expect(text).toContain("BT"); // a text object - so this really is a content stream
  });
});

describe("acroform reader - fields as a caller thinks of them", () => {
  it("finds the same fields whether the producer merges field and widget or splits them", () => {
    // pdf-lib splits (the field holds /T, its kid is a bare widget); PDFKit and we merge them.
    for (const name of ["jasy-form", "pdflib-form", "pdfkit-form"]) {
      const form = readAcroForm(load(name));
      expect(form).toBeDefined();
      const names = form!.fields.map((f) => f.name);
      expect(names).toContain("full_name");
      expect(names).toContain("notes");
      expect(names).toContain("agree");
      expect(form!.fields.find((f) => f.name === "full_name")?.value).toBe("Ada Lovelace");
      expect(form!.fields.find((f) => f.name === "full_name")?.type).toBe("Tx");
    }
  });

  it("builds fully qualified, dotted names from the field hierarchy", () => {
    // A real form nests fields; the name you address one by is the whole path.
    const form = readAcroForm(load("gov-w9"))!;
    expect(form.fields.length).toBe(23);
    expect(form.fields.some((f) => f.name.startsWith("topmostSubform[0].Page1[0]."))).toBe(true);
    expect(form.fields.every((f) => f.name.length > 0)).toBe(true);
  });

  it("keeps a radio group as ONE field with several widgets", () => {
    for (const name of ["jasy-form", "pdflib-form"]) {
      const plan = readAcroForm(load(name))!.fields.find((f) => f.name === "plan");
      expect(plan).toBeDefined();
      expect(plan!.type).toBe("Btn");
      expect(plan!.widgets.length).toBe(2); // two buttons, one field
    }
  });

  it("normalises a button value across the three spellings producers use", () => {
    // `/Yes` (a name, ours), `(Yes)` (PDFKit) and `(/Yes)` (react-pdf) all mean the same export value.
    // They must compare equal to the /AP state names, or filling could never match a state.
    for (const name of ["jasy-form", "pdfkit-form", "reactpdf-form", "pdflib-form"]) {
      const agree = readAcroForm(load(name))!.fields.find((f) => f.name === "agree");
      expect(agree?.value).toBe("Yes");
    }
    // And where appearances exist, the value is one of the states we could switch to.
    const jasy = readAcroForm(load("jasy-form"))!.fields.find((f) => f.name === "agree");
    expect(jasy?.onValues).toContain("Yes");
  });

  it("reads a choice field's options", () => {
    const country = readAcroForm(load("pdflib-form"))!.fields.find((f) => f.name === "country");
    expect(country?.type).toBe("Ch");
    expect(country?.options?.map((o) => o.value)).toEqual(["Germany", "France", "Spain"]);
    expect(country?.value).toBe("France");
  });

  it("reports a form whose fields carry no appearance stream", () => {
    // PDFKit writes none and asks the viewer to draw everything. Filling such a form means generating
    // appearances ourselves, so the reader has to say so.
    const form = readAcroForm(load("pdfkit-form"))!;
    expect(form.needAppearances).toBe(true);
    expect(form.fields.every((f) => f.needsAppearance)).toBe(true);
    // Ours is the opposite: everything baked, nothing for the viewer to do.
    const jasy = readAcroForm(load("jasy-form"))!;
    expect(jasy.needAppearances).toBe(false);
    expect(jasy.fields.every((f) => !f.needsAppearance)).toBe(true);
  });

  it("flags an XFA hybrid rather than pretending it is a plain AcroForm", () => {
    // Filling only the AcroForm side of a hybrid can be ignored by a viewer that prefers XFA.
    expect(readAcroForm(load("gov-w9"))!.hasXfa).toBe(true);
    expect(readAcroForm(load("jasy-form"))!.hasXfa).toBe(false);
  });

  it("returns undefined for a document that simply has no form", async () => {
    // Not an error - most PDFs are not forms. Rendering one here also round-trips our own writer
    // through our own reader, which is the cheapest possible check that the two agree.
    const bytes = await renderToBytes(Document([Page({ margin: 56 }, [Text("no form here")])]));
    const doc = PdfDocument.load(bytes);
    expect(doc.recovered).toBe(false);
    expect(readAcroForm(doc)).toBeUndefined();
  });

  it("does not crash on bytes that are not a PDF at all", () => {
    // A foreign file may be anything; the reader must fail as "nothing here", never by throwing.
    const junk = PdfDocument.load(new Uint8Array([1, 2, 3, 4, 5]));
    expect(junk.catalog).toBeUndefined();
    expect(readAcroForm(junk)).toBeUndefined();
  });
});
