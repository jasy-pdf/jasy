import { describe, it, expect } from "vitest";
import { Document, Page, Text, renderToBytes } from "../../../src/lib/api";

// letterSpacing -> the PDF `Tc` operator. It is graphics state and must be isolated so it cannot
// leak into the next run; at 0 it must not appear at all (byte-identity for every existing document).

const streamOf = async (letterSpacing?: number): Promise<string> => {
  const bytes = await renderToBytes(
    Document([Page({ margin: 40 }, [Text("Total", { size: 20, letterSpacing })])]),
    { compress: false },
  );
  return new TextDecoder("latin1").decode(bytes);
};

describe("letterSpacing emits Tc", () => {
  it("writes the spacing as a Tc operator", async () => {
    expect(await streamOf(3)).toContain("3.000 Tc");
  });

  it("emits NO Tc when the spacing is 0 or unset", async () => {
    expect(await streamOf(0)).not.toContain("Tc");
    expect(await streamOf(undefined)).not.toContain("Tc");
  });

  it("isolates the Tc in a q/Q so it cannot leak into the next run", async () => {
    const pdf = await streamOf(3);
    // The spaced run's block is wrapped: q ... Tc ... BT ... ET ... Q
    expect(pdf).toMatch(/q\s+3\.000 Tc\s+BT/);
    expect(pdf).toContain("Q");
  });
});
