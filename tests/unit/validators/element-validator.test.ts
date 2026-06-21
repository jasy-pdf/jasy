import { describe, it, expect } from "vitest";
import { Validator } from "../../../src/lib/validators/element-validator";
import { SizedPDFElement } from "../../../src/lib/elements/pdf-element";

// A minimal stand-in: the validator only reads getSize() + constructor.name.
const sized = (size: { x: number; y: number; width?: number; height?: number }) =>
  ({ getSize: () => size, constructor: { name: "TestElement" } }) as unknown as SizedPDFElement;

describe("Validator.validateSizedElement", () => {
  it("accepts 0-size hairlines and negative coordinates, but rejects a negative or missing size", () => {
    expect(() =>
      Validator.validateSizedElement(sized({ x: 0, y: 0, width: 100, height: 0 })),
    ).not.toThrow();
    expect(() =>
      Validator.validateSizedElement(sized({ x: 0, y: 0, width: 0, height: 10 })),
    ).not.toThrow();
    // Negative coordinates are legitimate now: a Positioned child overflows its frame on purpose.
    expect(() =>
      Validator.validateSizedElement(sized({ x: -14, y: -14, width: 100, height: 10 })),
    ).not.toThrow();

    expect(() =>
      Validator.validateSizedElement(sized({ x: 0, y: 0, width: 100, height: -1 })),
    ).toThrow(/invalid size/);
    expect(() =>
      Validator.validateSizedElement(sized({ x: 0, y: 0, width: undefined, height: 10 })),
    ).toThrow(/invalid size/);
  });
});
