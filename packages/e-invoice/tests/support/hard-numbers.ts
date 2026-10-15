import type { Invoice } from "../../src/invoice.ts";

/**
 * An invoice built from half cents. Every derived figure lands EXACTLY on ...5 before rounding, the
 * one place binary floats round the wrong way, and EN 16931 rounds half away from zero. The figures
 * in `hardTotals` were computed with integer arithmetic, never with the code under test.
 *
 * Complete for XRechnung, so the same file is what the validators get.
 */
export const hardInvoice: Invoice = {
  number: "RE-2026-0505",
  issueDate: "2026-10-15",
  currency: "EUR",
  dueDate: "2026-11-14",
  delivery: { date: "2026-10-14" },
  buyerReference: "04011000-12345-34",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    electronicAddress: "rechnung@muster.de",
    address: { line1: "Hauptstraße 1", city: "Berlin", postCode: "10115", country: "DE" },
    contact: { name: "Erika Muster", phone: "+49 30 123", email: "kontakt@muster.de" },
  },
  buyer: {
    name: "Amt",
    electronicAddress: "amt@bund.de",
    address: { line1: "Marienplatz 1", city: "Bonn", postCode: "53113", country: "DE" },
  },
  lines: [
    // 3 x 1.505 = 4.515 -> 4.52, and a unit price with three decimals that must survive as stated.
    {
      name: "Cable",
      quantity: 3,
      unit: "C62",
      netUnitPrice: 1.505,
      vat: { category: "S", ratePercent: 19 },
    },
    {
      name: "Setup",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 31.03,
      vat: { category: "S", ratePercent: 19 },
    },
    // 2 % of 7.25 = 0.145 -> 0.15, so the line is 7.10.
    {
      name: "Adapter",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 7.25,
      vat: { category: "S", ratePercent: 19 },
      allowancesCharges: [
        {
          isCharge: false,
          baseAmount: 7.25,
          percent: 2,
          vat: { category: "S", ratePercent: 19 },
          reason: "Line discount",
        },
      ],
    },
    // 2.5 x 12.199 = 30.4975 -> 30.50
    {
      name: "Labour",
      quantity: 2.5,
      unit: "HUR",
      netUnitPrice: 12.199,
      vat: { category: "S", ratePercent: 7 },
    },
    // A return: -3 x 1.505 = -4.515 -> -4.52, away from zero, not towards it.
    {
      name: "Cable returned",
      quantity: -3,
      unit: "C62",
      netUnitPrice: 1.505,
      vat: { category: "S", ratePercent: 7 },
    },
    // Priced per 100: 7 x 64.50 / 100 = 4.515 -> 4.52
    {
      name: "Screws",
      quantity: 7,
      unit: "C62",
      netUnitPrice: 64.5,
      priceBaseQuantity: 100,
      vat: { category: "S", ratePercent: 7 },
    },
  ],
  // 1 % of 14.50 = 0.145 -> 0.15
  allowancesCharges: [
    {
      isCharge: false,
      baseAmount: 14.5,
      percent: 1,
      vat: { category: "S", ratePercent: 19 },
      reason: "Loyalty",
    },
  ],
  payment: {
    iban: "DE02120300000000202051",
    terms: "Payable within 30 days.",
    cashDiscounts: [
      { days: 14, percent: 2 }, // 2 % of 83.22 = 1.6644 -> 1.66
      { days: 7, percent: 2, baseAmount: 7.25 }, // 2 % of 7.25 = 0.145 -> 0.15
    ],
  },
};

/** The figures, worked out with integers. 42.50 at 19 % is 8.075 and 30.50 at 7 % is 2.135. */
export const hardTotals = {
  lineNets: ["4.52", "31.03", "7.10", "30.50", "-4.52", "4.52"],
  lineAllowance: "0.15",
  docAllowance: "0.15",
  vat19: { taxable: "42.50", tax: "8.08" },
  vat7: { taxable: "30.50", tax: "2.14" },
  lineTotal: "73.15",
  taxBasisTotal: "73.00",
  taxTotal: "10.22",
  grandTotal: "83.22",
  skonto: [
    { saves: "1.66", pays: "81.56" },
    { saves: "0.15", pays: "7.10" },
  ],
};
