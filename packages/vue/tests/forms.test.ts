import { describe, it, expect } from "vitest";
import { h, type Component } from "vue";
import {
  Checkbox,
  Column,
  Document,
  Dropdown,
  ListBox,
  Page,
  PushButton,
  RadioGroup,
  SignatureField,
  TextField,
  renderToPdf,
  renderToPdfString,
} from "../src/index.ts";
import { PdfDocument, readAcroForm } from "@jasy/pdf/edit";

// Form fields as Vue components. Two things are deliberately NOT a one-to-one mapping of the TypeScript
// surface, and both are what these tests are mostly about:
//
//   - the list-like fields take `:options`, because a template has no second argument;
//   - a field's label is the default slot, so a check box is one tag instead of a Row + Checkbox + Text.

const doc = (...children: unknown[]): Component => ({
  render: () => h(Document, {}, () => h(Page, { margin: 40 }, () => h(Column, {}, () => children))),
});

/** Render, then read the result back with our own reader - the fields are what the test is about. */
const fieldsOf = async (component: Component) => {
  const form = readAcroForm(PdfDocument.load(await renderToPdf(component)));
  return form?.fields ?? [];
};

describe("form fields as components", () => {
  it("carries every kind through to a real AcroForm", async () => {
    const fields = await fieldsOf(
      doc(
        h(TextField, { name: "full_name", value: "Ada Lovelace", height: 24 }),
        h(Checkbox, { name: "agree", checked: true }),
        h(RadioGroup, { name: "plan", value: "pro", options: ["basic", "pro"] }),
        h(Dropdown, { name: "country", value: "France", options: ["Germany", "France"] }),
        h(ListBox, { name: "size", value: "M", options: ["S", "M", "L"] }),
        h(PushButton, { name: "go", label: "Submit" }),
        h(SignatureField, { name: "sig", label: "Sign" }),
      ),
    );
    expect(fields.map((f) => [f.name, f.type])).toEqual([
      ["full_name", "Tx"],
      ["agree", "Btn"],
      ["plan", "Btn"],
      ["country", "Ch"],
      ["size", "Ch"],
      ["go", "Btn"],
      ["sig", "Sig"],
    ]);
    expect(fields.find((f) => f.name === "full_name")?.value).toBe("Ada Lovelace");
    expect(fields.find((f) => f.name === "plan")?.value).toBe("pro");
  });

  it("takes the choices as a prop, in either spelling", async () => {
    // The short one where the stored value IS the visible text, the explicit one where they differ.
    const fields = await fieldsOf(
      doc(
        h(Dropdown, { name: "size", options: ["S", "M"] }),
        h(Dropdown, {
          name: "currency",
          options: [
            { value: "EUR", label: "Euro" },
            { value: "CHF", label: "Swiss franc" },
          ],
        }),
      ),
    );
    expect(fields.find((f) => f.name === "size")?.options).toEqual([
      { value: "S", label: "S" },
      { value: "M", label: "M" },
    ]);
    expect(fields.find((f) => f.name === "currency")?.options).toEqual([
      { value: "EUR", label: "Euro" },
      { value: "CHF", label: "Swiss franc" },
    ]);
  });

  it("says what is wrong when the choices are missing", async () => {
    // A choice field without options is a field the reader can never answer. Better a named error than
    // an empty dropdown nobody notices until the form comes back blank.
    // Thrown while the tree is built, so it surfaces synchronously - catch either shape.
    const err = await Promise.resolve()
      .then(() => renderToPdf(doc(h(Dropdown, { name: "x" } as never))))
      .then(
        () => undefined,
        (e) => e,
      );
    expect(String(err)).toMatch(/options/);
  });
});

describe("the label is the default slot", () => {
  it("draws the text beside the box without a Row to assemble", async () => {
    // Uncompressed, otherwise the text sits inside a Flate stream. And unkerned: a label is ordinary
    // PAGE text, which kerning splits into a TJ array, so the string is no longer contiguous. (A field's
    // own appearance is unkerned anyway - viewers do not kern field text.)
    const pdf = await renderToPdfString(
      doc(h(Checkbox, { name: "agree", checked: true }, () => "I agree to the terms")),
      undefined,
      { compress: false, kerning: false },
    );
    expect(pdf).toContain("I agree to the terms");
    // ... and it really is one field, not a stray text element that happens to sit nearby.
    const fields = await fieldsOf(
      doc(h(Checkbox, { name: "agree", checked: true }, () => "I agree to the terms")),
    );
    expect(fields.map((f) => f.name)).toEqual(["agree"]);
  });

  it("labels a push button and a signature field the same way", async () => {
    const pdf = await renderToPdfString(
      doc(
        h(PushButton, { name: "go" }, () => "Submit"),
        h(SignatureField, { name: "sig" }, () => "Sign here"),
      ),
      undefined,
      { compress: false },
    );
    expect(pdf).toContain("Submit");
    expect(pdf).toContain("Sign here");
  });

  it("leaves a field without a slot exactly as it was", async () => {
    // The label is optional everywhere; omitting it must not wrap anything.
    const fields = await fieldsOf(doc(h(Checkbox, { name: "agree" })));
    expect(fields.map((f) => f.name)).toEqual(["agree"]);
  });
});

describe("a field name is an identity", () => {
  it("refuses two fields of the same name", async () => {
    // The format allows it and says nothing: a viewer treats them as ONE field, showing the same value
    // in both places. Silent in every other library, named here.
    const err = await Promise.resolve()
      .then(() => renderToPdf(doc(h(TextField, { name: "email" }), h(Checkbox, { name: "email" }))))
      .then(
        () => undefined,
        (e) => e,
      );
    expect(String(err)).toMatch(/two form fields are called "email"/);
  });

  it("catches a radio group colliding with an ordinary field", async () => {
    // The group's own buttons share a name on purpose, so the check has to fire once per GROUP - not per
    // button, or the group would collide with itself.
    const err = await Promise.resolve()
      .then(() =>
        renderToPdf(
          doc(h(TextField, { name: "plan" }), h(RadioGroup, { name: "plan", options: ["a"] })),
        ),
      )
      .then(
        () => undefined,
        (e) => e,
      );
    expect(String(err)).toMatch(/two form fields are called "plan"/);
  });

  it("lets a second group of the same name JOIN the first", async () => {
    // Deliberate: it is how one question's buttons are placed in two different spots and stay mutually
    // exclusive. They end up as one field with all the widgets.
    const fields = await fieldsOf(
      doc(
        h(RadioGroup, { name: "plan", options: ["a", "b"] }),
        h(RadioGroup, { name: "plan", options: ["c"] }),
      ),
    );
    expect(fields.map((f) => f.name)).toEqual(["plan"]);
    expect(fields[0].widgets.length).toBe(3);
  });

  it("still lets a radio group share one name across its buttons", async () => {
    // That is what MAKES a radio group - the shared name is why the buttons are mutually exclusive.
    const fields = await fieldsOf(
      doc(h(RadioGroup, { name: "plan", value: "a", options: ["a", "b", "c"] })),
    );
    expect(fields.map((f) => f.name)).toEqual(["plan"]);
    expect(fields[0].widgets.length).toBe(3);
  });
});
