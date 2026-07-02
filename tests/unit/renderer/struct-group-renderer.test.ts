import { describe, it, expect, vi, afterEach } from "vitest";
import { StructGroupRenderer } from "../../../src/lib/renderer/struct-group-renderer";
import { StructGroup } from "../../../src/lib/elements/layout/struct-group";
import { RendererRegistry } from "../../../src/lib/utils/renderer-registry";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { PDFElement } from "../../../src/lib/elements/pdf-element";
import { IRNode } from "../../../src/lib/ir/display-list";

const group = (): StructGroup =>
  new StructGroup({ role: "Table", child: {} as unknown as PDFElement });

afterEach(() => vi.restoreAllMocks());

describe("StructGroupRenderer", () => {
  it("is transparent when accessible tagging is off (no structure element opened)", async () => {
    const childIR = [{ type: "text" }] as unknown as IRNode[];
    vi.spyOn(RendererRegistry, "getRenderer").mockReturnValue(vi.fn().mockResolvedValue(childIR));
    const struct = { enabled: false, openElement: vi.fn(), push: vi.fn(), pop: vi.fn() };
    const om = { struct } as unknown as PDFObjectManager;

    const out = await StructGroupRenderer.render(group(), om);
    expect(out).toBe(childIR); // just the child's IR
    expect(struct.openElement).not.toHaveBeenCalled();
    expect(struct.push).not.toHaveBeenCalled();
    expect(struct.pop).not.toHaveBeenCalled();
  });

  it("opens + pushes the structure element, then always pops - even if the child renderer throws", async () => {
    vi.spyOn(RendererRegistry, "getRenderer").mockReturnValue(
      vi.fn().mockRejectedValue(new Error("boom")),
    );
    const struct = {
      enabled: true,
      openElement: vi.fn().mockReturnValue(7),
      push: vi.fn(),
      pop: vi.fn(),
    };
    const om = { struct } as unknown as PDFObjectManager;

    await expect(StructGroupRenderer.render(group(), om)).rejects.toThrow("boom");
    expect(struct.openElement).toHaveBeenCalledWith(expect.any(Number), "Table");
    expect(struct.push).toHaveBeenCalledWith(7);
    expect(struct.pop).toHaveBeenCalledTimes(1); // the finally block ran despite the throw
  });
});
