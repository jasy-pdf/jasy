import { pageFormats, PageSize } from "../constants/page-sizes";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";
import { AFMParser } from "./afm-parser";
import { TTFParser } from "./ttf-parser";
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

// Suffix appended to an embedded font's PDF /BaseFont so each style variant of a family keeps
// a distinct name (the variants are otherwise selected by the font resource, not the name).
const STYLE_SUFFIX: Record<FontStyle, string> = {
  [FontStyle.Normal]: "",
  [FontStyle.Bold]: "-Bold",
  [FontStyle.Italic]: "-Italic",
  [FontStyle.BoldItalic]: "-BoldItalic",
};

class ImageManager {
  private images: Map<string, number> = new Map();

  addImage(resourceNumber: number) {
    this.images.set("IM" + resourceNumber.toString(), resourceNumber);
  }

  getAllImages() {
    return this.images;
  }
}

/** Graphics-state objects for transparency, deduped by their (fill, stroke) alpha pair. */
class ExtGStateManager {
  // alpha-pair key -> { resource name, indirect-object number }
  private states = new Map<string, { name: string; objectNumber: number }>();

  get(key: string) {
    return this.states.get(key);
  }

  add(key: string, name: string, objectNumber: number) {
    this.states.set(key, { name, objectNumber });
  }

  size(): number {
    return this.states.size;
  }

  /** name -> object number, for the page `/Resources /ExtGState` dict. */
  getAll(): Map<string, number> {
    const out = new Map<string, number>();
    this.states.forEach((value) => out.set(value.name, value.objectNumber));
    return out;
  }
}

class FontManager {
  private fonts: Map<string, FontIndexes> = new Map();

  addFont(
    fontName: string,
    fontIndex: number,
    resourceIndex: number,
    fontStyle: FontStyle = FontStyle.Normal,
    fullName: string = fontName,
    force = false,
  ): void {
    const fontKey = this._createFontKey(fontName, fontStyle);
    // `force` lets an embedded custom font override a same-named standard-14 entry (e.g. embedding
    // "Helvetica" as Liberation for PDF/A) - otherwise the standard /Type1 resource would win and
    // the CID text would be drawn against the wrong font.
    if (force || !this.fonts.has(fontKey)) {
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

  getFont(fontName: string, fontStyle: FontStyle = FontStyle.Normal): FontIndexes | undefined {
    const fontKey = this._createFontKey(fontName, fontStyle);
    return this.fonts.get(fontKey);
  }

  addCustomFont(fontName: string, fontStyle: FontStyle, fullName: string = fontName): void {
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
  private extGStates: ExtGStateManager = new ExtGStateManager(); // Transparency states
  private pdfConfig!: PDFConfig;
  public pageFormat = pageFormats[PageSize.A4];

  private afmParsers: {
    fontName: string;
    fontStyle: FontStyle;
    fullFontName?: string;
    parser: AFMParser;
  }[] = [];

  // Embedded TrueType fonts, keyed by the name the user registers them under. When a font
  // name is in here the metric/emission paths take the TTF branch instead of the AFM one.
  private customFonts = new Map<string, TTFParser>();

  // Embedded file attachments (their /Filespec object numbers + display names). Referenced from
  // the catalog's /Names/EmbeddedFiles + /AF. Drives ZUGFeRD's embedded factur-x.xml.
  private attachments: { name: string; filespec: number }[] = [];

  // Document XMP packet (catalog /Metadata), e.g. the PDF/A-3 + Factur-X identification. The
  // content is supplied by the caller; keep it ASCII (entity-escape non-ASCII) for the 1-byte path.
  private xmpMetadata?: string;

  // The /OutputIntent dict object number (catalog /OutputIntents), set by setOutputIntent. PDF/A
  // requires one; it names the output colour space via an embedded ICC profile.
  private outputIntent?: number;

  // PDF header version (PDF/A-3 needs 1.7) and whether to write a trailer /ID (PDF/A needs one).
  // Both default to the pre-PDF/A behaviour, so a normal document stays byte-identical.
  private pdfVersion = "1.4";
  private documentId = false;

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
    let length = this.getHeader().length; // Start with the header

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
  registerImage(width: number, height: number, imageType: string, imageData: string) {
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

  // Embeds a file as an associated file (PDF/A-3 / PDF 2.0): an /EmbeddedFile stream + a /Filespec.
  // The catalog wiring (/Names/EmbeddedFiles + /AF) is added by PDFRenderer when attachments exist.
  // `relationship` is the /AFRelationship (e.g. "Data" for the ZUGFeRD factur-x.xml). Binary bytes
  // ride as a latin1 string, like images/fonts (the final encoder passes 0x00-0xFF through).
  attachFile(
    name: string,
    data: Buffer,
    opts: { relationship?: string; mimeType?: string; description?: string } = {},
  ): void {
    const subtype = (opts.mimeType ?? "application/octet-stream").replace(/\//g, "#2F");
    const embedded = this.addObject(
      `<< /Type /EmbeddedFile /Subtype /${subtype} /Length ${data.length} ` +
        `/Params << /Size ${data.length} >> >>\nstream\n${data.toString("latin1")}\nendstream`,
    );
    const escaped = (s: string) =>
      s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const desc = opts.description ? ` /Desc (${escaped(opts.description)})` : "";
    const filespec = this.addObject(
      `<< /Type /Filespec /F (${escaped(name)}) /UF (${escaped(name)}) ` +
        `/AFRelationship /${opts.relationship ?? "Unspecified"}${desc} ` +
        `/EF << /F ${embedded} 0 R /UF ${embedded} 0 R >> >>`,
    );
    this.attachments.push({ name, filespec });
  }

  // Filespec object numbers + names, for the catalog's /Names/EmbeddedFiles and /AF.
  getAttachments(): { name: string; filespec: number }[] {
    return this.attachments;
  }

  // Sets the document XMP packet (catalog /Metadata). ASCII expected (see the field comment).
  setXmpMetadata(xml: string): void {
    this.xmpMetadata = xml;
  }

  getXmpMetadata(): string | undefined {
    return this.xmpMetadata;
  }

  // Embeds an ICC profile and a PDF/A /OutputIntent that points at it (catalog /OutputIntents).
  // `icc` are the raw profile bytes (an RGB profile, /N 3 - e.g. sRGB).
  setOutputIntent(icc: Buffer, opts: { identifier?: string; info?: string } = {}): void {
    const profile = this.addObject(
      `<< /N 3 /Length ${icc.length} >>\nstream\n${icc.toString("latin1")}\nendstream`,
    );
    this.outputIntent = this.addObject(
      `<< /Type /OutputIntent /S /GTS_PDFA1 ` +
        `/OutputConditionIdentifier (${opts.identifier ?? "sRGB"}) ` +
        `/Info (${opts.info ?? "sRGB IEC61966-2.1"}) /DestOutputProfile ${profile} 0 R >>`,
    );
  }

  getOutputIntent(): number | undefined {
    return this.outputIntent;
  }

  // PDF header version, e.g. "1.7" for PDF/A-3. Always "1.X" so the 9-byte header length (and the
  // xref offsets that depend on it) never change.
  setPdfVersion(version: string): void {
    this.pdfVersion = version;
  }

  getPdfVersion(): string {
    return this.pdfVersion;
  }

  // The full PDF header: the version line + a binary-marker comment whose 4 bytes are all > 127
  // (PDF/A clause 6.1.2). Every char is <= 0xFF, so the string length equals the emitted byte
  // length - which the xref offset calculation relies on.
  getHeader(): string {
    // The marker is `%` + â ã Ï Ó (Latin-1 0xE2 0xE3 0xCF 0xD3, all > 127); each char is <= 0xFF so
    // the final encoder emits it as that exact byte.
    return `%PDF-${this.pdfVersion}\n%âãÏÓ\n`;
  }

  // Enables a trailer /ID (required by PDF/A). The id is a content hash, so it is deterministic.
  enableDocumentId(): void {
    this.documentId = true;
  }

  // Registers (or reuses) a transparency graphics state and returns its resource name
  // (e.g. "GS1"). `fillAlpha` -> /ca, `strokeAlpha` -> /CA. Deduped by the alpha pair.
  registerExtGState(fillAlpha: number, strokeAlpha: number): string {
    const ca = fillAlpha.toFixed(3);
    const CA = strokeAlpha.toFixed(3);
    const key = `${ca}:${CA}`;

    const existing = this.extGStates.get(key);
    if (existing) return existing.name;

    const name = `GS${this.extGStates.size() + 1}`;
    const objectNumber = this.addObject(`<< /Type /ExtGState /ca ${ca} /CA ${CA} >>`);
    this.extGStates.add(key, name, objectNumber);
    return name;
  }

  // Returns all registered transparency states (name -> object number) for the page
  getAllExtGStatesRaw(): Map<string, number> {
    return this.extGStates.getAll();
  }

  // Registers a font
  registerFont(
    fontName: string,
    fontStyle: FontStyle = FontStyle.Normal,
    fullName: string = fontName,
  ): FontIndexes {
    if (this.fonts.hasFont(fontName, fontStyle)) {
      return this.fonts.getFont(fontName, fontStyle)!; // Already exists? Return it!
    }

    const afmFilePath = path.resolve(__dirname, "../", `assets/${fullName}.afm`);
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

  // Registers one variant (default Normal) of an embedded TrueType family `name`: stores it for
  // metrics and emits its PDF font objects. All variants share the family `name`; bold/italic are
  // separate .ttf files registered under the same name with a different style.
  registerCustomFont(name: string, data: Buffer, style: FontStyle = FontStyle.Normal): void {
    const key = this.customKey(name, style);
    if (this.customFonts.has(key)) return;
    const ttf = new TTFParser(data);
    this.customFonts.set(key, ttf);

    // Created in dependency order so each reference points at an already-numbered object.
    const pdfName = name + STYLE_SUFFIX[style];
    const fontFile = this.addObject(this.buildFontFile2(ttf));
    const descriptor = this.addObject(this.buildFontDescriptor(pdfName, ttf, fontFile));
    const cidFont = this.addObject(this.buildCIDFont(pdfName, ttf, descriptor));
    const toUnicode = this.addObject(this.buildToUnicode(ttf));
    const type0 = this.addObject(this.buildType0(pdfName, cidFont, toUnicode));

    // The Type0 dict is the resource the page references (/F{index} -> type0 object). `force` so an
    // embedded font overrides a same-named standard-14 entry instead of being silently dropped.
    this.fonts.addFont(name, this.fonts.getLastFontIndex() + 1, type0, style, name, true);
  }

  private customKey(name: string, style: FontStyle): string {
    return `${name}-${style}`;
  }

  // The variant to actually use for (name, style): the requested style if registered, else the
  // family's Normal as a clean fallback (e.g. bold chosen but no bold file), else undefined when
  // `name` is not a custom family at all.
  private resolveCustomStyle(
    name?: string,
    style: FontStyle = FontStyle.Normal,
  ): FontStyle | undefined {
    if (!name) return undefined;
    if (this.customFonts.has(this.customKey(name, style))) return style;
    if (this.customFonts.has(this.customKey(name, FontStyle.Normal))) return FontStyle.Normal;
    return undefined;
  }

  private getCustomFont(name?: string, style: FontStyle = FontStyle.Normal): TTFParser | undefined {
    const resolved = this.resolveCustomStyle(name, style);
    return resolved ? this.customFonts.get(this.customKey(name!, resolved)) : undefined;
  }

  isCustomFont(name?: string, style: FontStyle = FontStyle.Normal): boolean {
    return !!this.resolveCustomStyle(name, style);
  }

  // The page font resource for the resolved variant - same resolution as getCustomFont, so the
  // selected Type0 object and the emitted glyph ids always come from the SAME font file.
  getCustomFontResource(
    name: string,
    style: FontStyle = FontStyle.Normal,
  ): FontIndexes | undefined {
    const resolved = this.resolveCustomStyle(name, style);
    return resolved ? this.fonts.getFont(name, resolved) : undefined;
  }

  // Encodes text as a hex Identity-H string for an embedded font's Tj operator: each codepoint
  // becomes its 2-byte glyph id (CID == GID under /CIDToGIDMap /Identity).
  encodeCustomText(name: string, text: string, style: FontStyle = FontStyle.Normal): string {
    const ttf = this.getCustomFont(name, style);
    if (!ttf) return "";
    let hex = "";
    for (const ch of text) {
      hex += ttf.getGlyphIndex(ch.codePointAt(0)!).toString(16).padStart(4, "0").toUpperCase();
    }
    return hex;
  }

  // The whole (non-subset) font program. Binary bytes survive as a latin1 string - the final
  // Windows-1252 encoder passes 0x00-0xFF through unchanged (see getArrayBuffer).
  private buildFontFile2(ttf: TTFParser): string {
    const bytes = ttf.getData();
    return `<< /Length ${bytes.length} /Length1 ${bytes.length} >>\nstream\n${bytes.toString(
      "latin1",
    )}\nendstream`;
  }

  private buildFontDescriptor(name: string, ttf: TTFParser, fontFile: number): string {
    const [x0, y0, x1, y1] = ttf.bbox;
    return (
      `<< /Type /FontDescriptor /FontName /${name} /Flags 4 ` +
      `/FontBBox [${x0} ${y0} ${x1} ${y1}] /ItalicAngle 0 ` +
      `/Ascent ${ttf.ascent} /Descent ${ttf.descent} /CapHeight ${ttf.ascent} /StemV 80 ` +
      `/FontFile2 ${fontFile} 0 R >>`
    );
  }

  // CIDToGIDMap /Identity means CID == GID, so the /W widths are indexed straight by glyph id.
  private buildCIDFont(name: string, ttf: TTFParser, descriptor: number): string {
    const widths = ttf.glyphWidths().join(" ");
    return (
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} ` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> ` +
      `/FontDescriptor ${descriptor} 0 R /CIDToGIDMap /Identity ` +
      `/DW 1000 /W [0 [${widths}]] >>`
    );
  }

  // Maps glyph id -> Unicode so the text stays copy-/searchable (rendering doesn't need it).
  private buildToUnicode(ttf: TTFParser): string {
    const hex4 = (n: number) => n.toString(16).padStart(4, "0").toUpperCase();
    const entries = [...ttf.reverseCmap().entries()];
    const blocks: string[] = [];
    for (let i = 0; i < entries.length; i += 100) {
      const block = entries.slice(i, i + 100);
      const lines = block.map(([gid, code]) => `<${hex4(gid)}> <${hex4(code)}>`);
      blocks.push(`${block.length} beginbfchar\n${lines.join("\n")}\nendbfchar`);
    }
    const body =
      `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n` +
      `/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n` +
      `1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks.join("\n")}\n` +
      `endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    return `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  }

  private buildType0(name: string, cidFont: number, toUnicode: number): string {
    return (
      `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H ` +
      `/DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicode} 0 R >>`
    );
  }

  // Returns the current width of a text, included kernings
  public getStringWidth(
    text: string,
    fontFamily: string,
    fontSize: number,
    fontStyle: FontStyle,
  ): number {
    let width = 0;

    // We must calculate each sign
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const nextChar = text[i + 1] || null;

      // Get signs width
      const charWidth = this.getCharWidth(char, fontSize, undefined, fontFamily, fontStyle);
      width += charWidth;

      // If a next sign available calculate the kerning
      if (nextChar) {
        const kerning = this.getKerning(char, nextChar, undefined, fontFamily, fontStyle);
        width += kerning * fontSize; // Kerning must be scaled with the font size
      }
    }

    return width;
  }

  private getCharCode(char: string): string {
    return char.charCodeAt(0).toString();
  }

  private getAVMParserByFont(fullFontName?: string, fontName?: string, fontStyle?: FontStyle) {
    if (!fullFontName && (!fontName || !fontStyle)) {
      throw new Error(
        "No font family is given. Please set a full font name or a font with font style",
      );
    }
    let result;
    if (fullFontName) {
      result = this.afmParsers.find((f) => f.fullFontName === fullFontName);
    } else {
      result = this.afmParsers.find((f) => f.fontName === fontName && f.fontStyle === fontStyle);
    }

    if (!result)
      throw new Error(
        `Cannot find a parser for the given font family ${
          fullFontName || fontName || "No given font"
        }`,
      );

    return result;
  }

  // Methode zur Berechnung der Zeichenbreite anhand der Schriftgröße
  getCharWidth(
    char: string,
    fontSize: number,
    fullFontName?: string,
    fontName?: string,
    fontStyle?: FontStyle,
  ): number {
    const ttf = this.getCustomFont(fullFontName ?? fontName, fontStyle);
    if (ttf) return ttf.getCharWidth(char, fontSize);

    const currentParser = this.getAVMParserByFont(fullFontName, fontName, fontStyle);

    const advanceWidth = currentParser.parser.getAdvanceWidth(char);

    // Normally we got still zero. TODO: Return a alternative width like the "space"
    if (!advanceWidth) {
      throw new Error(`Kein Metrik-Eintrag für Zeichen: ${char} ${this.getCharCode(char)}`);
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
    fontStyle?: FontStyle,
  ): number {
    // TrueType kerning (the kern/GPOS tables) is not wired up yet - no kerning for custom fonts.
    if (this.getCustomFont(fullFontName ?? fontName, fontStyle)) return 0;

    const currentParser = this.getAVMParserByFont(fullFontName, fontName, fontStyle);

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
      const position = result.length + this.getHeader().length; // Calculate positions after the header
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
    const root = this.objects.findIndex((f) => f.toLowerCase().includes("catalog")) + 1;
    // A fresh document uses the same hash for both /ID strings; they only diverge on an update.
    const id = this.documentId ? ` /ID [${this.contentId()} ${this.contentId()}]` : "";
    return `trailer\n<< /Size ${objectCount + 1} /Root ${root} 0 R${id} >>\nstartxref\n${startxref}\n%%EOF`;
  }

  private contentId(): string {
    return `<${createHash("md5").update(this.objects.join("")).digest("hex").toUpperCase()}>`;
  }

  // Returns the number of objects
  getObjectCount(): number {
    return this.objects.length;
  }
}
