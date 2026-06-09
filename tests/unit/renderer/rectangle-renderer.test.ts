import { describe, it, expect, vi, beforeEach } from "vitest";
import { RectangleRenderer } from "../../../src/lib/renderer/rectangle-renderer";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { RendererRegistry } from "../../../src/lib/utils/renderer-registry";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { Color } from "../../../src/lib/common/color";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend";

describe("RectangleRenderer", () => {
  let mockObjectManager: PDFObjectManager;

  beforeEach(() => {
    mockObjectManager = {} as PDFObjectManager;

    // Mock RendererRegistry.getRenderer
    vi.spyOn(RendererRegistry, "getRenderer").mockReturnValue(undefined);
  });

  it("should render a rectangle with default black stroke and no background", async () => {
    const mockRectangleElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        color: new Color(0, 0, 0),
        backgroundColor: undefined,
        borderWidth: 1,
        children: [],
      }),
    } as unknown as RectangleElement;

    const result = PdfBackend.serialize(
      await RectangleRenderer.render(mockRectangleElement, mockObjectManager),
      mockObjectManager
    );

    expect(result).toBe("1 w\n0.000 0.000 0.000 RG\n10 20 100 50 re S\n");
  });

  it("should render a rectangle with a custom border color and no background", async () => {
    const mockRectangleElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        color: new Color(255, 0, 0), // Red border color
        backgroundColor: undefined,
        borderWidth: 2,
        children: [],
      }),
    } as unknown as RectangleElement;

    const result = PdfBackend.serialize(
      await RectangleRenderer.render(mockRectangleElement, mockObjectManager),
      mockObjectManager
    );

    expect(result).toBe("2 w\n1.000 0.000 0.000 RG\n10 20 100 50 re S\n");
  });

  it("should render a rectangle with a custom background color", async () => {
    const mockRectangleElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        color: new Color(0, 0, 255), // Blue border color
        backgroundColor: new Color(0, 255, 0), // Green background
        borderWidth: 1,
        children: [],
      }),
    } as unknown as RectangleElement;

    const result = PdfBackend.serialize(
      await RectangleRenderer.render(mockRectangleElement, mockObjectManager),
      mockObjectManager
    );

    expect(result).toBe(
      "1 w\n0.000 0.000 1.000 RG\n0.000 1.000 0.000 rg\n10 20 100 50 re B\n"
    );
  });

  it("should render a rectangle and its children", async () => {
    const mockChildElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 50,
        height: 25,
      }),
    };

    // Mock child renderer. Renderers return an IRNode[]; a sentinel stands in for
    // the child's node, which the rectangle appends after its own box node.
    vi.spyOn(RendererRegistry, "getRenderer").mockReturnValue(async () => {
      return ["child-node"];
    });

    const mockRectangleElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        color: new Color(0, 0, 255), // Blue border color
        backgroundColor: new Color(0, 255, 0), // Green background
        borderWidth: 1,
        children: [mockChildElement],
      }),
    } as unknown as RectangleElement;

    const result = await RectangleRenderer.render(
      mockRectangleElement,
      mockObjectManager
    );

    // The box node comes first, then the child's nodes are appended.
    expect(result[0]).toMatchObject({
      type: "rect",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
    expect(result[result.length - 1]).toBe("child-node");
    expect(RendererRegistry.getRenderer).toHaveBeenCalledWith(mockChildElement);
  });
});
