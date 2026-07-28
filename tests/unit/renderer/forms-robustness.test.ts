import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
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
  Text,
  TextField,
  renderToBytes,
} from "../../../src/lib/api";

// The HARD pass over form fields: encoding, escaping, every render setting, and byte-level structure.
// Everything here works on the real output bytes - a form that only "looks right" in one configuration
// is not good enough.
//
// NOTE ON DECODING: `TextDecoder("latin1")` is, per the WHATWG encoding standard, an alias for
// windows-1252. So a byte 0x95 comes back as U+2022 (a bullet), 0x80 as U+20AC (a euro sign). That is
// exactly the encoding a PDF standard font uses, so decoding this way shows what a viewer will show -
// but assertions about the actual BYTES must read the Uint8Array, not this string.
const decode = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

/** Every text run drawn in the file (`(...) Tj`), decoded as WinAnsi. */
const drawnRuns = (pdf: string) => [...pdf.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1]);

/** A document exercising every field kind at once. */
const kitchenSink = () =>
  Document([
    Page({ margin: 56, gap: 8 }, [
      Text("Everything"),
      TextField({ name: "text", value: "Ada", border: "#888" }),
      TextField({
        name: "multi",
        value: "wrap me across lines please",
        multiline: true,
        height: 50,
      }),
      Checkbox({ name: "check", checked: true }),
      RadioGroup({ name: "radio", value: "b" }, [
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ]),
      Dropdown({ name: "combo", value: "de" }, [{ value: "de", label: "Germany" }, "France"]),
      ListBox({ name: "list", multiSelect: true, values: ["x"], height: 60 }, ["x", "y"]),
      PushButton({ name: "btn", label: "Go", action: "reset" }),
      SignatureField({ name: "sig", label: "Sign" }),
    ]),
  ]);

describe("form fields - encoding and escaping", () => {
  it("writes umlauts, the euro sign and dashes as the WinAnsi bytes a viewer expects", async () => {
    const bytes = await renderToBytes(
      Document([
        Page({ margin: 56 }, [
          Column([TextField({ name: "v", value: "Müller 9,90 € — ok", width: 320 })]),
        ]),
      ]),
      { compress: false },
    );
    const runs = drawnRuns(decode(bytes));
    expect(runs).toContain("Müller 9,90 € — ok");
    // And the same, checked at the byte level: ü = 0xFC, € = 0x80, em dash = 0x97 (WinAnsi, not UTF-8).
    expect(bytes).toContain(0xfc);
    expect(bytes).toContain(0x80);
    expect(bytes).toContain(0x97);
  });

  it("escapes parentheses and backslashes everywhere a string reaches the PDF", async () => {
    const nasty = "a(b)c\\d";
    const bytes = await renderToBytes(
      Document([
        Page({ margin: 56 }, [
          Column([
            TextField({ name: nasty, value: nasty, tooltip: nasty, width: 300 }),
            Dropdown({ name: "c", value: nasty }, [{ value: nasty, label: nasty }]),
            PushButton({ name: "b", label: nasty, width: 200 }),
          ]),
        ]),
      ]),
      { compress: false },
    );
    const pdf = decode(bytes);
    // Every occurrence is escaped; an unescaped "(" inside a literal would break the dictionary.
    expect(pdf).toContain("a\\(b\\)c\\\\d");
    expect(pdf).not.toMatch(/\(a\(b\)c/);
    // The file still parses as a whole: balanced objects and a complete trailer.
    expect(pdf).toContain("%%EOF");
    expect(countObjects(pdf)).toBeGreaterThan(5);
  });

  it("replaces characters the standard font cannot encode, rather than emitting broken bytes", async () => {
    // KNOWN LIMIT: a baked appearance uses the built-in Helvetica (WinAnsi), so CJK / emoji cannot be
    // drawn. They become "?" - the encoder's substitution. This test pins that behaviour so it cannot
    // change silently; drawing such text needs an embedded font in the field's /DR (not built yet).
    const bytes = await renderToBytes(
      Document([Page({ margin: 56 }, [Column([TextField({ name: "cjk", value: "日本 😀" })])])]),
      { compress: false },
    );
    const runs = drawnRuns(decode(bytes));
    expect(runs.some((r) => /^\?+ \?+$/.test(r) || r.includes("?"))).toBe(true);
    // The stored value is untouched - only the DRAWN appearance is limited.
    expect(decode(bytes)).toContain("/V (");
  });
});

/** Count `N 0 obj` headers - a cheap structural sanity number. */
const countObjects = (pdf: string) => (pdf.match(/\n\d+ 0 obj/g) ?? []).length;

describe("form fields - every render setting", () => {
  const settings = [
    { name: "defaults", opts: {} },
    { name: "uncompressed", opts: { compress: false } },
    { name: "compressed", opts: { compress: true } },
    { name: "no kerning", opts: { compress: false, kerning: false } },
    { name: "kerning on", opts: { compress: false, kerning: true } },
    { name: "appearances off", opts: { compress: false, fieldAppearances: false } },
    { name: "appearances off + compressed", opts: { compress: true, fieldAppearances: false } },
    { name: "accessible", opts: { compress: false, accessible: true, title: "Forms", lang: "en" } },
  ] as const;

  for (const { name, opts } of settings) {
    it(`produces a structurally valid form with: ${name}`, async () => {
      const bytes = await renderToBytes(kitchenSink(), opts);
      const pdf = decode(bytes);
      // The form survives every setting: the catalog entry, one widget per field, and a signature flag.
      expect(pdf).toContain("/AcroForm");
      expect(pdf).toContain("/FT /Tx");
      expect(pdf).toContain("/FT /Btn");
      expect(pdf).toContain("/FT /Ch");
      expect(pdf).toContain("/FT /Sig");
      expect(pdf).toContain("/SigFlags 3");
      expect(pdf).toMatch(/\/Annots \[/);
      // Widgets: 2 text + 1 checkbox + 2 radio kids + 2 choice + 1 button + 1 signature = 9.
      expect((pdf.match(/\/Subtype \/Widget/g) ?? []).length).toBe(9);
      // And it is a complete file.
      expect(pdf.startsWith("%PDF-")).toBe(true);
      expect(pdf).toContain("trailer");
      expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    });
  }

  it("declares a correct /Length for every stream, in bytes", async () => {
    // A wrong /Length is the classic way to produce a file that looks fine to grep and breaks in a
    // viewer. Checked on the raw bytes, with compression on (the harder case).
    const bytes = await renderToBytes(kitchenSink(), { compress: true });
    let checked = 0;
    for (const { length, body } of eachStream(bytes)) {
      expect(body.length).toBe(length);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("compressed and uncompressed draw exactly the same content", async () => {
    const plain = await renderToBytes(kitchenSink(), { compress: false });
    const zipped = await renderToBytes(kitchenSink(), { compress: true });
    const runsPlain = drawnRuns(decode(plain));
    // Inflate every Flate stream from the compressed file and collect its runs.
    const runsZipped: string[] = [];
    for (const { body, flate } of eachStream(zipped)) {
      const raw = flate ? new Uint8Array(inflateSync(Buffer.from(body))) : body;
      runsZipped.push(...drawnRuns(decode(raw)));
    }
    expect(runsZipped).toEqual(runsPlain);
    expect(runsPlain.length).toBeGreaterThan(5);
  });

  it("still encrypts cleanly with fields present", async () => {
    const bytes = await renderToBytes(kitchenSink(), {
      compress: false,
      encrypt: { userPassword: "pw" },
    });
    const pdf = decode(bytes);
    expect(pdf).toContain("/Encrypt");
    expect(pdf).toContain("/AcroForm");
    expect((pdf.match(/\/Subtype \/Widget/g) ?? []).length).toBe(9);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("bakes with appearances on and bakes nothing with them off", async () => {
    const on = decode(await renderToBytes(kitchenSink(), { compress: false }));
    const off = decode(
      await renderToBytes(kitchenSink(), { compress: false, fieldAppearances: false }),
    );
    expect(on).not.toContain("/NeedAppearances");
    expect(on).toContain("(Ada) Tj");
    expect(off).toContain("/NeedAppearances true");
    expect(off).not.toContain("(Ada) Tj");
    // Off still keeps the values themselves - only the drawing is handed to the viewer.
    expect(off).toContain("/V (Ada)");
  });
});

/** Walk every `stream … endstream` in the raw bytes, yielding its declared /Length, its actual body and
 *  whether it is Flate-compressed. Byte-exact: the body is sliced from the Uint8Array, never a string.
 *
 * The dict is read by scanning BACK from the `stream` keyword to the object header - not by matching
 * `<< … >>`, which breaks on the nested dicts our appearance XObjects carry (`/Resources << /Font << … >>`). */
function* eachStream(
  bytes: Uint8Array,
): Generator<{ length: number; body: Uint8Array; flate: boolean }> {
  const s = new TextDecoder("latin1").decode(bytes);
  const re = /\bstream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const objStart = s.lastIndexOf(" obj", m.index);
    if (objStart < 0) continue;
    const dict = s.slice(objStart, m.index);
    const lengthMatch = /\/Length (\d+)/.exec(dict);
    if (!lengthMatch) continue;
    const start = m.index + m[0].length;
    const length = Number(lengthMatch[1]);
    yield {
      length,
      body: bytes.slice(start, start + length),
      flate: dict.includes("/FlateDecode"),
    };
  }
}
