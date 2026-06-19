import { describe, it, expect } from "vitest";
import { renderZugferd } from "@jasy/zugferd";
import { checkPdfA3 } from "../src/core/pdfa";

const invoice = {
  number: "RE-1",
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

describe("checkPdfA3 — structural PDF/A-3 + ZUGFeRD checks", () => {
  it("passes a conformant ZUGFeRD PDF/A-3 (every structural check green)", async () => {
    const { bytes } = await renderZugferd(invoice);
    const report = checkPdfA3(bytes);
    expect(report.ok).toBe(true);
    expect(report.checks.every((c) => c.ok)).toBe(true);
  });

  it("flags a PDF that lost its PDF/A identification", async () => {
    const { bytes } = await renderZugferd(invoice);
    const tampered = Buffer.from(
      Buffer.from(bytes).toString("latin1").replaceAll("pdfaid:part", "pdfaid:xxxx"),
      "latin1",
    );
    const report = checkPdfA3(tampered);
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === "pdfa-part")?.ok).toBe(false);
  });
});
