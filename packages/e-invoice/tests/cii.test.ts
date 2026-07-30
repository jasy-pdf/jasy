import { describe, it, expect } from "vitest";
import { toCII } from "../src/cii";
import { computeInvoice } from "../src/compute";
import { Invoice } from "../src/invoice";

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
  buyer: {
    name: "Kunde AG",
    address: { city: "München", postCode: "80331", country: "DE" },
  },
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

describe("toCII", () => {
  const xml = toCII(invoice, computeInvoice(invoice));

  it("declares the EN16931 guideline (BT-24) and the CII root", () => {
    expect(xml).toContain("<rsm:CrossIndustryInvoice");
    expect(xml).toContain("urn:cen.eu:en16931:2017");
  });

  it("emits the XSD-required structure (regression guards for caught bugs)", () => {
    // ExchangedDocument lives in the rsm namespace, not ram.
    expect(xml).toContain("<rsm:ExchangedDocument>");
    expect(xml).not.toContain("<ram:ExchangedDocument>");
    // ApplicableHeaderTradeDelivery is mandatory (1..1) even with no delivery data on this invoice.
    expect(xml).toContain("<ram:ApplicableHeaderTradeDelivery>");
  });

  it("maps the document header (BT-1 / BT-3 / BT-2)", () => {
    expect(xml).toContain("<ram:ID>RE-2026-001</ram:ID>");
    expect(xml).toContain("<ram:TypeCode>380</ram:TypeCode>");
    expect(xml).toContain('<udt:DateTimeString format="102">20260617</udt:DateTimeString>');
  });

  it("maps seller + buyer (BT-27 / BT-31 / BT-44 / country)", () => {
    expect(xml).toContain("<ram:Name>Muster GmbH</ram:Name>");
    expect(xml).toContain('<ram:ID schemeID="VA">DE123456789</ram:ID>');
    expect(xml).toContain("<ram:Name>Kunde AG</ram:Name>");
    expect(xml).toContain("<ram:CountryID>DE</ram:CountryID>");
  });

  it("maps the lines (BT-153 / BT-129 / BT-131)", () => {
    expect(xml).toContain("<ram:Name>Webdesign</ram:Name>");
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">2</ram:BilledQuantity>');
    expect(xml).toContain("<ram:LineTotalAmount>200.00</ram:LineTotalAmount>");
  });

  it("maps the VAT breakdown (BG-23: BT-117 / BT-116 / BT-119)", () => {
    expect(xml).toContain("<ram:CalculatedAmount>38.00</ram:CalculatedAmount>");
    expect(xml).toContain("<ram:BasisAmount>200.00</ram:BasisAmount>");
    expect(xml).toContain("<ram:RateApplicablePercent>7</ram:RateApplicablePercent>");
  });

  it("maps the document totals (BG-22: BT-109 / BT-110 / BT-112 / BT-115)", () => {
    expect(xml).toContain("<ram:TaxBasisTotalAmount>250.00</ram:TaxBasisTotalAmount>");
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">41.50</ram:TaxTotalAmount>');
    expect(xml).toContain("<ram:GrandTotalAmount>291.50</ram:GrandTotalAmount>");
    expect(xml).toContain("<ram:DuePayableAmount>291.50</ram:DuePayableAmount>");
  });

  it("maps payment IBAN/BIC (BT-84 / BT-86) and due date (BT-9)", () => {
    expect(xml).toContain("<ram:IBANID>DE02120300000000202051</ram:IBANID>");
    expect(xml).toContain("<ram:BICID>BYLADEM1001</ram:BICID>");
    expect(xml).toContain('<udt:DateTimeString format="102">20260701</udt:DateTimeString>');
  });

  it("escapes XML special characters in text", () => {
    const x = toCII(
      { ...invoice, seller: { ...invoice.seller, name: "A & B <Co>" } },
      computeInvoice(invoice),
    );
    expect(x).toContain("<ram:Name>A &amp; B &lt;Co&gt;</ram:Name>");
  });
});
