import { describe, it, expect } from "vitest";
import { Document, Page, Box, Text, span, renderToBytes } from "../../../src/lib/api";
import type { TextSegment } from "../../../src/lib/elements/text-element";

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

  it("applies an element-level letterSpacing to spans that do not override it", async () => {
    // Segmented content: the Text sets letterSpacing, the spans do not. Every drawn run must carry
    // the 4pt Tc.
    const bytes = await renderToBytes(
      Document([
        Page({ margin: 40 }, [
          Text([span("one "), span("two three")], { size: 20, letterSpacing: 4 }),
        ]),
      ]),
      { compress: false },
    );
    const pdf = new TextDecoder("latin1").decode(bytes);
    const tcCount = (pdf.match(/4\.000 Tc/g) ?? []).length;
    const runCount = (pdf.match(/ Tj/g) ?? []).length + (pdf.match(/ TJ/g) ?? []).length;
    expect(tcCount).toBe(runCount);
    expect(runCount).toBeGreaterThanOrEqual(2);
  });

  it("wraps segmented spaced text with the element's spacing, like the plain-string path", async () => {
    // The decisive check: a single span with the whole text must wrap into the SAME number of lines
    // as the same text as a plain string, at the same width and spacing. If the render path dropped
    // the element letterSpacing (the bug), the segment version would wrap without spacing -> fewer
    // lines than the string version -> and fewer than the layout reserved (overflow).
    const CONTENT = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const linesDrawn = async (content: string | TextSegment[]) => {
      const bytes = await renderToBytes(
        Document([
          Page({ margin: 40 }, [
            // The Box bounds the width (Text has no width of its own); the spacing decides the break.
            Box({ width: 200 }, [Text(content, { size: 16, letterSpacing: 3 })]),
          ]),
        ]),
        { compress: false },
      );
      const pdf = new TextDecoder("latin1").decode(bytes);
      // distinct Td y-positions = number of drawn lines.
      const ys = new Set([...pdf.matchAll(/[-\d.]+ ([-\d.]+) Td/g)].map((m) => m[1]));
      return ys.size;
    };
    const asString = await linesDrawn(CONTENT);
    const asSegments = await linesDrawn([span(CONTENT)]);
    expect(asSegments).toBe(asString);
    expect(asString).toBeGreaterThan(1); // it really did wrap
  });
});
