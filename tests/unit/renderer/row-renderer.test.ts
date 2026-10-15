import { describe, it, expect, vi } from "vitest";
import { RowRenderer } from "../../../src/lib/renderer/row-renderer.ts";
import { RendererRegistry } from "../../../src/lib/utils/renderer-registry.ts";
import type { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import type { RowElement } from "../../../src/lib/elements/row-element.ts";
import type { IRNode } from "../../../src/lib/ir/display-list.ts";

describe("RowRenderer", () => {
  it("renders its children in order, relative to its own top-left", async () => {
    const a = { getProps: vi.fn() };
    const b = { getProps: vi.fn() };
    const renderer = vi.fn(async (): Promise<IRNode[]> => []);
    vi.spyOn(RendererRegistry, "getRenderer").mockReturnValue(renderer);
    const row = {
      getProps: () => ({ x: 3, y: 4, width: 100, height: 20, children: [a, b] }),
    } as unknown as RowElement;
    const om = {} as PDFObjectManager;

    await RowRenderer.render(row, om, { origin: { x: 12, y: 34 }, frame: { x: 5, y: 6 } });

    const inner = { origin: { x: 15, y: 38 }, frame: { x: 5, y: 6 } };
    expect(renderer.mock.calls).toEqual([
      [a, om, inner],
      [b, om, inner],
    ]);
  });
});
