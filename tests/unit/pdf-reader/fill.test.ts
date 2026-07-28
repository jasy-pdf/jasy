import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fillForm, FillError } from "../../../src/lib/pdf-reader/fill";
import { PdfDocument } from "../../../src/lib/pdf-reader/document";
import { readAcroForm } from "../../../src/lib/pdf-reader/acroform-reader";
import { get } from "../../../src/lib/pdf-reader/objects";

// Filling an EXISTING form, against the same five producers the reader is tested with. Writing into a
// foreign file is where assumptions get punished: every one of these tests exists because something
// really did go wrong on one of these fixtures.

const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/forms/${name}.pdf`));

/** Every producer whose form we can fill (gov-w9 is exercised separately - it is an XFA hybrid). */
const PRODUCERS = [
  "jasy-form",
  "pdflib-form",
  "pdflib-form-classic",
  "pdfkit-form",
  "reactpdf-form",
];

const readBack = (bytes: Uint8Array) => {
  const doc = PdfDocument.load(bytes);
  const form = readAcroForm(doc);
  if (!form) throw new Error("no form in the filled file");
  return { doc, form, field: (n: string) => form.fields.find((f) => f.name === n) };
};

describe("fillForm - across producers", () => {
  for (const name of PRODUCERS) {
    it(`fills ${name}.pdf and reads the values back`, () => {
      const original = fixture(name);
      const { bytes } = fillForm(original, {
        full_name: "Grace Hopper",
        notes: "a note",
        agree: true,
      });

      // The original file is a literal PREFIX of the result: an incremental update appends, it never
      // rewrites. This is the property that keeps a signature over the original bytes intact.
      expect(bytes.length).toBeGreaterThan(original.length);
      expect(Array.from(bytes.subarray(0, original.length))).toEqual(Array.from(original));

      const { field } = readBack(bytes);
      expect(field("full_name")?.value).toBe("Grace Hopper");
      expect(field("notes")?.value).toBe("a note");
      expect(field("agree")?.value).not.toBe("Off");
    });
  }

  it("carries unicode through every producer - umlauts, currency, CJK and emoji", () => {
    // A PDF literal is PDFDocEncoded; writing UTF-8 into one (the obvious mistake) reads back as
    // mojibake. Anything outside ASCII therefore has to go out as a UTF-16BE hex string.
    const hard = "Jörg Müller — 1.234,56 € · 日本 😀 · a(b)c\\d";
    for (const name of PRODUCERS) {
      const { bytes } = fillForm(fixture(name), { full_name: hard });
      expect(readBack(bytes).field("full_name")?.value).toBe(hard);
    }
  });

  it("leaves fields it was not asked about completely alone", () => {
    // The point of an incremental update: a form with 20 fields of which you fill 3 keeps the other 17
    // byte for byte, values and all.
    const before = readBack(fixture("pdflib-form"));
    const { bytes } = fillForm(fixture("pdflib-form"), { full_name: "only this one" });
    const after = readBack(bytes);
    for (const name of ["notes", "agree", "plan", "country", "size"]) {
      expect(after.field(name)?.value).toBe(before.field(name)?.value);
    }
  });
});

describe("fillForm - the appearance must not go stale", () => {
  // The bug this suite exists for: a producer that DRAWS its fields (jasy, pdf-lib) leaves a picture of
  // the old value behind. Setting a new /V without touching it gives a self-contradicting document, and
  // the viewer faithfully shows the old, empty picture. Producers that draw nothing (PDFKit, react-pdf)
  // never had the problem - which is exactly how the cause was found.
  const appearanceOf = (bytes: Uint8Array, fieldName: string) => {
    const { doc, field } = readBack(bytes);
    const widget = field(fieldName)?.widgets[0]?.num;
    return widget === undefined ? undefined : get(doc.getObject(widget), "AP");
  };

  it("drops a text field's stale drawing when the value changes", () => {
    for (const name of ["jasy-form", "pdflib-form"]) {
      // These two DO draw their fields, so there is something to invalidate.
      expect(appearanceOf(fixture(name), "notes")).toBeDefined();
      const { bytes } = fillForm(fixture(name), { notes: "new text" });
      expect(appearanceOf(bytes, "notes")).toBeUndefined();
    }
  });

  it("keeps a check box's drawing, because it holds STATES and not a value", () => {
    // /AP for a button is `<< /Yes … /Off … >>`; both stay valid and only /AS moves. Dropping it would
    // leave the box with nothing to display at all.
    const { bytes } = fillForm(fixture("jasy-form"), { agree: true });
    expect(appearanceOf(bytes, "agree")).toBeDefined();
    const { doc, field } = readBack(bytes);
    const widget = doc.getObject(field("agree")!.widgets[0].num!);
    expect(get(widget, "AS")).toBeDefined(); // the visible state was switched
  });

  it("switches a radio group so that exactly one button is on", () => {
    const { bytes } = fillForm(fixture("jasy-form"), { plan: "basic" });
    const { doc, field } = readBack(bytes);
    const plan = field("plan")!;
    expect(plan.value).toBe("basic");
    const states = plan.widgets.map((w) => {
      const as = get(doc.getObject(w.num!), "AS");
      return as !== undefined && typeof as === "object" && "name" in as ? as.name : undefined;
    });
    expect(states.filter((s) => s !== "Off" && s !== undefined)).toEqual(["basic"]);
    expect(states.filter((s) => s === "Off")).toHaveLength(1);
  });
});

describe("fillForm - the form is a contract", () => {
  it("names an unknown field instead of quietly doing nothing", () => {
    expect(() => fillForm(fixture("jasy-form"), { nope: "x" })).toThrow(FillError);
    expect(() => fillForm(fixture("jasy-form"), { nope: "x" })).toThrow(/no such field: "nope"/);
  });

  it("rejects a value the field's type cannot hold", () => {
    expect(() => fillForm(fixture("jasy-form"), { full_name: true })).toThrow(/text field/);
    expect(() => fillForm(fixture("jasy-form"), { agree: ["a"] })).toThrow(/button/);
  });

  it("rejects a choice that is not one of the options", () => {
    expect(() => fillForm(fixture("jasy-form"), { country: "Atlantis" })).toThrow(
      /not an option of "country"/,
    );
    // ... and lists what IS accepted, so the message is actionable.
    expect(() => fillForm(fixture("jasy-form"), { country: "Atlantis" })).toThrow(/"Germany"/);
  });

  it("refuses a signature field rather than pretending to sign", () => {
    expect(() => fillForm(fixture("jasy-form"), { sig: "me" })).toThrow(/signature field/);
  });

  it("refuses a push button, which holds no value", () => {
    expect(() => fillForm(fixture("jasy-form"), { go: "x" })).toThrow(/push button/);
  });

  it("clears a value with null", () => {
    const { bytes } = fillForm(fixture("jasy-form"), { full_name: null });
    expect(readBack(bytes).field("full_name")?.value).toBeUndefined();
  });

  it("warns about an XFA hybrid instead of silently filling half a document", () => {
    // gov-w9 carries both an AcroForm and an XFA packet; a viewer preferring XFA may ignore our values.
    const w9 = fixture("gov-w9");
    const name = readAcroForm(PdfDocument.load(w9))!.fields[0].name;
    const { warnings, filled } = fillForm(w9, { [name]: "Ada" });
    expect(filled).toEqual([name]);
    expect(warnings.join(" ")).toMatch(/XFA/);
  });

  it("refuses a document that has no form at all", () => {
    expect(() => fillForm(new Uint8Array([1, 2, 3]), { a: "b" })).toThrow(/no AcroForm/);
  });
});

describe("fillForm - the file stays valid", () => {
  it("can be filled twice, each update chaining onto the last", () => {
    // Two incremental updates in a row: the second must find the first one's values and add to them.
    const once = fillForm(fixture("pdflib-form"), { full_name: "First" }).bytes;
    const twice = fillForm(once, { notes: "Second" }).bytes;
    expect(Array.from(twice.subarray(0, once.length))).toEqual(Array.from(once));
    const { field } = readBack(twice);
    expect(field("full_name")?.value).toBe("First");
    expect(field("notes")?.value).toBe("Second");
  });

  it("keeps the document readable: catalog, pages and index all still resolve", () => {
    for (const name of PRODUCERS) {
      const { bytes } = fillForm(fixture(name), { full_name: "X" });
      const doc = PdfDocument.load(bytes);
      // Read through the REAL index, not a rebuilt one - a broken update would force recovery.
      expect(doc.recovered).toBe(false);
      expect(doc.catalog).toBeDefined();
      expect(doc.lookup(doc.catalog, "Pages")).toBeDefined();
      expect(new TextDecoder("latin1").decode(bytes).trimEnd().endsWith("%%EOF")).toBe(true);
    }
  });

  it("writes an xref stream for a stream-indexed file and a table for a table-indexed one", () => {
    // Mixing the two would leave a reader that follows only one kind unable to walk the chain back.
    const modern = fillForm(fixture("pdflib-form"), { full_name: "X" }).bytes;
    const classic = fillForm(fixture("pdflib-form-classic"), { full_name: "X" }).bytes;
    const tailOf = (b: Uint8Array) => new TextDecoder("latin1").decode(b.subarray(b.length - 900));
    expect(tailOf(modern)).toContain("/Type /XRef");
    expect(tailOf(classic)).toContain("xref");
    expect(tailOf(classic)).toContain("trailer");
    // Both chain back to the revision they were built on.
    expect(tailOf(modern)).toMatch(/\/Prev \d+/);
    expect(tailOf(classic)).toMatch(/\/Prev \d+/);
  });

  it("does not corrupt binary bytes in the appended index", () => {
    // The xref stream is binary; running it through a UTF-8 encoder turns every value above 127 into
    // two bytes and the whole index becomes garbage - which is exactly what happened first time round.
    const bytes = fillForm(fixture("pdflib-form"), { full_name: "X" }).bytes;
    const doc = PdfDocument.load(bytes);
    expect(doc.recovered).toBe(false); // a garbled index would have forced a rebuild
    expect(readAcroForm(doc)!.fields.length).toBe(6);
  });
});
