import { describe, it, expect } from "vitest";
import { core } from "../src/index";

describe("@jasy-pdf/zugferd skeleton", () => {
  it("is wired to the layout core via the workspace", () => {
    expect(typeof core.renderPdf).toBe("function");
  });
});
