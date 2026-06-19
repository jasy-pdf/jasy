import { describe, it, expect } from "vitest";
import { renderZugferd } from "@jasy/zugferd";
import { readInvoice } from "../src/core/read";

const invoice = {
  number: "RE-READ-1",
  issueDate: "2026-06-19",
  currency: "EUR",
  seller: {
    name: "M GmbH",
    vatId: "DE123456789",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "K AG", address: { city: "Bonn", postCode: "53113", country: "DE" } },
  lines: [
    {
      name: "Service",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 100,
      vat: { category: "S" as const, ratePercent: 19 },
    },
  ],
};

describe("readInvoice", () => {
  it("reads a ZUGFeRD PDF — detects PDF, extracts the XML, identifies it", async () => {
    const { bytes } = await renderZugferd(invoice);
    const r = readInvoice(bytes);
    expect(r.isPdf).toBe(true);
    expect(r.meta).toMatchObject({ syntax: "CII", profile: "en16931" });
    expect(r.xml).toContain("CrossIndustryInvoice");
  });

  it("reads raw XML directly (not wrapped in a PDF)", async () => {
    const { xml } = await renderZugferd(invoice);
    const r = readInvoice(Buffer.from(xml, "utf-8"));
    expect(r.isPdf).toBe(false);
    expect(r.xml).toBe(xml);
    expect(r.meta.syntax).toBe("CII");
  });
});
