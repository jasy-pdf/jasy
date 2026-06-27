import { describe, it, expect } from "vitest";
import { wrapStringIntoLines } from "../../../src/lib/text/line-breaker";
import { TextElement } from "../../../src/lib/elements/text-element";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints";
import { LayoutContext } from "../../../src/lib/elements/pdf-element";
import { FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { FontMetrics } from "../../../src/lib/utils/font-metrics";
import { Text } from "../../../src/lib/api";

// Every glyph (and the space) is 10pt wide, no kerning -> "alfa" = 40pt. Deterministic wrapping.
const metrics = {
  getStringWidth: (t: string) => t.length * 10,
  getCharWidth: () => 10,
} as unknown as FontMetrics;

const wrap = (text: string, maxWidth: number, maxLines?: number, overflow?: "clip" | "ellipsis") =>
  wrapStringIntoLines(
    text,
    "Helvetica",
    10,
    FontStyle.Normal,
    maxWidth,
    metrics,
    maxLines,
    overflow,
  );

const TEXT = "alfa bram char dent emil"; // five 4-letter words; at 50pt each lands on its own line

describe("text truncation - maxLines + overflow", () => {
  it("open-end by default: wraps as many lines as it needs", () => {
    expect(wrap(TEXT, 50).length).toBe(5);
  });

  it("maxLines caps the line count", () => {
    expect(wrap(TEXT, 50, 2).length).toBe(2);
  });

  it("clip cuts hard - no ellipsis", () => {
    expect(wrap(TEXT, 50, 2, "clip")).toEqual(["alfa", "bram"]);
  });

  it("ellipsis ends the last kept line with ... and still fits the width", () => {
    const lines = wrap(TEXT, 50, 2, "ellipsis");
    expect(lines.length).toBe(2);
    expect(lines[1].endsWith("...")).toBe(true);
    expect(metrics.getStringWidth(lines[1], "Helvetica", 10, FontStyle.Normal)).toBeLessThanOrEqual(
      50,
    );
  });

  it("no truncation when the text already fits within maxLines", () => {
    expect(wrap("alfa", 50, 2, "ellipsis")).toEqual(["alfa"]); // one line, no ...
  });

  it("TextElement: maxLines caps the laid-out height", () => {
    const ctx = { metrics, pageConfig: {} } as LayoutContext;
    const el = new TextElement({ fontSize: 10, content: TEXT, maxLines: 2 });
    el.calculateLayout(BoxConstraints.loose(50, Infinity), { x: 0, y: 0 }, ctx);
    expect(el.getProps().height).toBe(20); // 2 lines x 10, not the full 5
  });

  it("Text({ maxLines, overflow }) flows through to the element", () => {
    const el = Text("hello world", { size: 10, maxLines: 3, overflow: "ellipsis" });
    expect(el.getProps().maxLines).toBe(3);
    expect(el.getProps().overflow).toBe("ellipsis");
  });
});
