import type {
  Invoice,
  InvoiceLine,
  Seller,
  Buyer,
  PostalAddress,
  Contact,
  Payment,
  VatCategory,
  InvoiceTypeCode,
  AllowanceCharge,
  VatExemptionReason,
} from "@jasy/zugferd";
import { detectInvoice } from "./detect.js";

// XML → Invoice. Hand-rolled, scope-based extraction of the known EN16931 tags (we emit them in
// @jasy/zugferd, so we know every path). No XML-parser dependency. CII first; UBL plugs in next.
// Round-trip safe: parsing an invoice we generated and re-emitting reproduces the same XML.

const unesc = (s: string): string =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** Inner content of the first `<tag …>…</tag>` (CII tags don't self-nest, so non-greedy is exact). */
function inner(xml: string | undefined, tag: string): string | undefined {
  if (xml === undefined) return undefined;
  return new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1];
}
/** Inner content of every `<tag …>…</tag>`. */
function innerAll(xml: string | undefined, tag: string): string[] {
  if (xml === undefined) return [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(m[1]);
  return out;
}
/** Text value of the first leaf `<tag …>value</tag>`, unescaped. */
function val(xml: string | undefined, tag: string): string | undefined {
  const c = inner(xml, tag);
  return c === undefined ? undefined : unesc(c);
}
/** An attribute on the first `<tag … name="X" …>`. */
function attr(xml: string | undefined, tag: string, name: string): string | undefined {
  if (xml === undefined) return undefined;
  return new RegExp(`<${tag}\\s[^>]*\\b${name}="([^"]*)"`).exec(xml)?.[1];
}
const num = (s: string | undefined): number => (s === undefined ? 0 : parseFloat(s));

/** `format="102"` date `20260620` → `2026-06-20`. */
function date(scope: string | undefined): string | undefined {
  const d = val(scope, "udt:DateTimeString");
  return d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : undefined;
}

function parseAddress(s: string): PostalAddress {
  return {
    postCode: val(s, "ram:PostcodeCode"),
    line1: val(s, "ram:LineOne"),
    line2: val(s, "ram:LineTwo"),
    line3: val(s, "ram:LineThree"),
    city: val(s, "ram:CityName"),
    subdivision: val(s, "ram:CountrySubDivisionName"),
    country: val(s, "ram:CountryID") ?? "",
  };
}

function parseContact(s: string | undefined): Contact | undefined {
  if (!s) return undefined;
  const c: Contact = {
    name: val(s, "ram:PersonName"),
    phone: val(inner(s, "ram:TelephoneUniversalCommunication"), "ram:CompleteNumber"),
    email: val(inner(s, "ram:EmailURIUniversalCommunication"), "ram:URIID"),
  };
  return c.name || c.phone || c.email ? c : undefined;
}

/** `<ram:ID schemeID="VA">…</ram:ID>` inside a party's tax registrations (VA = VAT id, FC = tax no.). */
function taxReg(s: string, scheme: string): string | undefined {
  const m = new RegExp(`<ram:ID schemeID="${scheme}">([^<]*)</ram:ID>`).exec(s);
  return m ? unesc(m[1]) : undefined;
}

function parseSeller(s: string): Seller {
  const org = inner(s, "ram:SpecifiedLegalOrganization");
  return {
    name: val(s, "ram:Name") ?? "",
    tradingName: val(org, "ram:TradingBusinessName"),
    legalRegistrationId: val(org, "ram:ID"),
    vatId: taxReg(s, "VA"),
    taxNumber: taxReg(s, "FC"),
    electronicAddress: val(inner(s, "ram:URIUniversalCommunication"), "ram:URIID"),
    address: parseAddress(inner(s, "ram:PostalTradeAddress") ?? ""),
    contact: parseContact(inner(s, "ram:DefinedTradeContact")),
  };
}

function parseBuyer(s: string): Buyer {
  const org = inner(s, "ram:SpecifiedLegalOrganization");
  return {
    name: val(s, "ram:Name") ?? "",
    tradingName: val(org, "ram:TradingBusinessName"),
    legalRegistrationId: val(org, "ram:ID"),
    vatId: taxReg(s, "VA"),
    electronicAddress: val(inner(s, "ram:URIUniversalCommunication"), "ram:URIID"),
    address: parseAddress(inner(s, "ram:PostalTradeAddress") ?? ""),
    contact: parseContact(inner(s, "ram:DefinedTradeContact")),
  };
}

function parseLine(s: string, index: number): InvoiceLine {
  const doc = inner(s, "ram:AssociatedDocumentLineDocument") ?? "";
  const product = inner(s, "ram:SpecifiedTradeProduct") ?? "";
  const price = inner(s, "ram:NetPriceProductTradePrice") ?? "";
  const del = inner(s, "ram:SpecifiedLineTradeDelivery") ?? "";
  const tax = inner(inner(s, "ram:SpecifiedLineTradeSettlement"), "ram:ApplicableTradeTax") ?? "";
  const id = val(doc, "ram:LineID");
  const note = inner(doc, "ram:IncludedNote");
  const basis = inner(price, "ram:BasisQuantity");
  return {
    id: id !== undefined && id !== String(index + 1) ? id : undefined, // omit the auto-number
    name: val(product, "ram:Name") ?? "",
    description: val(product, "ram:Description"),
    sellerItemId: val(product, "ram:SellerAssignedID"),
    buyerItemId: val(product, "ram:BuyerAssignedID"),
    standardItemId: val(product, "ram:GlobalID"),
    quantity: num(val(del, "ram:BilledQuantity")),
    unit: attr(del, "ram:BilledQuantity", "unitCode") ?? "",
    netUnitPrice: num(val(price, "ram:ChargeAmount")),
    priceBaseQuantity: basis ? num(val(price, "ram:BasisQuantity")) : undefined,
    vat: {
      category: (val(tax, "ram:CategoryCode") ?? "S") as VatCategory,
      ratePercent: num(val(tax, "ram:RateApplicablePercent")),
    },
    note: note ? val(note, "ram:Content") : undefined,
  };
}

/** A document-level allowance (discount) or charge (surcharge), BG-20 / BG-21. */
function parseAllowanceCii(ac: string): AllowanceCharge {
  const cat = inner(ac, "ram:CategoryTradeTax");
  return {
    isCharge: val(inner(ac, "ram:ChargeIndicator"), "udt:Indicator") === "true",
    amount: num(val(ac, "ram:ActualAmount")),
    reason: val(ac, "ram:Reason"),
    reasonCode: val(ac, "ram:ReasonCode"),
    vat: {
      category: (val(cat, "ram:CategoryCode") ?? "S") as VatCategory,
      ratePercent: num(val(cat, "ram:RateApplicablePercent")),
    },
  };
}

/** VAT exemption reasons (BT-120/121) keyed by category, read off the BG-23 breakdown groups. */
function exemptionsCii(set: string): Partial<Record<VatCategory, VatExemptionReason>> | undefined {
  const out: Partial<Record<VatCategory, VatExemptionReason>> = {};
  for (const g of innerAll(set, "ram:ApplicableTradeTax")) {
    const cat = val(g, "ram:CategoryCode") as VatCategory | undefined;
    const text = val(g, "ram:ExemptionReason");
    const code = val(g, "ram:ExemptionReasonCode");
    if (cat && (text || code)) out[cat] = { text, code };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Parse a UN/CEFACT CII invoice (EN16931 / ZUGFeRD / XRechnung-CII) into the Invoice model. */
export function parseCII(xml: string): Invoice {
  const header = inner(xml, "rsm:ExchangedDocument") ?? "";
  const tx = inner(xml, "rsm:SupplyChainTradeTransaction") ?? "";
  const agr = inner(tx, "ram:ApplicableHeaderTradeAgreement") ?? "";
  const del = inner(tx, "ram:ApplicableHeaderTradeDelivery") ?? "";
  const set = inner(tx, "ram:ApplicableHeaderTradeSettlement") ?? "";

  const type = num(val(header, "ram:TypeCode"));
  const notes = innerAll(header, "ram:IncludedNote")
    .map((n) => val(n, "ram:Content"))
    .filter((n): n is string => !!n);

  const shipTo = inner(del, "ram:ShipToTradeParty");
  const deliveryDate = date(inner(del, "ram:ActualDeliverySupplyChainEvent"));
  const delivery =
    shipTo || deliveryDate
      ? {
          date: deliveryDate,
          recipientName: val(shipTo, "ram:Name"),
          address:
            shipTo && inner(shipTo, "ram:PostalTradeAddress")
              ? parseAddress(inner(shipTo, "ram:PostalTradeAddress")!)
              : undefined,
        }
      : undefined;

  const pm = inner(set, "ram:SpecifiedTradeSettlementPaymentMeans");
  const acct = inner(pm, "ram:PayeePartyCreditorFinancialAccount");
  const inst = inner(pm, "ram:PayeeSpecifiedCreditorFinancialInstitution");
  const terms = inner(set, "ram:SpecifiedTradePaymentTerms");
  const payment: Payment | undefined =
    pm || terms
      ? {
          meansCode: val(pm, "ram:TypeCode"),
          meansText: val(pm, "ram:Information"),
          iban: val(acct, "ram:IBANID"),
          accountName: val(acct, "ram:AccountName"),
          bic: val(inst, "ram:BICID"),
          terms: val(terms, "ram:Description"),
        }
      : undefined;
  const totals = inner(set, "ram:SpecifiedTradeSettlementHeaderMonetarySummation");
  const paid = val(totals, "ram:TotalPrepaidAmount");
  const allowancesCharges = innerAll(set, "ram:SpecifiedTradeAllowanceCharge").map(
    parseAllowanceCii,
  );

  return {
    number: val(header, "ram:ID") ?? "",
    issueDate: date(inner(header, "ram:IssueDateTime")) ?? "",
    type: type && type !== 380 ? (type as InvoiceTypeCode) : undefined,
    currency: val(set, "ram:InvoiceCurrencyCode") ?? "",
    dueDate: date(inner(terms, "ram:DueDateDateTime")),
    buyerReference: val(agr, "ram:BuyerReference"),
    purchaseOrderRef: val(inner(agr, "ram:BuyerOrderReferencedDocument"), "ram:IssuerAssignedID"),
    contractRef: val(inner(agr, "ram:ContractReferencedDocument"), "ram:IssuerAssignedID"),
    notes: notes.length ? notes : undefined,
    seller: parseSeller(inner(agr, "ram:SellerTradeParty") ?? ""),
    buyer: parseBuyer(inner(agr, "ram:BuyerTradeParty") ?? ""),
    delivery,
    payeeName: val(inner(set, "ram:PayeeTradeParty"), "ram:Name"),
    lines: innerAll(tx, "ram:IncludedSupplyChainTradeLineItem").map(parseLine),
    allowancesCharges: allowancesCharges.length ? allowancesCharges : undefined,
    vatExemptionReasons: exemptionsCii(set),
    payment,
    paidAmount: paid ? num(paid) : undefined,
  };
}

// ── UBL (OASIS Invoice-2) - the second EN16931 syntax (PEPPOL; XRechnung accepts it too) ────────────

function parseAddressUbl(s: string): PostalAddress {
  return {
    line1: val(s, "cbc:StreetName"),
    line2: val(s, "cbc:AdditionalStreetName"),
    line3: val(inner(s, "cac:AddressLine"), "cbc:Line"),
    city: val(s, "cbc:CityName"),
    postCode: val(s, "cbc:PostalZone"),
    subdivision: val(s, "cbc:CountrySubentity"),
    country: val(inner(s, "cac:Country"), "cbc:IdentificationCode") ?? "",
  };
}

function parseContactUbl(s: string | undefined): Contact | undefined {
  if (!s) return undefined;
  const c: Contact = {
    name: val(s, "cbc:Name"),
    phone: val(s, "cbc:Telephone"),
    email: val(s, "cbc:ElectronicMail"),
  };
  return c.name || c.phone || c.email ? c : undefined;
}

/** A party's tax id by scheme: the cbc:CompanyID whose cac:TaxScheme is "VAT" (BT-31) or "FC" (BT-32). */
function ublTaxId(party: string, scheme: string): string | undefined {
  for (const pts of innerAll(party, "cac:PartyTaxScheme")) {
    if (val(inner(pts, "cac:TaxScheme"), "cbc:ID") === scheme) return val(pts, "cbc:CompanyID");
  }
  return undefined;
}

function parsePartyUbl(scope: string) {
  const party = inner(scope, "cac:Party") ?? "";
  const legal = inner(party, "cac:PartyLegalEntity");
  return {
    party,
    name: val(legal, "cbc:RegistrationName") ?? "",
    tradingName: val(inner(party, "cac:PartyName"), "cbc:Name"),
    legalRegistrationId: val(legal, "cbc:CompanyID"),
    vatId: ublTaxId(party, "VAT"),
    electronicAddress: val(party, "cbc:EndpointID"),
    address: parseAddressUbl(inner(party, "cac:PostalAddress") ?? ""),
    contact: parseContactUbl(inner(party, "cac:Contact")),
  };
}

function parseLineUbl(s: string, index: number): InvoiceLine {
  const item = inner(s, "cac:Item") ?? "";
  const price = inner(s, "cac:Price") ?? "";
  const tax = inner(item, "cac:ClassifiedTaxCategory") ?? "";
  const id = val(s, "cbc:ID");
  const base = val(price, "cbc:BaseQuantity");
  return {
    id: id !== undefined && id !== String(index + 1) ? id : undefined, // omit the auto-number
    name: val(item, "cbc:Name") ?? "",
    description: val(item, "cbc:Description"),
    sellerItemId: val(inner(item, "cac:SellersItemIdentification"), "cbc:ID"),
    buyerItemId: val(inner(item, "cac:BuyersItemIdentification"), "cbc:ID"),
    standardItemId: val(inner(item, "cac:StandardItemIdentification"), "cbc:ID"),
    quantity: num(val(s, "cbc:InvoicedQuantity")),
    unit: attr(s, "cbc:InvoicedQuantity", "unitCode") ?? "",
    netUnitPrice: num(val(price, "cbc:PriceAmount")),
    priceBaseQuantity: base !== undefined ? num(base) : undefined,
    vat: {
      category: (val(tax, "cbc:ID") ?? "S") as VatCategory,
      ratePercent: num(val(tax, "cbc:Percent")),
    },
    note: val(s, "cbc:Note"),
  };
}

function parseAllowanceUbl(ac: string): AllowanceCharge {
  const cat = inner(ac, "cac:TaxCategory");
  return {
    isCharge: val(ac, "cbc:ChargeIndicator") === "true",
    amount: num(val(ac, "cbc:Amount")),
    reason: val(ac, "cbc:AllowanceChargeReason"),
    reasonCode: val(ac, "cbc:AllowanceChargeReasonCode"),
    vat: {
      category: (val(cat, "cbc:ID") ?? "S") as VatCategory,
      ratePercent: num(val(cat, "cbc:Percent")),
    },
  };
}

function exemptionsUbl(xml: string): Partial<Record<VatCategory, VatExemptionReason>> | undefined {
  const out: Partial<Record<VatCategory, VatExemptionReason>> = {};
  for (const sub of innerAll(inner(xml, "cac:TaxTotal"), "cac:TaxSubtotal")) {
    const tc = inner(sub, "cac:TaxCategory");
    const cat = val(tc, "cbc:ID") as VatCategory | undefined;
    const text = val(tc, "cbc:TaxExemptionReason");
    const code = val(tc, "cbc:TaxExemptionReasonCode");
    if (cat && (text || code)) out[cat] = { text, code };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Parse an OASIS UBL invoice (EN16931 / PEPPOL / XRechnung-UBL) into the Invoice model. */
export function parseUBL(xml: string): Invoice {
  // UBL has no head wrapper; the header fields are direct children before the supplier party
  const cut = xml.indexOf("<cac:AccountingSupplierParty");
  const head = cut >= 0 ? xml.slice(0, cut) : xml;

  const seller = parsePartyUbl(inner(xml, "cac:AccountingSupplierParty") ?? "");
  const buyer = parsePartyUbl(inner(xml, "cac:AccountingCustomerParty") ?? "");
  const type = num(val(head, "cbc:InvoiceTypeCode"));
  const notes = innerAll(head, "cbc:Note")
    .map(unesc)
    .filter((n) => n.length > 0);

  const del = inner(xml, "cac:Delivery");
  const dLoc = inner(del, "cac:DeliveryLocation");
  const deliveryDate = val(del, "cbc:ActualDeliveryDate"); // UBL dates are plain ISO, no 102 format
  const dParty = inner(del, "cac:DeliveryParty");
  const delivery =
    del && (deliveryDate || dParty || dLoc)
      ? {
          date: deliveryDate,
          recipientName: val(inner(dParty, "cac:PartyName"), "cbc:Name"),
          address: inner(dLoc, "cac:PostalAddress")
            ? parseAddressUbl(inner(dLoc, "cac:PostalAddress")!)
            : undefined,
        }
      : undefined;

  const pm = inner(xml, "cac:PaymentMeans");
  const acct = inner(pm, "cac:PayeeFinancialAccount");
  const terms = inner(xml, "cac:PaymentTerms");
  const payment: Payment | undefined =
    pm || terms
      ? {
          meansCode: val(pm, "cbc:PaymentMeansCode"),
          reference: val(pm, "cbc:PaymentID"),
          iban: val(acct, "cbc:ID"),
          accountName: val(acct, "cbc:Name"),
          bic: val(inner(acct, "cac:FinancialInstitutionBranch"), "cbc:ID"),
          terms: val(terms, "cbc:Note"),
        }
      : undefined;
  const paid = val(inner(xml, "cac:LegalMonetaryTotal"), "cbc:PrepaidAmount");
  // document-level allowances/charges live before the lines (UBL also allows them per-line, which we skip)
  const li = xml.indexOf("<cac:InvoiceLine");
  const allowancesCharges = innerAll(li >= 0 ? xml.slice(0, li) : xml, "cac:AllowanceCharge").map(
    parseAllowanceUbl,
  );

  return {
    number: val(head, "cbc:ID") ?? "",
    issueDate: val(head, "cbc:IssueDate") ?? "",
    type: type && type !== 380 ? (type as InvoiceTypeCode) : undefined,
    currency: val(head, "cbc:DocumentCurrencyCode") ?? "",
    dueDate: val(head, "cbc:DueDate"),
    buyerReference: val(head, "cbc:BuyerReference"),
    purchaseOrderRef: val(inner(head, "cac:OrderReference"), "cbc:ID"),
    contractRef: val(inner(head, "cac:ContractDocumentReference"), "cbc:ID"),
    notes: notes.length ? notes : undefined,
    seller: {
      name: seller.name,
      tradingName: seller.tradingName,
      legalRegistrationId: seller.legalRegistrationId,
      vatId: seller.vatId,
      taxNumber: ublTaxId(seller.party, "FC"),
      electronicAddress: seller.electronicAddress,
      address: seller.address,
      contact: seller.contact,
    },
    buyer: {
      name: buyer.name,
      tradingName: buyer.tradingName,
      legalRegistrationId: buyer.legalRegistrationId,
      vatId: buyer.vatId,
      electronicAddress: buyer.electronicAddress,
      address: buyer.address,
      contact: buyer.contact,
    },
    delivery,
    lines: innerAll(xml, "cac:InvoiceLine").map(parseLineUbl),
    allowancesCharges: allowancesCharges.length ? allowancesCharges : undefined,
    vatExemptionReasons: exemptionsUbl(xml),
    payment,
    paidAmount: paid !== undefined ? num(paid) : undefined,
  };
}

/** Parse e-invoice XML into the Invoice model, picking CII/UBL from what it is. */
export function parseInvoice(xml: string): Invoice {
  const { syntax } = detectInvoice(xml);
  if (syntax === "UBL") return parseUBL(xml);
  if (syntax === "CII") return parseCII(xml);
  throw new Error(`${syntax} parsing is not implemented yet`);
}
