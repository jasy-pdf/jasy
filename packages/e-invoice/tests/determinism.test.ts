import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { renderZugferd } from "../src/render";
import { Invoice } from "../src/invoice";

// An archived or audited invoice gets re-rendered years later - from the same data, by the same
// version. If the two files differ, every downstream hash, signature and diff is worthless. Nothing
// in the render path may therefore come from the clock, a random source or iteration order.

const invoice: Invoice = {
  number: "RE-2026-001",
  issueDate: "2026-06-17",
  currency: "EUR",
  dueDate: "2026-07-01",
  buyerReference: "04011000-12345-34",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "rechnung@muster.de",
    address: { line1: "Hauptstr. 1", city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "Kunde AG", address: { city: "München", postCode: "80331", country: "DE" } },
  lines: [
    {
      name: "Webdesign",
      quantity: 2,
      unit: "C62",
      netUnitPrice: 100,
      vat: { category: "S", ratePercent: 19 },
    },
    {
      name: "Hosting",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 50,
      vat: { category: "S", ratePercent: 7 },
    },
  ],
  payment: { iban: "DE02120300000000202051", bic: "BYLADEM1001" },
};

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

describe("re-rendering the same invoice", () => {
  it("produces byte-identical PDF and XML", async () => {
    const a = await renderZugferd(invoice);
    const b = await renderZugferd(invoice);
    expect(sha(b.bytes)).toBe(sha(a.bytes));
    expect(b.xml).toBe(a.xml);
  });

  it("changes the bytes when the invoice changes, so the hash is not merely constant", async () => {
    const a = await renderZugferd(invoice);
    const b = await renderZugferd({ ...invoice, number: "RE-2026-002" });
    expect(sha(b.bytes)).not.toBe(sha(a.bytes));
  });

  it("gives the trailer /ID as a content hash, equal across renders", async () => {
    const a = await renderZugferd(invoice);
    const ids = /\/ID \[<([0-9A-F]+)> <([0-9A-F]+)>\]/.exec(
      Buffer.from(a.bytes).toString("latin1"),
    );
    expect(ids).not.toBeNull();
    expect(ids![1]).toBe(ids![2]); // a fresh document uses one hash for both strings
    const b = await renderZugferd(invoice);
    expect(/\/ID \[<([0-9A-F]+)>/.exec(Buffer.from(b.bytes).toString("latin1"))![1]).toBe(ids![1]);
  });
});
