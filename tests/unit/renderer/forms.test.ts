import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Column,
  Text,
  TextField,
  Checkbox,
  RadioGroup,
  Dropdown,
  ListBox,
  PushButton,
  SignatureField,
  renderToBytes,
} from "../../../src/lib/api";

// Interactive form fields (AcroForm). A field draws nothing in the content stream - it becomes a Widget
// annotation on the page (/Annots) + a field in the catalog /AcroForm, both from the shared FormFieldSpec.

const render = async (doc: Parameters<typeof renderToBytes>[0]) =>
  new TextDecoder("latin1").decode(await renderToBytes(doc, { compress: false }));

const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("form fields (AcroForm)", () => {
  it("emits a catalog /AcroForm with the field, and a Widget annotation on the page", async () => {
    const pdf = await render(
      Document([Page({ margin: 56 }, [Column([TextField({ name: "email", border: "#888" })])])]),
    );
    expect(pdf).toContain("/AcroForm");
    expect(pdf).toContain("/Subtype /Widget");
    expect(pdf).toContain("/FT /Tx");
    expect(pdf).toContain("/T (email)");
    expect(pdf).toMatch(/\/Annots \[/); // the widget is referenced from the page
  });

  it("carries the initial value and variant flags", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([
            TextField({ name: "who", value: "Ada" }),
            TextField({ name: "bio", multiline: true }),
            TextField({ name: "pin", password: true, maxLength: 4 }),
          ]),
        ]),
      ]),
    );
    expect(pdf).toContain("/V (Ada)");
    expect(pdf).toContain("/Ff 4096"); // Multiline (bit 13)
    expect(pdf).toContain("/Ff 8192"); // Password (bit 14)
    expect(pdf).toContain("/MaxLen 4");
    expect(count(pdf, "/Subtype /Widget")).toBe(3);
  });

  it("bakes the value into an /AP by default, so no /NeedAppearances is needed", async () => {
    const pdf = await render(
      Document([Page({ margin: 56 }, [Column([TextField({ name: "x", value: "Ada" })])])]),
    );
    expect(pdf).toMatch(/\/AP << \/N \d+ 0 R >>/); // the field carries its own appearance
    expect(pdf).toContain("(Ada) Tj"); // and the value is really drawn in it
    expect(pdf).not.toContain("/NeedAppearances"); // nothing left for the viewer to draw
    expect(pdf).toContain("/DR << /Font << /Helv"); // /DA still names the font
  });

  it("`fieldAppearances: false` bakes nothing and hands every value back to the viewer", async () => {
    const doc = Document([
      Page({ margin: 56 }, [Column([TextField({ name: "x", value: "Ada" })])]),
    ]);
    const pdf = new TextDecoder("latin1").decode(
      await renderToBytes(doc, { compress: false, fieldAppearances: false }),
    );
    expect(pdf).toContain("/NeedAppearances true");
    expect(pdf).not.toContain("/Subtype /Form /BBox"); // no appearance XObjects at all
    expect(pdf).not.toContain("(Ada) Tj"); // the value is stored, never drawn by us
    expect(pdf).toContain("/V (Ada)");
  });

  it("a password field draws a mask, never the characters", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([TextField({ name: "pw", value: "hunter2", password: true })]),
        ]),
      ]),
    );
    // The value itself must be stored (that is what the field holds), but nothing draws it.
    expect(pdf).toContain("/V (hunter2)");
    expect(pdf).not.toContain("(hunter2) Tj");
    expect(pdf).toMatch(/\(\u2022{7}\) Tj/); // seven bullets: byte 0x95, which latin1/cp1252 decodes to U+2022
  });

  it("wraps a multiline value and shows a dropdown's LABEL, not its stored value", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([
            TextField({
              name: "m",
              multiline: true,
              height: 60,
              width: 200,
              value: "a value long enough that it has to wrap onto a second line inside the box",
            }),
            Dropdown({ name: "c", value: "de" }, [{ value: "de", label: "Germany" }]),
          ]),
        ]),
      ]),
    );
    expect(count(pdf, ") Tj")).toBeGreaterThan(2); // several wrapped lines + the dropdown
    expect(pdf).toContain("(Germany) Tj"); // the label is drawn
    expect(pdf).toContain("/V (de)"); // the value is stored
  });

  it("a form-less document has NO /AcroForm (off = byte-identical path)", async () => {
    const pdf = await render(Document([Page({ margin: 56 }, [Text("no form here")])]));
    expect(pdf).not.toContain("/AcroForm");
    expect(pdf).not.toContain("/Widget");
  });

  it("a checkbox is a /Btn with baked on/off appearance streams and the right state", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([Checkbox({ name: "agree", checked: true }), Checkbox({ name: "news" })]),
        ]),
      ]),
    );
    expect(pdf).toContain("/FT /Btn");
    expect(pdf).toMatch(/\/AP << \/N << \/Yes \d+ 0 R \/Off \d+ 0 R >> >>/);
    expect(pdf).toContain("/Subtype /Form /BBox"); // the appearance XObjects
    expect(pdf).toContain("/AS /Yes"); // the checked one
    expect(pdf).toContain("/AS /Off"); // the unchecked one
  });

  it("a checkbox-only document needs NO /NeedAppearances (its /AP is baked)", async () => {
    const pdf = await render(
      Document([Page({ margin: 56 }, [Column([Checkbox({ name: "x", checked: true })])])]),
    );
    expect(pdf).toContain("/AcroForm");
    expect(pdf).not.toContain("/NeedAppearances");
  });

  it("a custom on-value is used for /V, /AS and the /AP state key", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [Column([Checkbox({ name: "plan", checked: true, onValue: "Pro" })])]),
      ]),
    );
    expect(pdf).toContain("/V /Pro");
    expect(pdf).toContain("/AS /Pro");
    expect(pdf).toMatch(/\/AP << \/N << \/Pro \d+ 0 R \/Off \d+ 0 R/);
  });

  it("a RadioGroup is ONE mutually-exclusive field with a kid per option", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          RadioGroup({ name: "size", value: "m" }, [
            { value: "s", label: "Small" },
            { value: "m", label: "Medium" },
            { value: "l", label: "Large" },
          ]),
        ]),
      ]),
    );
    // One /Btn field with the Radio + NoToggleToOff flags, holding all three buttons as /Kids.
    expect(pdf).toContain("/FT /Btn /Ff 49152");
    expect(pdf).toContain("/T (size)");
    expect(pdf).toContain("/V /m"); // the selected option
    expect(pdf).toMatch(/\/Kids \[\d+ 0 R \d+ 0 R \d+ 0 R\]/);
    // Three kid widgets, each pointing at the parent field, only the selected one showing its dot.
    expect(count(pdf, "/Subtype /Widget")).toBe(3);
    expect(count(pdf, "/Widget /Parent ")).toBe(3); // each kid references the group field
    expect(pdf).toContain("/AS /m"); // selected shows
    expect(count(pdf, "/AS /Off")).toBe(2); // the other two are off
  });

  it("with no value selected, the radio field is /Off", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          RadioGroup({ name: "pick" }, [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ]),
        ]),
      ]),
    );
    expect(pdf).toContain("/V /Off");
    expect(count(pdf, "/AS /Off")).toBe(2);
  });

  it("a Dropdown is a combo /Ch with an /Opt list and the selected /V", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([
            Dropdown({ name: "country", value: "de" }, [
              { value: "de", label: "Germany" },
              "France",
            ]),
          ]),
        ]),
      ]),
    );
    expect(pdf).toContain("/FT /Ch");
    expect(pdf).toContain("/Ff 131072"); // Combo flag
    expect(pdf).toContain("/Opt [[(de) (Germany)] [(France) (France)]]");
    expect(pdf).toContain("/V (de)");
    expect(pdf).toContain("/I [0]"); // Germany is option index 0
  });

  it("an editable Dropdown adds the Edit flag", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [Column([Dropdown({ name: "x", editable: true }, ["a", "b"])])]),
      ]),
    );
    expect(pdf).toContain("/Ff 393216"); // Combo | Edit
  });

  it("a multi-select ListBox carries an array /V and the selected /I indices", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([
            ListBox({ name: "top", multiSelect: true, values: ["b", "d"], height: 80 }, [
              "a",
              "b",
              "c",
              "d",
            ]),
          ]),
        ]),
      ]),
    );
    expect(pdf).toContain("/FT /Ch");
    expect(pdf).toContain("/Ff 2097152"); // MultiSelect
    expect(pdf).toContain("/V [(b) (d)]");
    expect(pdf).toContain("/I [1 3]");
  });

  it("a PushButton is a valueless /Btn with the Pushbutton flag and a baked caption", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [Column([PushButton({ name: "go", label: "Send", width: 100 })])]),
      ]),
    );
    expect(pdf).toContain("/FT /Btn");
    expect(pdf).toContain("/Ff 65536"); // Pushbutton
    expect(pdf).not.toContain("/V ("); // a push button holds no value
    expect(pdf).toContain("/MK << /CA (Send)"); // the caption a regenerating viewer falls back to
    expect(pdf).toMatch(/\/AP << \/N \d+ 0 R >>/); // one baked face, not an on/off state dict
    expect(pdf).toContain("(Send) Tj"); // the caption is really drawn in the appearance
    expect(pdf).toContain("/DA (/Helv"); // so a viewer that redraws it matches
  });

  it("maps the three button actions", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([
            PushButton({ name: "a", label: "Reset", action: "reset" }),
            PushButton({ name: "b", label: "Send", action: { submit: "https://x.test/f" } }),
            PushButton({ name: "c", label: "Docs", action: { open: "https://jasy.dev" } }),
          ]),
        ]),
      ]),
    );
    expect(pdf).toContain("/S /ResetForm");
    expect(pdf).toContain("/S /SubmitForm /F << /FS /URL /F (https://x.test/f) >>");
    expect(pdf).toContain("/S /URI /URI (https://jasy.dev)");
  });

  it("shares ONE Helvetica object across fields and button captions", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([
            TextField({ name: "t" }),
            PushButton({ name: "b", label: "Go" }),
            Dropdown({ name: "d" }, ["a"]),
          ]),
        ]),
      ]),
    );
    expect(count(pdf, "/BaseFont /Helvetica ")).toBe(1);
  });

  it("a SignatureField is an UNSIGNED /Sig placeholder and flags the catalog", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([SignatureField({ name: "approver", label: "Signature", width: 240 })]),
        ]),
      ]),
    );
    expect(pdf).toContain("/FT /Sig");
    expect(pdf).toContain("/T (approver)");
    expect(pdf).toContain("/SigFlags 3"); // SignaturesExist | AppendOnly
    expect(pdf).toMatch(/\/AP << \/N \d+ 0 R >>/); // the baked "sign here" face
    expect(pdf).toContain("(Signature) Tj"); // the hint is really drawn
    // Unsigned: the field carries no value - a signing tool fills that in later.
    expect(pdf).not.toMatch(/\/FT \/Sig[^>]*\/V/);
  });

  it("a document without a signature field has NO /SigFlags", async () => {
    const pdf = await render(
      Document([Page({ margin: 56 }, [Column([TextField({ name: "t" })])])]),
    );
    expect(pdf).toContain("/AcroForm");
    expect(pdf).not.toContain("/SigFlags");
  });

  it("a single-select ListBox accepts `values` as well as `value` (never drops the selection)", async () => {
    // `value` vs `values` is easy to confuse; silently discarding the user's selection is the worst
    // outcome, so a one-entry `values` on a single-select box selects that entry.
    const opts = [
      { value: "s", label: "Small" },
      { value: "m", label: "Medium" },
    ];
    const viaValues = await render(
      Document([
        Page({ margin: 56 }, [Column([ListBox({ name: "a", values: ["m"], height: 50 }, opts)])]),
      ]),
    );
    const viaValue = await render(
      Document([
        Page({ margin: 56 }, [Column([ListBox({ name: "b", value: "m", height: 50 }, opts)])]),
      ]),
    );
    expect(viaValues).toContain("/V (m)");
    expect(viaValues).toContain("/I [1]");
    expect(viaValue).toContain("/V (m)");
    // Multi-select still writes an array.
    const multi = await render(
      Document([
        Page({ margin: 56 }, [
          Column([ListBox({ name: "c", multiSelect: true, values: ["s", "m"], height: 50 }, opts)]),
        ]),
      ]),
    );
    expect(multi).toContain("/V [(s) (m)]");
    expect(multi).toContain("/I [0 1]");
  });

  it("marks a required field, and combines the flag with the field's own", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([
            TextField({ name: "a", required: true }),
            TextField({ name: "b", required: true, multiline: true, height: 40 }),
            Checkbox({ name: "c", required: true }),
          ]),
        ]),
      ]),
    );
    expect(pdf).toContain("/Ff 2"); // Required alone
    expect(pdf).toContain("/Ff 4098"); // Required | Multiline (2 | 4096)
  });

  it("controls printing and visibility through the annotation flags", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([
            TextField({ name: "normal" }),
            TextField({ name: "screen", print: false }),
            TextField({ name: "gone", hidden: true }),
          ]),
        ]),
      ]),
    );
    const widgetOf = (name: string) =>
      (pdf.match(/<< \/Type \/Annot \/Subtype \/Widget[^\n]*/g) ?? []).find((w) =>
        w.includes(`/T (${name})`),
      )!;
    expect(widgetOf("normal")).toContain("/F 4"); // printable, visible (the default)
    expect(widgetOf("screen")).toContain("/F 0"); // on screen only
    expect(widgetOf("gone")).toContain("/F 2"); // hidden everywhere
  });

  it("aligns a value, and the baked drawing agrees with /Q", async () => {
    // /Q tells a viewer how to align when IT redraws; our appearance must place the text the same way,
    // or the field jumps the moment someone clicks it.
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([
            TextField({ name: "l", value: "x", width: 300 }),
            TextField({ name: "c", value: "x", width: 300, align: "center" }),
            TextField({ name: "r", value: "x", width: 300, align: "right" }),
          ]),
        ]),
      ]),
    );
    expect(pdf).toContain("/Q 1"); // centre
    expect(pdf).toContain("/Q 2"); // right
    // Three drawn runs, left to right: the default near 0, then centre, then right.
    const xs = [...pdf.matchAll(/1 0 0 1 ([\d.]+) [\d.]+ Tm \(x\) Tj/g)].map((m) => Number(m[1]));
    expect(xs).toHaveLength(3);
    expect(xs[0]).toBeLessThan(10); // left
    expect(xs[1]).toBeGreaterThan(140); // centred in a 300pt box
    expect(xs[1]).toBeLessThan(160);
    expect(xs[2]).toBeGreaterThan(280); // hard right
  });

  it("passes the shared flags through to Dropdown and ListBox too", async () => {
    // These reach ChoiceElement through one mapper; forgetting them there made the props silently inert.
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([Dropdown({ name: "d", required: true, print: false }, ["a"])]),
        ]),
      ]),
    );
    expect(pdf).toContain("/Ff 131074"); // Combo (131072) | Required (2)
    expect(pdf).toContain("/F 0"); // screen only
  });

  it("escapes an export value that is not a bare PDF Name", async () => {
    // A Name may not hold spaces or delimiters; "Ja / Nein" must become #XX or the dictionary breaks.
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([Checkbox({ name: "c", checked: true, onValue: "Ja / Nein" })]),
        ]),
      ]),
    );
    expect(pdf).toContain("/Ja#20#2F#20Nein");
    expect(pdf).toContain("/V /Ja#20#2F#20Nein");
    expect(pdf).toContain("/AS /Ja#20#2F#20Nein");
    expect(pdf).not.toContain("/V /Ja / Nein"); // the unescaped form must not appear
  });

  it("only asks the viewer to draw values that we did not bake", async () => {
    const opts = { compress: false, fieldAppearances: false } as const;
    const boxes = new TextDecoder("latin1").decode(
      await renderToBytes(
        Document([Page({ margin: 56 }, [Column([Checkbox({ name: "c", checked: true })])])]),
        opts,
      ),
    );
    // A checkbox always carries a complete /AP, so nothing is deferred - even with baking off.
    expect(boxes).not.toContain("/NeedAppearances");
    const text = new TextDecoder("latin1").decode(
      await renderToBytes(
        Document([Page({ margin: 56 }, [Column([TextField({ name: "t", value: "x" })])])]),
        opts,
      ),
    );
    expect(text).toContain("/NeedAppearances true");
  });

  it("auto-sizes a button caption and a signature hint when fontSize is 0", async () => {
    const pdf = await render(
      Document([
        Page({ margin: 56 }, [
          Column([
            PushButton({ name: "b", label: "Auto", fontSize: 0, width: 120, height: 30 }),
            SignatureField({ name: "s", label: "Sign", fontSize: 0, height: 50 }),
          ]),
        ]),
      ]),
    );
    // `0 Tf` would draw an invisible caption; every baked run must use a real size.
    const sizes = [...pdf.matchAll(/\/Helv ([\d.]+) Tf/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(sizes.every((v) => v > 0)).toBe(true);
  });

  it("takes the group flags from EVERY radio button, not just the first", async () => {
    const options = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];
    const plain = await render(
      Document([Page({ margin: 56 }, [RadioGroup({ name: "g" }, options)])]),
    );
    const required = await render(
      Document([Page({ margin: 56 }, [RadioGroup({ name: "g", required: true }, options)])]),
    );
    expect(plain).toContain("/FT /Btn /Ff 49152"); // Radio | NoToggleToOff
    expect(required).toContain("/FT /Btn /Ff 49154"); // ... | Required
  });
});
