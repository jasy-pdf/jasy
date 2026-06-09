import { pageFormats, PageSize } from "../constants/page-sizes";
import * as fs from "fs";
import * as path from "path";
import { AFMParser } from "./afm-parser";
// Enums come from the leaf config module (never in a cycle); the config type is
// erased at runtime so it can come from the cyclic module safely.
import { ColorMode, Orientation } from "../renderer/pdf-config";
import type { PDFConfig } from "../renderer/pdf-document-class";
import type { FontMetrics } from "./font-metrics";

interface FontIndexes {
  fontIndex: number;
  resourceIndex: number;
  fontStyle: FontStyle;
  fullName: string;
}

export enum FontStyle {
  Normal = "normal",
  Bold = "bold",
  Italic = "italic",
  BoldItalic = "boldItalic",
}

class ImageManager {
  private images: Map<string, number> = new Map();

  addImage(resourceNumber: number) {
    this.images.set("IM" + resourceNumber.toString(), resourceNumber);
  }

  getAllImages() {
    return this.images;
  }
}

class FontManager {
  private fonts: Map<string, FontIndexes> = new Map();

  addFont(
    fontName: string,
    fontIndex: number,
    resourceIndex: number,
    fontStyle: FontStyle = FontStyle.Normal,
    fullName: string = fontName
  ): void {
    const fontKey = this._createFontKey(fontName, fontStyle);
    if (!this.fonts.has(fontKey)) {
      this.fonts.set(fontKey, {
        fontIndex,
        resourceIndex,
        fontStyle,
        fullName,
      });
    }
  }

  hasFont(fontName: string, fontStyle: FontStyle = FontStyle.Normal): boolean {
    const fontKey = this._createFontKey(fontName, fontStyle);
    return this.fonts.has(fontKey);
  }

  getFont(
    fontName: string,
    fontStyle: FontStyle = FontStyle.Normal
  ): FontIndexes | undefined {
    const fontKey = this._createFontKey(fontName, fontStyle);
    return this.fonts.get(fontKey);
  }

  addCustomFont(
    fontName: string,
    fontStyle: FontStyle,
    fullName: string = fontName
  ): void {
    const fontIndex = this.getLastFontIndex() + 1;
    const resourceIndex = this.getLastResourceIndex() + 1;
    this.addFont(fontName, fontIndex, resourceIndex, fontStyle, fullName);
  }

  getAllFonts(): Map<string, FontIndexes> {
    return this.fonts;
  }

  size(): number {
    return this.fonts.size;
  }

  getLastFontIndex(): number {
    let maxFontIndex = 0;
    this.fonts.forEach((value) => {
      if (value.fontIndex > maxFontIndex) {
        maxFontIndex = value.fontIndex;
      }
    });
    return maxFontIndex;
  }

  getLastResourceIndex(): number {
    let maxResourceIndex = 0;
    this.fonts.forEach((value) => {
      if (value.resourceIndex > maxResourceIndex) {
        maxResourceIndex = value.resourceIndex;
      }
    });
    return maxResourceIndex;
  }

  private _createFontKey(fontName: string, fontStyle: FontStyle): string {
    return `${fontName}-${fontStyle}`;
  }
}

export class PDFObjectManager implements FontMetrics {
  private objects: string[] = [];
  private objectPositions: number[] = [];
  private parentObjectNumber: number = 0;
  private fonts: FontManager = new FontManager(); // Stores the fonts
  private images: ImageManager = new ImageManager(); // Stores the images (object numbers and names)
  private pdfConfig!: PDFConfig;
  public pageFormat = pageFormats[PageSize.A4];

  private afmParsers: {
    fontName: string;
    fontStyle: FontStyle;
    fullFontName?: string;
    parser: AFMParser;
  }[] = [];

  constructor();
  constructor(pageSize?: PageSize) {
    if (pageSize) this.pageFormat = pageFormats[pageSize];
    this.fillConfigWithStandardValues();
  }

  // Adds an object and returns its number
  addObject(content: string): number {
    // The text is encoded in Windows-1252 if necessary
    const objectNumber = this.objects.length + 1;
    const position = this.getCurrentByteLength(); // Calculate the current byte length
    this.objectPositions.push(position);
    this.objects.push(content);
    return objectNumber;
  }

  // Replaces an object at the index `objectNumber`
  replaceObject(objectNumber: number, content: string): void {
    this.objects[objectNumber - 1] = content;
  }

  changePDFConfig(config: PDFConfig) {
    this.pdfConfig = { ...this.pdfConfig, ...config };
  }

  getPDFConfig(): PDFConfig {
    return this.pdfConfig;
  }

  private fillConfigWithStandardValues() {
    this.pdfConfig = {
      orientation: Orientation.portrait,
      defaultFont: {
        fontFamily: "Helvetica",
        fontSize: 12,
        fontStyle: FontStyle.Normal,
      },
      pageSize: PageSize.A4,
      margin: { left: 72, top: 72, bottom: 72, right: 72 },
      colorMode: ColorMode.color,
    };
  }

  // Calculates the total length of the document in bytes (for XRef)
  private getCurrentByteLength(): number {
    let length = "%PDF-1.4\n".length; // Start with the header

    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      const objectContent = `${i + 1} 0 obj\n${obj}\nendobj\n`;

      // Convert the object content into a buffer with the correct encoding
      const encodedContent = Buffer.from(objectContent, "binary");

      // Add the actual byte length to the total length
      length += encodedContent.length;
    }
    return length;
  }

  // Sets the parent object number
  setParentObjectNumber(number: number) {
    this.parentObjectNumber = number;
  }

  // Returns the parent object number
  getParentObjectNumber(): number {
    return this.parentObjectNumber;
  }

  // Registers an image
  registerImage(
    width: number,
    height: number,
    imageType: string,
    imageData: string
  ) {
    const imageObject = `<< /Type /XObject
    /Subtype /Image
    /Width ${width}
    /Height ${height}
    /ColorSpace /DeviceRGB
    /BitsPerComponent 8
    /Filter /${imageType}
    /Length ${imageData.length} >>
stream
${imageData} 
endstream`;

    // Add the image and its object number to the image manager - return the object number
    const imageObjectNumber = this.addObject(imageObject);

    this.images.addImage(imageObjectNumber);
    return imageObjectNumber;
  }

  // Registers a font
  registerFont(
    fontName: string,
    fontStyle: FontStyle = FontStyle.Normal,
    fullName: string = fontName
  ): FontIndexes {
    if (this.fonts.hasFont(fontName, fontStyle)) {
      return this.fonts.getFont(fontName, fontStyle)!; // Already exists? Return it!
    }

    const afmFilePath = path.resolve(
      __dirname,
      "../",
      `assets/${fullName}.afm`
    );
    if (fs.existsSync(afmFilePath)) {
      const data = fs.readFileSync(afmFilePath, "utf-8");
      this.afmParsers.push({
        fontName,
        fontStyle,
        fullFontName: fullName,
        parser: new AFMParser(data),
      });
    }

    const resourceNumber = this.objects.length + 1; // New resource number
    const fontNumber = this.fonts.getLastFontIndex() + 1; // New font index number
    this.fonts.addFont(fontName, fontNumber, resourceNumber, fontStyle); // Store it

    const fontObject = `<</BaseFont/${fullName}/Type/Font\n/Encoding/WinAnsiEncoding\n/Subtype/Type1>>`;
    this.addObject(fontObject);

    return {
      fontIndex: fontNumber,
      resourceIndex: resourceNumber,
      fontStyle: fontStyle,
      fullName: fullName,
    };
  }

  // Returns the current width of a text, included kernings
  public getStringWidth(
    text: string,
    fontFamily: string,
    fontSize: number,
    fontStyle: FontStyle
  ): number {
    let width = 0;

    // We must calculate each sign
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1] || null;

      // Get signs width
      const charWidth = this.getCharWidth(
        char,
        fontSize,
        undefined,
        fontFamily,
        fontStyle
      );
      width += charWidth;

      // If a next sign available calculate the kerning
      if (nextChar) {
        const kerning = this.getKerning(
          char,
          nextChar,
          undefined,
          fontFamily,
          fontStyle
        );
        width += kerning * fontSize; // Kerning must be scaled with the font size
      }
    }

    return width;
  }

  private getCharCode(char: string): string {
    return char.charCodeAt(0).toString();
  }

  private getAVMParserByFont(
    fullFontName?: string,
    fontName?: string,
    fontStyle?: FontStyle
  ) {
    if (!fullFontName && (!fontName || !fontStyle)) {
      throw new Error(
        "No font family is given. Please set a full font name or a font with font style"
      );
    }
    let result;
    if (fullFontName) {
      result = this.afmParsers.find((f) => f.fullFontName === fullFontName);
    } else {
      result = this.afmParsers.find(
        (f) => f.fontName === fontName && f.fontStyle === fontStyle
      );
    }

    if (!result)
      throw new Error(
        `Cannot find a parser for the given font family ${
          fullFontName || fontName || "No given font"
        }`
      );

    return result;
  }

  // Methode zur Berechnung der Zeichenbreite anhand der Schriftgröße
  getCharWidth(
    char: string,
    fontSize: number,
    fullFontName?: string,
    fontName?: string,
    fontStyle?: FontStyle
  ): number {
    const currentParser = this.getAVMParserByFont(
      fullFontName,
      fontName,
      fontStyle
    );

    const advanceWidth = currentParser.parser.getAdvanceWidth(char);

    // Normally we got still zero. TODO: Return a alternative width like the "space"
    if (!advanceWidth) {
      throw new Error(
        `Kein Metrik-Eintrag für Zeichen: ${char} ${this.getCharCode(char)}`
      );
    }

    // Width of the character multiplied by the font size (scaled proportionally)
    return (advanceWidth / 1000) * fontSize;
  }

  // Method to get the kerning, if available, between two signs
  private getKerning(
    char: string,
    nextChar: string,
    fullFontName?: string,
    fontName?: string,
    fontStyle?: FontStyle
  ): number {
    const currentParser = this.getAVMParserByFont(
      fullFontName,
      fontName,
      fontStyle
    );

    return currentParser.parser.getKerning(char, nextChar) / 1000;
  }

  // Returns all fonts
  getAllFontsRaw() {
    return this.fonts.getAllFonts();
  }

  // Returns all images
  getAllImagesRaw() {
    return this.images.getAllImages();
  }

  // Returns all rendered objects as a string
  getRenderedObjects(): string {
    let result = "";
    this.objectPositions = [];
    this.objects.forEach((content, index) => {
      const position = result.length + "%PDF-1.4\n".length; // Calculate positions after the header
      this.objectPositions.push(position);
      result += `${index + 1} 0 obj\n${content}\nendobj\n`;
    });
    return result;
  }

  // Creates the cross-reference table
  getXRefTable(): string {
    let xref = "xref\n";
    xref += `0 ${this.objects.length + 1}\n`;
    xref += `0000000000 65535 f \n`; // Free object

    this.objectPositions.forEach((pos) => {
      xref += `${pos.toString().padStart(10, "0")} 00000 n \n`;
    });

    return xref;
  }

  // Calculates the position of the XRef table and returns the trailer
  getTrailerAndXRef(startxref: number): string {
    const objectCount = this.getObjectCount();
    return `trailer\n<< /Size ${objectCount + 1} /Root ${
      this.objects.findIndex((f) => f.toLowerCase().includes("catalog")) + 1
    } 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  }

  // Returns the number of objects
  getObjectCount(): number {
    return this.objects.length;
  }
}
