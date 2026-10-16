import { describe, it, expect, vi } from "vitest";
import { RotatedRenderer } from "../../../src/lib/renderer/rotated-renderer.ts";
import { RendererRegistry } from "../../../src/lib/utils/renderer-registry.ts";
import type { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import type { RotatedElement } from "../../../src/lib/elements/layout/rotated-element.ts";
import type { IRNode } from "../../../src/lib/ir/display-list.ts";

describe("RotatedRenderer", () => {
  it("draws the child relative to the box, rotated around the box centre", async () => {
    const child = { getProps: vi.fn() };
    const renderer = vi.fn(async (): Promise<IRNode[]> => []);
    vi.spyOn(RendererRegistry, "getRenderer").mockReturnValue(renderer);
    const element = {
      getProps: () => ({ angle: 90, child, x: 10, y: 20, width: 40, height: 20 }),
    } as unknown as RotatedElement;
    const om = {} as PDFObjectManager;

    const nodes = await RotatedRenderer.render(element, om, {
      origin: { x: 100, y: 200 },
      frame: { x: 0, y: 0 },
    });

    expect(renderer).toHaveBeenCalledWith(child, om, {
      origin: { x: 110, y: 220 },
      frame: { x: 0, y: 0 },
    });
    // The centre (110 + 20, 220 + 10) is the fixed point of the rotation.
    const push = nodes[0];
    expect(push?.type).toBe("transform-push");
    if (push?.type !== "transform-push") return;
    const [a, b, c, d, e, f] = push.matrix;
    expect(a * 130 + c * 230 + e).toBeCloseTo(130);
    expect(b * 130 + d * 230 + f).toBeCloseTo(230);
  });
});
