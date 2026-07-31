import { describe, it, expect } from "vitest";
import { BoxConstraints, resolveSize } from "../../../src/lib/layout/box-constraints.ts";

// The shared resolver behind `width` / `height` / `aspectRatio` / `min*` / `max*` on Box, Column, Row
// and Image. The order it applies them in is the contract: ratio fills an open axis, min/max clamp
// afterwards, so an explicit bound beats the ratio the way it does in CSS.

const box = (w = 400, h = 600) => BoxConstraints.loose(w, h);
const none = {};

describe("aspectRatio", () => {
  it("derives the axis that was left open", () => {
    expect(resolveSize({ fixed: 300 }, none, 3 / 2, box()).height).toBe(200);
    expect(resolveSize(none, { fixed: 200 }, 3 / 2, box()).width).toBe(300);
  });

  it("fills the offered width and takes the height from the ratio when neither is pinned", () => {
    const r = resolveSize(none, none, 16 / 9, box(320, 600));
    expect(r.width).toBe(320);
    expect(r.height).toBeCloseTo(180, 5);
  });

  it("is ignored when both axes are pinned", () => {
    const r = resolveSize({ fixed: 300 }, { fixed: 300 }, 16 / 9, box());
    expect([r.width, r.height]).toEqual([300, 300]);
  });

  it("does nothing on a fully unbounded box, rather than guessing", () => {
    const r = resolveSize(none, none, 2, new BoxConstraints());
    expect([r.width, r.height]).toEqual([undefined, undefined]);
  });

  it("combines with a percentage width", () => {
    const r = resolveSize({ factor: 0.5 }, none, 2, box(400, 600));
    expect([r.width, r.height]).toEqual([200, 100]);
  });
});

describe("min / max", () => {
  it("clamps an explicit size", () => {
    expect(resolveSize({ fixed: 500, max: 300 }, none, undefined, box()).width).toBe(300);
    expect(resolveSize({ fixed: 50, min: 120 }, none, undefined, box()).width).toBe(120);
  });

  it("beats the ratio, as an explicit bound does in CSS", () => {
    // 300 wide at 3:1 wants 100 tall; a minHeight of 150 wins and the ratio is broken.
    const r = resolveSize({ fixed: 300 }, { min: 150 }, 3, box());
    expect([r.width, r.height]).toEqual([300, 150]);
  });

  it("caps a FILLING axis through the narrowed constraints", () => {
    // The point of returning constraints: with no width at all the element fills, and "fill" has to
    // respect maxWidth or the bound would silently do nothing.
    const r = resolveSize({ max: 250 }, none, undefined, box(400, 600));
    expect(r.width).toBeUndefined(); // still "fill"
    expect(r.constraints.maxWidth).toBe(250); // ... but no further than this
  });

  it("takes min and max as percentages too", () => {
    expect(resolveSize({ fixed: 400, maxFactor: 0.5 }, none, undefined, box(400)).width).toBe(200);
  });

  it("lets a min push past the offered room", () => {
    // Overflow is pagination's problem, not a reason to silently shrink - the CSS answer.
    const r = resolveSize(none, { min: 900 }, undefined, box(400, 600));
    expect(r.constraints.minHeight).toBe(900);
    expect(r.constraints.maxHeight).toBeGreaterThanOrEqual(900);
  });

  it("ignores a percentage bound on an unbounded axis", () => {
    // Same rule percentages already follow: a fraction of "unbounded" has no meaning.
    const r = resolveSize({ maxFactor: 0.5 }, none, undefined, new BoxConstraints());
    expect(r.constraints.maxWidth).toBe(Infinity);
  });
});

describe("nothing asked for", () => {
  it("stays undefined so the caller still fills or shrink-wraps", () => {
    const r = resolveSize(none, none, undefined, box());
    expect([r.width, r.height]).toEqual([undefined, undefined]);
    expect(r.constraints.maxWidth).toBe(400);
  });
});
