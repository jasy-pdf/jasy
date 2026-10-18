// Random documents around Flow (`support/random-document.ts`), each checked for what a reader would
// notice: text lost or drawn twice, lines drawn over each other, an overflow that is not an
// unbreakable block taller than its Region, or a throw. Run more by hand with
// `claude-data/tools/random-flow` (SEEDS=600).
import { describe, it, expect } from "vitest";
import { faultsOf } from "../support/random-document.ts";

const SEEDS = 40;
// Seeds that once found a fault - kept, so the same document is checked again.
const FOUND = [448, 758, 1432, 1638];

describe("random documents around Flow", () => {
  it(`lose nothing, draw nothing twice or on top, and report only what cannot break (${SEEDS} seeds and ${FOUND.length} that once failed)`, async () => {
    const all: string[] = [];
    for (const seed of [...Array.from({ length: SEEDS }, (_, i) => i + 1), ...FOUND])
      for (const f of await faultsOf(seed)) all.push(`seed ${seed}: ${f}`);
    expect(all).toEqual([]);
  }, 120_000);
});
