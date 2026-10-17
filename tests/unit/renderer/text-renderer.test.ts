import { TextRenderer } from "../../../src/lib/renderer/text-renderer.ts";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend.ts";
import { FontStyle, PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import { describe, it, vi, expect } from "vitest";
import { TextElement } from "../../../src/lib/elements/index.ts";
import { HorizontalAlignment } from "../../../src/lib/elements/pdf-element.ts";
import { Color } from "../../../src/lib/common/color.ts";
import { testMetrics } from "../support/metrics.ts";
import { PAGE_SCOPE } from "../support/scope.ts";

describe("TextRenderer", () => {
  it("should render text with correct commands", async () => {
    const mockTextElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 100,
        fontSize: 12,
        spans: [{ content: "Hello World" }],
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
      ...testMetrics({
        getStringWidth: vi.fn().mockReturnValue(10),

        getCharWidth: vi.fn().mockReturnValue(5),
      }),
      struct: { enabled: false },
      shapeText: () => undefined,
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager, PAGE_SCOPE),
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
        spans: [
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
      ...testMetrics({
        getStringWidth: vi.fn().mockReturnValue(10),

        getCharWidth: vi.fn().mockReturnValue(5),
      }),
      struct: { enabled: false },
      shapeText: () => undefined,
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager, PAGE_SCOPE),
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
        spans: [{ content: "Hello World" }],
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
      ...testMetrics({
        getStringWidth: vi.fn((t: string) => t.length * 5),

        getCharWidth: vi.fn(() => 5),
      }),
      struct: { enabled: false },
      shapeText: () => undefined,
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager, PAGE_SCOPE),
      mockObjectManager,
    );

    expect(result).toContain("/F1 12 Tf");
    // x: 10 + (200 - 55) / 2 = 82.5.
    // y: the test font is 0.75 up / 0.25 down, so its natural box is 1 em = 12 with no leading to
    // split; the baseline sits at its ascent, 12*0.75 = 9, below the top: 20 + 9 = 29.
    // (top-left baseline; the seam flips to PDF coordinates later).
    expect(result).toContain("82.500 29.000 Td");
    expect(result).toContain("(Hello World) Tj");
  });

  it("should render text with right alignment correctly", async () => {
    const mockTextElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 200,
        fontSize: 12,
        spans: [{ content: "Hello World" }],
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
      ...testMetrics({
        getStringWidth: vi.fn((t: string) => t.length * 5),

        getCharWidth: vi.fn(() => 5),
      }),
      struct: { enabled: false },
      shapeText: () => undefined,
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager, PAGE_SCOPE),
      mockObjectManager,
    );

    expect(result).toContain("/F1 12 Tf");
    // x: 10 + 200 - 25 = 185. y: top 20 + ascent 12*0.75 = 29.
    expect(result).toContain("155.000 29.000 Td");
    expect(result).toContain("(Hello World) Tj");
  });

  it("should render nothing for an empty string", async () => {
    const mockTextElement = {
      getProps: vi.fn().mockReturnValue({
        x: 10,
        y: 20,
        width: 200,
        fontSize: 12,
        spans: [{ content: "" }],
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
      ...testMetrics({
        getStringWidth: vi.fn().mockReturnValue(0),

        getCharWidth: vi.fn().mockReturnValue(0),
      }),
      struct: { enabled: false },
      shapeText: () => undefined,
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager, PAGE_SCOPE),
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
        spans: [
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
      ...testMetrics({
        getStringWidth: vi.fn((content, fontFamily, fontSize) => {
          return content.length * fontSize; // one glyph per character, at the font size
        }),

        getCharWidth: vi.fn().mockReturnValue(10),
      }),
      struct: { enabled: false },
      shapeText: () => undefined,
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager, PAGE_SCOPE),
      mockObjectManager,
    );

    expect(result).toContain("/F1 12 Tf"); // the normal font, for "Hello"
    expect(result).toContain("/F2 14 Tf"); // the bold one, for "World"
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
        spans: [
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
      ...testMetrics({
        getStringWidth: vi.fn().mockReturnValue(25), // the width of each segment: 50
        getCharWidth: vi.fn().mockReturnValue(0), // for empty spaces: 0
      }),
      struct: { enabled: false },
      shapeText: () => undefined,
    } as unknown as PDFObjectManager;

    const result = PdfBackend.serialize(
      await TextRenderer.render(mockTextElement, mockObjectManager, PAGE_SCOPE),
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
