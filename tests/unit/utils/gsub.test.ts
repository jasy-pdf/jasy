import { describe, it, expect } from "vitest";
import { GsubTable } from "../../../src/lib/utils/gsub.ts";

// The table is BUILT here rather than committed. The only real fonts in this repo live in the
// gitignored `claude-data/`, so a fixture-based test would fail in a fresh clone - the same reason
// the WOFF tests build their container. Building it also means every offset in the reader is
// exercised against a layout we wrote from the spec, not against one font's habits.

import {
  buildGsub,
  coverage1,
  coverage2,
  single1,
  single2,
  ligature,
  extension,
} from "../support/gsub-builder.ts";

describe("finding a feature's lookups", () => {
  const table = new GsubTable(
    buildGsub(
      [
        { tag: "init", lookups: [0] },
        { tag: "fina", lookups: [1] },
      ],
      [
        { type: 1, subtables: [single1(coverage1([10, 11]), 100)] },
        { type: 1, subtables: [single1(coverage1([10]), 200)] },
      ],
    ),
    0,
  );

  it("reports the script it carries", () => {
    expect(table.hasScript("arab")).toBe(true);
    expect(table.hasScript("latn")).toBe(false);
  });

  it("maps a feature tag to its lookup indices", () => {
    expect(table.lookups("arab", "init")).toEqual([0]);
    expect(table.lookups("arab", "fina")).toEqual([1]);
  });

  it("returns nothing for a feature or script the font does not have", () => {
    expect(table.lookups("arab", "medi")).toEqual([]);
    expect(table.lookups("latn", "init")).toEqual([]);
  });
});

describe("single substitution - the joining forms themselves", () => {
  const table = new GsubTable(
    buildGsub(
      [
        { tag: "init", lookups: [0] },
        { tag: "medi", lookups: [1] },
        { tag: "fina", lookups: [2] },
      ],
      [
        { type: 1, subtables: [single1(coverage1([10, 11, 12]), 100)] },
        { type: 1, subtables: [single2(coverage1([10, 11]), [55, 66])] },
        { type: 1, subtables: [single1(coverage2([[20, 24, 0]]), 500)] },
      ],
    ),
    0,
  );

  it("format 1 shifts a covered glyph by the delta", () => {
    expect(table.substituteSingle(0, 10)).toBe(110);
    expect(table.substituteSingle(0, 12)).toBe(112);
  });

  it("format 2 uses the replacement listed for that glyph", () => {
    expect(table.substituteSingle(1, 10)).toBe(55);
    expect(table.substituteSingle(1, 11)).toBe(66);
  });

  it("reads a range-based coverage as well as a listed one", () => {
    expect(table.substituteSingle(2, 20)).toBe(520);
    expect(table.substituteSingle(2, 24)).toBe(524);
  });

  it("says null for a glyph the lookup does not cover, which means the feature does not apply", () => {
    expect(table.substituteSingle(0, 99)).toBeNull();
    expect(table.substituteSingle(2, 25)).toBeNull();
  });
});

describe("ligature substitution - lam-alef and friends", () => {
  const table = new GsubTable(
    buildGsub(
      [{ tag: "rlig", lookups: [0] }],
      [
        {
          type: 4,
          subtables: [
            ligature(coverage1([10]), [
              [
                [900, 20], // 10 + 20      -> 900
                [901, 20, 30], // 10 + 20 + 30 -> 901
              ],
            ]),
          ],
        },
      ],
    ),
    0,
  );

  it("collapses a matching run and says how many glyphs it swallowed", () => {
    expect(table.substituteLigature(0, [10, 20, 99], 0)).toEqual({ glyph: 900, consumed: 2 });
  });

  it("prefers the LONGER ligature when both match", () => {
    // The two-glyph one also matches here; taking it would leave a stray glyph behind and is the
    // classic way a ligature table is read wrong.
    expect(table.substituteLigature(0, [10, 20, 30], 0)).toEqual({ glyph: 901, consumed: 3 });
  });

  it("matches at an offset, not just at the start", () => {
    expect(table.substituteLigature(0, [5, 10, 20], 1)).toEqual({ glyph: 900, consumed: 2 });
  });

  it("says null when the run does not match, or would run past the end", () => {
    expect(table.substituteLigature(0, [10, 99], 0)).toBeNull();
    expect(table.substituteLigature(0, [10], 0)).toBeNull(); // needs a second glyph it does not have
  });
});

describe("type 7 - the extension wrapper real fonts hide lookups behind", () => {
  const table = new GsubTable(
    buildGsub(
      [{ tag: "init", lookups: [0] }],
      [{ type: 7, subtables: [extension(1, single1(coverage1([10]), 100))] }],
    ),
    0,
  );

  it("unwraps to the real type, so a caller never learns it was wrapped", () => {
    expect(table.lookupType(0)).toBe(1);
    expect(table.substituteSingle(0, 10)).toBe(110);
  });
});

describe("a lookup type we do not implement", () => {
  const table = new GsubTable(
    buildGsub([{ tag: "rlig", lookups: [0] }], [{ type: 6, subtables: [[0, 0]] }]),
    0,
  );

  it("is reported rather than guessed at", () => {
    expect(table.lookupType(0)).toBe(6);
    expect(table.substituteSingle(0, 10)).toBeNull();
    expect(table.substituteLigature(0, [10, 20], 0)).toBeNull();
  });
});
