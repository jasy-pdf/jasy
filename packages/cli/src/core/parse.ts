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
    payment,
    paidAmount: paid ? num(paid) : undefined,
  };
}

/** Parse e-invoice XML into the Invoice model, picking CII/UBL from what it is. */
export function parseInvoice(xml: string): Invoice {
  const { syntax } = detectInvoice(xml);
  if (syntax === "CII") return parseCII(xml);
  throw new Error(`${syntax} parsing is not implemented yet`);
}
