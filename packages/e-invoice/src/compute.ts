import {
  add,
  divide,
  fromNumber,
  multiply,
  negate,
  percentageOf,
  subtract,
  sum,
  type Decimal,
} from "@jasy/decy";
import { acAmount } from "./allowance.ts";
import { cents, MODE, unitPrice } from "./money.ts";
import {
  AllowanceCharge,
  Invoice,
  InvoiceLine,
  VatCategory,
  VatExemptionReason,
} from "./invoice.ts";

// Derives every monetary amount of an invoice from its inputs, so the EN-16931 total/VAT checks
// (BR-CO-*) hold by construction. Exact decimals throughout (see `money.ts`); EN 16931 rounds in
// two places only - each line net (BT-131) and each VAT group's tax (BT-117) - and every total is
// an exact sum of those.

/** One VAT breakdown group (BG-23), keyed by category + rate. */
export interface VatBreakdownEntry {
  category: VatCategory; // BT-118
  ratePercent: number; // BT-119 (0 for untaxed categories)
  taxableAmount: Decimal; // BT-116
  taxAmount: Decimal; // BT-117
  exemption?: VatExemptionReason; // BT-120 / BT-121
}

/** All amounts derived from an `Invoice` - what the CII emitter writes for BG-22 / BG-23 / BT-131. */
export interface ComputedInvoice {
  lineNets: Decimal[]; // BT-131 per line (parallel to invoice.lines)
  lineTotal: Decimal; // BT-106  sum of line nets
  allowanceTotal: Decimal; // BT-107  sum of document allowances
  chargeTotal: Decimal; // BT-108  sum of document charges
  taxBasisTotal: Decimal; // BT-109  = lineTotal - allowanceTotal + chargeTotal
  taxTotal: Decimal; // BT-110  sum of VAT group tax amounts
  grandTotal: Decimal; // BT-112  = taxBasisTotal + taxTotal
  paidAmount: Decimal; // BT-113
  roundingAmount: Decimal; // BT-114  the deliberate cent, 0 when nobody asked for one
  duePayable: Decimal; // BT-115  = grandTotal - paidAmount + roundingAmount
  vatBreakdown: VatBreakdownEntry[]; // BG-23
}

/** An allowance/charge with its sign: what it does to the amount it sits on. */
const signed = (ac: AllowanceCharge): Decimal =>
  ac.isCharge ? acAmount(ac) : negate(acAmount(ac));

/**
 * Net amount of one line (BT-131): quantity x (price / base quantity) + charges - allowances,
 * rounded ONCE. Multiplying the adjustments by the base quantity keeps the division last.
 */
function lineNet(line: InvoiceLine): Decimal {
  const base = fromNumber(
    line.priceBaseQuantity && line.priceBaseQuantity > 0 ? line.priceBaseQuantity : 1,
  );
  const gross = multiply(fromNumber(line.quantity), unitPrice(line.netUnitPrice));
  const adjustment = sum((line.allowancesCharges ?? []).map(signed));
  return divide(add(gross, multiply(adjustment, base)), base, { scale: 2, mode: MODE });
}

const vatKey = (category: VatCategory, rate: number) => `${category}@${rate}`;

export function computeInvoice(invoice: Invoice): ComputedInvoice {
  const lineNets = invoice.lines.map(lineNet);
  const lineTotal = cents(sum(lineNets));

  const docAC: AllowanceCharge[] = invoice.allowancesCharges ?? [];
  const allowanceTotal = cents(sum(docAC.filter((a) => !a.isCharge).map(acAmount)));
  const chargeTotal = cents(sum(docAC.filter((a) => a.isCharge).map(acAmount)));

  // BG-23: group by (category, rate). Taxable = matching line nets +- matching document-level
  // allowances/charges, each already to the cent, so the sum is exact.
  const groups = new Map<
    string,
    { category: VatCategory; ratePercent: number; parts: Decimal[] }
  >();
  const groupFor = (category: VatCategory, rate: number) => {
    const key = vatKey(category, rate);
    let group = groups.get(key);
    if (!group) {
      group = { category, ratePercent: rate, parts: [] };
      groups.set(key, group);
    }
    return group;
  };
  invoice.lines.forEach((line, i) => {
    groupFor(line.vat.category, line.vat.ratePercent ?? 0).parts.push(lineNets[i]!);
  });
  docAC.forEach((ac) => {
    groupFor(ac.vat.category, ac.vat.ratePercent ?? 0).parts.push(signed(ac));
  });

  const vatBreakdown: VatBreakdownEntry[] = [...groups.values()].map((g) => {
    const taxableAmount = cents(sum(g.parts));
    const exemption = invoice.vatExemptionReasons?.[g.category];
    return {
      category: g.category,
      ratePercent: g.ratePercent,
      taxableAmount,
      taxAmount: cents(percentageOf(taxableAmount, fromNumber(g.ratePercent))),
      ...(exemption ? { exemption } : {}),
    };
  });

  const taxBasisTotal = add(subtract(lineTotal, allowanceTotal), chargeTotal);
  const taxTotal = cents(sum(vatBreakdown.map((g) => g.taxAmount)));
  const grandTotal = add(taxBasisTotal, taxTotal);
  const paidAmount = cents(invoice.paidAmount ?? 0);
  // BT-114 is ADDED, per EN 16931: it moves the PAYABLE, not the invoice total. The CII XSD puts
  // the element before the grand total, which reads as though it moved that instead - it does not.
  const roundingAmount = cents(invoice.roundingAmount ?? 0);
  const duePayable = add(subtract(grandTotal, paidAmount), roundingAmount);

  return {
    lineNets,
    lineTotal,
    allowanceTotal,
    chargeTotal,
    taxBasisTotal,
    taxTotal,
    grandTotal,
    paidAmount,
    roundingAmount,
    duePayable,
    vatBreakdown,
  };
}
