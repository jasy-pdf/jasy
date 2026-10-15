import { describe, it, expect, vi, beforeEach } from "vitest";
import { RectangleRenderer } from "../../../src/lib/renderer/rectangle-renderer.ts";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { RendererRegistry } from "../../../src/lib/utils/renderer-registry.ts";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element.ts";
import { Color } from "../../../src/lib/common/color.ts";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend.ts";
import type { IRNode } from "../../../src/lib/ir/display-list.ts";
import { PAGE_SCOPE } from "../support/scope.ts";

describe("RectangleRenderer", () => {
  let mockObjectManager: PDFObjectManager;

  beforeEach(() => {
    mockObjectManager = {} as PDFObjectManager;
    vi.restoreAllMocks();
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
      await RectangleRenderer.render(mockRectangleElement, mockObjectManager, PAGE_SCOPE),
      mockObjectManager,
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
      await RectangleRenderer.render(mockRectangleElement, mockObjectManager, PAGE_SCOPE),
      mockObjectManager,
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
      await RectangleRenderer.render(mockRectangleElement, mockObjectManager, PAGE_SCOPE),
      mockObjectManager,
    );

    expect(result).toBe("1 w\n0.000 0.000 1.000 RG\n0.000 1.000 0.000 rg\n10 20 100 50 re B\n");
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

    // A sentinel stands in for the child's node, which the rectangle appends after its own box node.
    const childNode: IRNode = {
      type: "line",
      x1: 1,
      y1: 2,
      x2: 3,
      y2: 4,
      stroke: new Color(0, 0, 0),
      strokeWidth: 1,
    };
    const childRenderer = vi.fn(async (): Promise<IRNode[]> => [childNode]);
    vi.spyOn(RendererRegistry, "getRenderer").mockReturnValue(childRenderer);

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
      mockObjectManager,
      PAGE_SCOPE,
    );

    // The box node comes first, then the child's nodes are appended.
    expect(result[0]).toMatchObject({
      type: "rect",
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
    expect(result[result.length - 1]).toBe(childNode);
    expect(RendererRegistry.getRenderer).toHaveBeenCalledWith(mockChildElement);
    // A plain box is no frame: its children keep the frame they were handed.
    expect(childRenderer).toHaveBeenCalledWith(mockChildElement, mockObjectManager, PAGE_SCOPE);
  });

  it("makes a relative box the frame for its subtree", async () => {
    const child = { getProps: vi.fn() };
    const childRenderer = vi.fn(async (): Promise<IRNode[]> => []);
    vi.spyOn(RendererRegistry, "getRenderer").mockReturnValue(childRenderer);
    const box = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        color: new Color(0, 0, 0),
        borderWidth: 1,
        relative: true,
        children: [child],
      }),
    } as unknown as RectangleElement;

    const scope = { origin: { x: 5, y: 7 }, frame: { x: 1, y: 1 } };
    await RectangleRenderer.render(box, mockObjectManager, scope);

    // Its absolute top-left (origin + own offset) is where its `Positioned` descendants draw from.
    expect(childRenderer).toHaveBeenCalledWith(child, mockObjectManager, {
      origin: { x: 5, y: 7 },
      frame: { x: 15, y: 27 },
    });
  });
});
