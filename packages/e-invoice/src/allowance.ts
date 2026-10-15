import { fromNumber, percentageOf, type Decimal } from "@jasy/decy";
import { AllowanceCharge } from "./invoice.ts";
import { cents } from "./money.ts";

// The ONE place an allowance/charge turns into a number.
//
// It exists because the amount can now be stated two ways - as a fixed sum, or as a percentage of a
// base - and four consumers need it: the totals, the CII generator, the UBL generator and the PDF.
// Four separate `ac.amount ?? base * percent / 100` expressions is exactly how the totals and the
// printed figure start disagreeing, which is the defect class this package cares about most.

/**
 * What this allowance/charge is worth, in currency.
 *
 * An explicit `amount` always wins: a user who states both has done the arithmetic themselves, and
 * silently overruling them would hide a typo rather than surface it. `profile-check` reports the
 * disagreement instead, where the message can name the field.
 */
export function acAmount(ac: AllowanceCharge): Decimal {
  if (ac.amount !== undefined) return cents(ac.amount);
  // The union guarantees these are present when `amount` is not.
  return percentOfBase(ac.baseAmount!, ac.percent!);
}

/** The amount a percentage WOULD produce, or null when it was not stated that way. */
export function acDerivedAmount(ac: AllowanceCharge): Decimal | null {
  if (ac.baseAmount === undefined || ac.percent === undefined) return null;
  return percentOfBase(ac.baseAmount, ac.percent);
}

/** `percent` of the base AS WRITTEN (BT-93 is to the cent), so a reader can redo the sum. */
const percentOfBase = (base: number, percent: number): Decimal =>
  cents(percentageOf(cents(base), fromNumber(percent)));

/**
 * Whether the percentage pair should be written to XML and paper. Both halves or neither: BT-94
 * without BT-93 states a rate with nothing to apply it to.
 */
export function hasPercentage(
  ac: AllowanceCharge,
): ac is AllowanceCharge & { baseAmount: number; percent: number } {
  return ac.baseAmount !== undefined && ac.percent !== undefined;
}
