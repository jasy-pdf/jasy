import { describe, it, expect } from "vitest";
import { Column, Row } from "../../../src/lib/api/layout";
import { Text } from "../../../src/lib/api/text";
import { ContainerElement } from "../../../src/lib/elements/container-element";
import { RowElement } from "../../../src/lib/elements/row-element";

describe("Column factory", () => {
  it("builds a ContainerElement, children-only form", () => {
    const c = Column([Text("a"), Text("b")]);
    expect(c).toBeInstanceOf(ContainerElement);
    expect((c.getProps().children as unknown[]).length).toBe(2);
  });

  it("the public cross default is `start` (not the engine `stretch`)", () => {
    expect(Column([]).getProps().cross).toBe("start");
  });

  it("passes gap / justify / align through (→ engine main / cross)", () => {
    const c = Column({ gap: 12, justify: "between", align: "center" }, [Text("a")]);
    const p = c.getProps();
    expect(p.gap).toBe(12);
    expect(p.main).toBe("between");
    expect(p.cross).toBe("center");
  });
});

describe("Row factory", () => {
  it("builds a RowElement with the same `start` cross default", () => {
    const r = Row([Text("a")]);
    expect(r).toBeInstanceOf(RowElement);
    expect((r.getProps() as { cross: string }).cross).toBe("start");
  });

  it("passes options through, opts + children form", () => {
    const r = Row({ gap: 8, justify: "center" }, [Text("a"), Text("b")]);
    const p = r.getProps() as { gap: number; main: string; children: unknown[] };
    expect(p.gap).toBe(8);
    expect(p.main).toBe("center");
    expect(p.children.length).toBe(2);
  });
});
