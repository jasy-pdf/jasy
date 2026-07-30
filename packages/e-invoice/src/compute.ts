import {
  AllowanceCharge,
  Invoice,
  InvoiceLine,
  VatCategory,
  VatExemptionReason,
} from "./invoice.ts";

// Derives every monetary amount of an invoice from its inputs, so the EN-16931 total/VAT checks
// (BR-CO-*) hold by construction. All amounts are rounded to 2 decimals (BR-DEC-*); rounding is
// half-up with an epsilon guard against binary-float drift (e.g. 1.005 → 1.01).

/** Round to 2 decimals, half-up, guarding against float drift. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** One VAT breakdown group (BG-23), keyed by category + rate. */
export interface VatBreakdownEntry {
  category: VatCategory; // BT-118
  ratePercent: number; // BT-119 (0 for untaxed categories)
  taxableAmount: number; // BT-116
  taxAmount: number; // BT-117
  exemption?: VatExemptionReason; // BT-120 / BT-121
}

/** All amounts derived from an `Invoice` - what the CII emitter writes for BG-22 / BG-23 / BT-131. */
export interface ComputedInvoice {
  lineNets: number[]; // BT-131 per line (parallel to invoice.lines)
  lineTotal: number; // BT-106  sum of line nets
  allowanceTotal: number; // BT-107  sum of document allowances
  chargeTotal: number; // BT-108  sum of document charges
  taxBasisTotal: number; // BT-109  = lineTotal - allowanceTotal + chargeTotal
  taxTotal: number; // BT-110  sum of VAT group tax amounts
  grandTotal: number; // BT-112  = taxBasisTotal + taxTotal
  paidAmount: number; // BT-113
  duePayable: number; // BT-115  = grandTotal - paidAmount
  vatBreakdown: VatBreakdownEntry[]; // BG-23
}

/** Net amount of one line (BT-131): quantity × unit price (per base qty), then line allowances/charges. */
function lineNet(line: InvoiceLine): number {
  const base = line.priceBaseQuantity && line.priceBaseQuantity > 0 ? line.priceBaseQuantity : 1;
  const gross = line.quantity * (line.netUnitPrice / base);
  const adjustment = (line.allowancesCharges ?? []).reduce(
    (sum, ac) => sum + (ac.isCharge ? ac.amount : -ac.amount),
    0,
  );
  return round2(gross + adjustment);
}

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const vatKey = (category: VatCategory, rate: number) => `${category}@${rate}`;

export function computeInvoice(invoice: Invoice): ComputedInvoice {
  const lineNets = invoice.lines.map(lineNet);
  const lineTotal = round2(sum(lineNets));

  const docAC: AllowanceCharge[] = invoice.allowancesCharges ?? [];
  const allowanceTotal = round2(sum(docAC.filter((a) => !a.isCharge).map((a) => a.amount)));
  const chargeTotal = round2(sum(docAC.filter((a) => a.isCharge).map((a) => a.amount)));

  // BG-23: group by (category, rate). Taxable = matching line nets ± matching document-level
  // allowances/charges. The tax of each group is taxable × rate.
  const groups = new Map<string, VatBreakdownEntry>();
  const groupFor = (category: VatCategory, rate: number): VatBreakdownEntry => {
    const key = vatKey(category, rate);
    let group = groups.get(key);
    if (!group) {
      group = { category, ratePercent: rate, taxableAmount: 0, taxAmount: 0 };
      groups.set(key, group);
    }
    return group;
  };
  invoice.lines.forEach((line, i) => {
    groupFor(line.vat.category, line.vat.ratePercent ?? 0).taxableAmount += lineNets[i];
  });
  docAC.forEach((ac) => {
    const group = groupFor(ac.vat.category, ac.vat.ratePercent ?? 0);
    group.taxableAmount += ac.isCharge ? ac.amount : -ac.amount;
  });

  const vatBreakdown: VatBreakdownEntry[] = [...groups.values()].map((g) => {
    const taxableAmount = round2(g.taxableAmount);
    const exemption = invoice.vatExemptionReasons?.[g.category];
    return {
      category: g.category,
      ratePercent: g.ratePercent,
      taxableAmount,
      taxAmount: round2((taxableAmount * g.ratePercent) / 100),
      ...(exemption ? { exemption } : {}),
    };
  });

  const taxBasisTotal = round2(lineTotal - allowanceTotal + chargeTotal);
  const taxTotal = round2(sum(vatBreakdown.map((g) => g.taxAmount)));
  const grandTotal = round2(taxBasisTotal + taxTotal);
  const paidAmount = round2(invoice.paidAmount ?? 0);
  const duePayable = round2(grandTotal - paidAmount);

  return {
    lineNets,
    lineTotal,
    allowanceTotal,
    chargeTotal,
    taxBasisTotal,
    taxTotal,
    grandTotal,
    paidAmount,
    duePayable,
    vatBreakdown,
  };
}
