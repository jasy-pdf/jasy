import { describe, it, expect } from "vitest";
import { Column, Document, Page, renderPdf, Text } from "../../../src/lib/api";

// A page with enough text that its content stream is worth compressing.
const doc = () =>
  Document([
    Page([
      Column(
        { gap: 8 },
        Array.from({ length: 40 }, (_, i) =>
          Text(`Line ${i}: the quick brown fox jumps over the lazy dog`),
        ),
      ),
    ]),
  ]);

describe("stream compression", () => {
  it("FlateDecodes streams by default (smaller) and leaves them greppable when off", async () => {
    const on = await renderPdf(doc());
    const off = await renderPdf(doc(), { compress: false });

    expect(on).toContain("/FlateDecode");
    expect(off).not.toContain("/FlateDecode");
    expect(on.length).toBeLessThan(off.length);
    // uncompressed content is readable; compressed is not
    expect(off).toContain("(Line 0");
    expect(on).not.toContain("(Line 0");
  });
});
