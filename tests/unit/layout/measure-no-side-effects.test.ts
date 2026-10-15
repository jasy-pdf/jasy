import { describe, it, expect } from "vitest";
import {
  Document,
  Page,
  Column,
  Row,
  Box,
  Text,
  Padding,
  Expanded,
  Table,
  Positioned,
  renderToBytes,
} from "../../../src/lib/index.ts";
import { BoxConstraints } from "../../../src/lib/layout/box-constraints.ts";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import type { LayoutContext, PDFElement } from "../../../src/lib/elements/pdf-element.ts";

// `measure` answers "how big would you be" and changes NOTHING: no position, no stored size, no
// placement queued with a frame. A parent measures first and lays a child out once afterwards, so a
// measure that moved anything would leave the drawn tree where the measurement put it.

/** Every element's geometry, read through its props, in tree order. */
const geometry = (root: PDFElement): string => {
  const out: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    const props = (node as { getProps?: () => Record<string, unknown> }).getProps?.();
    if (props) {
      const { x, y, width, height } = props;
      out.push(`${node.constructor.name} ${x} ${y} ${width} ${height}`);
      for (const value of Object.values(props)) {
        for (const kid of Array.isArray(value) ? value : [value]) walk(kid);
      }
    }
  };
  walk(root);
  return out.join("\n");
};

describe("measure has no side effects", () => {
  it("measuring a laid-out tree under other constraints moves nothing", async () => {
    const body = Column({ gap: 4 }, [
      Text("A paragraph long enough to wrap across a narrower measurement than its own."),
      Row({ gap: 6 }, [
        Box({ width: 60, border: "gray", padding: 3 }, [Text("box")]),
        Text("next"),
      ]),
      Padding(5, Column({}, [Text("padded")])),
      Row({}, [Column({}, [Expanded(Text("expanded")), Text("after")])]),
      Table({ columns: ["minmax(30, auto)", "1fr"], header: ["No", "Item"] }, [["1", "one"]]),
      Box({ relative: true, height: 40, border: "gray" }, [
        Positioned({ right: 0, top: 0 }, Text("badge")),
      ]),
    ]);
    const doc = Document([Page({ size: "A5", margin: 20 }, [body])]);
    await renderToBytes(doc);
    const before = geometry(body);

    const om = new PDFObjectManager();
    om.registerFont("Helvetica");
    const ctx: LayoutContext = { metrics: om, pageConfig: om.getPDFConfig() };
    for (const width of [80, 200, Infinity])
      body.measure(BoxConstraints.loose(width, Infinity), ctx);

    expect(geometry(body)).toBe(before);
  });
});
