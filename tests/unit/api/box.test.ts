import { describe, it, expect } from "vitest";
import { Box } from "../../../src/lib/api/layout";
import { Text } from "../../../src/lib/api/text";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { PaddingElement } from "../../../src/lib/elements/layout/padding-element";
import { ContainerElement } from "../../../src/lib/elements/container-element";

const props = (b: RectangleElement) => b.getProps() as any;

describe("Box factory", () => {
  it("no border options → borderWidth 0 (no outline)", () => {
    const b = Box([Text("a")]);
    expect(b).toBeInstanceOf(RectangleElement);
    expect(props(b).borderWidth).toBe(0);
  });

  it("border colour gives a 1pt border by default", () => {
    const b = Box({ border: "steelblue" }, [Text("a")]);
    expect(props(b).borderWidth).toBe(1);
    expect(props(b).color.toArray()).toEqual([70, 130, 180]);
  });

  it("explicit borderWidth alone still makes a border (default black)", () => {
    expect(props(Box({ borderWidth: 2 }, [Text("a")])).borderWidth).toBe(2);
  });

  it("bg maps to the fill colour, alpha preserved", () => {
    const b = Box({ bg: "#1450aa22" }, [Text("a")]);
    expect(props(b).backgroundColor.toArray()).toEqual([0x14, 0x50, 0xaa]);
    expect(props(b).backgroundColor.getAlpha()).toBeCloseTo(0x22 / 255, 5);
    expect(props(b).borderWidth).toBe(0); // bg-only box has no outline
  });

  it("radius / width / height pass through", () => {
    const b = Box({ radius: 6, width: 120, height: 40 }, [Text("a")]);
    expect(props(b).radius).toBe(6);
    expect(props(b).width).toBe(120);
    expect(props(b).height).toBe(40);
  });

  it("padding wraps a single child in one PaddingElement", () => {
    const b = Box({ padding: 10 }, [Text("a")]);
    const kids = props(b).children;
    expect(kids).toHaveLength(1);
    expect(kids[0]).toBeInstanceOf(PaddingElement);
    expect((kids[0].getProps() as any).margin).toEqual([10, 10, 10, 10]);
  });

  it("padding wraps multiple children in a Column inside the Padding", () => {
    const b = Box({ padding: { x: 8, y: 4 } }, [Text("a"), Text("b")]);
    const padding = props(b).children[0] as PaddingElement;
    expect((padding.getProps() as any).margin).toEqual([4, 8, 4, 8]);
    expect((padding.getProps() as any).child).toBeInstanceOf(ContainerElement);
  });

  it("no padding → children stacked directly in the rectangle", () => {
    const b = Box([Text("a"), Text("b")]);
    expect(props(b).children).toHaveLength(2);
    expect(props(b).children[0]).not.toBeInstanceOf(PaddingElement);
  });
});
