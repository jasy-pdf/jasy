import { TextRenderer } from "../../../src/lib/renderer/text-renderer";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend";
import { FontStyle, PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager";
import { describe, it, vi, expect } from "vitest";
import { TextElement } from "../../../src/lib/elements";
import { HorizontalAlignment } from "../../../src/lib/elements/pdf-element";
import { Color } from "../../../src/lib/common/color";
import { unitVerticals } from "../support/metrics";

describe("TextRenderer - calculateTextHeight", () => {
  it("should calculate the correct text height for a simple string", () => {
    const mockObjectManager = {
      getStringWidth: vi.fn().mockReturnValue(10), // String width is used for each word = 20
      getCharWidth: vi.fn().mockReturnValue(5), // Used for empty spaces = 5
      getFontVerticals: unitVerticals,
      struct: { enabled: false },
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
      getFontVerticals: unitVerticals,
      struct: { enabled: false },
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
      getFontVerticals: unitVerticals,
      struct: { enabled: false },
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
      getEmojiFont: vi.fn().mockReturnValue(undefined),
      getEmojiImageSource: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(10),
      getCharWidth: vi.fn().mockReturnValue(5),
      getFontVerticals: unitVerticals,
      struct: { enabled: false },
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
      getEmojiFont: vi.fn().mockReturnValue(undefined),
      getEmojiImageSource: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(10),
      getCharWidth: vi.fn().mockReturnValue(5),
      getFontVerticals: unitVerticals,
      struct: { enabled: false },
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
      getEmojiFont: vi.fn().mockReturnValue(undefined),
      getEmojiImageSource: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(25), // Here we get the widht of the "complete" string, because the renderer renders each "line", not only the words/segments: 25
      getCharWidth: vi.fn().mockReturnValue(0), // For empty spaces: 0
      getFontVerticals: unitVerticals,
      struct: { enabled: false },
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager),
      mockObjectManager,
    );

    expect(result).toContain("/F1 12 Tf");
    // x: 10 + (200 - 25) / 2 = 97.5.
    // y: the test font is 0.75 up / 0.25 down, so its natural box is 1 em = 12 with no leading to
    // split; the baseline sits at its ascent, 12*0.75 = 9, below the top: 20 + 9 = 29.
    // (top-left baseline; the seam flips to PDF coordinates later).
    expect(result).toContain("97.500 29.000 Td");
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
      getEmojiFont: vi.fn().mockReturnValue(undefined),
      getEmojiImageSource: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(25), // Here we get the widht of the "complete" string, because the renderer renders each "line", not only the words/segments: 25
      getCharWidth: vi.fn().mockReturnValue(0),
      getFontVerticals: unitVerticals,
      struct: { enabled: false },
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager),
      mockObjectManager,
    );

    expect(result).toContain("/F1 12 Tf");
    // x: 10 + 200 - 25 = 185. y: top 20 + ascent 12*0.75 = 29.
    expect(result).toContain("185.000 29.000 Td");
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
      getEmojiFont: vi.fn().mockReturnValue(undefined),
      getEmojiImageSource: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(0),
      getCharWidth: vi.fn().mockReturnValue(0),
      getFontVerticals: unitVerticals,
      struct: { enabled: false },
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
      getEmojiFont: vi.fn().mockReturnValue(undefined),
      getEmojiImageSource: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn((content, fontFamily, fontSize) => {
        return content.length * fontSize; // Einfacher Algorithmus zur Rückgabe der Breite
      }),
      getCharWidth: vi.fn().mockReturnValue(10),
      getFontVerticals: unitVerticals,
      struct: { enabled: false },
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
      getEmojiFont: vi.fn().mockReturnValue(undefined),
      getEmojiImageSource: vi.fn().mockReturnValue(undefined),
      getStringWidth: vi.fn().mockReturnValue(25), // Here we get the widht of each segment: 50
      getCharWidth: vi.fn().mockReturnValue(0), // For empty spaces: 0
      getFontVerticals: unitVerticals,
      struct: { enabled: false },
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager),
      mockObjectManager,
    );

    // Prüfen, ob beide Segmente gerendert werden
    expect(result).toContain("/F1 12 Tf");
    expect(result).toContain("/F2 14 Tf");

    // x: 10 + (200 - 50) / 2 = 85.
    // y: the line mixes 12pt and 14pt, so the tallest ascent (14*0.75 = 10.5) and the deepest
    // descent (14*0.25 = 3.5) size the box: content 14, no leading, baseline at 10.5. 20 + 10.5.
    expect(result).toContain("85.000 30.500 Td");
  });
});
