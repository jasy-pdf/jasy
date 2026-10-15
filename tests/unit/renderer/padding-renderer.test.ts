import { describe, it, expect, vi } from "vitest";
import { PaddingRenderer } from "../../../src/lib/renderer/padding-renderer.ts";
import { PaddingElement } from "../../../src/lib/elements/layout/padding-element.ts";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import {
  RendererRegistry,
  MissingRendererError,
} from "../../../src/lib/utils/renderer-registry.ts";
import { PAGE_SCOPE } from "../support/scope.ts";

// Mock RendererRegistry.getRenderer method. Renderers now return an IRNode[];
// "rendered child content" stands in for a node passed straight through.
vi.spyOn(RendererRegistry, "getRenderer").mockImplementation(() => {
  return vi.fn().mockResolvedValue(["rendered child content"]);
});

describe("PaddingRenderer", () => {
  it("should render the content of the child element", async () => {
    // Mock PaddingElement
    const mockPaddingElement = {
      getProps: vi.fn().mockReturnValue({
        child: {
          getProps: vi.fn().mockReturnValue({
            x: 10,
            y: 20,
            width: 100,
            height: 50,
          }),
        },
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      }),
    } as unknown as PaddingElement;

    // Mock PDFObjectManager
    const mockObjectManager = {} as PDFObjectManager;

    const result = await PaddingRenderer.render(mockPaddingElement, mockObjectManager, PAGE_SCOPE);

    expect(mockPaddingElement.getProps).toHaveBeenCalled();
    expect(result).toContain("rendered child content");
  });

  // A child with no renderer used to yield an empty display list - silently. It is a bug either way,
  // so the renderer now lets the registry's error through (ISSUE-11).
  it("propagates the error when no renderer is found", async () => {
    vi.spyOn(RendererRegistry, "getRenderer").mockImplementation(() => {
      throw new MissingRendererError("FakeChild");
    });

    const mockPaddingElement = {
      getProps: vi.fn().mockReturnValue({
        child: {
          getProps: vi.fn().mockReturnValue({
            x: 10,
            y: 20,
            width: 100,
            height: 50,
          }),
        },
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      }),
    } as unknown as PaddingElement;

    const mockObjectManager = {} as PDFObjectManager;

    await expect(
      PaddingRenderer.render(mockPaddingElement, mockObjectManager, PAGE_SCOPE),
    ).rejects.toThrow(MissingRendererError);
  });
});
