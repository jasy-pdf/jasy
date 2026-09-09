import { CashDiscount, IsoDate } from "./invoice.ts";

// Skonto (early-payment discount) - the ONE place it is turned into numbers and into text.
//
// It is NOT an allowance. EN 16931 has no business term for it: a discount that only applies if the
// buyer pays early cannot reduce the invoice total, because at the time of issue nobody knows whether
// it will be taken. So it belongs in the payment terms, BT-20, and XRechnung fixes the wording so a
// machine can read it back out of the free text:
//
//   #SKONTO#TAGE=14#PROZENT=2.00#
//   #SKONTO#TAGE=30#PROZENT=1.00#BASISBETRAG=1000.00#
//
// One line per tier, appended after any human-readable terms. Modelling Skonto as a document-level
// allowance instead - the obvious workaround while this was missing - produces a schema-valid but
// FALSE invoice, because the amount is deducted immediately. `profile-check.ts` looks for that.

/** A discount with its amounts and deadline worked out. */
export interface ResolvedDiscount {
  days: number;
  percent: number;
  /** The amount the percentage applies to (BASISBETRAG). */
  baseAmount: number;
  /** What the buyer saves by paying in time. */
  discountAmount: number;
  /** What is left to pay when the discount is taken. */
  discountedTotal: number;
  /** Last day the discount applies: issue date + `days`. */
  deadline: IsoDate;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `issueDate` plus `days`, in UTC so the result never depends on the machine's zone. */
function addDays(issueDate: IsoDate, days: number): IsoDate {
  const ms = Date.parse(`${issueDate}T00:00:00Z`);
  if (Number.isNaN(ms)) return issueDate;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Work out what each discount is worth. `grossTotal` is BT-112 (the total including VAT) - the base
 * German practice calculates Skonto on, and the default when a discount names no `baseAmount`.
 */
export function resolveDiscounts(
  discounts: CashDiscount[] | undefined,
  issueDate: IsoDate,
  grossTotal: number,
): ResolvedDiscount[] {
  return (discounts ?? []).map((d) => {
    const baseAmount = round2(d.baseAmount ?? grossTotal);
    const discountAmount = round2((baseAmount * d.percent) / 100);
    return {
      days: d.days,
      percent: d.percent,
      baseAmount,
      discountAmount,
      discountedTotal: round2(baseAmount - discountAmount),
      deadline: addDays(issueDate, d.days),
    };
  });
}

/** Fixed two decimals with a dot, whatever the locale - this string is read by machines. */
const decimal2 = (n: number) => n.toFixed(2);

/**
 * The structured line XRechnung reads Skonto out of. `BASISBETRAG` is written whenever the user gave
 * one explicitly; left off it defaults to the payable amount on the reader's side too.
 */
export function skontoLine(d: ResolvedDiscount, explicitBase: boolean): string {
  const base = explicitBase ? `BASISBETRAG=${decimal2(d.baseAmount)}#` : "";
  return `#SKONTO#TAGE=${d.days}#PROZENT=${decimal2(d.percent)}#${base}`;
}

/**
 * The complete BT-20 payload: the human terms, then one machine-readable line per discount.
 *
 * With no discounts this returns `terms` unchanged - including `undefined` - so an invoice that does
 * not use Skonto produces byte-identical output to before this existed.
 */
export function paymentTermsText(
  terms: string | undefined,
  discounts: CashDiscount[] | undefined,
  issueDate: IsoDate,
  grossTotal: number,
): string | undefined {
  if (!discounts?.length) return terms;
  const resolved = resolveDiscounts(discounts, issueDate, grossTotal);
  const lines = resolved.map((d, i) => skontoLine(d, discounts[i]!.baseAmount !== undefined));
  return [terms, ...lines].filter(Boolean).join("\n");
}
