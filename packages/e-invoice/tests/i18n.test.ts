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
