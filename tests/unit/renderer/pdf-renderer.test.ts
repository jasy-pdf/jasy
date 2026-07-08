import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFRenderer } from "../../../src/lib/renderer/pdf-renderer";
import { PDFDocumentElement } from "../../../src/lib/elements/pdf-document-element";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { RendererRegistry } from "../../../src/lib/utils/renderer-registry";
import { TextElement } from "../../../src/lib/elements/text-element";
import { ContainerElement } from "../../../src/lib/elements/container-element";
import { RectangleElement } from "../../../src/lib/elements/rectangle-element";
import { ImageElement } from "../../../src/lib/elements/image-element";
import { ExpandedElement, PaddingElement } from "../../../src/lib/elements";
import { PDFDocumentRenderer } from "../../../src/lib/renderer/pdf-document-renderer";

describe("PDFRenderer", () => {
  let mockObjectManager: PDFObjectManager;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear all mocks

    // Mock PDFObjectManager methods. getPDFConfig seeds the layout context.
    mockObjectManager = {
      addObject: vi.fn().mockReturnValue(1),
      getRenderedObjects: vi.fn().mockReturnValue("mocked rendered objects\n"),
      getXRefTable: vi.fn().mockReturnValue("xref table\n"),
      getTrailerAndXRef: vi.fn().mockReturnValue("trailer\nstartxref\n33"),
      getParentObjectNumber: vi.fn().mockReturnValue(1),
      getPDFConfig: vi.fn().mockReturnValue({}),
      getOverflowPolicy: vi.fn().mockReturnValue("ignore"),
      getAttachments: vi.fn().mockReturnValue([]),
      getXmpMetadata: vi.fn().mockReturnValue(undefined),
      getOutputIntent: vi.fn().mockReturnValue(undefined),
      getPdfVersion: vi.fn().mockReturnValue("1.4"),
      getHeader: vi.fn().mockReturnValue("%PDF-1.4\n"),
      finalizeCustomFonts: vi.fn(),
      finalizeEncryption: vi.fn().mockResolvedValue(undefined),
      struct: { enabled: false, finalize: vi.fn().mockReturnValue("") },
      outline: { isEmpty: true, finalize: vi.fn().mockReturnValue("") },
      dests: { isEmpty: true, finalize: vi.fn().mockReturnValue("") },
    } as unknown as PDFObjectManager;

    vi.spyOn(PDFDocumentRenderer, "render").mockResolvedValue(1);

    // Mock RendererRegistry registration
    vi.spyOn(RendererRegistry, "register");
  });

  it("should register all renderers", async () => {
    const mockDocumentElement = {
      calculateLayout: vi.fn(),
      getDefaultTextStyle: vi.fn(),
      getProps: vi.fn().mockReturnValue({ children: [] }),
    } as unknown as PDFDocumentElement;

    await PDFRenderer.render(mockDocumentElement, mockObjectManager);

    // Check that all the renderers are registered
    expect(RendererRegistry.register).toHaveBeenCalledWith(TextElement, expect.any(Function));
    expect(RendererRegistry.register).toHaveBeenCalledWith(ContainerElement, expect.any(Function));
    expect(RendererRegistry.register).toHaveBeenCalledWith(RectangleElement, expect.any(Function));
    expect(RendererRegistry.register).toHaveBeenCalledWith(ExpandedElement, expect.any(Function));
    expect(RendererRegistry.register).toHaveBeenCalledWith(PaddingElement, expect.any(Function));
    expect(RendererRegistry.register).toHaveBeenCalledWith(ImageElement, expect.any(Function));
  });

  it("should call calculateLayout on the document element", async () => {
    const mockDocumentElement = {
      calculateLayout: vi.fn(),
      getDefaultTextStyle: vi.fn(),
      getProps: vi.fn().mockReturnValue({ children: [] }),
    } as unknown as PDFDocumentElement;

    await PDFRenderer.render(mockDocumentElement, mockObjectManager);

    // Check that calculateLayout was called
    expect(mockDocumentElement.calculateLayout).toHaveBeenCalled();
  });

  it("should generate correct PDF content", async () => {
    const mockDocumentElement = {
      calculateLayout: vi.fn(),
      getDefaultTextStyle: vi.fn(),
      getProps: vi.fn().mockReturnValue({ children: [] }),
    } as unknown as PDFDocumentElement;

    const result = await PDFRenderer.render(mockDocumentElement, mockObjectManager);

    // Verify the structure of the generated PDF content
    expect(result).toContain("%PDF-1.4\n");
    expect(result).toContain("mocked rendered objects");
    expect(result).toContain("xref table");
    expect(result).toContain("trailer");
  });

  it("should add the catalog object", async () => {
    const mockDocumentElement = {
      calculateLayout: vi.fn(),
      getDefaultTextStyle: vi.fn(),
      getProps: vi.fn().mockReturnValue({ children: [] }),
    } as unknown as PDFDocumentElement;

    await PDFRenderer.render(mockDocumentElement, mockObjectManager);

    expect(mockObjectManager.addObject).toHaveBeenCalledWith("<< /Type /Catalog /Pages 1 0 R >>");
  });

  it("should add the correct XRef and trailer", async () => {
    const mockDocumentElement = {
      calculateLayout: vi.fn(),
      getDefaultTextStyle: vi.fn(),
      getProps: vi.fn().mockReturnValue({ children: [] }),
    } as unknown as PDFDocumentElement;

    const result = await PDFRenderer.render(mockDocumentElement, mockObjectManager);

    // Check that XRef and trailer are appended correctly
    const startxref = result.indexOf("xref table");
    expect(result).toContain("xref table");
    expect(result).toContain(`startxref\n${startxref}`);
    expect(result).toContain("trailer");
  });

  it("should handle an empty document", async () => {
    const mockDocumentElement = {
      getProps: vi.fn().mockReturnValue({ children: [] }),
      calculateLayout: vi.fn(),
      getDefaultTextStyle: vi.fn(),
    } as unknown as PDFDocumentElement;

    const result = await PDFRenderer.render(mockDocumentElement, mockObjectManager);

    // Check that an empty document is handled correctly
    expect(result).toContain("%PDF-1.4\n");
    expect(result).toContain("mocked rendered objects");
    expect(result).toContain("xref table");
    expect(result).toContain("trailer");
  });
});
