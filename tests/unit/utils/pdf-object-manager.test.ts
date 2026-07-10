import { describe, it, expect, vitest } from "vitest";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { AFMParser } from "../../../src/lib/utils/afm-parser";
import * as fs from "fs";

describe("PDFObjectManager", () => {
  it("should add and return the correct object number", () => {
    const manager = new PDFObjectManager();
    const objectNumber = manager.addObject("First object");
    expect(objectNumber).toBe(1);
  });

  it("should replace the object at the correct index", () => {
    const manager = new PDFObjectManager();
    const objectNumber = manager.addObject("First object");
    manager.replaceObject(objectNumber, "Updated object");

    const renderedObjects = manager.getRenderedObjects();
    expect(renderedObjects).toContain("Updated object");
  });

  it("should return the correct rendered objects as a string", () => {
    const manager = new PDFObjectManager();
    manager.addObject("First object");
    manager.addObject("Second object");

    const renderedObjects = manager.getRenderedObjects();
    expect(renderedObjects).toContain("First object");
    expect(renderedObjects).toContain("Second object");
  });
});

describe("PDFObjectManager - Fonts", () => {
  it("should register a font and return correct font indexes", () => {
    const manager = new PDFObjectManager();
    const font = manager.registerFont("Helvetica", FontStyle.Normal);

    expect(font.fontIndex).toBe(1);
    expect(font.resourceIndex).toBe(1);
  });

  it("is the plain sum of the char widths - no kerning is folded in", () => {
    const manager = new PDFObjectManager();
    manager.registerFont("Helvetica", FontStyle.Normal);

    vitest.spyOn(manager, "getCharWidth").mockReturnValue(600);

    // "AV" is Helvetica's most famous kern pair (KPX A V -70). It must not appear here: we emit a
    // single `Tj`, which the viewer advances by the plain widths.
    const width = manager.getStringWidth("AV", "Helvetica", 12, FontStyle.Normal);
    expect(width).toBe(1200);
  });

  it("rejects a non-string font family with a clear hint (font bytes passed as a name)", () => {
    const manager = new PDFObjectManager();
    const fontBytes = new Uint8Array([0, 1, 0, 0]) as any; // TTF bytes where a family name is expected
    expect(() => manager.getStringWidth("hi", fontBytes, 12, FontStyle.Normal)).toThrow(
      /Font family must be a string name, got object.*fonts/,
    );
  });
});

describe("PDFObjectManager - Images", () => {
  it("should register an image and return the correct object number", () => {
    const manager = new PDFObjectManager();
    const imageObjectNumber = manager.registerImage(100, 200, "DCTDecode", "imageData");

    expect(imageObjectNumber).toBe(1);
  });

  it("should return all registered images", () => {
    const manager = new PDFObjectManager();
    manager.registerImage(100, 200, "DCTDecode", "imageData");

    const images = manager.getAllImagesRaw();
    expect(images.size).toBe(1);
    expect(images.has("IM1")).toBe(true);
  });
});

describe("PDFObjectManager - XRef and Trailer", () => {
  it("should generate the correct XRef table", () => {
    const manager = new PDFObjectManager();
    manager.addObject("First object");

    const xrefTable = manager.getXRefTable();
    // First object sits right after the header (version line + PDF/A binary marker = 15 bytes).
    expect(xrefTable).toContain("0000000015 00000 n ");
  });

  it("should generate the correct trailer", () => {
    const manager = new PDFObjectManager();
    manager.addObject("First object");

    const trailer = manager.getTrailerAndXRef(9);
    expect(trailer).toContain("/Size 2");
    expect(trailer).toContain("startxref");
    expect(trailer).toContain("9");
  });
});

describe("PDFObjectManager - Images", () => {
  it("should register an image and return the correct object number", () => {
    const manager = new PDFObjectManager();

    const imageWidth = 100;
    const imageHeight = 100;
    const imageType = "DCTDecode";
    const imageData = "some-image-data";

    const imageObjectNumber = manager.registerImage(imageWidth, imageHeight, imageType, imageData);

    expect(imageObjectNumber).toBe(1);
    const allImages = manager.getAllImagesRaw();
    expect(allImages.has("IM1")).toBe(true);
    expect(allImages.get("IM1")).toBe(imageObjectNumber);
  });
});

describe("PDFObjectManager - Object Replacement", () => {
  it("should replace an object correctly", () => {
    const manager = new PDFObjectManager();
    const objectNumber = manager.addObject("Original Content");

    manager.replaceObject(objectNumber, "Updated Content");

    const renderedObjects = manager.getRenderedObjects();
    expect(renderedObjects).toContain("Updated Content");
    expect(renderedObjects).not.toContain("Original Content");
  });
});

describe("PDFObjectManager - AFM Parsing", () => {
  it("should load an AFM file and correctly parse advance widths and kerning", () => {
    const afmData = fs.readFileSync("./src/lib/assets/Helvetica.afm", "utf-8");
    const parser = new AFMParser(afmData);

    const advanceWidth = parser.getAdvanceWidth("A");
    expect(advanceWidth).toBeGreaterThan(0);

    const kerning = parser.getKerning("A", "V");
    expect(kerning).toBeLessThan(0);
  });
});

describe("PDFObjectManager - measured width equals drawn width", () => {
  it("does not kern, so a string is exactly as wide as the glyphs the viewer advances by", () => {
    const manager = new PDFObjectManager();
    manager.registerFont("Helvetica", FontStyle.Normal);

    const chars = [...("AVATAR Wave" as string)];
    const summed = chars.reduce(
      (w, c) => w + manager.getCharWidth(c, 40, undefined, "Helvetica", FontStyle.Normal),
      0,
    );
    const measured = manager.getStringWidth("AVATAR Wave", "Helvetica", 40, FontStyle.Normal);
    // With kerning folded in this was 19pt narrower than what a `Tj` actually draws, so the text
    // overflowed its box. The AFM pairs live on in `AFMParser.getKerning` for a future `TJ` path.
    expect(measured).toBeCloseTo(summed, 9);
  });
});

describe("PDFObjectManager - XRef Table and Trailer with multiple objects", () => {
  it("should generate correct XRef table and trailer for multiple objects with calculated byte offsets", () => {
    const manager = new PDFObjectManager();

    // Add objects
    manager.addObject("First Object");
    manager.addObject("Second Object");
    manager.addObject("Third Object");

    // Calculate the byte positions (offsets start right after the real header)
    const header = manager.getHeader();
    const firstObject = "1 0 obj\nFirst Object\nendobj\n";
    const secondObject = "2 0 obj\nSecond Object\nendobj\n";

    const firstObjectOffset = header.length; // Start directly after header
    const secondObjectOffset = firstObjectOffset + firstObject.length;
    const thirdObjectOffset = secondObjectOffset + secondObject.length;

    const xrefTable = manager.getXRefTable();

    // Verify that the table starts with 'xref' and lists the correct number of objects
    expect(xrefTable).toContain("xref");
    expect(xrefTable).toContain("0 4"); // One free object + three added objects

    // Check that each object has a reference in the XRef table
    expect(xrefTable).toMatch(/0000000000 65535 f/); // Free object
    expect(xrefTable).toMatch(new RegExp(`${String(firstObjectOffset).padStart(10, "0")} 00000 n`)); // First object
    expect(xrefTable).toMatch(
      new RegExp(`${String(secondObjectOffset).padStart(10, "0")} 00000 n`),
    ); // Second object
    expect(xrefTable).toMatch(new RegExp(`${String(thirdObjectOffset).padStart(10, "0")} 00000 n`)); // Third object

    const trailer = manager.getTrailerAndXRef(50);

    // Verify that the trailer contains the correct size and root object reference
    expect(trailer).toContain("/Size 4"); // Total objects (1 free + 3 added)
    expect(trailer).toContain("startxref");
    expect(trailer).toContain("50"); // Start of XRef table
  });
});
