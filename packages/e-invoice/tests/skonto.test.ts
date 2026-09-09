import { describe, it, expect } from "vitest";
import { Invoice } from "../src/invoice.ts";
import { toCII } from "../src/cii.ts";
import { toUBL } from "../src/ubl.ts";
import { computeInvoice } from "../src/compute.ts";
import { resolveDiscounts, paymentTermsText } from "../src/skonto.ts";
import { en16931Problems } from "../src/profile-check.ts";
import { defaultInvoiceTemplate } from "../src/template.ts";
import { resolveLabels, makeFormatters } from "../src/i18n.ts";
import { printedText } from "./support/printed.ts";

/**
 * Skonto is the gap that could produce a WRONG invoice, so these tests are about more than the
 * string format: that the discount never touches the totals, that both syntaxes say the same thing,
 * that the paper shows what the XML says, and that the old workaround is now named as a mistake.
 */

const base: Invoice = {
  number: "RE-2026-100",
  issueDate: "2026-09-09",
  currency: "EUR",
  seller: {
    name: "Muster GmbH",
    vatId: "DE123456789",
    address: { city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "Kunde AG", address: { city: "München", postCode: "80331", country: "DE" } },
  lines: [
    {
      name: "Wartung",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 1000,
      vat: { category: "S", ratePercent: 19 },
    },
  ],
  payment: { iban: "DE02120300000000202051", terms: "Zahlbar innerhalb 30 Tagen netto." },
};

const withSkonto = (...discounts: { days: number; percent: number; baseAmount?: number }[]) => ({
  ...base,
  payment: { ...base.payment, cashDiscounts: discounts },
});

describe("the numbers", () => {
  it("defaults the base to the gross total, not the net", () => {
    const invoice = withSkonto({ days: 14, percent: 2 });
    const gross = computeInvoice(invoice).grandTotal; // 1000 + 19 % = 1190
    const [d] = resolveDiscounts(invoice.payment!.cashDiscounts, invoice.issueDate, gross);
    expect(d!.baseAmount).toBe(1190);
    expect(d!.discountAmount).toBe(23.8);
    expect(d!.discountedTotal).toBe(1166.2);
  });

  it("counts the deadline from the issue date", () => {
    const [d] = resolveDiscounts([{ days: 14, percent: 2 }], "2026-09-09", 100);
    expect(d!.deadline).toBe("2026-09-23");
  });

  it("crosses a month and a leap day without drifting", () => {
    expect(resolveDiscounts([{ days: 30, percent: 1 }], "2026-12-20", 100)[0]!.deadline).toBe(
      "2027-01-19",
    );
    expect(resolveDiscounts([{ days: 1, percent: 1 }], "2028-02-28", 100)[0]!.deadline).toBe(
      "2028-02-29",
    );
  });

  it("NEVER changes the invoice totals - that is the whole reason it is not an allowance", () => {
    const plain = computeInvoice(base);
    const skonto = computeInvoice(withSkonto({ days: 14, percent: 2 }));
    expect(skonto.grandTotal).toBe(plain.grandTotal);
    expect(skonto.duePayable).toBe(plain.duePayable);
    expect(skonto.taxBasisTotal).toBe(plain.taxBasisTotal);
  });
});

describe("the BT-20 payload", () => {
  it("appends the structured line beneath the human terms", () => {
    const text = paymentTermsText(
      "Zahlbar in 30 Tagen.",
      [{ days: 14, percent: 2 }],
      "2026-09-09",
      1190,
    );
    expect(text).toBe("Zahlbar in 30 Tagen.\n#SKONTO#TAGE=14#PROZENT=2.00#");
  });

  it("writes BASISBETRAG only when the user gave one", () => {
    const text = paymentTermsText(
      undefined,
      [
        { days: 14, percent: 2 },
        { days: 30, percent: 1.5, baseAmount: 500 },
      ],
      "2026-09-09",
      1190,
    );
    expect(text).toBe(
      "#SKONTO#TAGE=14#PROZENT=2.00#\n#SKONTO#TAGE=30#PROZENT=1.50#BASISBETRAG=500.00#",
    );
  });

  it("always writes two decimals, because a machine reads this", () => {
    const text = paymentTermsText(undefined, [{ days: 7, percent: 3 }], "2026-09-09", 100);
    expect(text).toContain("PROZENT=3.00#");
  });

  it("leaves the terms untouched when there is no discount, so old output stays byte-identical", () => {
    expect(paymentTermsText("Nur Text.", undefined, "2026-09-09", 100)).toBe("Nur Text.");
    expect(paymentTermsText("Nur Text.", [], "2026-09-09", 100)).toBe("Nur Text.");
    expect(paymentTermsText(undefined, undefined, "2026-09-09", 100)).toBeUndefined();
  });
});

describe("both syntaxes carry it, and say the same thing", () => {
  const invoice = withSkonto({ days: 14, percent: 2 });
  const computed = computeInvoice(invoice);

  it("CII puts it in ram:Description", () => {
    expect(toCII(invoice, computed)).toContain("#SKONTO#TAGE=14#PROZENT=2.00#");
  });

  it("UBL puts it in cbc:Note", () => {
    expect(toUBL(invoice, computed)).toContain("#SKONTO#TAGE=14#PROZENT=2.00#");
  });

  it("and neither reports a lower payable amount", () => {
    expect(toCII(invoice, computed)).toContain(
      "<ram:DuePayableAmount>1190.00</ram:DuePayableAmount>",
    );
  });
});

describe("the paper says what the XML says", () => {
  it("prints the percentage, the deadline and what it saves", () => {
    const invoice = withSkonto({ days: 14, percent: 2 });
    const text = printedText(
      defaultInvoiceTemplate(
        invoice,
        computeInvoice(invoice),
        resolveLabels("de"),
        makeFormatters("de", "EUR"),
      ),
    ).join("\n");
    expect(text).toContain("Skonto");
    expect(text).toMatch(/23\.09\.2026/);
    expect(text).toMatch(/1\.166,20/);
  });
});

describe("the workaround is named as a mistake", () => {
  it("refuses an allowance whose reason says Skonto", () => {
    const problems = en16931Problems({
      ...base,
      allowancesCharges: [
        {
          isCharge: false,
          amount: 23.8,
          vat: { category: "S", ratePercent: 19 },
          reason: "2% Skonto",
        },
      ],
    });
    expect(problems.join(" ")).toContain("cashDiscounts");
  });

  it("says nothing about a real, unconditional discount", () => {
    const problems = en16931Problems({
      ...base,
      allowancesCharges: [
        {
          isCharge: false,
          amount: 50,
          vat: { category: "S", ratePercent: 19 },
          reason: "Treuerabatt",
        },
      ],
    });
    expect(problems).toEqual([]);
  });

  it("rejects a discount that cannot exist", () => {
    expect(en16931Problems(withSkonto({ days: 14, percent: 0 })).join(" ")).toContain("percent");
    expect(en16931Problems(withSkonto({ days: -1, percent: 2 })).join(" ")).toContain("days");
  });
});
