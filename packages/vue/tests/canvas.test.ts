import { describe, it, expect } from "vitest";
import { h, type Component } from "vue";
import { Document, Page, Canvas, toDocumentDescriptor, renderToPdfString } from "../src/index.ts";
import type { CanvasPainter } from "@jasy/pdf";

// `paint` is a function PROP, which a Vue template passes like any other value - unlike a component
// whose CHILD is a closure, which has no template form at all.

const comp = (render: () => any): Component => ({ render });
const draw = (c: CanvasPainter) => void c.rect(0, 0, 10, 10).fill("#1450aa");

describe("<JasyCanvas>", () => {
  it("declares the options the Canvas factory takes", () => {
    const props = Object.keys((Canvas as { props?: object }).props ?? {});
    expect(props).toEqual(expect.arrayContaining(["paint", "width", "height", "alt"]));
  });

  it("reaches the descriptor as a `canvas` node, callback and all", () => {
    const desc = toDocumentDescriptor(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () => h(Canvas, { paint: draw, width: 40, height: 20 })),
        ),
      ),
    );
    const page = desc.children![0] as {
      children: { type: string; props: Record<string, unknown> }[];
    };
    expect(page.children[0]!.type).toBe("canvas");
    expect(page.children[0]!.props["paint"]).toBe(draw);
  });

  it("renders what the callback drew", async () => {
    const pdf = await renderToPdfString(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () => h(Canvas, { paint: draw, width: 40, height: 20 })),
        ),
      ),
      undefined,
      { compress: false },
    );
    expect(pdf).toContain("0.078 0.314 0.667 rg");
  });

  it("is handed the size the layout resolved", async () => {
    let seen = 0;
    await renderToPdfString(
      comp(() =>
        h(Document, null, () =>
          h(Page, null, () =>
            h(Canvas, {
              paint: (_c: CanvasPainter, s: { width: number }) => void (seen = s.width),
              width: 44,
              height: 20,
            }),
          ),
        ),
      ),
    );
    expect(seen).toBe(44);
  });
});
