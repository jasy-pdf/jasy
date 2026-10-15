import { describe, it, expect, vi } from "vitest";
import { RepeatingHeaderRenderer } from "../../../src/lib/renderer/repeating-header-renderer.ts";
import { RendererRegistry } from "../../../src/lib/utils/renderer-registry.ts";
import type { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import type { RepeatingHeaderElement } from "../../../src/lib/elements/layout/repeating-header-element.ts";
import type { IRNode } from "../../../src/lib/ir/display-list.ts";

describe("RepeatingHeaderRenderer", () => {
  it("renders header then body, both relative to its own top-left", async () => {
    const header = { getProps: vi.fn() };
    const body = { getProps: vi.fn() };
    const renderer = vi.fn(async (): Promise<IRNode[]> => []);
    vi.spyOn(RendererRegistry, "getRenderer").mockReturnValue(renderer);
    const element = {
      getProps: () => ({ x: 3, y: 4, width: 100, height: 60, header, body }),
    } as unknown as RepeatingHeaderElement;
    const om = {} as PDFObjectManager;

    await RepeatingHeaderRenderer.render(element, om, {
      origin: { x: 12, y: 34 },
      frame: { x: 5, y: 6 },
    });

    const inner = { origin: { x: 15, y: 38 }, frame: { x: 5, y: 6 } };
    expect(renderer.mock.calls).toEqual([
      [header, om, inner],
      [body, om, inner],
    ]);
  });
});
