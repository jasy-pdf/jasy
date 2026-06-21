// The Invoice data model - the public API of @jasy/zugferd and the single source that drives
// both the CII XML and the rendered PDF. It mirrors the EN-16931 semantic model: every field is
// annotated with its Business Term (BT-xx) / Business Group (BG-xx) so the mapping to the standard
// is traceable and reviewable. Target: ZUGFeRD 2.x / Factur-X, profile EN16931 (COMFORT).
//
// DESIGN - provide inputs, we compute the maths. The user supplies line items, prices, VAT rates
// and (optional) allowances/charges; the generator DERIVES the line net amounts (BG-25 BT-131),
// the document totals (BG-22, BT-106…BT-115) and the VAT breakdown (BG-23, BT-116…BT-121) with
// spec-correct rounding. That makes the totals consistent BY CONSTRUCTION - the single biggest
// class of validation failures (BR-CO-* total checks) can't happen. (A future option may let an
// accounting system pass its own totals to assert against ours.)
//
// Scope: this first model covers every MANDATORY EN16931 term plus the fields a real invoice needs.
// Deferred (addable later, none block a valid EN16931 invoice): tax representative (BG-11/12),
// payment card / direct debit (BG-18/BG-19), item attributes (BG-32), item classification (BT-158),
// preceding-invoice references (BG-3), per-line object/order references.

/** ISO 8601 calendar date, `"YYYY-MM-DD"` (e.g. BT-2 issue date). */
export type IsoDate = string;
/** ISO 4217 currency code, e.g. `"EUR"` (BT-5). */
export type CurrencyCode = string;
/** ISO 3166-1 alpha-2 country code, e.g. `"DE"` (BT-40 / BT-55). */
export type CountryCode = string;
/** UN/ECE Rec 20 unit-of-measure code, e.g. `"C62"` (one/piece), `"HUR"` (hour), `"KGM"` (kg). */
export type UnitCode = string;

/**
 * VAT category code (UNCL 5305 subset bound by EN-16931). The rate (%) belongs WITH the category
 * on each line; for non-standard categories an exemption reason is usually required (BT-120/121).
 */
export type VatCategory =
  | "S" // Standard rate
  | "Z" // Zero rated goods
  | "E" // Exempt from VAT
  | "AE" // VAT reverse charge
  | "K" // Intra-community supply (goods/services to another EU member state)
  | "G" // Export outside the EU
  | "O" // Services outside scope of tax
  | "L" // Canary Islands general indirect tax
  | "M"; // Tax for production, services and importation in Ceuta and Melilla

/** Invoice type code (UNCL 1001). The common two; more exist. */
export type InvoiceTypeCode =
  | 380 // Commercial invoice
  | 381; // Credit note

/** A postal address (BG-5 seller / BG-8 buyer / delivery). Only the country code is mandatory. */
export interface PostalAddress {
  line1?: string; // BT-35 / BT-50  address line 1
  line2?: string; // BT-36 / BT-51  address line 2
  line3?: string; // BT-162 / BT-163 address line 3
  city?: string; // BT-37 / BT-52
  postCode?: string; // BT-38 / BT-53
  /** Region / county / state (BT-39 / BT-54). */
  subdivision?: string;
  country: CountryCode; // BT-40 / BT-55  (MANDATORY)
}

/** A contact point on a party (BG-6 seller contact / BG-9 buyer contact). All optional. */
export interface Contact {
  name?: string; // BT-41 / BT-56
  phone?: string; // BT-42 / BT-57
  email?: string; // BT-43 / BT-58
}

/** The seller / supplier (BG-4 + address BG-5 + contact BG-6). */
export interface Seller {
  name: string; // BT-27  (MANDATORY) registered legal name
  tradingName?: string; // BT-28  business/trading name if different
  /** Seller VAT identifier, e.g. `"DE123456789"` (BT-31). Needed whenever VAT is charged. */
  vatId?: string;
  /** Tax registration identifier / Steuernummer (BT-32) - alternative/additional to the VAT ID. */
  taxNumber?: string;
  /** Legal registration id, e.g. Handelsregisternummer (BT-30). */
  legalRegistrationId?: string;
  /** Free-text legal footer info, e.g. share capital, managing director (BT-33). */
  additionalLegalInfo?: string;
  /** Electronic address (BT-34), e.g. an email or Peppol id. Required by XRechnung/Peppol. */
  electronicAddress?: string;
  address: PostalAddress; // BG-5  (MANDATORY)
  contact?: Contact; // BG-6
}

/** The buyer / customer (BG-7 + address BG-8 + contact BG-9). */
export interface Buyer {
  name: string; // BT-44  (MANDATORY)
  tradingName?: string; // BT-45
  /** Buyer VAT identifier (BT-48) - required e.g. for reverse-charge / intra-community supply. */
  vatId?: string;
  /** Buyer legal registration id (BT-47). */
  legalRegistrationId?: string;
  /** Buyer electronic address (BT-49). Required by XRechnung/Peppol. */
  electronicAddress?: string;
  address: PostalAddress; // BG-8  (MANDATORY)
  contact?: Contact; // BG-9
}

/** Where the goods/services were delivered (BG-13). Optional; used when it differs from the buyer. */
export interface Delivery {
  date?: IsoDate; // BT-72  actual delivery date
  recipientName?: string; // BT-70  deliver-to party name
  address?: PostalAddress; // BG-15 deliver-to address
}

/** A document-level allowance (discount, BG-20) or charge (surcharge, BG-21). */
export interface AllowanceCharge {
  /** `true` = charge (adds, BG-21), `false` = allowance/discount (subtracts, BG-20). */
  isCharge: boolean;
  amount: number; // BT-92 (allowance) / BT-99 (charge)  (MANDATORY)
  /** The VAT category + rate this allowance/charge falls under (BT-95/96 or BT-102/103). */
  vat: LineVat;
  reason?: string; // BT-97 / BT-104  human reason
  /** Coded reason (UNCL 5189 allowance / UNCL 7161 charge), BT-98 / BT-105. */
  reasonCode?: string;
}

/** VAT treatment of a line / allowance / charge: a category and (for taxed categories) a rate. */
export interface LineVat {
  category: VatCategory; // BT-151 (line) / BT-95 / BT-102  (MANDATORY)
  /** VAT rate in percent, e.g. `19` (BT-152 / BT-96 / BT-103). Omit/0 for Z/E/AE/K/G/O. */
  ratePercent?: number;
}

/**
 * Why a VAT category carries no (or 0%) tax (BT-120 text / BT-121 code), e.g. reverse charge.
 * EN-16931 requires this on the VAT breakdown for the non-standard categories (E/AE/K/G/O…) -
 * given per category here and emitted onto each matching BG-23 group by the generator.
 */
export interface VatExemptionReason {
  text?: string; // BT-120, e.g. "Reverse charge - Steuerschuldnerschaft des Leistungsempfängers (§13b UStG)"
  code?: string; // BT-121 (VATEX code list), e.g. "VATEX-EU-AE"
}

/** One invoice line (BG-25) with its item (BG-31), price (BG-29) and VAT (BG-30). */
export interface InvoiceLine {
  /** Stable line id (BT-126). If omitted the generator numbers lines "1", "2", … */
  id?: string;
  name: string; // BT-153  (MANDATORY) item name
  description?: string; // BT-154
  /** Seller's / buyer's / standard (GTIN) item ids (BT-155 / BT-156 / BT-157). */
  sellerItemId?: string;
  buyerItemId?: string;
  standardItemId?: string; // GTIN/EAN
  quantity: number; // BT-129  (MANDATORY)
  unit: UnitCode; // BT-130  (MANDATORY)
  /** Net price of one unit, before line allowances/charges (BT-146)  (MANDATORY). */
  netUnitPrice: number;
  /** Quantity the net price refers to (BT-149), default 1 - e.g. price "per 100". */
  priceBaseQuantity?: number;
  vat: LineVat; // BG-30  (MANDATORY)
  /** Per-line allowances/charges (BG-27 / BG-28). Net line amount BT-131 is computed from these. */
  allowancesCharges?: AllowanceCharge[];
  note?: string; // BT-127
}

/** How the invoice is to be paid (BG-16 + credit transfer BG-17). */
export interface Payment {
  /** Payment means code (UNCL 4461), e.g. `58` SEPA credit transfer, `30` credit transfer (BT-81). */
  meansCode?: string;
  /** Free-text means description (BT-82). */
  meansText?: string;
  /** Remittance / payment reference shown to the payer, e.g. the invoice no. (BT-83). */
  reference?: string;
  /** IBAN of the account to pay into (BT-84). */
  iban?: string;
  /** Account holder name (BT-85). */
  accountName?: string;
  /** BIC of the payee bank (BT-86). */
  bic?: string;
  /** Free-text payment terms, e.g. "Zahlbar innerhalb 14 Tagen netto" (BT-20). */
  terms?: string;
}

/** The complete invoice - the single input to `renderZugferd(invoice, …)`. */
export interface Invoice {
  /** Invoice number (BT-1)  (MANDATORY). */
  number: string;
  /** Issue date (BT-2)  (MANDATORY). */
  issueDate: IsoDate;
  /** Invoice type code (BT-3), default 380 commercial invoice. */
  type?: InvoiceTypeCode;
  /** Document currency (BT-5)  (MANDATORY). */
  currency: CurrencyCode;
  /** Payment due date (BT-9). */
  dueDate?: IsoDate;
  /**
   * Buyer reference (BT-10). For German B2G (XRechnung) this carries the **Leitweg-ID** and is
   * mandatory; for B2B ZUGFeRD it's optional.
   */
  buyerReference?: string;
  /** Seller order/contract references: purchase order (BT-13), contract (BT-12). */
  purchaseOrderRef?: string;
  contractRef?: string;
  /** Free-text document notes (BG-1 / BT-22). */
  notes?: string[];

  seller: Seller; // BG-4  (MANDATORY)
  buyer: Buyer; // BG-7  (MANDATORY)
  delivery?: Delivery; // BG-13
  /** Payee if different from the seller (BG-10). */
  payeeName?: string; // BT-59

  /** The invoice lines (BG-25)  (MANDATORY, at least one). */
  lines: InvoiceLine[];
  /** Document-level allowances/charges (BG-20 / BG-21), applied after the line sum. */
  allowancesCharges?: AllowanceCharge[];

  /**
   * Exemption reason per non-standard VAT category (BT-120/121), e.g. `{ AE: { text, code } }`.
   * Required by EN-16931 for E/AE/K/G/O categories; the generator puts it on the BG-23 group.
   */
  vatExemptionReasons?: Partial<Record<VatCategory, VatExemptionReason>>;

  payment?: Payment; // BG-16

  /** Amount already paid (BT-113), subtracted from the total to give the amount due (BT-115). */
  paidAmount?: number;
}
