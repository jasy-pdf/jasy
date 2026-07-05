import { describe, it, expect } from "vitest";
import { toDimension } from "../../../src/lib/api/dimension";

describe("toDimension", () => {
  it("a number is a fixed point size", () => {
    expect(toDimension(120)).toEqual({ points: 120 });
    expect(toDimension(0)).toEqual({ points: 0 });
  });

  it("a percentage string is a 0..1 factor", () => {
    expect(toDimension("50%")).toEqual({ factor: 0.5 });
    expect(toDimension("100%")).toEqual({ factor: 1 });
    expect(toDimension("12.5%")).toEqual({ factor: 0.125 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(toDimension(" 25% " as `${number}%`)).toEqual({ factor: 0.25 });
  });

  it("rejects a size that is neither a number nor a percentage", () => {
    expect(() => toDimension("50px" as `${number}%`)).toThrow(/Invalid size/);
    expect(() => toDimension("wide" as `${number}%`)).toThrow(/Invalid size/);
  });
});
