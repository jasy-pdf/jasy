import { describe, it, expect } from "vitest";
import { Invoice } from "../src/invoice.ts";
import { toCII } from "../src/cii.ts";
import { toUBL } from "../src/ubl.ts";
import { computeInvoice } from "../src/compute.ts";
import { defaultInvoiceTemplate } from "../src/template.ts";
import { resolveLabels, makeFormatters } from "../src/i18n.ts";
import { printedText } from "./support/printed.ts";

/**
 * The fifteen scalars that only exist so someone can quote them back: project, tender, cost centre,
 * party identifiers, order lines, country of origin.
 *
 * Individually they are one element each. Together they are the case where a generator quietly
 * writes the right value into the wrong slot, so most of what is asserted here is WHERE things land -
 * the two syntaxes disagree about that constantly, and only one of them is checked by a schema that
 * cares about sequence.
 */

const full: Invoice = {
  number: "RE-2026-600",
  issueDate: "2026-09-09",
  currency: "EUR",
  buyerReference: "LEITWEG-1",
  purchaseOrderRef: "PO-100",
  salesOrderRef: "SO-200", // BT-14
  contractRef: "C-300",
  projectRef: "PRJ-400", // BT-11
  tenderRef: "TENDER-500", // BT-17
  objectRef: "METER-600", // BT-18
  buyerAccountingRef: "KST-4711", // BT-19
  notes: ["Bitte bei Rueckfragen die Projektnummer angeben."],
  noteSubjectCode: "AAI", // BT-21
  seller: {
    name: "Muster GmbH",
    identifier: "4012345000009", // BT-29
    vatId: "DE123456789",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: {
    name: "Kunde AG",
    identifier: "4098765000004", // BT-46
    address: { city: "München", postCode: "80331", country: "DE" },
  },
  delivery: { date: "2026-09-01", locationId: "LOC-77" }, // BT-71
  payeeName: "Factor AG",
  payeeIdentifier: "PAYEE-1", // BT-60
  payeeLegalRegistrationId: "HRB 4711", // BT-61
  lines: [
    {
      name: "Zaehler",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 100,
      vat: { category: "S", ratePercent: 19 },
      objectRef: "DEV-9", // BT-128
      orderLineRef: "12", // BT-132
      buyerAccountingRef: "KST-0815", // BT-133
      originCountry: "CH", // BT-159
    },
  ],
};

const computed = computeInvoice(full);
const cii = toCII(full, computed);
const ubl = toUBL(full, computed);

describe("CII", () => {
  it("puts a party identifier FIRST, where TradePartyType declares ID", () => {
    expect(cii).toContain("<ram:SellerTradeParty><ram:ID>4012345000009</ram:ID>");
    expect(cii).toContain("<ram:BuyerTradeParty><ram:ID>4098765000004</ram:ID>");
  });

  it("separates the seller's order number from the buyer's", () => {
    expect(cii).toContain(
      "<ram:SellerOrderReferencedDocument><ram:IssuerAssignedID>SO-200</ram:IssuerAssignedID>",
    );
    expect(cii).toContain(
      "<ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>PO-100</ram:IssuerAssignedID>",
    );
  });

  it("tells the shared reference element apart by TypeCode", () => {
    expect(cii).toContain(
      "<ram:AdditionalReferencedDocument><ram:IssuerAssignedID>TENDER-500</ram:IssuerAssignedID><ram:TypeCode>50</ram:TypeCode>",
    );
    expect(cii).toContain(
      "<ram:AdditionalReferencedDocument><ram:IssuerAssignedID>METER-600</ram:IssuerAssignedID><ram:TypeCode>130</ram:TypeCode>",
    );
  });

  it("carries the note subject code beside the note", () => {
    expect(cii).toMatch(/<ram:IncludedNote><ram:Content>[^<]*<\/ram:Content><ram:SubjectCode>AAI</);
  });

  it("puts the cost centre in the accounting account, at the end of the settlement", () => {
    expect(cii).toContain(
      "<ram:ReceivableSpecifiedTradeAccountingAccount><ram:ID>KST-4711</ram:ID>",
    );
    expect(cii.indexOf("DuePayableAmount")).toBeLessThan(cii.indexOf("KST-4711"));
  });

  it("carries the payee identifier and registration", () => {
    expect(cii).toContain("<ram:PayeeTradeParty><ram:ID>PAYEE-1</ram:ID>");
    expect(cii).toContain("<ram:SpecifiedLegalOrganization><ram:ID>HRB 4711</ram:ID>");
  });

  it("carries the delivery location, the order line, the object and the origin", () => {
    expect(cii).toContain("<ram:ShipToTradeParty><ram:ID>LOC-77</ram:ID>");
    expect(cii).toContain("<ram:BuyerOrderReferencedDocument><ram:LineID>12</ram:LineID>");
    expect(cii).toContain("<ram:OriginTradeCountry><ram:ID>CH</ram:ID>");
    expect(cii).toContain("<ram:ID>KST-0815</ram:ID>");
  });
});

describe("UBL, where the same values land somewhere else entirely", () => {
  it("keeps both order numbers in ONE OrderReference", () => {
    expect(ubl).toContain(
      "<cac:OrderReference><cbc:ID>PO-100</cbc:ID><cbc:SalesOrderID>SO-200</cbc:SalesOrderID></cac:OrderReference>",
    );
  });

  it("uses three different elements for tender, object and project", () => {
    expect(ubl).toContain(
      "<cac:OriginatorDocumentReference><cbc:ID>TENDER-500</cbc:ID></cac:OriginatorDocumentReference>",
    );
    expect(ubl).toContain(
      "<cac:AdditionalDocumentReference><cbc:ID>METER-600</cbc:ID><cbc:DocumentTypeCode>130</cbc:DocumentTypeCode>",
    );
    expect(ubl).toContain("<cac:ProjectReference><cbc:ID>PRJ-400</cbc:ID></cac:ProjectReference>");
  });

  it("has no element for the note subject and prefixes the note instead", () => {
    // BT-21 exists in CII as an element. In UBL the binding writes it as #CODE# in front of BT-22.
    expect(ubl).toMatch(/<cbc:Note>#AAI#Bitte bei/);
  });

  it("writes the cost centre BEFORE the buyer reference, per the InvoiceType sequence", () => {
    expect(ubl).toContain("<cbc:AccountingCost>KST-4711</cbc:AccountingCost>");
    expect(ubl.indexOf("cbc:AccountingCost")).toBeLessThan(ubl.indexOf("cbc:BuyerReference"));
  });

  it("puts the tender BEFORE the contract reference, likewise", () => {
    expect(ubl.indexOf("OriginatorDocumentReference")).toBeLessThan(
      ubl.indexOf("ContractDocumentReference"),
    );
  });

  it("nests the delivery location id with its address", () => {
    expect(ubl).toContain("<cac:DeliveryLocation><cbc:ID>LOC-77</cbc:ID>");
  });

  it("carries the payee identity as party identification and legal entity", () => {
    expect(ubl).toContain(
      "<cac:PayeeParty><cac:PartyIdentification><cbc:ID>PAYEE-1</cbc:ID></cac:PartyIdentification>",
    );
    expect(ubl).toContain("<cac:PartyLegalEntity><cbc:CompanyID>HRB 4711</cbc:CompanyID>");
  });

  it("carries the line references and the country of origin", () => {
    expect(ubl).toContain("<cbc:AccountingCost>KST-0815</cbc:AccountingCost>");
    expect(ubl).toContain("<cac:OrderLineReference><cbc:LineID>12</cbc:LineID>");
    expect(ubl).toContain("<cac:DocumentReference><cbc:ID>DEV-9</cbc:ID>");
    expect(ubl).toContain("<cac:OriginCountry><cbc:IdentificationCode>CH</cbc:IdentificationCode>");
  });
});

describe("every one of them reaches the paper", () => {
  const text = printedText(
    defaultInvoiceTemplate(full, computed, resolveLabels("de"), makeFormatters("de", "EUR")),
  ).join("\n");

  it.each([
    ["BT-14 sales order", "SO-200"],
    ["BT-11 project", "PRJ-400"],
    ["BT-17 tender", "TENDER-500"],
    ["BT-18 object", "METER-600"],
    ["BT-19 cost centre", "KST-4711"],
    ["BT-29 seller id", "4012345000009"],
    ["BT-46 buyer id", "4098765000004"],
    ["BT-71 delivery location", "LOC-77"],
    ["BT-60 payee id", "PAYEE-1"],
    ["BT-61 payee registration", "HRB 4711"],
    ["BT-128 line object", "DEV-9"],
    ["BT-132 order line", "Bestellposition 12"],
    ["BT-133 line cost centre", "KST-0815"],
    ["BT-159 origin country", "Ursprungsland CH"],
  ])("prints %s", (_name, value) => {
    expect(text).toContain(value);
  });
});

describe("absent means untouched", () => {
  it("adds none of the elements when none of the fields is set", () => {
    const bare: Invoice = {
      number: "RE-1",
      issueDate: "2026-09-09",
      currency: "EUR",
      seller: { name: "S", address: { country: "DE" } },
      buyer: { name: "B", address: { country: "DE" } },
      lines: [
        {
          name: "L",
          quantity: 1,
          unit: "C62",
          netUnitPrice: 1,
          vat: { category: "S", ratePercent: 19 },
        },
      ],
    };
    const c = computeInvoice(bare);
    for (const tag of [
      "SellerOrderReferencedDocument",
      "SpecifiedProcuringProject",
      "ReceivableSpecifiedTradeAccountingAccount",
      "OriginTradeCountry",
      "SubjectCode",
    ]) {
      expect(toCII(bare, c), tag).not.toContain(tag);
    }
    for (const tag of [
      "SalesOrderID",
      "ProjectReference",
      "OriginatorDocumentReference",
      "AccountingCost",
      "OriginCountry",
      "PartyIdentification",
    ]) {
      expect(toUBL(bare, c), tag).not.toContain(tag);
    }
  });
});
