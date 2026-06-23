// A ZUGFeRD / Factur-X e-invoice: a typed EN-16931 Invoice in -> a conformant PDF/A-3 with the
// CII XML embedded out. Totals + the VAT breakdown are computed by the generator, so the business
// rules that check the arithmetic hold by construction. Rendered via @jasy/zugferd (not renderToBytes);
// the harness writes both the .pdf and the .xml.
import type { Invoice } from "@jasy/zugferd";

const invoice: Invoice = {
  number: "RE-2026-0142",
  issueDate: "2026-06-20",
  dueDate: "2026-07-04",
  currency: "EUR",
  buyerReference: "PO-99213",
  notes: ["Thank you for your business. Conformant ZUGFeRD invoice generated with @jasy/zugferd."],

  seller: {
    name: "Muster Studio GmbH",
    vatId: "DE123456789",
    legalRegistrationId: "HRB 12345 B",
    electronicAddress: "rechnung@muster-studio.de",
    address: { line1: "Hauptstraße 1", postCode: "10115", city: "Berlin", country: "DE" },
    contact: { name: "Erika Muster", phone: "+49 30 1234567", email: "kontakt@muster-studio.de" },
  },

  buyer: {
    name: "Beispiel Kunde AG",
    vatId: "DE987654321",
    address: { line1: "Marienplatz 1", postCode: "80331", city: "München", country: "DE" },
  },

  lines: [
    { id: "1", name: "Brand identity workshop", quantity: 2, unit: "HUR", netUnitPrice: 680, vat: { category: "S", ratePercent: 19 } },
    { id: "2", name: "Logo design, primary and variants", quantity: 1, unit: "C62", netUnitPrice: 1450, vat: { category: "S", ratePercent: 19 } },
    { id: "3", name: "Design system in Figma", quantity: 1, unit: "C62", netUnitPrice: 1680, vat: { category: "S", ratePercent: 19 } },
    { id: "4", name: "Frontend implementation", quantity: 8, unit: "HUR", netUnitPrice: 95, vat: { category: "S", ratePercent: 19 } },
    { id: "5", name: "Deployment and CI setup", quantity: 1, unit: "C62", netUnitPrice: 420, vat: { category: "S", ratePercent: 19 } },
  ],

  payment: {
    meansCode: "58", // SEPA credit transfer
    iban: "DE02120300000000202051",
    bic: "BYLADEM1001",
    accountName: "Muster Studio GmbH",
    terms: "Zahlbar innerhalb 14 Tagen netto.",
  },
};

export const zugferd = { invoice, options: { profile: "en16931" as const } };
