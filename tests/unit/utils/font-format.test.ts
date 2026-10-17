import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Text,
  renderToBytes,
  FontFormatError,
} from "../../../src/lib/api/index.ts";
import { TTFParser } from "../../../src/lib/utils/ttf-parser.ts";
import { buildTestTtf } from "./ttf-fixture.ts";

// A CFF font carries the same tables up front as a TrueType one, so it MEASURED fine - and was then
// embedded as a TrueType program it is not (/FontFile2), which viewers reject and PDF/A forbids.
// Every path (bytes, a file, a URL, an unwrapped WOFF) meets in TTFParser, and it says so there.

/** A real test font whose sfnt version is rewritten - everything after the first four bytes stays. */
const tagged = (tag: string) => {
  const bytes = new Uint8Array(buildTestTtf());
  bytes.set(
    Array.from(tag, (c) => c.charCodeAt(0)),
    0,
  );
  return bytes;
};

describe("a font jasy cannot embed is named, never embedded broken", () => {
  it("OpenType with CFF outlines", () => {
    expect(() => new TTFParser(tagged("OTTO"))).toThrow(FontFormatError);
    expect(() => new TTFParser(tagged("OTTO"))).toThrow(/PostScript \(CFF\) outlines/);
  });

  it("a TrueType Collection", () => {
    expect(() => new TTFParser(tagged("ttcf"))).toThrow(/TrueType Collection/);
  });

  it("through renderToBytes({ fonts }) as raw bytes", async () => {
    await expect(
      renderToBytes(Document([Page([Text("x", { font: "Cff" })])]), {
        fonts: { Cff: tagged("OTTO") },
      }),
    ).rejects.toBeInstanceOf(FontFormatError);
  });

  it("a TrueType font still opens", () => {
    expect(() => new TTFParser(new Uint8Array(buildTestTtf()))).not.toThrow();
  });
});
