import { describe, it, expect, vi } from "vitest";
import { Color } from "../../../src/lib/common/color";

describe("Color Class", () => {
  it("should initialize with valid RGB values", () => {
    const color = new Color(100, 150, 200);
    expect(color.toArray()).toEqual([100, 150, 200]);
  });

  it("should clamp RGB values to 0 if below 0", () => {
    const consoleSpy = vi.spyOn(console, "warn");
    const color = new Color(-50, 50, 255);
    expect(color.toArray()).toEqual([0, 50, 255]);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Warning: r value -50 is out of range (0-255). Clamping to valid range.",
    );
  });

  it("should clamp RGB values to 255 if above 255", () => {
    const consoleSpy = vi.spyOn(console, "warn");
    const color = new Color(100, 300, 255);
    expect(color.toArray()).toEqual([100, 255, 255]);
    expect(consoleSpy).toHaveBeenCalledWith(
      "Warning: g value 300 is out of range (0-255). Clamping to valid range.",
    );
  });

  it("should convert to grayscale correctly", () => {
    const color = new Color(100, 150, 200);
    const grayscaleColor = color.toGrayscale();

    // Since grayscale should make all components the same
    expect(grayscaleColor).toBe("0.553 0.553 0.553");
  });

  it("should return a PDF-compatible color string", () => {
    const color = new Color(100, 150, 200);
    const pdfColorString = color.toPDFColorString();
    expect(pdfColorString).toBe("0.392 0.588 0.784");
  });

  it("should handle edge cases of RGB values correctly", () => {
    // Test min edge cases
    const minColor = new Color(0, 0, 0);
    expect(minColor.toArray()).toEqual([0, 0, 0]);

    // Test max edge cases
    const maxColor = new Color(255, 255, 255);
    expect(maxColor.toArray()).toEqual([255, 255, 255]);
  });
});
