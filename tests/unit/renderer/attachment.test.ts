import { describe, it, expect } from "vitest";
import { Document, Page, Text, renderPdf } from "../../../src/lib/api";

const doc = Document([Page([Text("hi")])]);

describe("PDF embedded-file attachments (/AF)", () => {
  it("adds nothing to the catalog when there are no attachments", async () => {
    const pdf = await renderPdf(doc);
    expect(pdf).toContain("/Type /Catalog /Pages");
    expect(pdf).not.toContain("/EmbeddedFile");
    expect(pdf).not.toContain("/AF [");
  });

  it("embeds a file as an associated file (Filespec + EmbeddedFile + catalog wiring)", async () => {
    const xml = Buffer.from("<invoice>ä €</invoice>", "utf-8");
    const pdf = await renderPdf(doc, {
      attachments: [
        { name: "factur-x.xml", data: xml, relationship: "Data", mimeType: "text/xml" },
      ],
    });
    expect(pdf).toContain("/Type /EmbeddedFile");
    expect(pdf).toContain("/Subtype /text#2Fxml");
    expect(pdf).toContain("/Type /Filespec");
    expect(pdf).toContain("/F (factur-x.xml)");
    expect(pdf).toContain("/AFRelationship /Data");
    expect(pdf).toContain("/AF [");
    expect(pdf).toContain("/EmbeddedFiles << /Names [(factur-x.xml)");
  });
});
