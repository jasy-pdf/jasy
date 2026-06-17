import { describe, it, expect, vi, Mock } from "vitest";
import {
  applyContainFit,
  applyCoverFit,
  applyFillFit,
  applyFitNone,
  convertImageToGrayscaleBuffer,
} from "../../../src/lib/utils/image-helper";
import { Jimp, JimpMime } from "jimp";

vi.mock("jimp", () => ({
  Jimp: {
    read: vi.fn(),
    MIME_PNG: "image/png",
    MIME_JPEG: "image/jpeg",
    MIME_BMP: "image/bmp",
  },
  JimpMime: {
    png: "image/png",
    jpeg: "image/jpeg",
    bmp: "image/bmp",
  },
}));

describe("convertImageToGrayscaleBuffer", () => {
  it("should convert PNG image to grayscale buffer", async () => {
    const imageMock = {
      mime: "image/png",
      greyscale: vi.fn(),
      getBuffer: vi.fn().mockResolvedValue(Buffer.from("mocked buffer")), // Mock getBuffer als Promise
    };

    (Jimp.read as unknown as Mock).mockResolvedValue(imageMock);

    const buffer = await convertImageToGrayscaleBuffer("path/to/png/image.png");
    expect(buffer).toEqual(Buffer.from("mocked buffer"));
    expect(imageMock.greyscale).toHaveBeenCalled();
    expect(imageMock.getBuffer).toHaveBeenCalledWith("image/png");
  });

  it("should throw an error for unsupported MIME types", async () => {
    const imageMock = {
      mime: "image/gif",
    };

    (Jimp.read as unknown as Mock).mockResolvedValue(imageMock);

    await expect(convertImageToGrayscaleBuffer("path/to/gif/image.gif")).rejects.toThrow(
      "Unsupported MIME type",
    );
  });
});

describe("Image Fit Functions", () => {
  it("should apply contain fit correctly", () => {
    const result = applyContainFit(400, 300, 500, 500);
    expect(result.width).toBeCloseTo(500);
    expect(result.height).toBeCloseTo(375); // 400/300 = 1.33, so 500 / 1.33 = 375
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBeCloseTo((500 - 375) / 2);
  });

  it("should apply cover fit correctly", () => {
    const result = applyCoverFit(400, 300, 500, 500);
    expect(result.width).toBeCloseTo(666.67); // scale height to match container height
    expect(result.height).toBeCloseTo(500);
    expect(result.offsetX).toBeCloseTo((500 - 666.67) / 2); // negative offset due to cover fit
    expect(result.offsetY).toBe(0);
  });

  it("should apply fill fit correctly", () => {
    const result = applyFillFit(500, 500);
    expect(result.width).toBe(500);
    expect(result.height).toBe(500);
    expect(result.offsetX).toBe(0);
    expect(result.offsetY).toBe(0);
  });

  it("should apply fit none correctly", () => {
    const result = applyFitNone(400, 300, 500, 500);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
    expect(result.offsetX).toBeCloseTo((500 - 400) / 2);
    expect(result.offsetY).toBeCloseTo((500 - 300) / 2);
  });
});
