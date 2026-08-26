import { describe, it, expect, vi } from "vitest";
import { ExpandedRenderer } from "../../../src/lib/renderer/expanded-renderer";
import { RendererRegistry, MissingRendererError } from "../../../src/lib/utils/renderer-registry";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { ExpandedElement } from "../../../src/lib/elements";
import { PDFElement } from "../../../src/lib/elements/pdf-element";

describe("ExpandedRenderer", () => {
  it("should render the child element using its registered renderer", async () => {
    // Mock child element (it should be an instance of PDFElement or its subclass)
    const mockChild: PDFElement = {
      getProps: () => ({}), // Minimal implementation for PDFElement
      calculateLayout: vi.fn(),
      normalizeCoordinates: vi.fn(),
    } as unknown as PDFElement;

    // Mock the ExpandedElement with a child
    const mockExpandedElement: ExpandedElement = {
      getProps: () => ({
        child: mockChild,
        x: 0,
        y: 0,
        width: 100,
        height: 50,
      }),
      calculateLayout: vi.fn(),
      normalizeCoordinates: vi.fn(),
    } as unknown as ExpandedElement;

    // Mock PDFObjectManager
    const mockObjectManager = {} as PDFObjectManager;

    // Mock the renderer for the child element. Renderers now return an IRNode[].
    const mockChildRenderer = vi.fn().mockResolvedValue(["child-node"]);

    // Spy on RendererRegistry to return the mock renderer for the child
    vi.spyOn(RendererRegistry, "getRenderer").mockReturnValue(mockChildRenderer);

    // Call the ExpandedRenderer's render method
    const result = await ExpandedRenderer.render(mockExpandedElement, mockObjectManager);

    // Check if the mock renderer for the child was called
    expect(mockChildRenderer).toHaveBeenCalledWith(mockChild, mockObjectManager);

    // Expanded passes the child's display list straight through.
    expect(result).toEqual(["child-node"]);
  });

  // Skipping an unrenderable child silently is what let a document come out blank (ISSUE-11); the
  // registry's error must reach the caller.
  it("propagates the error when the child has no renderer", async () => {
    const mockChild: PDFElement = {
      getProps: () => ({}),
      calculateLayout: vi.fn(),
      normalizeCoordinates: vi.fn(),
    } as unknown as PDFElement;

    const mockExpandedElement: ExpandedElement = {
      getProps: () => ({
        child: mockChild,
        x: 0,
        y: 0,
        width: 100,
        height: 50,
      }),
      calculateLayout: vi.fn(),
      normalizeCoordinates: vi.fn(),
    } as unknown as ExpandedElement;

    const mockObjectManager = {} as PDFObjectManager;

    vi.spyOn(RendererRegistry, "getRenderer").mockImplementation(() => {
      throw new MissingRendererError("FakeChild");
    });

    await expect(ExpandedRenderer.render(mockExpandedElement, mockObjectManager)).rejects.toThrow(
      MissingRendererError,
    );
  });
});
