import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fillForm, FillError } from "../../../src/lib/edit/fill.ts";
import { PdfDocument } from "../../../src/lib/edit/document.ts";
import { readAcroForm } from "../../../src/lib/edit/acroform-reader.ts";
import { get, textOf } from "../../../src/lib/edit/objects.ts";
import { Column, Document, Page, TextField, renderToBytes } from "../../../src/lib/api/index.ts";

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

/** Assemble a tiny PDF with a real cross-reference table, so a test never depends on the scan-rebuild
 *  fallback. `gens` gives each object's generation, defaulting to 0. */
function buildPdf(objects: string[], gens: number[] = []): Uint8Array {
  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} ${gens[i] ?? 0} obj\n${o}\nendobj\n`;
  });
  const startxref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off, i) => {
    body += `${String(off).padStart(10, "0")} ${String(gens[i] ?? 0).padStart(5, "0")} n \n`;
  });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

/**
 * A minimal PDF whose field tree has a PARENT stating `/FT`, `/MaxLen` and `/V`, and a kid stating none
 * of them. No producer we have fixtures from splits a field this way, so inheritance would otherwise be
 * untested. The `/AcroForm` sits INLINE in the catalog rather than behind a reference - also legal, and
 * also a case no fixture covers. `/constructor` is there to catch a key that exists on Object.prototype.
 */
function inheritedFieldPdf(): Uint8Array {
  return buildPdf([
    "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] >> >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [5 0 R] >>",
    "<< /T (group) /FT /Tx /MaxLen 5 /V (dad) /Kids [5 0 R] >>",
    "<< /Type /Annot /Subtype /Widget /Parent 4 0 R /T (child) /Rect [10 10 190 40] /constructor (keep me) >>",
  ]);
}

/** A small encrypted form, built with our own writer - the only encrypted PDF we can produce. */
const encryptedForm = () =>
  renderToBytes(
    Document([
      Page({ margin: 56 }, [
        Column([
          TextField({
            name: "full_name",
            value: "Ada Lovelace",
            tooltip: "Your name",
            border: "#888",
          }),
        ]),
      ]),
    ]),
    { encrypt: { userPassword: "secret" } },
  );

const readBack = (bytes: Uint8Array) => {
  const doc = PdfDocument.load(bytes);
  const form = readAcroForm(doc);
  if (!form) throw new Error("no form in the filled file");
  return { doc, form, field: (n: string) => form.fields.find((f) => f.name === n) };
};

describe("fillForm - across producers", () => {
  for (const name of PRODUCERS) {
    it(`fills ${name}.pdf and reads the values back`, async () => {
      const original = fixture(name);
      const { bytes } = await fillForm(original, {
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

  it("carries unicode through every producer - umlauts, currency, CJK and emoji", async () => {
    // A PDF literal is PDFDocEncoded; writing UTF-8 into one (the obvious mistake) reads back as
    // mojibake. Anything outside ASCII therefore has to go out as a UTF-16BE hex string.
    const hard = "Jörg Müller — 1.234,56 € · 日本 😀 · a(b)c\\d";
    for (const name of PRODUCERS) {
      const { bytes } = await fillForm(fixture(name), { full_name: hard });
      expect(readBack(bytes).field("full_name")?.value).toBe(hard);
    }
  });

  it("leaves fields it was not asked about completely alone", async () => {
    // The point of an incremental update: a form with 20 fields of which you fill 3 keeps the other 17
    // byte for byte, values and all.
    const before = readBack(fixture("pdflib-form"));
    const { bytes } = await fillForm(fixture("pdflib-form"), { full_name: "only this one" });
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

  it("REDRAWS a text field, so the picture shows the new value", async () => {
    for (const name of ["jasy-form", "pdflib-form", "pdfkit-form", "reactpdf-form"]) {
      const { bytes } = await fillForm(fixture(name), { notes: "new text" });
      // There IS an appearance afterwards - including for the two producers that ship none at all -
      // and it draws the value we just wrote.
      expect(appearanceOf(bytes, "notes")).toBeDefined();
      const doc = PdfDocument.load(bytes);
      const form = readAcroForm(doc)!;
      const widget = form.fields.find((f) => f.name === "notes")!.widgets[0].num!;
      const ap = get(doc.getObject(widget), "AP");
      const n = doc.resolve(get(ap, "N"));
      const drawn = new TextDecoder("latin1").decode(
        doc.streamData(n as Parameters<typeof doc.streamData>[0]),
      );
      expect(drawn).toContain("new text");
    }
  });

  it("leaves the drawing to the viewer when asked to", async () => {
    // The opt-out is the old behaviour, and it has to stay reachable: no picture, /NeedAppearances set.
    const { bytes } = await fillForm(
      fixture("jasy-form"),
      { notes: "new text" },
      { fieldAppearances: false },
    );
    expect(appearanceOf(bytes, "notes")).toBeUndefined();
    expect(new TextDecoder("latin1").decode(bytes)).toContain("/NeedAppearances true");
  });

  it("keeps a check box's drawing, because it holds STATES and not a value", async () => {
    // /AP for a button is `<< /Yes … /Off … >>`; both stay valid and only /AS moves. Dropping it would
    // leave the box with nothing to display at all.
    const { bytes } = await fillForm(fixture("jasy-form"), { agree: true });
    expect(appearanceOf(bytes, "agree")).toBeDefined();
    const { doc, field } = readBack(bytes);
    const widget = doc.getObject(field("agree")!.widgets[0].num!);
    expect(get(widget, "AS")).toBeDefined(); // the visible state was switched
  });

  it("ticks a check box whose widget declares no states of its own", async () => {
    // PDFKit and react-pdf write no appearance states, so a widget "owns" nothing and the usual test -
    // does this widget have the target state? - left every box Off however it was filled. It only became
    // visible once we started drawing the states ourselves.
    for (const name of ["pdfkit-form", "reactpdf-form"]) {
      const { bytes } = await fillForm(fixture(name), { agree: true });
      const { doc, field } = readBack(bytes);
      const widget = doc.getObject(field("agree")!.widgets[0].num!);
      const as = get(widget, "AS");
      expect(
        as !== undefined && as !== null && typeof as === "object" && "name" in as ? as.name : "",
      ).not.toBe("Off");
      expect(get(widget, "AP")).toBeDefined(); // and the state pictures now exist
    }
  });

  it("switches a radio group so that exactly one button is on", async () => {
    const { bytes } = await fillForm(fixture("jasy-form"), { plan: "basic" });
    const { doc, field } = readBack(bytes);
    const plan = field("plan")!;
    expect(plan.value).toBe("basic");
    const states = plan.widgets.map((w) => {
      // `typeof null` is "object" too, so the null case has to be ruled out before reading .name.
      const as = get(doc.getObject(w.num!), "AS");
      return as !== undefined && as !== null && typeof as === "object" && "name" in as
        ? as.name
        : undefined;
    });
    expect(states.filter((s) => s !== "Off" && s !== undefined)).toEqual(["basic"]);
    expect(states.filter((s) => s === "Off")).toHaveLength(1);
  });
});

describe("fillForm - the form is a contract", () => {
  it("names an unknown field instead of quietly doing nothing", async () => {
    await expect(fillForm(fixture("jasy-form"), { nope: "x" })).rejects.toThrow(FillError);
    await expect(fillForm(fixture("jasy-form"), { nope: "x" })).rejects.toThrow(
      /no such field: "nope"/,
    );
  });

  it("rejects a value the field's type cannot hold", async () => {
    await expect(fillForm(fixture("jasy-form"), { full_name: true })).rejects.toThrow(/text field/);
    await expect(fillForm(fixture("jasy-form"), { agree: ["a"] })).rejects.toThrow(/button/);
  });

  it("rejects a choice that is not one of the options", async () => {
    await expect(fillForm(fixture("jasy-form"), { country: "Atlantis" })).rejects.toThrow(
      /not an option of "country"/,
    );
    // ... and lists what IS accepted, so the message is actionable.
    await expect(fillForm(fixture("jasy-form"), { country: "Atlantis" })).rejects.toThrow(
      /"Germany"/,
    );
  });

  it("refuses a signature field rather than pretending to sign", async () => {
    await expect(fillForm(fixture("jasy-form"), { sig: "me" })).rejects.toThrow(/signature field/);
  });

  it("refuses a push button, which holds no value", async () => {
    await expect(fillForm(fixture("jasy-form"), { go: "x" })).rejects.toThrow(/push button/);
  });

  it("clears a value with null", async () => {
    const { bytes } = await fillForm(fixture("jasy-form"), { full_name: null });
    expect(readBack(bytes).field("full_name")?.value).toBeUndefined();
  });

  it("warns about an XFA hybrid instead of silently filling half a document", async () => {
    // gov-w9 carries both an AcroForm and an XFA packet; a viewer preferring XFA may ignore our values.
    const w9 = fixture("gov-w9");
    const name = readAcroForm(PdfDocument.load(w9))!.fields[0].name;
    const { warnings, filled } = await fillForm(w9, { [name]: "Ada" });
    expect(filled).toEqual([name]);
    expect(warnings.join(" ")).toMatch(/XFA/);
  });

  it("names WHICH encryption problem it is, rather than just refusing", async () => {
    const encrypted = await encryptedForm();
    await expect(fillForm(encrypted, { full_name: "Ada" })).rejects.toThrow(/pass its password/);
    await expect(fillForm(encrypted, { full_name: "Ada" }, { password: "nope" })).rejects.toThrow(
      /wrong password/,
    );
  });

  it("refuses a boolean for a choice field instead of writing the word 'true'", async () => {
    // `String(true)` used to reach the option check, so an EDITABLE combo would have accepted the text
    // "true" as a value.
    await expect(fillForm(fixture("jasy-form"), { country: true })).rejects.toThrow(/choice field/);
  });

  it("treats an empty array as clearing the choice", async () => {
    // It fell through to `pdfText(list[0])` on undefined and wrote the literal text "(undefined)".
    const { bytes } = await fillForm(fixture("jasy-form"), { size: [] });
    expect(readBack(bytes).field("size")?.value).toBeUndefined();
    expect(new TextDecoder("latin1").decode(bytes)).not.toContain("(undefined)");
  });

  it("refuses to read an encrypted form that was never opened with its password", async () => {
    // `load` does not decipher, so every string is still ciphertext; handing those back as field names
    // would be the silent guess this reader exists to avoid.
    const encrypted = await encryptedForm();
    expect(() => readAcroForm(PdfDocument.load(encrypted))).toThrow(
      /open it with PdfDocument.open/,
    );
  });

  it("refuses a document that has no form at all", async () => {
    await expect(fillForm(new Uint8Array([1, 2, 3]), { a: "b" })).rejects.toThrow(/no AcroForm/);
  });
});

describe("fillForm - /MaxLen", () => {
  // The real IRS form is the test case here: it declares /MaxLen on six fields, which none of the
  // producer fixtures do. A viewer stops the user at that limit while typing, so a longer value could
  // never have been entered by hand - and a comb field draws exactly MaxLen cells, leaving the surplus
  // nowhere to go.
  const w9 = () => fixture("gov-w9");
  const capped = () => {
    const form = readAcroForm(PdfDocument.load(w9()))!;
    return form.fields.find((f) => f.maxLen === 7)!; // f1_15, seven characters
  };

  it("reads /MaxLen off a real government form", async () => {
    const withMax = readAcroForm(PdfDocument.load(w9()))!.fields.filter(
      (f) => f.maxLen !== undefined,
    );
    expect(withMax.length).toBeGreaterThan(0);
    expect(capped().maxLen).toBe(7);
  });

  it("accepts a value exactly at the limit and refuses one past it", async () => {
    const name = capped().name;
    await expect(fillForm(w9(), { [name]: "1234567" })).resolves.toBeDefined();
    await expect(fillForm(w9(), { [name]: "12345678" })).rejects.toThrow(
      /holds at most 7 characters, but the value has 8/,
    );
  });

  it("counts code points, not UTF-16 units", async () => {
    // Four emoji are eight UTF-16 units but four characters; `.length` would reject a value the field
    // can hold perfectly well.
    const name = capped().name;
    expect([..."😀😀😀😀"].length).toBe(4);
    expect("😀😀😀😀".length).toBe(8);
    await expect(fillForm(w9(), { [name]: "😀😀😀😀" })).resolves.toBeDefined();
  });

  it("inherits /MaxLen from a parent field, the way the type is inherited", async () => {
    // Every fixture declares /MaxLen on the leaf, so inheritance needs a document built for it: a parent
    // field carrying /FT and /MaxLen, and a kid that states neither. Without this the rule would be
    // untested - the tree walk could ignore the parent entirely and every other test would still pass.
    const doc = PdfDocument.load(inheritedFieldPdf());
    expect(doc.recovered).toBe(false); // read through a real index, not a rescued one
    const field = readAcroForm(doc)!.fields.find((f) => f.name === "group.child")!;
    expect(field.type).toBe("Tx"); // inherited too, the established rule this rides on
    expect(field.maxLen).toBe(5);
    await expect(fillForm(inheritedFieldPdf(), { "group.child": "123456" })).rejects.toThrow(
      /holds at most 5 characters/,
    );
  });
});

describe("fillForm - awkward shapes a producer is allowed to write", () => {
  it("inherits /V from a parent field, so a kid that states no value still has one", async () => {
    const form = readAcroForm(PdfDocument.load(inheritedFieldPdf()))!;
    expect(form.fields.find((f) => f.name === "group.child")?.value).toBe("dad");
  });

  it("sets /NeedAppearances when the AcroForm sits INLINE in the catalog", async () => {
    // Only a referenced /AcroForm used to be rewritten, so an inline one silently kept its old flag and
    // the freshly written values were never drawn. Only reachable with the drawing left to the viewer -
    // when jasy bakes the picture itself there is nothing for the viewer to regenerate.
    const { bytes } = await fillForm(
      inheritedFieldPdf(),
      { "group.child": "abc" },
      { fieldAppearances: false },
    );
    const doc = PdfDocument.load(bytes);
    const acro = doc.lookup(doc.catalog, "AcroForm");
    expect(get(acro, "NeedAppearances")).toBe(true);
    expect(readAcroForm(doc)!.fields.find((f) => f.name === "group.child")?.value).toBe("abc");
  });

  it("keeps a dictionary key that collides with Object.prototype", async () => {
    // `k in changes` finds "constructor" on the prototype and would drop the entry from the rewritten
    // dictionary - silently deleting data we were never asked to touch.
    const { bytes } = await fillForm(inheritedFieldPdf(), { "group.child": "abc" });
    const doc = PdfDocument.load(bytes);
    const widget = doc.getObject(5);
    expect(textOf(get(widget, "constructor"))).toBe("keep me");
  });

  it("preserves an object's generation instead of writing 0", async () => {
    // Object 5 lives at generation 3. Re-emitting it as `5 0 obj` would describe a DIFFERENT object than
    // the one being replaced, and the xref entry would point at the wrong thing.
    const pdf = buildPdf(
      [
        "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Annots [5 0 R] >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Type /Annot /Subtype /Widget /T (aged) /FT /Tx /Rect [10 10 190 40] >>",
      ],
      [0, 0, 0, 0, 3],
    );
    const { bytes } = await fillForm(pdf, { aged: "value" });
    const appended = new TextDecoder("latin1").decode(bytes.subarray(pdf.length));
    expect(appended).toContain("5 3 obj");
    expect(appended).not.toContain("5 0 obj");
    // and it is still readable through the real index
    const doc = PdfDocument.load(bytes);
    expect(doc.recovered).toBe(false);
    expect(readAcroForm(doc)!.fields.find((f) => f.name === "aged")?.value).toBe("value");
  });
});

describe("fillForm - an ENCRYPTED document", () => {
  it("fills it with the password and the result is still fully encrypted", async () => {
    const original = await encryptedForm();
    const { bytes } = await fillForm(
      original,
      { full_name: "Grace Hopper äöü" },
      { password: "secret" },
    );

    // Still an incremental update: the original bytes are untouched at the front.
    expect(Array.from(bytes.subarray(0, original.length))).toEqual(Array.from(original));

    const doc = await PdfDocument.open(bytes, { password: "secret" });
    const form = readAcroForm(doc)!;
    expect(form.fields[0].value).toBe("Grace Hopper äöü");

    // The written value must be ciphertext, and so must the tooltip we did NOT touch but did rewrite
    // along with the rest of the dictionary - that one is the trap: it is plaintext in memory after
    // opening, and copying it through unchanged would put it in the clear.
    const raw = new TextDecoder("latin1").decode(bytes);
    expect(raw).not.toContain("Grace Hopper");
    expect(raw).not.toContain("Your name");
    expect(raw).not.toContain("full_name");
  });

  it("fills an ACCESSIBLE encrypted document, whose metadata stream is deliberately plaintext", async () => {
    // `/EncryptMetadata false` leaves the XMP stream in the clear on purpose. Deciphering it anyway - as
    // the first version did - destroyed it, and an accessible+encrypted file could not be opened at all.
    // Found by writing this test; it is the reason it exists.
    const original = await renderToBytes(
      Document([
        Page({ margin: 56 }, [
          Column([TextField({ name: "full_name", value: "x", border: "#888" })]),
        ]),
      ]),
      { encrypt: { userPassword: "secret" }, accessible: true, lang: "de-DE", title: "T" },
    );
    // /Lang really is in there, and enciphered to begin with.
    expect(new TextDecoder("latin1").decode(original)).not.toContain("de-DE");

    const { bytes } = await fillForm(original, { full_name: "Ada" }, { password: "secret" });
    expect(new TextDecoder("latin1").decode(bytes)).not.toContain("de-DE");

    const doc = await PdfDocument.open(bytes, { password: "secret" });
    expect(readAcroForm(doc)!.fields[0].value).toBe("Ada");
  });

  it("still refuses a wrong value, before any encryption happens", async () => {
    await expect(
      fillForm(await encryptedForm(), { nope: "x" }, { password: "secret" }),
    ).rejects.toThrow(/no such field/);
  });
});

describe("fillForm - the file stays valid", () => {
  it("can be filled twice, each update chaining onto the last", async () => {
    // Two incremental updates in a row: the second must find the first one's values and add to them.
    const once = (await fillForm(fixture("pdflib-form"), { full_name: "First" })).bytes;
    const twice = (await fillForm(once, { notes: "Second" })).bytes;
    expect(Array.from(twice.subarray(0, once.length))).toEqual(Array.from(once));
    const { field } = readBack(twice);
    expect(field("full_name")?.value).toBe("First");
    expect(field("notes")?.value).toBe("Second");
  });

  it("keeps the document readable: catalog, pages and index all still resolve", async () => {
    for (const name of PRODUCERS) {
      const { bytes } = await fillForm(fixture(name), { full_name: "X" });
      const doc = PdfDocument.load(bytes);
      // Read through the REAL index, not a rebuilt one - a broken update would force recovery.
      expect(doc.recovered).toBe(false);
      expect(doc.catalog).toBeDefined();
      expect(doc.lookup(doc.catalog, "Pages")).toBeDefined();
      expect(new TextDecoder("latin1").decode(bytes).trimEnd().endsWith("%%EOF")).toBe(true);
    }
  });

  it("writes an xref stream for a stream-indexed file and a table for a table-indexed one", async () => {
    // Mixing the two would leave a reader that follows only one kind unable to walk the chain back.
    const modern = (await fillForm(fixture("pdflib-form"), { full_name: "X" })).bytes;
    const classic = (await fillForm(fixture("pdflib-form-classic"), { full_name: "X" })).bytes;
    const tailOf = (b: Uint8Array) => new TextDecoder("latin1").decode(b.subarray(b.length - 900));
    expect(tailOf(modern)).toContain("/Type /XRef");
    expect(tailOf(classic)).toContain("xref");
    expect(tailOf(classic)).toContain("trailer");
    // Both chain back to the revision they were built on.
    expect(tailOf(modern)).toMatch(/\/Prev \d+/);
    expect(tailOf(classic)).toMatch(/\/Prev \d+/);
  });

  it("does not corrupt binary bytes in the appended index", async () => {
    // The xref stream is binary; running it through a UTF-8 encoder turns every value above 127 into
    // two bytes and the whole index becomes garbage - which is exactly what happened first time round.
    const bytes = (await fillForm(fixture("pdflib-form"), { full_name: "X" })).bytes;
    const doc = PdfDocument.load(bytes);
    expect(doc.recovered).toBe(false); // a garbled index would have forced a rebuild
    expect(readAcroForm(doc)!.fields.length).toBe(6);
  });
});
