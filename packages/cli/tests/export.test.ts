import { describe, it, expect } from "vitest";
import { inflateRawSync } from "node:zlib";
import { computeInvoice } from "@jasy/zugferd";
import { exportJson, exportText, exportXlsx, exportInvoice } from "../src/core/export";

/** Minimal ZIP reader: walk the local headers, inflate each part (method 8) - mirrors our writer. */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const comp = buf.readUInt32LE(i + 18);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const name = buf.subarray(i + 30, i + 30 + nameLen).toString("utf-8");
    const start = i + 30 + nameLen + extraLen;
    const body = buf.subarray(start, start + comp);
    out[name] = (method === 8 ? inflateRawSync(body) : body).toString("utf-8");
    i = start + comp;
  }
  return out;
}

const invoice = {
  number: "RE-EXP-1",
  issueDate: "2026-06-21",
  currency: "EUR",
  seller: {
    name: "M GmbH",
    vatId: "DE123456789",
    address: { line1: "Hauptstr. 1", city: "Berlin", postCode: "10115", country: "DE" },
  },
  buyer: { name: "K AG", address: { city: "Bonn", postCode: "53113", country: "DE" } },
  lines: [
    {
      name: "Service",
      quantity: 1,
      unit: "C62",
      netUnitPrice: 100,
      vat: { category: "S" as const, ratePercent: 19 },
    },
  ],
};
const totals = computeInvoice(invoice);

describe("export", () => {
  it("json: valid JSON with the model + a totals block", () => {
    const o = JSON.parse(exportJson(invoice, totals));
    expect(o.number).toBe("RE-EXP-1");
    expect(o.seller.name).toBe("M GmbH");
    expect(o.totals).toMatchObject({ net: 100, vat: 19, gross: 119, currency: "EUR" });
  });

  it("txt: a readable receipt", () => {
    const t = exportText(invoice, totals);
    expect(t).toContain("RE-EXP-1");
    expect(t).toContain("Service");
    expect(t).toMatch(/Total EUR\s+119\.00/);
  });

  it("xlsx: a valid deflate zip whose sheet inflates back to the data", () => {
    const x = exportXlsx(invoice, totals);
    expect(x.subarray(0, 2).toString("latin1")).toBe("PK"); // ZIP signature
    const parts = unzip(x);
    expect(Object.keys(parts)).toContain("xl/worksheets/sheet1.xml");
    expect(parts["xl/worksheets/sheet1.xml"]).toContain("RE-EXP-1"); // round-trips deflate→inflate
    expect(parts["xl/worksheets/sheet1.xml"]).toContain("Service");
  });

  it("xlsx: strips XML-illegal control characters", () => {
    const dirty = { ...invoice, lines: [{ ...invoice.lines[0], name: "A\x07B\x1fC" }] };
    const sheet = unzip(exportXlsx(dirty, computeInvoice(dirty)))["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("ABC"); // control chars dropped, XML stays well-formed
  });

  it("exportInvoice dispatches by format", () => {
    expect(typeof exportInvoice(invoice, totals, "json")).toBe("string");
    expect(Buffer.isBuffer(exportInvoice(invoice, totals, "xlsx"))).toBe(true);
  });
});
