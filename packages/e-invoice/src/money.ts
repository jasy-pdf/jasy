import { fromNumber, round, type Decimal } from "@jasy/decy";

// The ONE boundary between the user's numbers and exact money. A JS number cannot hold 4.515 (it
// stores 4.51499999...), so every amount becomes a Decimal here, once, from its shortest text, and
// the arithmetic never touches a float again. Rounding a value that went through float math in
// between rounds the float, not the money.

/** EN 16931 rounds half away from zero (commercial rounding). */
export const MODE = "halfAwayFromZero";

/** An amount to the cent - every amount BR-DEC limits to two decimals, stated or derived. */
export function cents(value: Decimal | number): Decimal {
  return round(typeof value === "number" ? fromNumber(value) : value, { scale: 2, mode: MODE });
}

/**
 * A unit price (BT-146): at least two decimals, at most four. The standard sets no limit; four is
 * ours, and the line net is computed from exactly the price written, so the XML never contradicts
 * itself (PEPPOL-EN16931-R120).
 */
export function unitPrice(value: number): Decimal {
  let price = round(fromNumber(value), { scale: 4, mode: MODE });
  while (price.scale > 2 && price.units % 10n === 0n) {
    price = round(price, { scale: price.scale - 1, mode: MODE });
  }
  return price;
}
