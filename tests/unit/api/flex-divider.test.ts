import { describe, it, expect } from "vitest";
import { Spacer, Expanded } from "../../../src/lib/api/layout";
import { Divider } from "../../../src/lib/api/content";
import { Text } from "../../../src/lib/api/text";
import { ExpandedElement } from "../../../src/lib/elements/layout/expanded-element";
import { PaddingElement } from "../../../src/lib/elements/layout/padding-element";
import { LineElement } from "../../../src/lib/elements/line-element";

describe("Spacer", () => {
  it("is a flex ExpandedElement, default flex 1", () => {
    const s = Spacer();
    expect(s).toBeInstanceOf(ExpandedElement);
    expect(s.getFlex()).toBe(1);
  });

  it("takes a flex weight", () => {
    expect(Spacer(3).getFlex()).toBe(3);
  });
});

describe("Expanded", () => {
  it("wraps a child, child-only form, default flex 1", () => {
    const e = Expanded(Text("a"));
    expect(e).toBeInstanceOf(ExpandedElement);
    expect(e.getFlex()).toBe(1);
    expect(e.getProps().child).toBeDefined();
  });

  it("takes a flex option in the opts form", () => {
    const e = Expanded({ flex: 2 }, Text("a"));
    expect(e.getFlex()).toBe(2);
  });
});

describe("Divider", () => {
  it("is a LineElement wrapped in padding for vertical room", () => {
    const d = Divider() as PaddingElement;
    expect(d).toBeInstanceOf(PaddingElement);
    const p = d.getProps() as any;
    expect(p.child).toBeInstanceOf(LineElement);
    expect(p.margin).toEqual([6, 0, 6, 0]); // default {y:6}
  });

  it("maps color / thickness / margin", () => {
    const d = Divider({ color: "steelblue", thickness: 2, margin: 10 }) as PaddingElement;
    const line = (d.getProps() as any).child as LineElement;
    const lp = line.getProps() as any;
    expect(lp.color.toArray()).toEqual([70, 130, 180]);
    expect(lp.strokeWidth).toBe(2);
    expect((d.getProps() as any).margin).toEqual([10, 10, 10, 10]);
  });
});
