import { describe, it, expect } from "vitest";
import { COMPONENTS, SERVER_FACTORIES } from "../src/module.ts";

// Both lists are hand-written, so a new factory in the engine is invisible in Nuxt until someone
// remembers to add it - which is how `Svg` shipped without a component the first time.
describe("the auto-import lists", () => {
  it("carries Svg on both sides, beside Image", () => {
    expect(COMPONENTS).toContain("Svg");
    expect(SERVER_FACTORIES).toContain("Svg");
  });

  it("keeps the client and server lists in step for the drawing factories", () => {
    for (const name of ["Image", "Svg"]) {
      expect(COMPONENTS.includes(name)).toBe(SERVER_FACTORIES.includes(name));
    }
  });
});
