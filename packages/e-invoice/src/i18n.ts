// Invoice-template localisation: the visible LABELS (template chrome) plus locale-aware number,
// currency and date formatting. The invoice DATA (names, item texts, addresses) is never translated -
// it stays in whatever language the user supplied. Formatting uses the built-in `Intl` API (ECMA-402,
// no dependency). Default locale is `de` (ZUGFeRD is a German standard / German-market-first).

export type Locale = "de" | "en" | "fr";

/** Every label the default template draws. A custom language = supply a full `InvoiceLabels`. */
export interface InvoiceLabels {
  invoice: string;
  position: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vat: string;
  amount: string;
  subtotal: string;
  allowance: string;
  charge: string;
  netTotal: string;
  plusVat: string;
  grandTotal: string;
  alreadyPaid: string;
  amountDue: string;
  payment: string;
  payableBy: string;
  bankDetails: string;
  remittance: string;
  invoiceNumber: string;
  invoiceDate: string;
  deliveryDate: string;
  dueDate: string;
  customerReference: string;
  orderNumber: string;
  vatId: string;
  taxNumber: string;
  registration: string;
  phone: string;
}

const de: InvoiceLabels = {
  invoice: "Rechnung",
  position: "Pos",
  description: "Beschreibung",
  quantity: "Menge",
  unitPrice: "Einzelpreis",
  vat: "USt",
  amount: "Betrag",
  subtotal: "Summe Positionen",
  allowance: "abzgl. Nachlass",
  charge: "zzgl. Zuschlag",
  netTotal: "Nettobetrag",
  plusVat: "zzgl. USt",
  grandTotal: "Gesamtbetrag",
  alreadyPaid: "bereits gezahlt",
  amountDue: "Zahlbetrag",
  payment: "Zahlung",
  payableBy: "Zahlbar bis",
  bankDetails: "Bankverbindung",
  remittance: "Verwendungszweck",
  invoiceNumber: "Rechnungsnummer",
  invoiceDate: "Rechnungsdatum",
  deliveryDate: "Lieferdatum",
  dueDate: "Fälligkeit",
  customerReference: "Kundenreferenz",
  orderNumber: "Bestellnummer",
  vatId: "USt-IdNr",
  taxNumber: "Steuernr",
  registration: "Reg.",
  phone: "Tel.",
};

const en: InvoiceLabels = {
  invoice: "Invoice",
  position: "No.",
  description: "Description",
  quantity: "Qty",
  unitPrice: "Unit price",
  vat: "VAT",
  amount: "Amount",
  subtotal: "Subtotal",
  allowance: "less discount",
  charge: "plus surcharge",
  netTotal: "Net amount",
  plusVat: "plus VAT",
  grandTotal: "Total",
  alreadyPaid: "already paid",
  amountDue: "Amount due",
  payment: "Payment",
  payableBy: "Payable by",
  bankDetails: "Bank details",
  remittance: "Reference",
  invoiceNumber: "Invoice no.",
  invoiceDate: "Invoice date",
  deliveryDate: "Delivery date",
  dueDate: "Due date",
  customerReference: "Customer reference",
  orderNumber: "Order no.",
  vatId: "VAT ID",
  taxNumber: "Tax no.",
  registration: "Reg.",
  phone: "Tel.",
};

const fr: InvoiceLabels = {
  invoice: "Facture",
  position: "N°",
  description: "Description",
  quantity: "Qté",
  unitPrice: "Prix unitaire",
  vat: "TVA",
  amount: "Montant",
  subtotal: "Sous-total",
  allowance: "remise",
  charge: "majoration",
  netTotal: "Total HT",
  plusVat: "TVA",
  grandTotal: "Total TTC",
  alreadyPaid: "déjà payé",
  amountDue: "Net à payer",
  payment: "Paiement",
  payableBy: "À payer avant le",
  bankDetails: "Coordonnées bancaires",
  remittance: "Référence",
  invoiceNumber: "N° de facture",
  invoiceDate: "Date de facture",
  deliveryDate: "Date de livraison",
  dueDate: "Échéance",
  customerReference: "Référence client",
  orderNumber: "N° de commande",
  vatId: "N° TVA",
  taxNumber: "N° fiscal",
  registration: "Immatriculation",
  phone: "Tél.",
};

const DICTIONARIES: Record<Locale, InvoiceLabels> = { de, en, fr };
const LOCALE_TAG: Record<Locale, string> = { de: "de-DE", en: "en-US", fr: "fr-FR" };

/** The label set for a locale, with optional per-key overrides merged on top. */
export function resolveLabels(
  locale: Locale = "de",
  overrides?: Partial<InvoiceLabels>,
): InvoiceLabels {
  return { ...DICTIONARIES[locale], ...overrides };
}

/** Locale-aware formatters for the amounts, percentages and dates the template prints. */
export interface Formatters {
  /** A currency amount, e.g. de → "1.234,56 €", en → "€1,234.56". */
  money(n: number): string;
  /** A plain number, e.g. a quantity. */
  number(n: number): string;
  /** A VAT rate given in percent (19 → de "19 %", en "19%"). */
  percent(ratePercent: number): string;
  /** An ISO date "YYYY-MM-DD" in the locale's short form (UTC, so no timezone drift). */
  date(iso: string): string;
}

export function makeFormatters(locale: Locale = "de", currency: string): Formatters {
  const tag = LOCALE_TAG[locale];
  const money = new Intl.NumberFormat(tag, { style: "currency", currency });
  const number = new Intl.NumberFormat(tag, { maximumFractionDigits: 2 });
  const percent = new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 2 });
  const date = new Intl.DateTimeFormat(tag, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "UTC",
  });
  return {
    money: (n) => money.format(n),
    number: (n) => number.format(n),
    percent: (ratePercent) => percent.format(ratePercent / 100),
    date: (iso) => date.format(new Date(`${iso}T00:00:00Z`)),
  };
}
