import { describe, it, expect } from "vitest";
import { makeFormatters, resolveLabels } from "../src/i18n";

describe("i18n", () => {
  it("resolves locale presets, default de, with optional per-key overrides", () => {
    expect(resolveLabels().invoice).toBe("Rechnung"); // default locale
    expect(resolveLabels("de").invoice).toBe("Rechnung");
    expect(resolveLabels("en").invoice).toBe("Invoice");
    expect(resolveLabels("fr").vat).toBe("TVA");
    expect(resolveLabels("en", { vat: "Sales Tax" }).vat).toBe("Sales Tax");
  });

  it("formats amounts, percentages and dates per locale via Intl", () => {
    const de = makeFormatters("de", "EUR");
    const en = makeFormatters("en", "EUR");
    expect(de.money(1234.56)).toContain("1.234,56");
    expect(en.money(1234.56)).toContain("1,234.56");
    expect(de.percent(19)).toMatch(/19\s*%/);
    expect(en.percent(19)).toBe("19%");
    expect(de.date("2026-06-17")).toBe("17.06.2026"); // UTC → no timezone drift
    expect(en.date("2026-06-17")).toBe("06/17/2026");
  });
});

describe("the service period, for the eye", () => {
  const de = makeFormatters("de", "EUR");
  const en = makeFormatters("en", "EUR");

  it("reads a whole calendar month AS that month - what §31 Abs. 4 UStDV allows", () => {
    expect(de.period("2026-06-01", "2026-06-30")).toBe("Juni 2026");
    expect(en.period("2026-06-01", "2026-06-30")).toBe("June 2026");
  });

  it("knows how long the month is, rather than assuming 30 or 31", () => {
    expect(de.period("2026-02-01", "2026-02-28")).toBe("Februar 2026");
    expect(de.period("2024-02-01", "2024-02-29")).toBe("Februar 2024"); // leap year
    expect(de.period("2026-01-01", "2026-01-31")).toBe("Januar 2026");
  });

  it("shows both ends whenever it is NOT a whole month", () => {
    expect(de.period("2026-06-02", "2026-06-30")).toBe("02.06.2026 - 30.06.2026"); // starts late
    expect(de.period("2026-06-01", "2026-06-29")).toBe("01.06.2026 - 29.06.2026"); // ends early
    expect(de.period("2026-06-01", "2026-07-31")).toBe("01.06.2026 - 31.07.2026"); // two months
    expect(de.period("2025-06-01", "2026-06-30")).toBe("01.06.2025 - 30.06.2026"); // a whole year
  });

  it("does not drift across a timezone, like the plain date formatter", () => {
    expect(de.period("2026-06-01", "2026-06-30")).not.toContain("Mai");
  });
});
