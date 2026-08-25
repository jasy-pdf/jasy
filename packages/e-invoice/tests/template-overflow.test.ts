import { describe, it, expect } from "vitest";
import { renderZugferd } from "../src/render";
import { Invoice } from "../src/invoice";

// Nothing may be DRAWN outside the page. A real invoice broke exactly here: a long company name took
// its natural single-line width, pushed the contact block past the right edge, and the viewer clipped
// the seller's own address mid-word. The document still validated - PDF/A says nothing about content
// sitting off the MediaBox - so no validator would ever have caught it.
//
// The check reads the text-positioning operators out of an UNCOMPRESSED content stream, which is why
// it sees what is really drawn rather than what the element tree intended.

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

const base: Invoice = {
  number: "RE-1",
  issueDate: "2026-08-25",
  currency: "EUR",
  dueDate: "2026-09-08",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "re@muster.de",
    address: { line1: "Hauptstr. 1", city: "Berlin", postCode: "10115", country: "DE" },
    contact: { name: "Erika Muster", phone: "+49 30 1234567", email: "kontakt@muster.de" },
  },
  buyer: {
    name: "Kunde AG",
    electronicAddress: "re@kunde.de",
    address: { city: "München", postCode: "80331", country: "DE" },
  },
  lines: [
    {
      name: "Wartung",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 500,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
  payment: { iban: "DE02120300000000202051" },
};

/** Where every text run starts, read from the raw (uncompressed) content stream. */
async function drawnAt(invoice: Invoice): Promise<{ x: number; y: number }[]> {
  const { bytes } = await renderZugferd(invoice, { compress: false });
  const stream = Buffer.from(bytes).toString("latin1");
  return [...stream.matchAll(/(-?[\d.]+) (-?[\d.]+) Td/g)].map((m) => ({
    x: parseFloat(m[1]),
    y: parseFloat(m[2]),
  }));
}

const LONG_NAME = "Heuberger Softwareentwicklung und Digitale Medien GmbH & Co. KG";
const LONG_STREET = "Bahnhofstrasse 145a, Gebaeude C, 3. Obergeschoss";

describe("nothing is drawn outside the page", () => {
  const cases: [string, Invoice][] = [
    ["a plain invoice", base],
    ["a long seller name", { ...base, seller: { ...base.seller, name: LONG_NAME } }],
    [
      "a long seller street",
      {
        ...base,
        seller: { ...base.seller, address: { ...base.seller.address, line1: LONG_STREET } },
      },
    ],
    ["a long buyer name", { ...base, buyer: { ...base.buyer, name: LONG_NAME } }],
    [
      "everything long at once",
      {
        ...base,
        seller: {
          ...base.seller,
          name: LONG_NAME,
          address: { ...base.seller.address, line1: LONG_STREET },
        },
        buyer: {
          ...base.buyer,
          name: LONG_NAME,
          address: { ...base.buyer.address, line1: LONG_STREET },
        },
      },
    ],
  ];

  it.each(cases)("keeps every text run inside the page: %s", async (_label, invoice) => {
    const positions = await drawnAt(invoice);
    expect(positions.length).toBeGreaterThan(10); // the stream really was read

    const offPage = positions.filter(
      (p) => p.x < 0 || p.x > A4_WIDTH || p.y < 0 || p.y > A4_HEIGHT,
    );
    expect(offPage).toEqual([]);
  });
});
