import { describe, it, expect } from "vitest";
import { Invoice } from "../src/invoice.ts";
import { toCII } from "../src/cii.ts";
import { toUBL } from "../src/ubl.ts";
import { computeInvoice } from "../src/compute.ts";
import { toBase64, pdfAttachments } from "../src/attachment.ts";
import { en16931Problems } from "../src/profile-check.ts";
import { defaultInvoiceTemplate } from "../src/template.ts";
import { resolveLabels, makeFormatters } from "../src/i18n.ts";
import { printedText } from "./support/printed.ts";

/**
 * BG-24. A supporting document has to reach the recipient twice - base64 in the XML for a machine,
 * an embedded file in the PDF for a person - and the paper has to SAY it is there, or nobody looks.
 */

const base: Invoice = {
  number: "RE-2026-300",
  issueDate: "2026-09-09",
  currency: "EUR",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "Kunde AG", address: { city: "München", postCode: "80331", country: "DE" } },
  lines: [
    {
      name: "Support",
      quantity: 8,
      unit: "HUR",
      netUnitPrice: 95,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
};

const CSV = new TextEncoder().encode("Datum;Stunden\n2026-09-01;8\n");

const withDocs = (docs: Invoice["supportingDocuments"]): Invoice => ({
  ...base,
  supportingDocuments: docs,
});

describe("base64, written by hand because neither Buffer nor btoa is safe here", () => {
  it("matches the reference encoding on bytes above 0x7f", () => {
    const bytes = new Uint8Array([0x00, 0x7f, 0x80, 0xff, 0xfe]);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });

  it("pads the way base64 pads", () => {
    expect(toBase64(new TextEncoder().encode("a"))).toBe("YQ==");
    expect(toBase64(new TextEncoder().encode("ab"))).toBe("YWI=");
    expect(toBase64(new TextEncoder().encode("abc"))).toBe("YWJj");
    expect(toBase64(new Uint8Array(0))).toBe("");
  });

  it("agrees with Buffer on a longer run, so length has no edge case left", () => {
    const bytes = new Uint8Array(500).map((_, i) => (i * 37) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
  });
});

describe("the XML carries the file", () => {
  const invoice = withDocs([
    {
      reference: "TIMESHEET-09",
      description: "Stundennachweis September",
      file: { content: CSV, mimeType: "text/csv", filename: "stunden.csv" },
    },
  ]);
  const computed = computeInvoice(invoice);

  it("CII writes the binary with the two required attributes", () => {
    const xml = toCII(invoice, computed);
    expect(xml).toContain(
      `<ram:AttachmentBinaryObject mimeCode="text/csv" filename="stunden.csv">${toBase64(CSV)}</ram:AttachmentBinaryObject>`,
    );
    expect(xml).toContain("<ram:IssuerAssignedID>TIMESHEET-09</ram:IssuerAssignedID>");
    expect(xml).toContain("<ram:TypeCode>916</ram:TypeCode>");
  });

  it("CII places it in the agreement, after the contract reference", () => {
    const withRefs = { ...invoice, contractRef: "C-1" };
    const xml = toCII(withRefs, computeInvoice(withRefs));
    expect(xml.indexOf("ContractReferencedDocument")).toBeLessThan(
      xml.indexOf("AdditionalReferencedDocument"),
    );
  });

  it("UBL nests it one level deeper, inside cac:Attachment", () => {
    const xml = toUBL(invoice, computed);
    expect(xml).toMatch(
      /<cac:AdditionalDocumentReference><cbc:ID>TIMESHEET-09<\/cbc:ID>.*?<cac:Attachment><cbc:EmbeddedDocumentBinaryObject/,
    );
  });

  it("round-trips: what comes out of the XML is the file that went in", () => {
    const xml = toCII(invoice, computed);
    const b64 = /<ram:AttachmentBinaryObject[^>]*>([^<]+)</.exec(xml)![1]!;
    expect(new Uint8Array(Buffer.from(b64, "base64"))).toEqual(CSV);
  });
});

describe("a link instead of a file", () => {
  const invoice = withDocs([{ reference: "LEISTUNG-09", url: "https://example.invalid/n.pdf" }]);
  const computed = computeInvoice(invoice);

  it("CII uses URIID and writes no binary", () => {
    const xml = toCII(invoice, computed);
    expect(xml).toContain("<ram:URIID>https://example.invalid/n.pdf</ram:URIID>");
    expect(xml).not.toContain("AttachmentBinaryObject");
  });

  it("UBL wraps it as an external reference", () => {
    expect(toUBL(invoice, computed)).toContain(
      "<cac:ExternalReference><cbc:URI>https://example.invalid/n.pdf</cbc:URI></cac:ExternalReference>",
    );
  });
});

describe("the file also goes into the PDF, not only the XML", () => {
  it("hands the renderer a Supplement attachment per file", () => {
    const attachments = pdfAttachments([
      {
        reference: "A",
        file: { content: CSV, mimeType: "text/csv", filename: "stunden.csv" },
      },
      { reference: "B", url: "https://example.invalid/x" },
    ]);
    expect(attachments).toHaveLength(1); // the link has no file to attach
    expect(attachments[0]).toMatchObject({
      name: "stunden.csv",
      mimeType: "text/csv",
      relationship: "Supplement",
    });
  });

  it("calls it Supplement, never Data - only the invoice XML is the invoice", () => {
    const [a] = pdfAttachments([
      { reference: "A", file: { content: CSV, mimeType: "text/csv", filename: "x.csv" } },
    ]);
    expect(a!.relationship).not.toBe("Data");
  });
});

describe("a name collision is refused, because no validator catches it", () => {
  const file = (filename: string) => ({
    reference: filename,
    file: { content: CSV, mimeType: "text/csv", filename },
  });

  it("refuses the name a reader uses to find the invoice XML", () => {
    // Both files end up in one name tree. A consumer picks whichever it finds first, and veraPDF
    // calls the result compliant - measured.
    expect(() => pdfAttachments([file("factur-x.xml")])).toThrow(/factur-x\.xml/);
  });

  it("refuses the other reserved names too, whatever the case", () => {
    for (const n of ["zugferd-invoice.xml", "XRechnung.xml", "order-x.xml"]) {
      expect(() => pdfAttachments([file(n)]), n).toThrow(/invoice XML/);
    }
  });

  it("refuses two attachments sharing a name", () => {
    expect(() => pdfAttachments([file("t.csv"), file("t.csv")])).toThrow(/used twice/);
  });

  it("does NOT quietly rename - the name is written in the XML too", () => {
    // Uniquifying the PDF key would leave the XML saying "t.csv" and the PDF saying "t (2).csv",
    // which is the two-halves-disagree defect this package exists to prevent.
    try {
      pdfAttachments([file("t.csv"), file("t.csv")]);
    } catch (e) {
      expect((e as Error).message).toContain("cannot share a name");
    }
  });

  it("allows names that merely look similar", () => {
    expect(() => pdfAttachments([file("factur-x-copy.xml"), file("t.csv")])).not.toThrow();
  });

  it("names both in the pre-flight, before the render throws", () => {
    const problems = en16931Problems({
      ...base,
      supportingDocuments: [file("factur-x.xml"), file("t.csv"), file("T.CSV")],
    });
    expect(problems.join(" ")).toContain("invoice XML");
    expect(problems.join(" ")).toContain("used twice");
  });
});

describe("the paper says an attachment exists", () => {
  const printed = (invoice: Invoice) =>
    printedText(
      defaultInvoiceTemplate(
        invoice,
        computeInvoice(invoice),
        resolveLabels("de"),
        makeFormatters("de", "EUR"),
      ),
    ).join("\n");

  it("names the description, the reference and the file", () => {
    const text = printed(
      withDocs([
        {
          reference: "TIMESHEET-09",
          description: "Stundennachweis September",
          file: { content: CSV, mimeType: "text/csv", filename: "stunden.csv" },
        },
      ]),
    );
    expect(text).toContain("Anlagen");
    expect(text).toContain("Stundennachweis September");
    expect(text).toContain("stunden.csv");
  });

  it("shows the link when there is no file", () => {
    const text = printed(withDocs([{ reference: "L", url: "https://example.invalid/n.pdf" }]));
    expect(text).toContain("https://example.invalid/n.pdf");
  });

  it("stays silent with no attachments", () => {
    expect(printed(base)).not.toContain("Anlagen");
  });
});

describe("what the pre-flight refuses", () => {
  it("a document that is only a name", () => {
    const problems = en16931Problems(withDocs([{ reference: "X" }]));
    expect(problems.join(" ")).toContain("neither a file nor a url");
  });

  it("a file without the attributes the schema requires", () => {
    const problems = en16931Problems(
      withDocs([{ reference: "X", file: { content: CSV, mimeType: "", filename: "" } }]),
    );
    expect(problems.join(" ")).toContain("filename");
    expect(problems.join(" ")).toContain("mimeType");
  });

  it("says nothing about a complete one", () => {
    expect(
      en16931Problems(
        withDocs([
          { reference: "X", file: { content: CSV, mimeType: "text/csv", filename: "a.csv" } },
        ]),
      ),
    ).toEqual([]);
  });
});

describe("absent means untouched", () => {
  it("adds nothing to either syntax", () => {
    const computed = computeInvoice(base);
    expect(toCII(base, computed)).not.toContain("AdditionalReferencedDocument");
    expect(toUBL(base, computed)).not.toContain("AdditionalDocumentReference");
  });
});
