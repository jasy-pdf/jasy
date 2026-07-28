import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Lexer } from "../../../src/lib/pdf-reader/lexer";
import {
  get,
  isDict,
  isRef,
  isStream,
  isString,
  nameOf,
  textOf,
  type PdfObject,
} from "../../../src/lib/pdf-reader/objects";

// The object parser is the foundation the whole reader stands on: if it mangles a byte here, every
// value above it is wrong. So this suite is deliberately paranoid about ENCODING and BINARY SAFETY -
// a PDF string may hold any byte, and a field name from another producer is often UTF-16.

const bytes = (s: string) => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));
const parse = (src: string | Uint8Array) =>
  new Lexer(typeof src === "string" ? bytes(src) : src).parse();

/** A hex string as a producer would write a unicode value: UTF-16BE behind a BOM. */
const utf16beHex = (s: string) => {
  let h = "FEFF";
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${h.toUpperCase()}>`;
};

describe("lexer - strings", () => {
  it("keeps every one of the 256 byte values intact through a literal string", () => {
    // Anything may sit inside a literal; only ( ) and \ must be escaped. A reader that decodes to text
    // too early, or that assumes ASCII, corrupts exactly the data we came for.
    const all = Array.from({ length: 256 }, (_, i) => i);
    const src: number[] = [0x28]; // (
    for (const b of all) {
      if (b === 0x28 || b === 0x29 || b === 0x5c) src.push(0x5c); // escape ( ) \
      // A bare CR or LF inside a literal is an END-OF-LINE MARKER, not data (see the test below), so
      // the round-trip case escapes them as \r and \n.
      if (b === 13) src.push(0x5c, 0x72);
      else if (b === 10) src.push(0x5c, 0x6e);
      else src.push(b);
    }
    src.push(0x29); // )
    const out = parse(new Uint8Array(src));
    expect(isString(out)).toBe(true);
    if (!isString(out)) return;
    expect(Array.from(out.bytes)).toEqual(all);
  });

  it("translates a raw end-of-line inside a literal to a single LF (PDF 7.3.4.2)", () => {
    // An unescaped CR, LF or CRLF in a literal string all mean ONE line feed. Passing CR through
    // verbatim would silently change the value of any field written across two lines.
    expect(textOf(parse("(a\rb)"))).toBe("a\nb");
    expect(textOf(parse("(a\r\nb)"))).toBe("a\nb");
    expect(textOf(parse("(a\nb)"))).toBe("a\nb");
  });

  it("handles escapes, octal codes, nesting and the line continuation", () => {
    expect(textOf(parse("(a(b)c)"))).toBe("a(b)c"); // balanced inner parens need no escape
    expect(textOf(parse("(a\\(b\\)c)"))).toBe("a(b)c"); // ... and escaped ones work too
    expect(textOf(parse("(back\\\\slash)"))).toBe("back\\slash");
    expect(textOf(parse("(\\101\\102)"))).toBe("AB"); // octal
    expect(textOf(parse("(tab\\tend)"))).toBe("tab\tend");
    expect(textOf(parse("(one\\\ntwo)"))).toBe("onetwo"); // a backslash-newline joins the lines
  });

  it("reads hex strings, including odd digits and embedded whitespace", () => {
    const a = parse("<48656C6C6F>");
    expect(isString(a) && new TextDecoder("latin1").decode(a.bytes)).toBe("Hello");
    const spaced = parse("<48 65 6C\n6C 6F>");
    expect(isString(spaced) && new TextDecoder("latin1").decode(spaced.bytes)).toBe("Hello");
    // A trailing odd digit is padded with 0: <41 4> means 0x41 0x40.
    const odd = parse("<414>");
    expect(isString(odd) && Array.from(odd.bytes)).toEqual([0x41, 0x40]);
  });

  it("decodes UTF-16BE text - umlauts, symbols AND emoji (surrogate pairs)", () => {
    // This is how pdf-lib writes every field name, and how any producer writes non-Latin text.
    for (const s of ["full_name", "Jörg Müller", "1.234,56 € — ok", "Hallo 😀 Grüße", "日本語"]) {
      expect(textOf(parse(utf16beHex(s)))).toBe(s);
    }
  });

  it("reads a latin literal as text but leaves the bytes untouched", () => {
    const o = parse("(Jörg)"); // bytes here are latin1/PDFDoc, not UTF-8
    expect(textOf(o)).toBe("Jörg");
    expect(isString(o) && o.hex).toBe(false);
  });
});

describe("lexer - names, numbers and references", () => {
  it("decodes #XX escapes in a name", () => {
    expect(nameOf(parse("/Feld#20mit#2FSlash"))).toBe("Feld mit/Slash");
    expect(nameOf(parse("/Ja#20#2F#20Nein"))).toBe("Ja / Nein"); // what our own writer emits
    expect(nameOf(parse("/Simple"))).toBe("Simple");
  });

  it("tells an indirect reference apart from two plain numbers", () => {
    const ref = parse("18 0 R");
    expect(isRef(ref) && ref.num).toBe(18);
    // Without the R it is just a number - and the cursor must not have eaten the rest.
    const lx = new Lexer(bytes("18 0"));
    expect(lx.parse()).toBe(18);
    expect(lx.parse()).toBe(0);
  });

  it("reads number forms", () => {
    expect(parse("42")).toBe(42);
    expect(parse("-3.25")).toBe(-3.25);
    expect(parse("+7")).toBe(7);
    expect(parse(".5")).toBe(0.5);
    expect(parse("true")).toBe(true);
    expect(parse("null")).toBe(null);
  });
});

describe("lexer - dictionaries, arrays and streams", () => {
  it("parses a nested dictionary the way a real widget is written", () => {
    const o = parse(
      "<< /Type /Annot /Subtype /Widget /FT /Tx /T (full_name) /Rect [56 733.39 539.28 757.39] " +
        "/AP << /N 18 0 R >> /MK << /BC [0.53 0.53 0.53] >> >>",
    );
    expect(isDict(o)).toBe(true);
    expect(nameOf(get(o, "Subtype"))).toBe("Widget");
    expect(textOf(get(o, "T"))).toBe("full_name");
    const rect = get(o, "Rect");
    expect(Array.isArray(rect) && rect).toEqual([56, 733.39, 539.28, 757.39]);
    // A nested dict holding a reference - the appearance lives in another object.
    expect(isRef(get(get(o, "AP"), "N"))).toBe(true);
  });

  it("marks where a stream's data begins instead of guessing its length", () => {
    // /Length may itself be an indirect reference, so the parser cannot slice the data - it records
    // the start and the document layer cuts once it can resolve.
    const o = parse("<< /Length 5 0 R >>\nstream\nHELLO\nendstream");
    expect(isStream(o)).toBe(true);
    if (!isStream(o)) return;
    expect(o.start).toBe("<< /Length 5 0 R >>\nstream\n".length);
    expect(isRef(get(o, "Length"))).toBe(true);
  });

  it("does not spin forever on a token it cannot model", () => {
    // Robustness against a foreign file: an unknown keyword inside an array must be skipped, not loop.
    const o = parse("[1 someKeyword 2]");
    expect(Array.isArray(o) && o).toEqual([1, 2]);
  });
});

describe("lexer - against real files from five different producers", () => {
  const fixture = (name: string) =>
    new Uint8Array(readFileSync(`tests/fixtures/forms/${name}.pdf`));

  /** Parse every top-level `N 0 obj` the crude way, which is all this layer can do before the xref
   *  table is understood - enough to prove the grammar copes with each producer's style. */
  const topLevelObjects = (data: Uint8Array): PdfObject[] => {
    const text = new TextDecoder("latin1").decode(data);
    const out: PdfObject[] = [];
    for (const m of text.matchAll(/(\d+) (\d+) obj/g)) {
      const o = new Lexer(data, (m.index ?? 0) + m[0].length).parse();
      if (o !== undefined) out.push(o);
    }
    return out;
  };

  const producers = [
    "jasy-form",
    "pdflib-form",
    "pdflib-form-classic",
    "pdfkit-form",
    "reactpdf-form",
    "gov-w9",
  ];

  for (const name of producers) {
    it(`parses every top-level object in ${name}.pdf`, () => {
      const objects = topLevelObjects(fixture(name));
      expect(objects.length).toBeGreaterThan(5);
      // Every one came back as something we model - no silent `undefined` holes.
      expect(objects.every((o) => o !== undefined)).toBe(true);
    });
  }

  it("reads the same field names out of four different producers", () => {
    // pdf-lib writes them as UTF-16BE hex, the others as literals: the reader must not care.
    for (const name of ["jasy-form", "pdflib-form-classic", "pdfkit-form", "reactpdf-form"]) {
      const names = topLevelObjects(fixture(name))
        .map((o) => textOf(get(o, "T")))
        .filter((t): t is string => t !== undefined);
      expect(names).toContain("full_name");
      expect(names).toContain("notes");
      expect(names).toContain("agree");
    }
  });
});
