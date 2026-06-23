import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderZugferd } from "@jasy/zugferd";
import { validateCommand } from "../src/commands/validate";

const invoice = {
  number: "RE-2026-CMD",
  issueDate: "2026-06-20",
  currency: "EUR",
  dueDate: "2026-07-04",
  buyerReference: "04011000-12345-34",
  seller: {
    name: "Muster Studio GmbH",
    vatId: "DE123456789",
    electronicAddress: "rechnung@muster-studio.de",
    address: { line1: "Hauptstraße 1", city: "Berlin", postCode: "10115", country: "DE" },
    contact: { name: "Erika Muster", phone: "+49 30 1234567", email: "kontakt@muster-studio.de" },
  },
  buyer: {
    name: "Beispiel Kunde AG",
    address: { line1: "Marienplatz 1", city: "München", postCode: "80331", country: "DE" },
  },
  lines: [
    {
      id: "1",
      name: "Webdesign",
      quantity: 2,
      unit: "HUR",
      netUnitPrice: 100,
      vat: { category: "S" as const, ratePercent: 19 },
    },
  ],
  payment: { iban: "DE02120300000000202051", terms: "Zahlbar innerhalb 14 Tagen netto." },
};

describe("jasy validate command", () => {
  let logs: string[];
  beforeEach(() => {
    logs = [];
    vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      logs.push(a.join(" "));
    });
    process.exitCode = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("reports VALID and exits 0 for a conformant ZUGFeRD PDF", async () => {
    const { bytes } = await renderZugferd(invoice);
    const f = join(tmpdir(), "jasy-cmd-valid.pdf");
    writeFileSync(f, bytes);
    validateCommand([f]);
    rmSync(f, { force: true });
    const out = logs.join("\n");
    expect(out).toContain("EN 16931 rules");
    expect(out).toContain("PDF/A-3 structure");
    expect(out).toContain("→ VALID");
    expect(process.exitCode).toBe(0);
  });

  it("emits a machine-readable report with --json (same data, parseable)", async () => {
    const { bytes } = await renderZugferd(invoice);
    const f = join(tmpdir(), "jasy-cmd-json.pdf");
    writeFileSync(f, bytes);
    validateCommand([f, "--json"]);
    rmSync(f, { force: true });

    // The only stdout in --json mode is the JSON itself.
    const report = JSON.parse(logs.join("\n"));
    expect(report.valid).toBe(true);
    expect(report.summary).toContain("EN 16931");
    expect(report.businessRules.valid).toBe(true);
    expect(report.pdfA3.passed).toBe(report.pdfA3.total);
    expect(report.recognized).toBe(true);
    expect(process.exitCode).toBe(0);
  });

  it("flags a non-invoice as not recognised (not 'valid') and exits 1", () => {
    const f = join(tmpdir(), "jasy-cmd-garbage.txt");
    writeFileSync(f, "this is not an invoice at all");
    validateCommand([f, "--json"]);
    rmSync(f, { force: true });
    const report = JSON.parse(logs.join("\n"));
    expect(report.recognized).toBe(false);
    expect(report.valid).toBe(false);
    expect(process.exitCode).toBe(1);
  });

  it("reports INVALID and exits 1 when the PDF/A structure is broken", async () => {
    const { bytes } = await renderZugferd(invoice);
    const broken = Buffer.from(
      Buffer.from(bytes).toString("latin1").replaceAll("pdfaid:part", "pdfaid:xxxx"),
      "latin1",
    );
    const f = join(tmpdir(), "jasy-cmd-invalid.pdf");
    writeFileSync(f, broken);
    validateCommand([f]);
    rmSync(f, { force: true });
    expect(logs.join("\n")).toContain("→ INVALID");
    expect(process.exitCode).toBe(1);
  });
});
