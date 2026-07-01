import { TextRenderer } from "../../../src/lib/renderer/text-renderer";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend";
import { FontStyle, PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { describe, it, vi, expect } from "vitest";
import { TextElement } from "../../../src/lib/elements";
import { HorizontalAlignment } from "../../../src/lib/elements/pdf-element";
import { Color } from "../../../src/lib/common/color";

describe("TextRenderer - calculateTextHeight", () => {
  it("should calculate the correct text height for a simple string", () => {
    const mockObjectManager = {
      getStringWidth: vi.fn().mockReturnValue(10), // String width is used for each word = 20
      getCharWidth: vi.fn().mockReturnValue(5), // Used for empty spaces = 5
    } as unknown as PDFObjectManager;

    const textHeight = TextRenderer.calculateTextHeight(
      "Hello World",
      12,
      "Helvetica",
      FontStyle.Normal,
      mockObjectManager,
      25,
    );

    expect(textHeight).toBe(12); // No line breaks
  });

  it("should calculate the correct text height with wrapping", () => {
    const mockObjectManager = {
      getStringWidth: vi.fn().mockReturnValue(10), // String width is used for each word = 60
      getCharWidth: vi.fn().mockReturnValue(5), // Used for empty spaces = 25
    } as unknown as PDFObjectManager;

    const textHeight = TextRenderer.calculateTextHeight(
      "Hello World, this is a test",
      12,
      "Helvetica",
      FontStyle.Normal,
      mockObjectManager,
      70,
    );

    expect(textHeight).toBe(24); // Two lines
  });

  it("should calculate the correct text height for TextSegments", () => {
    const mockObjectManager = {
      getStringWidth: vi.fn().mockReturnValue(10),
      getCharWidth: vi.fn().mockReturnValue(5),
    } as unknown as PDFObjectManager;

    const segments = [
      { content: "Hello", fontSize: 12 },
      { content: "World", fontSize: 14 },
    ];

    const textHeight = TextRenderer.calculateTextHeight(
      segments,
      12,
      "Helvetica",
      FontStyle.Normal,
      mockObjectManager,
      100,
    );

    expect(textHeight).toBe(14); // Bigger font size is setting height (one line)
  });

  it("should render text with correct commands", async () => {
    const mockTextElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 100,
        fontSize: 12,
        content: "Hello World",
        fontFamily: "Helvetica",
        fontStyle: FontStyle.Normal,
        color: new Color(0, 0, 0), // Black
        textAlignment: "left",
      }),
    } as unknown as TextElement;

    const mockObjectManager = {
      registerFont: vi.fn().mockReturnValue({ fontIndex: 1 }),
      isCustomFont: vi.fn().mockReturnValue(false),
      getColorFont: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(10),
      getCharWidth: vi.fn().mockReturnValue(5),
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager),
      mockObjectManager,
    );

    expect(result).toContain("BT");
    expect(result).toContain("/F1 12 Tf");
    expect(result).toContain("(Hello World) Tj");
    expect(result).toContain("ET");
  });

  it("should render TextSegments correctly", async () => {
    const mockTextElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 100,
        fontSize: 12,
        content: [
          { content: "Hello", fontSize: 12 },
          { content: "World", fontSize: 14 },
        ],
        fontFamily: "Helvetica",
        fontStyle: FontStyle.Normal,
        color: new Color(0, 0, 0),
        textAlignment: "left",
      }),
    } as unknown as TextElement;

    const mockObjectManager = {
      registerFont: vi.fn().mockReturnValue({ fontIndex: 1 }),
      isCustomFont: vi.fn().mockReturnValue(false),
      getColorFont: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(10),
      getCharWidth: vi.fn().mockReturnValue(5),
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager),
      mockObjectManager,
    );

    expect(result).toContain("/F1 12 Tf");
    expect(result).toContain("/F1 14 Tf");
    expect(result).toContain("(Hello) Tj");
    expect(result).toContain("(World) Tj");
  });

  it("should render text with center alignment correctly", async () => {
    const mockTextElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 200,
        fontSize: 12,
        content: "Hello World",
        fontFamily: "Helvetica",
        fontStyle: FontStyle.Normal,
        color: new Color(0, 0, 0),
        textAlignment: HorizontalAlignment.center,
      }),
    } as unknown as TextElement;

    const mockObjectManager = {
      registerFont: vi.fn().mockReturnValue({ fontIndex: 1 }),
      isCustomFont: vi.fn().mockReturnValue(false),
      getColorFont: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(25), // Here we get the widht of the "complete" string, because the renderer renders each "line", not only the words/segments: 25
      getCharWidth: vi.fn().mockReturnValue(0), // For empty spaces: 0
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager),
      mockObjectManager,
    );

    expect(result).toContain("/F1 12 Tf");
    // x: 10 + (200 - 25) / 2 = 97.5. y: top 20 + baseline 12*0.683 = 28.196
    // (top-left baseline; the seam flips to PDF coordinates later).
    expect(result).toContain("97.500 28.196 Td");
    expect(result).toContain("(Hello World) Tj");
  });

  it("should render text with right alignment correctly", async () => {
    const mockTextElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 200,
        fontSize: 12,
        content: "Hello World",
        fontFamily: "Helvetica",
        fontStyle: FontStyle.Normal,
        color: new Color(0, 0, 0),
        textAlignment: HorizontalAlignment.right,
      }),
    } as unknown as TextElement;

    const mockObjectManager = {
      registerFont: vi.fn().mockReturnValue({ fontIndex: 1 }),
      isCustomFont: vi.fn().mockReturnValue(false),
      getColorFont: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(25), // Here we get the widht of the "complete" string, because the renderer renders each "line", not only the words/segments: 25
      getCharWidth: vi.fn().mockReturnValue(0),
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager),
      mockObjectManager,
    );

    expect(result).toContain("/F1 12 Tf");
    // x: 10 + 200 - 25 = 185. y: top 20 + baseline 12*0.683 = 28.196.
    expect(result).toContain("185.000 28.196 Td");
    expect(result).toContain("(Hello World) Tj");
  });

  it("should render nothing for an empty string", async () => {
    const mockTextElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 200,
        fontSize: 12,
        content: "",
        fontFamily: "Helvetica",
        fontStyle: FontStyle.Normal,
        color: new Color(0, 0, 0),
        textAlignment: "left",
      }),
    } as unknown as TextElement;

    const mockObjectManager = {
      registerFont: vi.fn().mockReturnValue({ fontIndex: 1 }),
      isCustomFont: vi.fn().mockReturnValue(false),
      getColorFont: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(0),
      getCharWidth: vi.fn().mockReturnValue(0),
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager),
      mockObjectManager,
    );

    // Empty content produces no runs, hence no operators at all (the old renderer
    // emitted an empty BT/ET shell; the IR seam drops it - visually identical).
    expect(result).toBe("");
  });

  it("should render multiple text segments correctly", async () => {
    const mockTextElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 200,
        fontSize: 12,
        content: [
          {
            content: "Hello",
            fontSize: 12,
            fontFamily: "Helvetica",
            fontStyle: FontStyle.Normal,
          },
          {
            content: "World",
            fontSize: 14,
            fontFamily: "Helvetica-Bold",
            fontStyle: FontStyle.Bold,
          },
        ],
        fontFamily: "Helvetica",
        fontStyle: FontStyle.Normal,
        color: new Color(0, 0, 0),
        textAlignment: "left",
      }),
    } as unknown as TextElement;

    const mockObjectManager = {
      registerFont: vi.fn().mockImplementation((fontFamily, fontStyle) => {
        if (fontStyle === FontStyle.Bold) {
          return { fontIndex: 2 }; // Bold font
        }
        return { fontIndex: 1 }; // Normal font
      }),
      isCustomFont: vi.fn().mockReturnValue(false),
      getColorFont: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn((content, fontFamily, fontSize) => {
        return content.length * fontSize; // Einfacher Algorithmus zur Rückgabe der Breite
      }),
      getCharWidth: vi.fn().mockReturnValue(10),
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager),
      mockObjectManager,
    );

    expect(result).toContain("/F1 12 Tf"); // Normal font für "Hello"
    expect(result).toContain("/F2 14 Tf"); // Bold font für "World"
    expect(result).toContain("(Hello) Tj");
    expect(result).toContain("(World) Tj");
  });

  it("should render centered text with multiple segments correctly", async () => {
    const mockTextElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 200,
        fontSize: 12,
        content: [
          {
            content: "Hello",
            fontSize: 12,
            fontFamily: "Helvetica",
            fontStyle: FontStyle.Normal,
          },
          {
            content: "World",
            fontSize: 14,
            fontFamily: "Helvetica-Bold",
            fontStyle: FontStyle.Bold,
          },
        ],
        fontFamily: "Helvetica",
        fontStyle: FontStyle.Normal,
        color: new Color(0, 0, 0),
        textAlignment: HorizontalAlignment.center,
      }),
    } as unknown as TextElement;

    const mockObjectManager = {
      registerFont: vi.fn().mockImplementation((fontFamily, fontStyle) => {
        if (fontStyle === FontStyle.Bold) {
          return { fontIndex: 2 }; // Bold font
        }
        return { fontIndex: 1 }; // Normal font
      }),
      isCustomFont: vi.fn().mockReturnValue(false),
      getColorFont: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(25), // Here we get the widht of each segment: 50
      getCharWidth: vi.fn().mockReturnValue(0), // For empty spaces: 0
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager),
      mockObjectManager,
    );

    // Prüfen, ob beide Segmente gerendert werden
    expect(result).toContain("/F1 12 Tf");
    expect(result).toContain("/F2 14 Tf");

    // x: 10 + (200 - 50) / 2 = 85. y: top 20 + baseline (tallest font 14)*0.683 = 29.562.
    expect(result).toContain("85.000 29.562 Td");
  });
});
