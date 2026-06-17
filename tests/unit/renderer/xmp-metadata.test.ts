import { describe, it, expect } from "vitest";
import { Document, Page, Text, renderPdf } from "../../../src/lib/api";

const doc = Document([Page([Text("hi")])]);
const xmp = '<?xpacket?><x:xmpmeta xmlns:x="adobe:ns:meta/"><test/></x:xmpmeta><?xpacket end?>';

describe("PDF XMP metadata (/Metadata)", () => {
  it("adds no /Metadata to the catalog when none is set", async () => {
    const pdf = await renderPdf(doc);
    expect(pdf).not.toContain("/Type /Metadata");
    expect(pdf).not.toContain("/Metadata ");
  });

  it("embeds an XMP packet as a /Metadata stream referenced by the catalog", async () => {
    const pdf = await renderPdf(doc, { xmp });
    expect(pdf).toContain("/Type /Metadata /Subtype /XML");
    expect(pdf).toContain("/Metadata "); // catalog reference "/Metadata N 0 R"
    expect(pdf).toContain('<x:xmpmeta xmlns:x="adobe:ns:meta/">');
  });
});
