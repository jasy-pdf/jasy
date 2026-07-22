import { describe, it, expect } from "vitest";
import { Document, Page, Column, Row, Box, Text, Spacer, renderPdf } from "../../../src/lib/api";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend";
import { IRNode } from "../../../src/lib/ir/display-list";

// The y a `Td` operator places the given text at (uncompressed content stream, PDF bottom-left origin).
const yOf = (pdf: string, text: string): number => {
  const m = new RegExp(`([-\\d.]+|-?Infinity|NaN) Td \\(${text}\\)`).exec(pdf);
  if (!m) throw new Error(`"${text}" was not drawn at all`);
  return Number(m[1]);
};

const render = (doc: Parameters<typeof renderPdf>[0]) =>
  renderPdf(doc, { compress: false, kerning: false });

describe("Spacer / Expanded on an unbounded main axis (issue #10)", () => {
  it("pushes a sibling to the bottom when the Spacer sits directly in the Page", async () => {
    const pdf = await render(
      Document([Page({ size: "A4", margin: 56 }, [Text("top"), Spacer(), Text("tail")])]),
    );
    expect(yOf(pdf, "tail")).toBeLessThan(70); // near the bottom margin, not under "top"
  });

  it("does the same from inside a nested Column (this used to emit -Infinity)", async () => {
    const pdf = await render(
      Document([Page({ size: "A4", margin: 56 }, [Column([Text("top"), Spacer(), Text("tail")])])]),
    );
    expect(pdf).not.toContain("Infinity");
    expect(yOf(pdf, "tail")).toBeLessThan(70);
  });

  it("does the same from inside a Box with a resolved height", async () => {
    const pdf = await render(
      Document([
        Page({ size: "A4", margin: 56 }, [
          Box({ height: "100%" }, [Column([Text("top"), Spacer(), Text("tail")])]),
        ]),
      ]),
    );
    expect(yOf(pdf, "tail")).toBeLessThan(70);
  });

  it("collapses the Spacer to zero where no bound exists anywhere, and still draws the sibling", async () => {
    // A shrink-wrapping Box in an unbounded region: nothing can tell the Spacer how much to take.
    // It must take nothing - and above all it must not swallow what comes after it.
    const pdf = await render(
      Document([
        Page([Column([Box({}, [Column([Text("top"), Spacer(), Text("tail")])]), Text("after")])]),
      ]),
    );
    expect(pdf).not.toContain("Infinity");
    expect(() => yOf(pdf, "tail")).not.toThrow();
    expect(() => yOf(pdf, "after")).not.toThrow();
    expect(yOf(pdf, "tail")).toBeLessThan(yOf(pdf, "top")); // stacked right below, no gap
  });

  it("keeps a Spacer in a Row working (horizontal main axis)", async () => {
    const pdf = await render(
      Document([Page({ size: "A4", margin: 56 }, [Row([Text("L"), Spacer(), Text("R")])])]),
    );
    expect(pdf).not.toContain("Infinity");
    const x = /([\d.]+) [\d.]+ Td \(R\)/.exec(pdf);
    expect(Number(x![1])).toBeGreaterThan(400); // pushed to the right edge
  });

  // The need for a bounded axis propagates: a Spacer two levels down cannot resolve against Infinity
  // either, so every stack in between has to ask its own parent for a bound.
  it("reaches a Spacer nested one Column deeper", async () => {
    const pdf = await render(
      Document([
        Page({ size: "A4", margin: 56 }, [Column([Column([Text("top"), Spacer(), Text("tail")])])]),
      ]),
    );
    expect(yOf(pdf, "tail")).toBeLessThan(70);
  });

  it("reaches a Spacer through a Box that has no size of its own", async () => {
    const pdf = await render(
      Document([
        Page({ size: "A4", margin: 56 }, [
          Column([Box({}, [Column([Text("top"), Spacer(), Text("tail")])])]),
        ]),
      ]),
    );
    expect(yOf(pdf, "tail")).toBeLessThan(70);
  });

  it("carries a horizontal need through a Column (a Column in a Row has no bounded width)", async () => {
    const pdf = await render(
      Document([
        Page({ size: "A4", margin: 56 }, [Row([Column([Row([Text("L"), Spacer(), Text("R")])])])]),
      ]),
    );
    const m = /([\d.]+) [\d.]+ Td \(R\)/.exec(pdf);
    expect(Number(m![1])).toBeGreaterThan(400);
  });

  it("resolves a percentage height inside a sized Box", async () => {
    const pdf = await render(
      Document([
        Page({ size: "A4", margin: 56 }, [
          Box({ height: 300, bg: "#dddddd" }, [Box({ height: "50%", bg: "#ff0000" }, [Text("x")])]),
        ]),
      ]),
    );
    const heights = [...pdf.matchAll(/[\d.]+ [\d.]+ [\d.]+ ([\d.]+) re/g)].map((m) => Number(m[1]));
    expect(heights).toContain(300); // the outer box
    expect(heights).toContain(150); // 50% of it, not a shrink-wrapped 12pt line
  });

  it("a Column without a flex child still shrink-wraps (old layouts untouched)", async () => {
    const pdf = await render(
      Document([Page({ size: "A4", margin: 56 }, [Column([Text("top"), Text("tail")])])]),
    );
    expect(yOf(pdf, "top") - yOf(pdf, "tail")).toBeLessThan(20); // stacked, not spread apart
  });
});

describe("the backend refuses non-finite geometry", () => {
  it("throws instead of writing Infinity into the content stream", () => {
    const bad = [{ type: "rect", x: 10, y: Infinity, width: 5, height: 5 }] as unknown as IRNode[];
    expect(() => PdfBackend.serialize(bad, {} as never)).toThrow(/non-finite/);
  });

  it("does not trip on a document that merely contains the word Infinity", async () => {
    const pdf = await render(Document([Page([Text("Infinity and NaN are fine words")])]));
    expect(pdf).toContain("(Infinity and NaN are fine words)");
  });
});
