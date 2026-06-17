import { describe, it, expect } from "vitest";
import { renderPdf } from "jasy-pdf";
import { toCII, computeInvoice } from "../src/index";

describe("@jasy-pdf/zugferd", () => {
  it("exposes its public API (compute + CII)", () => {
    expect(typeof computeInvoice).toBe("function");
    expect(typeof toCII).toBe("function");
  });

  it("is wired to the layout core via the workspace", () => {
    expect(typeof renderPdf).toBe("function");
  });
});
