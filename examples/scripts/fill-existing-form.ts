/**
 * Open an existing PDF, fill its AcroForm, save it.
 *
 * The whole surface is three functions: `PdfDocument.open` to load, `readAcroForm` to see what the form
 * holds, and `fillForm` to write values into it. Values are plain data, not a sequence of calls on field
 * objects - the same shape as describing a document with `Document([...])`.
 *
 * Saving is an INCREMENTAL UPDATE: the original bytes are kept verbatim and the changes are appended.
 * A signature over the original therefore stays intact, and the original file is a literal byte prefix
 * of the result.
 *
 * Run:  pnpm exec tsx examples/scripts/fill-existing-form.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PdfDocument, readAcroForm, fillForm, flattenForm, FillError } from "@jasy/pdf/edit";

const source = "tests/fixtures/forms/jasy-form.pdf";
const target = "examples/out/filled-form.pdf";

// ---------------------------------------------------------------------------------------------
// 1. Look at the form before touching it.
// ---------------------------------------------------------------------------------------------
// `open` is async because a password-protected file has to be deciphered first. For a plain PDF you can
// use the synchronous `PdfDocument.load(bytes)` instead.
const original = new Uint8Array(readFileSync(source));
const doc = await PdfDocument.open(original);

const form = readAcroForm(doc);
if (!form) throw new Error("this PDF has no form in it");

for (const field of form.fields) {
  const kind = { Tx: "text", Btn: "button", Ch: "choice", Sig: "signature" }[field.type];
  const options = field.options?.map((o) => o.value).join(", ");
  const states = field.onValues?.join(", ");
  console.log(
    `  ${field.name.padEnd(12)} ${kind.padEnd(10)} ` +
      `${field.value !== undefined ? `= ${JSON.stringify(field.value)}` : ""}` +
      `${options ? ` [${options}]` : ""}${states ? ` [${states}]` : ""}`,
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Fill it.
// ---------------------------------------------------------------------------------------------
// Names are the fully qualified ones `readAcroForm` reports - dotted for a nested form.
// A string fills a text field, `true`/`false` ticks a check box, a state name picks a radio button,
// an array selects in a multi-select list, and `null` clears a field.
const { bytes, warnings, filled } = await fillForm(original, {
  full_name: "Grace Hopper",
  notes: "Two lines with umlauts: äöüß\nand 1.234,56 €",
  agree: true,
  plan: "basic",
  country: "France",
  size: ["M"],
});

console.log(`\n  filled: ${filled.join(", ")}`);
for (const w of warnings) console.log(`  warning: ${w}`);

// The original is a byte prefix of the result - that is what "incremental" means, and it is checkable.
const prefixIntact = bytes.subarray(0, original.length).every((b, i) => b === original[i]);
console.log(`  original bytes untouched: ${prefixIntact}`);

writeFileSync(target, bytes);
console.log(`  written: ${target}`);

// ---------------------------------------------------------------------------------------------
// 3. The form is a contract.
// ---------------------------------------------------------------------------------------------
// Anything that would not apply cleanly is a NAMED error, never a silent no-op: an unknown field, a
// value the field's type cannot hold, a choice outside its options, a value past /MaxLen, a read-only
// field. The message says what WOULD be accepted.
try {
  await fillForm(original, { country: "Atlantis" });
} catch (e) {
  if (!(e instanceof FillError)) throw e;
  console.log(`\n  refused, as it should be:\n    ${e.message}`);
}

// ---------------------------------------------------------------------------------------------
// 4. Flatten it, so the values stop being editable.
// ---------------------------------------------------------------------------------------------
// The value becomes part of the page and the field is gone - nothing is re-rendered, so the result looks
// exactly as it did. Flatten only some of them with `{ fields: [...] }`.
//
// What you get is what the FORM said: a field the author gave a border keeps that border, a field
// without one flattens to plain text. Flattening freezes what is there, it does not add or remove
// decoration.
const flat = await flattenForm(bytes);
writeFileSync("examples/out/flattened-form.pdf", flat.bytes);
console.log(`\n  flattened: ${flat.flattened.join(", ")}`);
console.log(
  `  fields left: ${readAcroForm(await PdfDocument.open(flat.bytes))?.fields.length ?? 0}`,
);

// ---------------------------------------------------------------------------------------------
// 5. A password-protected document.
// ---------------------------------------------------------------------------------------------
// Pass the password and everything above works the same way. jasy OPENS AES-256 (R6 and Adobe's older
// R5), AES-128 and RC4; it only ever WRITES AES-256 R6, so filling a legacy-encrypted file is refused
// rather than quietly downgraded to a broken cipher.
//
//   const secured = new Uint8Array(readFileSync("secured.pdf"));
//   const result = await fillForm(secured, { full_name: "Ada" }, { password: "geheim" });
//
// A missing or wrong password, or a scheme we do not implement, each says so by name.
