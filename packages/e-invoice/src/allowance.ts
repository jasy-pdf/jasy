import { AllowanceCharge } from "./invoice.ts";

// The ONE place an allowance/charge turns into a number.
//
// It exists because the amount can now be stated two ways - as a fixed sum, or as a percentage of a
// base - and four consumers need it: the totals, the CII generator, the UBL generator and the PDF.
// Four separate `ac.amount ?? base * percent / 100` expressions is exactly how the totals and the
// printed figure start disagreeing, which is the defect class this package cares about most.

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What this allowance/charge is worth, in currency.
 *
 * An explicit `amount` always wins: a user who states both has done the arithmetic themselves, and
 * silently overruling them would hide a typo rather than surface it. `profile-check` reports the
 * disagreement instead, where the message can name the field.
 */
export function acAmount(ac: AllowanceCharge): number {
  if (ac.amount !== undefined) return round2(ac.amount);
  // The union guarantees these are present when `amount` is not.
  return round2((ac.baseAmount! * ac.percent!) / 100);
}

/** The amount a percentage WOULD produce, or null when it was not stated that way. */
export function acDerivedAmount(ac: AllowanceCharge): number | null {
  if (ac.baseAmount === undefined || ac.percent === undefined) return null;
  return round2((ac.baseAmount * ac.percent) / 100);
}

/**
 * Whether the percentage pair should be written to XML and paper. Both halves or neither: BT-94
 * without BT-93 states a rate with nothing to apply it to.
 */
export function hasPercentage(
  ac: AllowanceCharge,
): ac is AllowanceCharge & { baseAmount: number; percent: number } {
  return ac.baseAmount !== undefined && ac.percent !== undefined;
}
