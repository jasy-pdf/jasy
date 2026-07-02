import { describe, it, expect, vi } from "vitest";
import { ImageRenderer } from "../../../src/lib/renderer/image-renderer";
import { ImageElement, BoxFit } from "../../../src/lib/elements/image-element";
import { PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend";
import * as imageHelper from "../../../src/lib/utils/image-helper";

describe("ImageRenderer", () => {
  it("should render an image with the correct placement and size for 'cover' fit", async () => {
    // Mock ImageElement
    const mockImageElement = {
      getProps: vi.fn().mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        image: {
          init: vi.fn().mockResolvedValue(undefined),
          getImageType: vi.fn().mockResolvedValue("jpeg"),
          getFileData: vi.fn().mockResolvedValue("mockImageData"),
          getImageDimensions: vi.fn().mockResolvedValue({
            width: 200,
            height: 200,
          }),
        },
        fit: BoxFit.cover,
      }),
    } as unknown as ImageElement;

    // Mock PDFObjectManager
    const mockObjectManager = {
      registerImage: vi.fn().mockReturnValue(1),
      struct: { enabled: false },
    } as unknown as PDFObjectManager;

    // Mock applyCoverFit using vi.mock or by mocking the module directly
    vi.spyOn(imageHelper, "applyCoverFit").mockReturnValue({
      width: 100,
      height: 100,
      offsetX: 0,
      offsetY: 0,
    });

    // The renderer now returns an IRNode[]; the backend serializes it and registers
    // the image XObject (which is what the registerImage assertions below check).
    const result = PdfBackend.serialize(
      await ImageRenderer.render(mockImageElement, mockObjectManager),
      mockObjectManager,
    );

    expect(mockImageElement.getProps).toHaveBeenCalled();
    // JPEG carries no alpha, so the 5th arg (smask) is undefined.
    expect(mockObjectManager.registerImage).toHaveBeenCalledWith(
      200,
      200,
      "jpeg",
      "mockImageData",
      undefined,
    );

    expect(result).toContain("q");
    expect(result).toContain("/IM1 Do");
  });

  it("should render an image with the correct placement and size for 'contain' fit", async () => {
    // Mock ImageElement
    const mockImageElement = {
      getProps: vi.fn().mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        image: {
          init: vi.fn().mockResolvedValue(undefined),
          getImageType: vi.fn().mockResolvedValue("jpeg"),
          getFileData: vi.fn().mockResolvedValue("mockImageData"),
          getImageDimensions: vi.fn().mockResolvedValue({
            width: 200,
            height: 200,
          }),
        },
        fit: BoxFit.contain,
      }),
    } as unknown as ImageElement;

    // Mock PDFObjectManager
    const mockObjectManager = {
      registerImage: vi.fn().mockReturnValue(2),
      struct: { enabled: false },
    } as unknown as PDFObjectManager;

    // Mock applyContainFit using vi.spyOn for the whole module
    vi.spyOn(imageHelper, "applyContainFit").mockReturnValue({
      width: 80,
      height: 80,
      offsetX: 10,
      offsetY: 10,
    });

    // The renderer now returns an IRNode[]; the backend serializes it and registers
    // the image XObject (which is what the registerImage assertions below check).
    const result = PdfBackend.serialize(
      await ImageRenderer.render(mockImageElement, mockObjectManager),
      mockObjectManager,
    );

    expect(mockImageElement.getProps).toHaveBeenCalled();
    // JPEG carries no alpha, so the 5th arg (smask) is undefined.
    expect(mockObjectManager.registerImage).toHaveBeenCalledWith(
      200,
      200,
      "jpeg",
      "mockImageData",
      undefined,
    );

    expect(result).toContain("q");
    expect(result).toContain("/IM2 Do");
  });

  it("should throw an error if file data is null", async () => {
    // Mock ImageElement with no fileData
    const mockImageElement = {
      getProps: vi.fn().mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        image: {
          init: vi.fn().mockResolvedValue(undefined),
          getImageType: vi.fn().mockResolvedValue("jpeg"),
          getFileData: vi.fn().mockResolvedValue(null),
          getImageDimensions: vi.fn().mockResolvedValue({
            width: 200,
            height: 200,
          }),
        },
        fit: BoxFit.fill,
      }),
    } as unknown as ImageElement;

    // Mock PDFObjectManager
    const mockObjectManager = {} as PDFObjectManager;

    await expect(ImageRenderer.render(mockImageElement, mockObjectManager)).rejects.toThrow(
      "File data cannot be `null`",
    );
  });

  it("should render an image with the correct placement and size for 'fill' fit", async () => {
    // Mock ImageElement
    const mockImageElement = {
      getProps: vi.fn().mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        image: {
          init: vi.fn().mockResolvedValue(undefined),
          getImageType: vi.fn().mockResolvedValue("jpeg"),
          getFileData: vi.fn().mockResolvedValue("mockImageData"),
          getImageDimensions: vi.fn().mockResolvedValue({
            width: 200,
            height: 200,
          }),
        },
        fit: BoxFit.fill,
      }),
    } as unknown as ImageElement;

    // Mock PDFObjectManager
    const mockObjectManager = {
      registerImage: vi.fn().mockReturnValue(3),
      struct: { enabled: false },
    } as unknown as PDFObjectManager;

    // Mock applyFillFit using vi.spyOn for the whole module
    vi.spyOn(imageHelper, "applyFillFit").mockReturnValue({
      width: 100,
      height: 100,
      offsetX: 0,
      offsetY: 0,
    });

    // The renderer now returns an IRNode[]; the backend serializes it and registers
    // the image XObject (which is what the registerImage assertions below check).
    const result = PdfBackend.serialize(
      await ImageRenderer.render(mockImageElement, mockObjectManager),
      mockObjectManager,
    );

    expect(mockImageElement.getProps).toHaveBeenCalled();
    // JPEG carries no alpha, so the 5th arg (smask) is undefined.
    expect(mockObjectManager.registerImage).toHaveBeenCalledWith(
      200,
      200,
      "jpeg",
      "mockImageData",
      undefined,
    );

    expect(result).toContain("q");
    expect(result).toContain("/IM3 Do");
  });

  it("should render an image with the correct placement and size for 'none' fit", async () => {
    // Mock ImageElement
    const mockImageElement = {
      getProps: vi.fn().mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        image: {
          init: vi.fn().mockResolvedValue(undefined),
          getImageType: vi.fn().mockResolvedValue("jpeg"),
          getFileData: vi.fn().mockResolvedValue("mockImageData"),
          getImageDimensions: vi.fn().mockResolvedValue({
            width: 200,
            height: 200,
          }),
        },
        fit: BoxFit.none,
      }),
    } as unknown as ImageElement;

    // Mock PDFObjectManager
    const mockObjectManager = {
      registerImage: vi.fn().mockReturnValue(4),
      struct: { enabled: false },
    } as unknown as PDFObjectManager;

    // Mock applyFitNone using vi.spyOn for the whole module
    vi.spyOn(imageHelper, "applyFitNone").mockReturnValue({
      width: 280,
      height: 210,
      offsetX: 0,
      offsetY: 0,
    });

    // The renderer now returns an IRNode[]; the backend serializes it and registers
    // the image XObject (which is what the registerImage assertions below check).
    const result = PdfBackend.serialize(
      await ImageRenderer.render(mockImageElement, mockObjectManager),
      mockObjectManager,
    );

    expect(mockImageElement.getProps).toHaveBeenCalled();
    // JPEG carries no alpha, so the 5th arg (smask) is undefined.
    expect(mockObjectManager.registerImage).toHaveBeenCalledWith(
      200,
      200,
      "jpeg",
      "mockImageData",
      undefined,
    );

    expect(result).toContain("q");
    expect(result).toContain("/IM4 Do");
  });
  it("tags an image with alt text as a Figure (accessible)", async () => {
    const mockImageElement = {
      getProps: vi.fn().mockReturnValue({
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        image: {
          init: vi.fn().mockResolvedValue(undefined),
          getImageType: vi.fn().mockResolvedValue("jpeg"),
          getFileData: vi.fn().mockResolvedValue("mockImageData"),
          getImageDimensions: vi.fn().mockResolvedValue({ width: 200, height: 200 }),
        },
        fit: BoxFit.none,
        alt: "a sample photo",
      }),
    } as unknown as ImageElement;
    const mockObjectManager = {
      registerImage: vi.fn().mockReturnValue(1),
      struct: { enabled: true, openElement: () => 7 },
    } as unknown as PDFObjectManager;
    vi.spyOn(imageHelper, "applyFitNone").mockReturnValue({
      width: 100,
      height: 100,
      offsetX: 0,
      offsetY: 0,
    });
    const [node] = await ImageRenderer.render(mockImageElement, mockObjectManager);
    expect((node as { tag?: unknown }).tag).toEqual({ role: "Figure", key: 7 });
  });
});
