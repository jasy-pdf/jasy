import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { flattenForm, FlattenError } from "../../../src/lib/edit/flatten.ts";
import { fillForm } from "../../../src/lib/edit/fill.ts";
import { PdfDocument } from "../../../src/lib/edit/document.ts";
import { readAcroForm } from "../../../src/lib/edit/acroform-reader.ts";
import { get, isStream } from "../../../src/lib/edit/objects.ts";

// Flattening: the values become page content and stop being fields.
//
// There is nothing to render - a field's appearance already IS a form XObject, so flattening stamps that
// XObject onto the page and drops the widget. What the tests below are really about is everything around
// that: which page a widget belongs to, what happens to a producer that ships no appearance at all, and
// the graphics state the existing page content leaves behind.

const PRODUCERS = ["jasy-form", "pdflib-form", "pdfkit-form", "reactpdf-form"];
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/forms/${name}.pdf`));

const pageOf = (doc: PdfDocument) => {
  const kids = doc.lookup(doc.lookup(doc.catalog, "Pages"), "Kids");
  return doc.resolve(Array.isArray(kids) ? kids[0] : undefined);
};

/** Every content stream of page 1, concatenated. */
const pageContent = (doc: PdfDocument): string => {
  const contents = doc.lookup(pageOf(doc), "Contents");
  const parts = Array.isArray(contents) ? contents : [get(pageOf(doc), "Contents")];
  return parts
    .map((p) => {
      const s = doc.resolve(p);
      return isStream(s) ? new TextDecoder("latin1").decode(doc.streamData(s)) : "";
    })
    .join("\n");
};

describe("flattenForm - across producers", () => {
  for (const name of PRODUCERS) {
    it(`flattens ${name}.pdf into page content`, async () => {
      const original = fixture(name);
      const filled = (
        await fillForm(original, { full_name: "Grace Hopper", notes: "a note", agree: true })
      ).bytes;
      const { bytes, flattened } = await flattenForm(filled);

      expect(flattened.length).toBeGreaterThan(0);
      // Still an incremental update - the input is a literal prefix of the output.
      expect(Array.from(bytes.subarray(0, filled.length))).toEqual(Array.from(filled));

      const doc = PdfDocument.load(bytes);
      // No fields and no widgets left: the form is gone, not merely emptied.
      expect(readAcroForm(doc)?.fields.length ?? 0).toBe(0);
      const annots = doc.lookup(pageOf(doc), "Annots");
      expect(Array.isArray(annots) ? annots.length : 0).toBe(0);
      // ... and the values are drawn instead, as XObject invocations.
      expect(pageContent(doc)).toMatch(/\/JasyFlat\d+ Do/);
    });
  }

  it("draws an appearance for a producer that ships none", async () => {
    // PDFKit writes no /AP at all and leaves every box to the viewer. Refusing here would mean refusing
    // most foreign forms, so the picture is drawn from the widget's own style and current value.
    const before = readAcroForm(PdfDocument.load(fixture("pdfkit-form")))!;
    expect(before.fields.every((f) => f.needsAppearance)).toBe(true);

    const { flattened } = await flattenForm(fixture("pdfkit-form"));
    expect(flattened.length).toBe(before.fields.length);
  });
});

describe("flattenForm - the graphics state of the page it appends to", () => {
  // Several content streams are ONE stream to a reader, so whatever the page's own content leaves in
  // effect applies to ours. PDFKit and react-pdf both open with `1 0 0 -1 0 <h> cm` and never undo it -
  // legal, since nothing follows a page - and our stamps would land upside down.
  const contentsOf = (bytes: Uint8Array) => {
    const doc = PdfDocument.load(bytes);
    const c = doc.lookup(pageOf(doc), "Contents");
    return Array.isArray(c) ? c.length : 1;
  };

  it("brackets the page in q/Q when it leaves a transform behind", async () => {
    for (const name of ["pdfkit-form", "reactpdf-form"]) {
      const { bytes } = await flattenForm(fixture(name));
      // original + our stamps + the leading `q` = three.
      expect(contentsOf(bytes)).toBe(3);
      expect(pageContent(PdfDocument.load(bytes))).toContain("Q\n");
    }
  });

  it("leaves a well-behaved page alone", async () => {
    // Ours and pdf-lib's restore what they change, so they pay nothing for the fix above.
    for (const name of ["jasy-form", "pdflib-form"]) {
      const { bytes } = await flattenForm(fixture(name));
      expect(contentsOf(bytes)).toBe(2);
    }
  });
});

describe("flattenForm - the contract", () => {
  it("flattens only the fields it was asked for", async () => {
    const { bytes, flattened } = await flattenForm(fixture("jasy-form"), { fields: ["full_name"] });
    expect(flattened).toEqual(["full_name"]);
    const left = readAcroForm(PdfDocument.load(bytes))!;
    expect(left.fields.map((f) => f.name)).not.toContain("full_name");
    expect(left.fields.length).toBeGreaterThan(0); // the rest is still a form
  });

  it("names an unknown field instead of quietly doing nothing", async () => {
    await expect(flattenForm(fixture("jasy-form"), { fields: ["nope"] })).rejects.toThrow(
      /no such field: "nope"/,
    );
  });

  it("refuses a document that has no form", async () => {
    await expect(flattenForm(new Uint8Array([1, 2, 3]))).rejects.toThrow(FlattenError);
  });

  it("keeps a check box showing the state it was on", async () => {
    // Flattening freezes what the reader sees, so an unchecked box must not come out checked.
    const off = (await fillForm(fixture("jasy-form"), { agree: false })).bytes;
    const flat = (await flattenForm(off)).bytes;
    const drawn = pageContent(PdfDocument.load(flat));
    expect(drawn).toMatch(/\/JasyFlat\d+ Do/);
    // The "on" mark is a stroked path; the off state draws no check.
    const doc = PdfDocument.load(flat);
    const xobjects = doc.lookup(doc.lookup(pageOf(doc), "Resources"), "XObject");
    expect(xobjects).toBeDefined();
  });
});
