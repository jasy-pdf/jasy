import { describe, it, expect } from "vitest";
import { COMPONENTS, SERVER_FACTORIES } from "../src/module.ts";

describe("the auto-import lists", () => {
  it("carry Flow, Region, ColumnBreak and SplitView on both sides", () => {
    for (const name of ["Flow", "Region", "ColumnBreak", "SplitView"]) {
      expect(COMPONENTS).toContain(name);
      expect(SERVER_FACTORIES).toContain(name);
    }
  });
});
