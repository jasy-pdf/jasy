import { describe, it, expect, vi, beforeEach } from "vitest";
import { PageRenderer } from "../../../src/lib/renderer/page-renderer";
import { PageElement } from "../../../src/lib/elements/page-element";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { RendererRegistry } from "../../../src/lib/utils/renderer-registry";
import { PageSize } from "../../../src/lib/constants/page-sizes";

// Mock RendererRegistry.getRenderer method. Renderers now return an IRNode[]; these
// tests only check page structure (object count, references), so an empty list is fine.
vi.spyOn(RendererRegistry, "getRenderer").mockImplementation(() => {
  return vi.fn().mockResolvedValue([]);
});

describe("PageRenderer", () => {
  beforeEach(() => {
    vi.doMock("../constants/page-sizes", () => ({
      pageFormats: {
        [PageSize.A4]: [595.28, 841.89], // Beispielwert für A4
      },
    }));
  });

  it("should render a page and register the content correctly", async () => {
    // Mock PageElement
    const mockPageElement = {
      getProps: vi.fn().mockReturnValue({
        config: { pageSize: PageSize.A4 },
        children: [
          { getProps: vi.fn() }, // Child element
        ],
      }),
    } as unknown as PageElement;

    // Mock PDFObjectManager
    const mockObjectManager = {
      addObject: vi.fn().mockReturnValue(1),
      addContentStream: vi.fn().mockReturnValue(1),
      getParentObjectNumber: vi.fn().mockReturnValue(1),
      registerFont: vi.fn(),
      getAllFontsRaw: vi.fn().mockReturnValue(
        new Map([
          [
            "Helvetica",
            {
              fontIndex: 1,
              resourceIndex: 1,
            },
          ],
        ]),
      ),
      getAllImagesRaw: vi.fn().mockReturnValue(new Map()),
      getAllExtGStatesRaw: vi.fn().mockReturnValue(new Map()),
      getAllShadingsRaw: vi.fn().mockReturnValue(new Map()),
    } as unknown as PDFObjectManager;

    const pageNumber = await PageRenderer.render(mockPageElement, mockObjectManager);

    expect(mockPageElement.getProps).toHaveBeenCalled();
    expect(mockObjectManager.addContentStream).toHaveBeenCalledTimes(1); // content stream
    expect(mockObjectManager.addObject).toHaveBeenCalledTimes(1); // the page object
    expect(pageNumber).toBe(1); // Returns the page object number

    // Check if the renderer was called for the child element
    expect(RendererRegistry.getRenderer).toHaveBeenCalledWith(expect.anything());
  });

  it("should render a page with image references", async () => {
    // Mock PageElement
    const mockPageElement = {
      getProps: vi.fn().mockReturnValue({
        config: { pageSize: PageSize.A4 },
        children: [],
      }),
    } as unknown as PageElement;

    // Mock PDFObjectManager with image references
    const mockObjectManager = {
      addObject: vi.fn().mockReturnValue(1),
      addContentStream: vi.fn().mockReturnValue(1),
      getParentObjectNumber: vi.fn().mockReturnValue(1),
      registerFont: vi.fn(),
      getAllFontsRaw: vi.fn().mockReturnValue(new Map()),
      getAllImagesRaw: vi.fn().mockReturnValue(new Map([["image1", 2]])),
      getAllExtGStatesRaw: vi.fn().mockReturnValue(new Map()),
      getAllShadingsRaw: vi.fn().mockReturnValue(new Map()),
    } as unknown as PDFObjectManager;

    const pageNumber = await PageRenderer.render(mockPageElement, mockObjectManager);

    expect(mockPageElement.getProps).toHaveBeenCalled();
    expect(mockObjectManager.addContentStream).toHaveBeenCalledTimes(1); // content stream
    expect(mockObjectManager.addObject).toHaveBeenCalledTimes(1); // the page object
    expect(pageNumber).toBe(1); // Returns the page object number

    // Ensure that image references were added to the page
    expect(mockObjectManager.getAllImagesRaw).toHaveBeenCalled();
  });

  it("should handle multiple children and fonts correctly", async () => {
    // Mock PageElement
    const mockPageElement = {
      getProps: vi.fn().mockReturnValue({
        config: { pageSize: PageSize.A4 },
        children: [
          { getProps: vi.fn() },
          { getProps: vi.fn() }, // Multiple children
        ],
      }),
    } as unknown as PageElement;

    // Mock PDFObjectManager with multiple fonts
    const mockObjectManager = {
      addObject: vi.fn().mockReturnValue(1),
      addContentStream: vi.fn().mockReturnValue(1),
      getParentObjectNumber: vi.fn().mockReturnValue(1),
      registerFont: vi.fn(),
      getAllFontsRaw: vi.fn().mockReturnValue(
        new Map([
          [
            "Helvetica",
            {
              fontIndex: 1,
              resourceIndex: 1,
            },
          ],
          [
            "Times-Roman",
            {
              fontIndex: 2,
              resourceIndex: 2,
            },
          ],
        ]),
      ),
      getAllImagesRaw: vi.fn().mockReturnValue(new Map()),
      getAllExtGStatesRaw: vi.fn().mockReturnValue(new Map()),
      getAllShadingsRaw: vi.fn().mockReturnValue(new Map()),
    } as unknown as PDFObjectManager;

    const pageNumber = await PageRenderer.render(mockPageElement, mockObjectManager);

    expect(mockPageElement.getProps).toHaveBeenCalled();
    expect(mockObjectManager.addContentStream).toHaveBeenCalledTimes(1); // content stream
    expect(mockObjectManager.addObject).toHaveBeenCalledTimes(1); // the page object
    expect(pageNumber).toBe(1); // Returns the page object number

    // Ensure that font references were added
    expect(mockObjectManager.getAllFontsRaw).toHaveBeenCalled();
  });
});
