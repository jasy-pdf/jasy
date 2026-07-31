import { describe, it, expect } from "vitest";
import { stringsIn, type PdfObject, type PdfString } from "../../../src/lib/edit/objects.ts";

// `stringsIn` decides which strings get deciphered on the way in and enciphered on the way out. Both
// sides of the crypto seam depend on it seeing EVERY string, so the interesting cases are the ones
// where it might quietly see fewer than all of them.

const str = (text: string): PdfString => ({
  kind: "string",
  bytes: Uint8Array.from(text, (c) => c.charCodeAt(0)),
  hex: false,
});

const dict = (entries: Record<string, PdfObject>): PdfObject => ({
  kind: "dict",
  map: new Map(Object.entries(entries)),
});

describe("stringsIn", () => {
  it("finds strings in dictionaries, arrays and a stream's own dictionary", () => {
    const found = stringsIn(
      dict({
        T: str("field name"),
        Kids: [dict({ TU: str("tooltip") })],
        // A stream's DATA is covered by the stream's own encryption; its dictionary is not, and it can
        // carry a string like any other dictionary.
        Body: {
          kind: "stream",
          dict: dict({ Author: str("Ada") }) as never,
          start: 0,
          raw: undefined,
        } as unknown as PdfObject,
      }),
    );
    expect(found.map((s) => new TextDecoder().decode(s.bytes)).sort()).toEqual([
      "Ada",
      "field name",
      "tooltip",
    ]);
  });

  it("refuses an absurdly nested object instead of returning a short list", () => {
    // Returning what it had found so far is the dangerous answer: the caller would encipher the strings
    // it was given and write the rest back in the clear, which is the ISSUE-7 failure mode again. The
    // walk never follows references, so 65 levels of INLINE nesting is not something a producer does.
    let deep: PdfObject = str("buried");
    for (let i = 0; i < 65; i++) deep = [deep];
    expect(() => stringsIn(deep)).toThrow(/nests objects more than 64 deep/);

    // ... and one level under the limit still works, so the boundary is where it claims to be.
    let ok: PdfObject = str("reachable");
    for (let i = 0; i < 60; i++) ok = [ok];
    expect(stringsIn(ok).length).toBe(1);
  });
});
