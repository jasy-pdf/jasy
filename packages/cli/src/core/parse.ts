import type {
  CashDiscount,
  SupportingDocument,
  PrecedingInvoice,
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
} from "@jasy/e-invoice";
import { detectInvoice } from "./detect.js";

// XML → Invoice. Hand-rolled, scope-based extraction of the known EN16931 tags (we emit them in
// @jasy/e-invoice, so we know every path). No XML-parser dependency. CII first; UBL plugs in next.
// Round-trip safe: parsing an invoice we generated and re-emitting reproduces the same XML.

const unesc = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // last: an escaped ampersand must not re-open the ones above

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
  const raw = new RegExp(`<${tag}\\s[^>]*\\b${name}="([^"]*)"`).exec(xml)?.[1];
  return raw === undefined ? undefined : unesc(raw);
}
const num = (s: string | undefined): number => (s === undefined ? 0 : parseFloat(s));

/** `format="102"` date `20260620` → `2026-06-20`. */
function date(scope: string | undefined): string | undefined {
  return iso102(val(scope, "udt:DateTimeString"));
}
/** The same, in the QUALIFIED namespace - BT-26 is the only place we emit `qdt:`. */
function qdtDate(scope: string | undefined): string | undefined {
  return iso102(val(scope, "qdt:DateTimeString"));
}
const iso102 = (d: string | undefined): string | undefined =>
  d && d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : undefined;

/**
 * A party's OWN `ram:ID` (BT-29 / BT-46 / BT-60 / BT-71) - the first child of the type. Scoped by
 * hand: an unscoped lookup finds the nested `SpecifiedLegalOrganization/ram:ID` (BT-30) instead.
 */
function partyId(scope: string | undefined): string | undefined {
  if (scope === undefined) return undefined;
  const head = scope.split(
    /<ram:(?:Name|Description|SpecifiedLegalOrganization|PostalTradeAddress|DefinedTradeContact)\b/,
  )[0];
  return val(head, "ram:ID");
}

/** Regex-safe: every value interpolated into a pattern here comes out of the parsed file. */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** BT-111. The element appears twice; only `currencyID` separates it from BT-110, so match on that. */
function amountInCurrency(scope: string | undefined, currency: string): string | undefined {
  if (scope === undefined) return undefined;
  const re = new RegExp(
    `<ram:TaxTotalAmount\\s[^>]*currencyID="${escapeRe(currency)}"[^>]*>([^<]*)<`,
  );
  return re.exec(scope)?.[1];
}

/** BG-14 / BG-26, the service period - a §14 Abs. 4 Nr. 6 UStG field. */
function parsePeriod(scope: string | undefined): { start: string; end: string } | undefined {
  const p = inner(scope, "ram:BillingSpecifiedPeriod");
  if (!p) return undefined;
  const start = date(inner(p, "ram:StartDateTime"));
  const end = date(inner(p, "ram:EndDateTime"));
  return start && end ? { start, end } : undefined;
}

/** A reference that shares `AdditionalReferencedDocument` with its neighbours; told apart by code. */
function typedRef(scope: string | undefined, typeCode: string): string | undefined {
  for (const d of innerAll(scope, "ram:AdditionalReferencedDocument")) {
    if (val(d, "ram:TypeCode") === typeCode) return val(d, "ram:IssuerAssignedID");
  }
  return undefined;
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
    identifier: partyId(s), // BT-29
    tradingName: val(org, "ram:TradingBusinessName"),
    legalRegistrationId: val(org, "ram:ID"),
    additionalLegalInfo: val(s, "ram:Description"), // BT-33
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
    identifier: partyId(s), // BT-46
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
  const agreement = inner(s, "ram:SpecifiedLineTradeAgreement");
  const product = inner(s, "ram:SpecifiedTradeProduct") ?? "";
  const price = inner(s, "ram:NetPriceProductTradePrice") ?? "";
  const del = inner(s, "ram:SpecifiedLineTradeDelivery") ?? "";
  const lineSettlement = inner(s, "ram:SpecifiedLineTradeSettlement");
  const tax = inner(lineSettlement, "ram:ApplicableTradeTax") ?? "";
  const lineVat = {
    category: (val(tax, "ram:CategoryCode") ?? "S") as VatCategory,
    ratePercent: num(val(tax, "ram:RateApplicablePercent")),
  };
  const lineAC = innerAll(lineSettlement, "ram:SpecifiedTradeAllowanceCharge").map(
    (ac) => ({ ...parseAllowanceCii(ac), vat: lineVat }), // BG-27 / BG-28
  );
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
    period: parsePeriod(lineSettlement), // BG-26
    allowancesCharges: lineAC.length ? lineAC : undefined,
    originCountry: val(inner(product, "ram:OriginTradeCountry"), "ram:ID"), // BT-159
    orderLineRef: val(inner(agreement, "ram:BuyerOrderReferencedDocument"), "ram:LineID"), // BT-132
    objectRef: typedRef(lineSettlement, "130"), // BT-128
    buyerAccountingRef: val(
      inner(lineSettlement, "ram:ReceivableSpecifiedTradeAccountingAccount"),
      "ram:ID",
    ), // BT-133
  };
}

/** A document-level allowance (discount) or charge (surcharge), BG-20 / BG-21. */
function parseAllowanceCii(ac: string): AllowanceCharge {
  const cat = inner(ac, "ram:CategoryTradeTax");
  // BT-93/94 (and BT-137/138) - both halves, or re-emitting drops the rate.
  const percent = val(ac, "ram:CalculationPercent");
  const basis = val(ac, "ram:BasisAmount");
  return {
    isCharge: val(inner(ac, "ram:ChargeIndicator"), "udt:Indicator") === "true",
    amount: num(val(ac, "ram:ActualAmount")),
    ...(percent !== undefined && basis !== undefined
      ? { percent: num(percent), baseAmount: num(basis) }
      : {}),
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

/**
 * Skonto out of BT-20, which holds the human terms and one `#SKONTO#…#` line per tier.
 * `BASISBETRAG` is carried only when present - defaulting it would add a segment on re-emit.
 */
function parseSkonto(description: string | undefined): {
  terms?: string;
  cashDiscounts?: CashDiscount[];
} {
  if (!description) return {};
  const lines = description.split("\n");
  const human = lines.filter((l) => !l.startsWith("#SKONTO#"));
  const discounts: CashDiscount[] = [];
  for (const l of lines) {
    if (!l.startsWith("#SKONTO#")) continue;
    const days = /#TAGE=(-?[\d.]+)#/.exec(l)?.[1];
    const percent = /#PROZENT=(-?[\d.]+)#/.exec(l)?.[1];
    const base = /#BASISBETRAG=(-?[\d.]+)#/.exec(l)?.[1];
    if (days === undefined || percent === undefined) continue;
    discounts.push({
      days: num(days),
      percent: num(percent),
      ...(base !== undefined ? { baseAmount: num(base) } : {}),
    });
  }
  return {
    terms: human.length ? human.join("\n") : undefined,
    cashDiscounts: discounts.length ? discounts : undefined,
  };
}

/** BG-24. Shares its element with BT-17 and BT-18; `TypeCode` 916 is the supporting document. */
function parseSupportingDocuments(agr: string): SupportingDocument[] | undefined {
  const out: SupportingDocument[] = [];
  for (const d of innerAll(agr, "ram:AdditionalReferencedDocument")) {
    if (val(d, "ram:TypeCode") !== "916") continue;
    const b64 = val(d, "ram:AttachmentBinaryObject");
    const mimeType = attr(d, "ram:AttachmentBinaryObject", "mimeCode");
    const filename = attr(d, "ram:AttachmentBinaryObject", "filename");
    out.push({
      reference: val(d, "ram:IssuerAssignedID") ?? "",
      description: val(d, "ram:Name"),
      url: val(d, "ram:URIID"),
      ...(b64 !== undefined && mimeType && filename
        ? { file: { content: new Uint8Array(Buffer.from(b64, "base64")), mimeType, filename } }
        : {}),
    });
  }
  return out.length ? out : undefined;
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
          locationId: partyId(shipTo), // BT-71
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
  const paymentReference = val(set, "ram:PaymentReference"); // BT-83, emitted on its own
  const skonto = parseSkonto(val(terms, "ram:Description")); // BT-20 carries two things at once
  // BG-19 sits in three CII blocks: mandate in the terms, account in the means, creditor in the head.
  const mandateReference = val(terms, "ram:DirectDebitMandateID"); // BT-89
  const creditorId = val(set, "ram:CreditorReferenceID"); // BT-90
  const debitedIban = val(inner(pm, "ram:PayerPartyDebtorFinancialAccount"), "ram:IBANID"); // BT-91
  const payment: Payment | undefined =
    pm || terms || paymentReference
      ? {
          meansCode: val(pm, "ram:TypeCode"),
          meansText: val(pm, "ram:Information"),
          reference: paymentReference,
          iban: val(acct, "ram:IBANID"),
          accountName: val(acct, "ram:AccountName"),
          bic: val(inst, "ram:BICID"),
          terms: skonto.terms,
          cashDiscounts: skonto.cashDiscounts,
          ...(mandateReference
            ? { directDebit: { mandateReference, creditorId, debitedIban } }
            : {}),
        }
      : undefined;
  const payeeParty = inner(set, "ram:PayeeTradeParty");
  const precedingInvoices: PrecedingInvoice[] = innerAll(set, "ram:InvoiceReferencedDocument").map(
    (d) => ({
      number: val(d, "ram:IssuerAssignedID") ?? "", // BT-25
      issueDate: qdtDate(inner(d, "ram:FormattedIssueDateTime")), // BT-26
    }),
  );
  const totals = inner(set, "ram:SpecifiedTradeSettlementHeaderMonetarySummation");
  const paid = val(totals, "ram:TotalPrepaidAmount");
  const rounding = val(totals, "ram:RoundingAmount"); // BT-114
  // BT-6/BT-111: the second TaxTotalAmount, told apart from BT-110 only by its currencyID.
  const taxCurrency = val(set, "ram:TaxCurrencyCode");
  const inTaxCurrency = taxCurrency ? amountInCurrency(totals, taxCurrency) : undefined;
  const taxTotalInTaxCurrency = inTaxCurrency !== undefined ? num(inTaxCurrency) : undefined;
  const allowancesCharges = innerAll(set, "ram:SpecifiedTradeAllowanceCharge").map(
    parseAllowanceCii,
  );

  return {
    number: val(header, "ram:ID") ?? "",
    issueDate: date(inner(header, "ram:IssueDateTime")) ?? "",
    type: type && type !== 380 ? (type as InvoiceTypeCode) : undefined,
    currency: val(set, "ram:InvoiceCurrencyCode") ?? "",
    dueDate: date(inner(terms, "ram:DueDateDateTime")),
    taxCurrency, // BT-6
    taxTotalInTaxCurrency, // BT-111
    buyerReference: val(agr, "ram:BuyerReference"),
    purchaseOrderRef: val(inner(agr, "ram:BuyerOrderReferencedDocument"), "ram:IssuerAssignedID"),
    salesOrderRef: val(inner(agr, "ram:SellerOrderReferencedDocument"), "ram:IssuerAssignedID"), // BT-14
    contractRef: val(inner(agr, "ram:ContractReferencedDocument"), "ram:IssuerAssignedID"),
    projectRef: val(inner(agr, "ram:SpecifiedProcuringProject"), "ram:ID"), // BT-11
    tenderRef: typedRef(agr, "50"), // BT-17
    objectRef: typedRef(agr, "130"), // BT-18
    buyerAccountingRef: val(inner(set, "ram:ReceivableSpecifiedTradeAccountingAccount"), "ram:ID"), // BT-19
    notes: notes.length ? notes : undefined,
    noteSubjectCode: val(innerAll(header, "ram:IncludedNote")[0], "ram:SubjectCode"), // BT-21
    precedingInvoices: precedingInvoices.length ? precedingInvoices : undefined, // BG-3
    supportingDocuments: parseSupportingDocuments(agr), // BG-24
    seller: parseSeller(inner(agr, "ram:SellerTradeParty") ?? ""),
    buyer: parseBuyer(inner(agr, "ram:BuyerTradeParty") ?? ""),
    delivery,
    period: parsePeriod(set), // BG-14
    payeeName: val(payeeParty, "ram:Name"),
    payeeIdentifier: partyId(payeeParty), // BT-60
    payeeLegalRegistrationId: val(inner(payeeParty, "ram:SpecifiedLegalOrganization"), "ram:ID"), // BT-61
    lines: innerAll(tx, "ram:IncludedSupplyChainTradeLineItem").map(parseLine),
    allowancesCharges: allowancesCharges.length ? allowancesCharges : undefined,
    vatExemptionReasons: exemptionsCii(set),
    payment,
    paidAmount: paid ? num(paid) : undefined,
    roundingAmount: rounding !== undefined ? num(rounding) : undefined, // BT-114
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

/** BT-90. Shares `cac:PartyIdentification` with BT-29; only `schemeID="SEPA"` tells them apart. */
function sepaPartyId(scope: string | undefined): string | undefined {
  if (scope === undefined) return undefined;
  const m = /<cbc:ID schemeID="SEPA">([^<]*)<\/cbc:ID>/.exec(scope);
  return m ? unesc(m[1]) : undefined;
}

function parsePartyUbl(scope: string) {
  const party = inner(scope, "cac:Party") ?? "";
  const legal = inner(party, "cac:PartyLegalEntity");
  return {
    party,
    // BT-29 / BT-46 - skipping the SEPA-scheme entry, which is BT-90 in the same element.
    identifier: innerAll(party, "cac:PartyIdentification")
      .map((pi) => (/schemeID="SEPA"/.test(pi) ? undefined : val(pi, "cbc:ID")))
      .find((v) => v !== undefined),
    name: val(legal, "cbc:RegistrationName") ?? "",
    tradingName: val(inner(party, "cac:PartyName"), "cbc:Name"),
    legalRegistrationId: val(legal, "cbc:CompanyID"),
    additionalLegalInfo: val(legal, "cbc:CompanyLegalForm"), // BT-33
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
  // Only the ones INSIDE this line - `cac:AllowanceCharge` before the item (BG-27 / BG-28).
  const itemAt = s.indexOf("<cac:Item");
  const lineVat = {
    category: (val(tax, "cbc:ID") ?? "S") as VatCategory,
    ratePercent: num(val(tax, "cbc:Percent")),
  };
  const lineAC = innerAll(itemAt >= 0 ? s.slice(0, itemAt) : s, "cac:AllowanceCharge").map(
    (ac) => ({ ...parseAllowanceUbl(ac), vat: lineVat }), // BG-27 / BG-28
  );
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
    allowancesCharges: lineAC.length ? lineAC : undefined,
    period: periodUbl(s), // BG-26
    buyerAccountingRef: val(s, "cbc:AccountingCost"), // BT-133
    orderLineRef: val(inner(s, "cac:OrderLineReference"), "cbc:LineID"), // BT-132
    objectRef: val(inner(s, "cac:DocumentReference"), "cbc:ID"), // BT-128
    originCountry: val(inner(item, "cac:OriginCountry"), "cbc:IdentificationCode"), // BT-159
  };
}

/** BG-14 / BG-26 in UBL - plain ISO dates, no 102 format. */
function periodUbl(scope: string | undefined): { start: string; end: string } | undefined {
  const p = inner(scope, "cac:InvoicePeriod");
  const start = val(p, "cbc:StartDate");
  const end = val(p, "cbc:EndDate");
  return start && end ? { start, end } : undefined;
}

function parseAllowanceUbl(ac: string): AllowanceCharge {
  const cat = inner(ac, "cac:TaxCategory");
  const percent = val(ac, "cbc:MultiplierFactorNumeric");
  const basis = val(ac, "cbc:BaseAmount");
  return {
    isCharge: val(ac, "cbc:ChargeIndicator") === "true",
    amount: num(val(ac, "cbc:Amount")),
    ...(percent !== undefined && basis !== undefined
      ? { percent: num(percent), baseAmount: num(basis) }
      : {}), // BT-93/94, BT-137/138
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

  const payeeUbl = inner(xml, "cac:PayeeParty");
  const seller = parsePartyUbl(inner(xml, "cac:AccountingSupplierParty") ?? "");
  const buyer = parsePartyUbl(inner(xml, "cac:AccountingCustomerParty") ?? "");
  const type = num(val(head, "cbc:InvoiceTypeCode"));
  // BT-21 has no UBL element; the binding prefixes the note with #CODE#. Strip it, or the note grows
  // by one prefix per round-trip.
  const rawNotes = innerAll(head, "cbc:Note")
    .map(unesc)
    .filter((n) => n.length > 0);
  const noteSubjectCode = /^#([A-Za-z0-9]+)#/.exec(rawNotes[0] ?? "")?.[1];
  // Only the prefix that IS the subject code: a note legitimately starting with some other #TAG#
  // keeps it, and so does one whose prefix differs from the first note's.
  const prefix = noteSubjectCode ? `#${noteSubjectCode}#` : undefined;
  const notes = rawNotes.map((n) => (prefix && n.startsWith(prefix) ? n.slice(prefix.length) : n));

  const del = inner(xml, "cac:Delivery");
  const dLoc = inner(del, "cac:DeliveryLocation");
  const deliveryDate = val(del, "cbc:ActualDeliveryDate"); // UBL dates are plain ISO, no 102 format
  const dParty = inner(del, "cac:DeliveryParty");
  const delivery =
    del && (deliveryDate || dParty || dLoc)
      ? {
          date: deliveryDate,
          locationId: val(dLoc, "cbc:ID"), // BT-71
          recipientName: val(inner(dParty, "cac:PartyName"), "cbc:Name"),
          // `cac:Address`, not `cac:PostalAddress` - a LocationType holds the one, a Party the other.
          address: inner(dLoc, "cac:Address")
            ? parseAddressUbl(inner(dLoc, "cac:Address")!)
            : undefined,
        }
      : undefined;

  const pm = inner(xml, "cac:PaymentMeans");
  const acct = inner(pm, "cac:PayeeFinancialAccount");
  const terms = inner(xml, "cac:PaymentTerms");
  const skonto = parseSkonto(val(terms, "cbc:Note")); // BT-20 carries two things at once
  // BG-19. UBL keeps the mandate together but hangs the creditor id on the seller party.
  const mandate = inner(pm, "cac:PaymentMandate");
  const mandateReference = val(mandate, "cbc:ID"); // BT-89
  const creditorId = sepaPartyId(inner(xml, "cac:AccountingSupplierParty")); // BT-90
  const debitedIban = val(inner(mandate, "cac:PayerFinancialAccount"), "cbc:ID"); // BT-91
  const payment: Payment | undefined =
    pm || terms
      ? {
          meansCode: val(pm, "cbc:PaymentMeansCode"),
          meansText: attr(pm, "cbc:PaymentMeansCode", "name"), // BT-82 is an attribute here
          reference: val(pm, "cbc:PaymentID"),
          iban: val(acct, "cbc:ID"),
          accountName: val(acct, "cbc:Name"),
          bic: val(inner(acct, "cac:FinancialInstitutionBranch"), "cbc:ID"),
          terms: skonto.terms,
          cashDiscounts: skonto.cashDiscounts,
          ...(mandateReference
            ? { directDebit: { mandateReference, creditorId, debitedIban } }
            : {}),
        }
      : undefined;
  const monetary = inner(xml, "cac:LegalMonetaryTotal");
  const paid = val(monetary, "cbc:PrepaidAmount");
  const rounding = val(monetary, "cbc:PayableRoundingAmount"); // BT-114
  // BT-111 is a SECOND cac:TaxTotal carrying only an amount - the first one has the breakdown. Scoped
  // to before the lines: a LINE-level TaxTotal has no subtotal either and would be mistaken for it.
  const beforeLines = xml.indexOf("<cac:InvoiceLine");
  const taxTotals = innerAll(beforeLines >= 0 ? xml.slice(0, beforeLines) : xml, "cac:TaxTotal");
  const secondTaxTotal = taxTotals.find((t) => !t.includes("<cac:TaxSubtotal"));
  const taxTotalInTaxCurrency =
    secondTaxTotal !== undefined ? num(val(secondTaxTotal, "cbc:TaxAmount")) : undefined;

  const precedingInvoices: PrecedingInvoice[] = innerAll(head, "cac:BillingReference").map((b) => {
    const d = inner(b, "cac:InvoiceDocumentReference");
    return { number: val(d, "cbc:ID") ?? "", issueDate: val(d, "cbc:IssueDate") }; // BT-25 / BT-26
  });

  // BG-24 and BT-18 share cac:AdditionalDocumentReference; the object reference carries a type code.
  const additional = innerAll(head, "cac:AdditionalDocumentReference");
  const objectRefUbl = additional.find((d) => val(d, "cbc:DocumentTypeCode") === "130")
    ? val(
        additional.find((d) => val(d, "cbc:DocumentTypeCode") === "130"),
        "cbc:ID",
      )
    : undefined;
  const supportingDocuments: SupportingDocument[] = additional
    .filter((d) => val(d, "cbc:DocumentTypeCode") !== "130")
    .map((d) => {
      const att = inner(d, "cac:Attachment");
      const b64 = val(att, "cbc:EmbeddedDocumentBinaryObject");
      const mimeType = attr(att, "cbc:EmbeddedDocumentBinaryObject", "mimeCode");
      const filename = attr(att, "cbc:EmbeddedDocumentBinaryObject", "filename");
      return {
        reference: val(d, "cbc:ID") ?? "",
        description: val(d, "cbc:DocumentDescription"),
        url: val(inner(att, "cac:ExternalReference"), "cbc:URI"),
        ...(b64 !== undefined && mimeType && filename
          ? { file: { content: new Uint8Array(Buffer.from(b64, "base64")), mimeType, filename } }
          : {}),
      };
    });
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
    taxCurrency: val(head, "cbc:TaxCurrencyCode"), // BT-6
    taxTotalInTaxCurrency, // BT-111
    buyerReference: val(head, "cbc:BuyerReference"),
    buyerAccountingRef: val(head, "cbc:AccountingCost"), // BT-19
    purchaseOrderRef: val(inner(head, "cac:OrderReference"), "cbc:ID"),
    salesOrderRef: val(inner(head, "cac:OrderReference"), "cbc:SalesOrderID"), // BT-14
    contractRef: val(inner(head, "cac:ContractDocumentReference"), "cbc:ID"),
    projectRef: val(inner(head, "cac:ProjectReference"), "cbc:ID"), // BT-11
    tenderRef: val(inner(head, "cac:OriginatorDocumentReference"), "cbc:ID"), // BT-17
    objectRef: objectRefUbl, // BT-18
    notes: notes.length ? notes : undefined,
    noteSubjectCode,
    precedingInvoices: precedingInvoices.length ? precedingInvoices : undefined, // BG-3
    supportingDocuments: supportingDocuments.length ? supportingDocuments : undefined, // BG-24
    seller: {
      name: seller.name,
      identifier: seller.identifier, // BT-29
      tradingName: seller.tradingName,
      legalRegistrationId: seller.legalRegistrationId,
      additionalLegalInfo: seller.additionalLegalInfo, // BT-33
      vatId: seller.vatId,
      taxNumber: ublTaxId(seller.party, "FC"),
      electronicAddress: seller.electronicAddress,
      address: seller.address,
      contact: seller.contact,
    },
    buyer: {
      name: buyer.name,
      identifier: buyer.identifier, // BT-46
      tradingName: buyer.tradingName,
      legalRegistrationId: buyer.legalRegistrationId,
      vatId: buyer.vatId,
      electronicAddress: buyer.electronicAddress,
      address: buyer.address,
      contact: buyer.contact,
    },
    delivery,
    period: periodUbl(head), // BG-14
    payeeName: val(inner(payeeUbl, "cac:PartyName"), "cbc:Name"),
    payeeIdentifier: val(inner(payeeUbl, "cac:PartyIdentification"), "cbc:ID"), // BT-60
    payeeLegalRegistrationId: val(inner(payeeUbl, "cac:PartyLegalEntity"), "cbc:CompanyID"), // BT-61
    lines: innerAll(xml, "cac:InvoiceLine").map(parseLineUbl),
    allowancesCharges: allowancesCharges.length ? allowancesCharges : undefined,
    vatExemptionReasons: exemptionsUbl(xml),
    payment,
    paidAmount: paid !== undefined ? num(paid) : undefined,
    roundingAmount: rounding !== undefined ? num(rounding) : undefined, // BT-114
  };
}

/** Parse e-invoice XML into the Invoice model, picking CII/UBL from what it is. */
export function parseInvoice(xml: string): Invoice {
  const { syntax } = detectInvoice(xml);
  if (syntax === "UBL") return parseUBL(xml);
  if (syntax === "CII") return parseCII(xml);
  throw new Error(`${syntax} parsing is not implemented yet`);
}
