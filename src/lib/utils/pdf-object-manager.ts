import { pageFormats, PageSize } from "../constants/page-sizes.ts";
import type { OverflowPolicy } from "../layout/fragmentation.ts";
import { STANDARD_AFM } from "../assets/font-data.ts";
import { md5, md5Hex } from "./md5.ts";
import { zlibSync } from "fflate";
import { bytesFromLatin1, latin1FromBytes } from "./bytes.ts";
import { AFMParser } from "./afm-parser.ts";
import { mergeSpans, TTFParser } from "./ttf-parser.ts";
import { WoffError, isWoff, woffToSfnt } from "./woff.ts";
import { isWoff2 } from "./woff2.ts";
import { subsetTTF } from "./ttf-subsetter.ts";
import { shapeRun, type ShapedGlyph } from "../text/shape.ts";

/** What Latin text is shaped with unless a run says otherwise: the ligatures a font's designer
 *  drew for it. On by default like kerning - CSS, browsers and every other renderer do the same,
 *  and nobody should have to know the word to get text that is set properly. */
const LATIN_FEATURES = ["liga"] as const;

/** What a run is shaped with. Arabic joining is unconditional; this is only the Latin part. */
const features = (ligatures: boolean): readonly string[] => (ligatures ? LATIN_FEATURES : []);
import { getArrayBuffer, isWindows1252 } from "./utf8-to-windows1252-encoder.ts";
import type { SecurityHandler } from "../crypto/security-handler.ts";
import type { Gradient, GradientStop } from "../ir/display-list.ts";
import { isEmojiCodePoint } from "../text/emoji-codepoints.ts";
import type { FontVerticals } from "../text/line-metrics.ts";
import type { FontDecoration } from "../text/text-decoration.ts";
import { StructTree } from "./struct-tree.ts";
import { OutlineBuilder } from "./outline.ts";
import { DestRegistry } from "./dest-registry.ts";
import { AcroFormCollector } from "../forms/acroform.ts";
// Enums come from the leaf config module (never in a cycle); the config type is
// erased at runtime so it can come from the cyclic module safely.
import { ColorMode, Orientation } from "../renderer/pdf-config.ts";
import type { PDFConfig } from "../renderer/pdf-document-class.ts";
import type { FontMetrics } from "./font-metrics.ts";

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

// Escapes a string into a valid PDF /Name token. A raw space or delimiter in a /Name (e.g. a font
// family like "Great Vibes" or "Times New Roman") breaks the dictionary, so such chars become #XX.
const pdfName = (s: string): string =>
  s.replace(
    /[^\x21-\x7e]|[#()<>[\]{}/%]/g,
    (c) => "#" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"),
  );

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
  private shadings = new Map<string, number>(); // gradient resource name -> object number
  private emojiFontName?: string; // doc-level color-emoji fallback font (Document({ emoji }))
  private emojiImage?: { url: string; format: string }; // ... or a CDN/image emoji source instead
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
  // Nested by family, then by style. The flat `${name}-${style}` key it replaced had to be BUILT on
  // every lookup, and the lookups happen once per character - the string allocation alone was a third
  // of a custom-font render. `customFontEmit` below keeps the flat key: it is touched once per face.
  private customFonts = new Map<string, Map<FontStyle, TTFParser>>();
  // Memoised getFontVerticals answers, family -> style -> metrics. Cleared when a font registers.
  private verticalsCache = new Map<string, Map<FontStyle, FontVerticals>>();
  // Same, for getFontDecoration.
  private decorationCache = new Map<string, Map<FontStyle, FontDecoration>>();
  // Per-registered face: the reserved font-object numbers + the glyph ids actually used. The font
  // program is subsetted and the objects filled in by finalizeCustomFonts(), after the render pass.
  private customFontEmit = new Map<
    string,
    {
      pdfName: string;
      /** The parsed face, kept here so the cold emit/finalize paths never look it up by key again. */
      ttf: TTFParser;
      fontFile: number;
      descriptor: number;
      cidFont: number;
      toUnicode: number;
      type0: number;
      used: Set<number>;
    }
  >();

  // Shaped runs, keyed by font + text; `null` means "asked, and there was nothing to shape".
  private shapeCache = new Map<string, ShapedGlyph[] | null>();
  // Per font, glyph -> the code points it stands for. A shaped glyph is often absent from the cmap (a
  // ligature) or maps back to a presentation form, so `ToUnicode` cannot come from the cmap alone.
  private shapedOrigins = new Map<string, Map<number, number[]>>();

  // Embedded file attachments (their /Filespec object numbers + display names). Referenced from
  // the catalog's /Names/EmbeddedFiles + /AF. Drives ZUGFeRD's embedded factur-x.xml.
  private attachments: { name: string; filespec: number }[] = [];

  // Document XMP packet (catalog /Metadata), e.g. the PDF/A-3 + Factur-X identification. The
  // content is supplied by the caller; keep it ASCII (entity-escape non-ASCII) for the 1-byte path.
  private xmpMetadata?: string;

  // The /OutputIntent dict object number (catalog /OutputIntents), set by setOutputIntent. PDF/A
  // requires one; it names the output color space via an embedded ICC profile.
  private outputIntent?: number;

  // PDF header version (PDF/A-3 needs 1.7) and whether to write a trailer /ID (PDF/A needs one).
  // Both default to the pre-PDF/A behavior, so a normal document stays byte-identical.
  private pdfVersion = "1.4";
  private documentId = false;
  private compress = false;
  private overflowPolicy: OverflowPolicy = "error";

  // Optional encryption (setSecurityHandler). Stream emitters register their raw bytes here during the
  // render; finalizeEncryption() encrypts them all in one async pass and adds the /Encrypt object.
  private security?: SecurityHandler;
  private encJobs: Uint8Array[] = [];
  private strJobs: Uint8Array[] = [];
  private encryptObjNum?: number;

  // Accessible (PDF/UA) tagging, off by default (byte-identical output); the API turns it on.
  private _struct = new StructTree();
  get struct(): StructTree {
    return this._struct;
  }

  // Document outline (bookmarks). Empty unless a `Bookmark` was placed; then finalize() emits /Outlines.
  private _outline = new OutlineBuilder();
  get outline(): OutlineBuilder {
    return this._outline;
  }

  // Named destinations (internal-link jump targets). Empty unless an `Anchor` was placed; then it emits
  // a /Names /Dests tree.
  private _dests = new DestRegistry();
  get dests(): DestRegistry {
    return this._dests;
  }

  // Interactive form fields (AcroForm). Empty unless a form field was placed; then finalize() emits the
  // catalog /AcroForm dict and each field's widget lands in its page /Annots.
  private _acroform = new AcroFormCollector();
  get acroform(): AcroFormCollector {
    return this._acroform;
  }

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

  // FlateDecode compression for stream payloads (default off; renderPdf turns it on). Off keeps the
  // PDF greppable for debugging and the internal tests; the XMP metadata stream is never routed here.
  setCompress(on: boolean): void {
    this.compress = on;
  }

  // Overflow policy for unbreakable content taller than a page region (default "error"); the renderer
  // seeds it into the layout-context root so packChildren can act on it.
  /**
   * Code points no font in the document could draw, so they were removed rather than emitted as
   * `.notdef` (which PDF/A forbids). Collected here because this object is the one thing threaded
   * through BOTH passes; the caller gets them back with the bytes, so an application can say which
   * character went missing instead of a server log nobody reads.
   */
  private readonly missingGlyphs = new Set<number>();

  reportMissingGlyph(codePoints: number[]): void {
    for (const cp of codePoints) this.missingGlyphs.add(cp);
  }

  /** The dropped code points, in the order first seen. Empty for a document that hit none. */
  getMissingGlyphs(): number[] {
    return [...this.missingGlyphs];
  }

  setOverflowPolicy(policy: OverflowPolicy): void {
    this.overflowPolicy = policy;
  }
  getOverflowPolicy(): OverflowPolicy {
    return this.overflowPolicy;
  }

  // A unique, binary-safe placeholder for a stream's bytes, swapped for ciphertext in finalizeEncryption().
  private encToken(id: number): string {
    return ` JENC:${id} `;
  }

  // The same trick for a literal STRING. A separate marker because the two are swapped differently: a
  // stream keeps its delimiters and only the payload changes, a string is replaced whole by a hex one.
  private strToken(id: number): string {
    return `\x00\x02JSTR:${id}\x02\x00`;
  }

  /**
   * The single choke-point every literal string in an OBJECT goes through - a field's `/T` and `/V`, a
   * bookmark `/Title`, a link `/URI`, an `/Alt` text, a destination name.
   *
   * Without a security handler this is the escaped literal we have always written, so output stays
   * byte-identical. With one, the raw bytes are registered for the finalize pass and a placeholder takes
   * their place: ISO 32000-1 7.6.2 requires ALL strings and streams to be encrypted, and the ones missed
   * here were exactly the values a password is supposed to protect (ISSUE-7).
   *
   * A string INSIDE a content stream needs none of this - the stream is enciphered as a whole.
   */
  pdfString(text: string): string {
    if (!this.security) {
      return `(${text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
    }
    // Encrypt the bytes the unencrypted path would have written, so a viewer decrypts to the same value.
    // No escaping is applied: the result is emitted as a HEX string, which has no escapes to get wrong.
    const bytes = new Uint8Array(getArrayBuffer(text));
    const id = this.strJobs.push(bytes) - 1;
    return this.strToken(id);
  }

  // The single encryption choke-point every stream emitter routes through (stream(), registerImage). Without
  // a security handler: the bytes as a latin1 string + their length. With one: register the raw bytes for the
  // finalize pass and return a placeholder + the pre-computable encrypted length (16-byte IV + PKCS#7 padding).
  private streamPayload(bytes: Uint8Array): { body: string; length: number } {
    if (!this.security) return { body: latin1FromBytes(bytes), length: bytes.length };
    const id = this.encJobs.push(bytes) - 1;
    return { body: this.encToken(id), length: 16 + (Math.floor(bytes.length / 16) + 1) * 16 };
  }

  // Builds a stream object body: `<< extraDict /Length n >> stream … endstream`, FlateDecode-compressed
  // when enabled AND it actually helps (tiny streams aren't inflated). The payload rides through
  // streamPayload, so it is encrypted uniformly when a security handler is set.
  private stream(extraDict: string, data: Uint8Array): string {
    const head = extraDict ? extraDict + " " : "";
    let body = data;
    let filter = "";
    if (this.compress) {
      const z = zlibSync(data);
      if (z.length < data.length) {
        body = z;
        filter = "/Filter /FlateDecode ";
      }
    }
    const p = this.streamPayload(body);
    return `<< ${head}${filter}/Length ${p.length} >>\nstream\n${p.body}\nendstream`;
  }

  // Adds a page content stream (compressed when enabled). The caller passes the raw operator string.
  // Bytes go through the Windows-1252 encoder (NOT a latin1 low-byte cast): a Tj literal may carry a
  // CP1252 char like "…"/"—"/"€" whose codepoint is > 0xFF, and latin1 would mangle it (… -> "&").
  // For every char <= 0xFF the encoder passes the byte through, so existing streams stay byte-identical.
  addContentStream(content: string): number {
    return this.addObject(this.stream("", new Uint8Array(getArrayBuffer(content))));
  }

  // A Form XObject: a self-contained content stream with its own /BBox (+ optional /Resources). Used for
  // form-field appearance streams (/AP). Routes through the same choke-point as page content, so
  // compression and encryption apply. Returns the object number.
  addFormXObject(bbox: string, content: string, resources?: string): number {
    const dict =
      `/Type /XObject /Subtype /Form /BBox ${bbox}` +
      (resources ? ` /Resources << ${resources} >>` : "");
    return this.addObject(this.stream(dict, new Uint8Array(getArrayBuffer(content))));
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

      // The body is a latin1/binary string (every char <= 0xFF), so its length IS its byte length.
      length += objectContent.length;
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
    imageData: string,
    smaskData?: string,
  ) {
    // A transparent PNG carries its alpha as a separate DeviceGray /SMask image the viewer composites with.
    let smaskEntry = "";
    if (smaskData) {
      const s = this.streamPayload(bytesFromLatin1(smaskData));
      const smaskObject = `<< /Type /XObject
    /Subtype /Image
    /Width ${width}
    /Height ${height}
    /ColorSpace /DeviceGray
    /BitsPerComponent 8
    /Filter /FlateDecode
    /Length ${s.length} >>
stream
${s.body}
endstream`;
      smaskEntry = `    /SMask ${this.addObject(smaskObject)} 0 R\n`;
    }

    const img = this.streamPayload(bytesFromLatin1(imageData));
    const imageObject = `<< /Type /XObject
    /Subtype /Image
    /Width ${width}
    /Height ${height}
    /ColorSpace /DeviceRGB
    /BitsPerComponent 8
    /Filter /${imageType}
${smaskEntry}    /Length ${img.length} >>
stream
${img.body}
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
    data: Uint8Array,
    opts: { relationship?: string; mimeType?: string; description?: string } = {},
  ): void {
    const subtype = (opts.mimeType ?? "application/octet-stream").replace(/\//g, "#2F");
    const embedded = this.addObject(
      this.stream(
        `/Type /EmbeddedFile /Subtype /${subtype} /Params << /Size ${data.length} >>`,
        data,
      ),
    );
    const desc = opts.description ? ` /Desc ${this.pdfString(opts.description)}` : "";
    const filespec = this.addObject(
      `<< /Type /Filespec /F ${this.pdfString(name)} /UF ${this.pdfString(name)} ` +
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
  setOutputIntent(icc: Uint8Array, opts: { identifier?: string; info?: string } = {}): void {
    const profile = this.addObject(this.stream("/N 3", icc));
    this.outputIntent = this.addObject(
      `<< /Type /OutputIntent /S /GTS_PDFA1 ` +
        `/OutputConditionIdentifier ${this.pdfString(opts.identifier ?? "sRGB")} ` +
        `/Info ${this.pdfString(opts.info ?? "sRGB IEC61966-2.1")} /DestOutputProfile ${profile} 0 R >>`,
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

  // Turn on encryption: the handler encrypts every stream and supplies the /Encrypt dict. Forces a trailer
  // /ID (encrypted PDFs require one) and PDF 2.0 (AES-256 R6). PDF/A forbids encryption - guarded at finalize.
  setSecurityHandler(handler: SecurityHandler): void {
    this.security = handler;
    this.documentId = true;
    this.setPdfVersion("2.0");
  }

  // One async pass at the very end: refuse to encrypt a PDF/A document, then encrypt every registered stream
  // (swap each placeholder for its ciphertext) and add the /Encrypt object the trailer references.
  async finalizeEncryption(): Promise<void> {
    if (!this.security) return;
    if (this.outputIntent !== undefined || this.attachments.length > 0) {
      throw new Error("@jasy/pdf: cannot encrypt a PDF/A document - PDF/A forbids encryption.");
    }
    for (let id = 0; id < this.encJobs.length; id++) {
      const ciphertext = latin1FromBytes(await this.security.encrypt(this.encJobs[id]));
      const token = this.encToken(id);
      const idx = this.objects.findIndex((o) => o.includes(token));
      // Function replacement: a string replacement would interpret `$&`/`$\``/... in the random ciphertext.
      if (idx >= 0) this.objects[idx] = this.objects[idx].replace(token, () => ciphertext);
    }
    // Strings: the same idea, but a string is replaced WHOLE - `(text)` becomes `<ciphertext>`. Hex,
    // because the ciphertext is binary and a hex string has no escape rules to get wrong.
    for (let id = 0; id < this.strJobs.length; id++) {
      const cipher = await this.security.encrypt(this.strJobs[id]);
      const hex = Array.from(cipher, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
      const token = this.strToken(id);
      const idx = this.objects.findIndex((o) => o.includes(token));
      if (idx >= 0) this.objects[idx] = this.objects[idx].replace(token, () => `<${hex}>`);
    }

    // Added LAST on purpose: the /Encrypt dictionary's own strings must stay in the clear (7.6.2), and
    // they would otherwise be swept up by the pass above.
    this.encryptObjNum = this.addObject(`<< ${this.security.encryptDict()} >>`);
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

  // Registers a gradient as a PDF shading (+ its color-stop function) and returns the resource name
  // (e.g. "Sh1"). Used to fill a color-glyph layer with a COLR v1 gradient. Not deduped: each layer
  // carries page-absolute coordinates, so two calls rarely match.
  registerShading(g: Gradient): string {
    const fn = this.buildShadingFunction(g.stops);
    const n = (x: number): string => x.toFixed(3);
    const coords =
      g.type === "linear"
        ? `${n(g.x0)} ${n(g.y0)} ${n(g.x1)} ${n(g.y1)}`
        : `${n(g.x0)} ${n(g.y0)} ${n(g.r0)} ${n(g.x1)} ${n(g.y1)} ${n(g.r1)}`;
    const shadingType = g.type === "linear" ? 2 : 3;
    // PDF shadings extend by clamping the end colors; "repeat"/"reflect" would need a tiling pattern,
    // so we approximate them as clamp (pad) for now - correct for the common pad case.
    const objectNumber = this.addObject(
      `<< /ShadingType ${shadingType} /ColorSpace /DeviceRGB /Coords [${coords}] ` +
        `/Function ${fn} 0 R /Extend [true true] >>`,
    );
    const name = `Sh${this.shadings.size + 1}`;
    this.shadings.set(name, objectNumber);
    return name;
  }

  // Builds the PDF function mapping t in [0,1] to a color along the stops. Two stops collapse to one
  // exponential (linear) function; more stops stitch one linear piece per interval (FunctionType 3).
  private buildShadingFunction(stops: GradientStop[]): number {
    const c = (i: number): string => stops[i].color.toPDFColorString(); // "r g b" in 0..1
    // Malformed / empty color line: fall back to opaque black instead of indexing an empty array.
    if (stops.length === 0) {
      return this.addObject("<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [0 0 0] /N 1 >>");
    }
    if (stops.length <= 2) {
      const c0 = c(0);
      const c1 = c(stops.length - 1);
      return this.addObject(`<< /FunctionType 2 /Domain [0 1] /C0 [${c0}] /C1 [${c1}] /N 1 >>`);
    }
    const pieces: number[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      pieces.push(
        this.addObject(`<< /FunctionType 2 /Domain [0 1] /C0 [${c(i)}] /C1 [${c(i + 1)}] /N 1 >>`),
      );
    }
    const functions = pieces.map((p) => `${p} 0 R`).join(" ");
    const bounds = stops
      .slice(1, -1)
      .map((s) => s.offset.toFixed(4))
      .join(" ");
    const encode = pieces.map(() => "0 1").join(" ");
    return this.addObject(
      `<< /FunctionType 3 /Domain [0 1] /Functions [${functions}] /Bounds [${bounds}] /Encode [${encode}] >>`,
    );
  }

  // Returns all registered gradient shadings (name -> object number) for the page /Resources.
  getAllShadingsRaw(): Map<string, number> {
    return this.shadings;
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
    this.verticalsCache.delete(fontName);
    this.decorationCache.delete(fontName);

    const data = STANDARD_AFM[fullName];
    if (data !== undefined) {
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

    const fontObject = `<</BaseFont/${pdfName(fullName)}/Type/Font\n/Encoding/WinAnsiEncoding\n/Subtype/Type1>>`;
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
  registerCustomFont(name: string, data: Uint8Array, style: FontStyle = FontStyle.Normal): void {
    let byStyle = this.customFonts.get(name);
    if (!byStyle) {
      byStyle = new Map();
      this.customFonts.set(name, byStyle);
    }
    if (byStyle.has(style)) return;
    // A WOFF is the same sfnt behind a small wrapper, so it is unpacked HERE - the one place every
    // font path meets (a file, raw bytes, a URL, a browser upload) - and TTFParser never learns a
    // second container format.
    // WOFF2 cannot be unwrapped here: its Brotli decoder is imported lazily, which makes it async,
    // and this is a synchronous constructor path. `renderPdf` unwraps it one step earlier - so the
    // only way to arrive here still packed is by calling the engine directly.
    if (isWoff2(data)) {
      throw new WoffError(
        "a WOFF2 font reached the object manager still packed. Register it through addFont/Document " +
          "({ fonts }) - unpacking WOFF2 needs Brotli, which is loaded asynchronously.",
      );
    }
    byStyle.set(style, new TTFParser(isWoff(data) ? woffToSfnt(data) : data));
    this.verticalsCache.delete(name); // this family now answers from the .ttf, not from an AFM
    this.decorationCache.delete(name);
    // Emission (the PDF font objects + page resource) is DEFERRED to first use via ensureEmitted(),
    // so a registered-but-never-rendered face - e.g. a bundled family the document doesn't touch -
    // costs nothing in the output. The metrics above are still available for layout immediately.
  }

  // Reserves the font objects and registers the page resource the FIRST time a face is actually
  // used. Idempotent; `style` is the already-resolved variant.
  private ensureEmitted(name: string, style: FontStyle): void {
    const key = this.customKey(name, style);
    if (this.customFontEmit.has(key)) return;

    // Reserve the font objects (dependency order so each reference points at an already-numbered
    // object); their content - a SUBSET of the font - is filled in by finalizeCustomFonts().
    const fontFile = this.addObject("<< >>");
    const descriptor = this.addObject("<< >>");
    const cidFont = this.addObject("<< >>");
    const toUnicode = this.addObject("<< >>");
    const type0 = this.addObject("<< >>");

    // The Type0 dict is the resource the page references (/F{index} -> type0 object). `force` so an
    // embedded font overrides a same-named standard-14 entry instead of being silently dropped.
    this.fonts.addFont(name, this.fonts.getLastFontIndex() + 1, type0, style, name, true);
    this.customFontEmit.set(key, {
      pdfName: name + STYLE_SUFFIX[style],
      ttf: this.customFonts.get(name)!.get(style)!, // `style` is already resolved, so this exists
      fontFile,
      descriptor,
      cidFont,
      toUnicode,
      type0,
      used: new Set([0]), // .notdef always present
    });
  }

  // Fills the reserved font objects with a SUBSET of each font (only the glyphs the document used),
  // tagged "ABCDEF+" as PDF/A requires for subsets. Call once, after the render pass, before output.
  finalizeCustomFonts(): void {
    for (const [key, e] of this.customFontEmit) {
      const ttf = e.ttf;
      const base = `${this.subsetTag(e.pdfName, e.used)}+${e.pdfName}`;
      this.replaceObject(e.fontFile, this.buildFontFile2(ttf, e.used));
      this.replaceObject(e.descriptor, this.buildFontDescriptor(base, ttf, e.fontFile));
      this.replaceObject(e.cidFont, this.buildCIDFont(base, ttf, e.descriptor, e.used));
      this.replaceObject(
        e.toUnicode,
        this.buildToUnicode(ttf, e.used, this.shapedOrigins.get(key)),
      );
      this.replaceObject(e.type0, this.buildType0(base, e.cidFont, e.toUnicode));
    }
  }

  // A deterministic 6-uppercase-letter subset tag (PDF/A wants the "TAG+FontName" form).
  private subsetTag(pdfName: string, used: Set<number>): string {
    const h = md5(new TextEncoder().encode(pdfName + [...used].sort((a, b) => a - b).join(",")));
    let tag = "";
    for (let i = 0; i < 6; i++) tag += String.fromCharCode(65 + (h[i] % 26));
    return tag;
  }

  private customKey(name: string, style: FontStyle): string {
    return `${name}-${style}`;
  }

  // The variant to actually use for (name, style): the requested style if registered, else the
  // family's Normal as a clean fallback (e.g. bold chosen but no bold file), else undefined when
  // `name` is not a custom family at all.
  //
  // This runs once per CHARACTER (getCharWidth -> getCustomFont), and every paragraph is measured
  // several times (layout, pagination, drawing), so it is the hottest function in the whole renderer.
  // The size check is what keeps a standard-14 document from paying for a feature it never uses: with
  // no custom font registered, neither lookup could ever hit, so there is nothing to look up.
  private resolveCustomStyle(
    name?: string,
    style: FontStyle = FontStyle.Normal,
  ): FontStyle | undefined {
    if (this.customFonts.size === 0 || !name) return undefined;
    const byStyle = this.customFonts.get(name);
    if (!byStyle) return undefined;
    if (byStyle.has(style)) return style;
    return byStyle.has(FontStyle.Normal) ? FontStyle.Normal : undefined;
  }

  // The same lookup as above, but returning the font itself in ONE map walk instead of resolving the
  // style and then looking the font up again under a freshly built key.
  private getCustomFont(name?: string, style: FontStyle = FontStyle.Normal): TTFParser | undefined {
    if (this.customFonts.size === 0 || !name) return undefined;
    const byStyle = this.customFonts.get(name);
    if (!byStyle) return undefined;
    return byStyle.get(style) ?? byStyle.get(FontStyle.Normal);
  }

  isCustomFont(name?: string, style: FontStyle = FontStyle.Normal): boolean {
    return !!this.resolveCustomStyle(name, style);
  }

  // The parsed font for a color-capable custom family (COLR/CPAL), for drawing emoji as vector
  // layers. Returns undefined for standard-14 fonts, unknown names, or fonts with no color glyphs -
  // the caller then draws normal monochrome text.
  getColorFont(name: string, style: FontStyle = FontStyle.Normal): TTFParser | undefined {
    const ttf = this.getCustomFont(name, style);
    return ttf?.hasColorGlyphs() ? ttf : undefined;
  }

  // The document's color-emoji fallback font: a code point the current text font can't color-render
  // is drawn from this font's color glyphs instead (so `Text("Hallo 😅")` works in one string). Set
  // via `Document({ emoji })`; must name a registered color font.
  setEmojiFont(name: string): void {
    this.emojiFontName = name;
  }

  getEmojiFont(): string | undefined {
    return this.emojiFontName;
  }

  // Alternative color-emoji source: raster images (a CDN like Twemoji, react-pdf style). The renderer
  // fetches `${url}${hexCodePoint}.${format}` per emoji and embeds it. The font source is preferred
  // (native vector); this exists for parity + as an escape hatch.
  setEmojiImageSource(url: string, format: string): void {
    this.emojiImage = { url, format };
  }

  getEmojiImageSource(): { url: string; format: string } | undefined {
    return this.emojiImage;
  }

  // Whether `ttf` has a COLOR glyph for a code point (i.e. it would render it as color emoji).
  /**
   * Whether a family can draw this code point at all. An embedded face answers from its `cmap`; a
   * standard-14 one can only draw what Windows-1252 encodes, which is what its `/Widths` array covers.
   * Used to pick a family out of a fallback stack, per code point.
   */
  hasGlyph(
    codePoint: number,
    fontFamily: string,
    fontStyle: FontStyle = FontStyle.Normal,
  ): boolean {
    const ttf = this.getCustomFont(fontFamily, fontStyle);
    if (ttf) return ttf.getGlyphIndex(codePoint) !== 0;
    return isWindows1252(codePoint);
  }

  /**
   * Whether the document draws this code point through the colour-emoji path instead of the text
   * font - a fallback emoji FONT, or an image source (`Document({ emoji })`). Such a code point is
   * missing from the text font ON PURPOSE, so glyph coverage must leave it alone. Mirrors exactly
   * what `getCharWidth` measures it as, or a dropped emoji would have been measured and not drawn.
   */
  rendersAsEmoji(codePoint: number, fontFamily: string, fontStyle: FontStyle): boolean {
    const ttf = this.getCustomFont(fontFamily, fontStyle);
    if (ttf && this.colorRenders(ttf, codePoint)) return true;
    if (this.emojiFontName && this.emojiFontName !== fontFamily) {
      const emoji = this.getColorFont(this.emojiFontName, fontStyle);
      if (emoji && this.colorRenders(emoji, codePoint)) return true;
    }
    return this.emojiImage !== undefined && isEmojiCodePoint(codePoint);
  }

  private colorRenders(ttf: TTFParser, codePoint: number): boolean {
    return ttf.getColorGlyph(ttf.getGlyphIndex(codePoint)) !== null;
  }

  // The page font resource for the resolved variant - same resolution as getCustomFont, so the
  // selected Type0 object and the emitted glyph ids always come from the SAME font file.
  getCustomFontResource(
    name: string,
    style: FontStyle = FontStyle.Normal,
  ): FontIndexes | undefined {
    const resolved = this.resolveCustomStyle(name, style);
    if (!resolved) return undefined;
    this.ensureEmitted(name, resolved);
    return this.fonts.getFont(name, resolved);
  }

  /** How many glyphs a run draws - its code-point count unless a ligature merged some. `letterSpacing`
   *  is per glyph (`Tc`), so this is what it multiplies. */
  shapedGlyphCount(
    text: string,
    fontFamily?: string,
    fontStyle?: FontStyle,
    ligatures = true,
  ): number | undefined {
    return this.shapeText(text, fontFamily, fontStyle, features(ligatures))?.length;
  }

  /**
   * The shaped glyphs of a run, or undefined when nothing needed shaping. The ONE place shaping is
   * decided, so measuring and drawing cannot disagree. Memoised: a paragraph is measured several
   * times (layout, pagination, drawing).
   */
  shapeText(
    text: string,
    fontFamily?: string,
    fontStyle: FontStyle = FontStyle.Normal,
    features: readonly string[] = LATIN_FEATURES,
  ) {
    const resolved = this.resolveCustomStyle(fontFamily, fontStyle);
    if (!resolved) return undefined;
    const key = `${this.customKey(fontFamily!, resolved)}\u0000${features.join(",")}\u0000${text}`;
    const cached = this.shapeCache.get(key);
    if (cached !== undefined) return cached ?? undefined;
    const ttf = this.customFonts.get(fontFamily!)!.get(resolved)!;
    const shaped =
      shapeRun(
        [...text].map((c) => c.codePointAt(0)!),
        ttf,
        features,
      ) ?? null;
    this.shapeCache.set(key, shaped);
    if (shaped) {
      // Recorded at shaping time - the only moment the glyph and its code points are known together.
      const fontKey = this.customKey(fontFamily!, resolved);
      let origins = this.shapedOrigins.get(fontKey);
      if (!origins) this.shapedOrigins.set(fontKey, (origins = new Map()));
      for (const g of shaped) origins.set(g.glyph, g.codePoints);
    }
    return shaped ?? undefined;
  }

  /** Hex Identity-H for glyphs the producer already resolved (a shaped run), which cannot be given as
   *  text. Recording each keeps it in the subset. */
  registerGlyphs(
    name: string,
    glyphs: readonly number[],
    style: FontStyle = FontStyle.Normal,
  ): string {
    const resolved = this.resolveCustomStyle(name, style);
    if (!resolved) return "";
    this.ensureEmitted(name, resolved);
    const emit = this.customFontEmit.get(this.customKey(name, resolved))!;
    let out = "";
    for (const g of glyphs) {
      emit.used.add(g);
      out += g.toString(16).padStart(4, "0").toUpperCase();
    }
    return out;
  }

  // Encodes text as a hex Identity-H string for an embedded font's Tj operator: each codepoint
  // becomes its 2-byte glyph id (CID == GID under /CIDToGIDMap /Identity).
  encodeCustomText(
    name: string,
    text: string,
    style: FontStyle = FontStyle.Normal,
    shape = true,
  ): string {
    const resolved = this.resolveCustomStyle(name, style);
    if (!resolved) return "";
    this.ensureEmitted(name, resolved);
    // Once per text run, not per character: the flat key is fine here.
    const emit = this.customFontEmit.get(this.customKey(name, resolved))!;
    const { ttf, used } = emit;
    const hex4 = (gid: number) => gid.toString(16).padStart(4, "0").toUpperCase();

    // The SAME shaped run the measuring path used, so the glyphs drawn are the glyphs measured.
    // `shape: false` is for a caller that has ALREADY decided the run is unshaped - the renderer puts
    // shaped glyphs in the IR node, so the backend's text path is the unshaped one by definition.
    const shaped = shape ? this.shapeText(text, name, style) : undefined;
    if (shaped) {
      let out = "";
      for (const g of shaped) {
        used.add(g.glyph);
        out += hex4(g.glyph);
      }
      return out;
    }

    let hex = "";
    for (const ch of text) {
      const gid = ttf.getGlyphIndex(ch.codePointAt(0)!);
      used.add(gid); // record the glyph so the subset keeps it
      hex += hex4(gid);
    }
    return hex;
  }

  // The SUBSET font program (only the used glyphs' outlines). Binary bytes survive as a latin1
  // string - the final Windows-1252 encoder passes 0x00-0xFF through unchanged (see getArrayBuffer).
  private buildFontFile2(ttf: TTFParser, used: Set<number>): string {
    const bytes = subsetTTF(ttf.getData(), used);
    // /Length1 is the UNCOMPRESSED font-program length (required even when FlateDecode'd).
    return this.stream(`/Length1 ${bytes.length}`, bytes);
  }

  private buildFontDescriptor(name: string, ttf: TTFParser, fontFile: number): string {
    const [x0, y0, x1, y1] = ttf.bbox;
    return (
      `<< /Type /FontDescriptor /FontName /${pdfName(name)} /Flags 4 ` +
      `/FontBBox [${x0} ${y0} ${x1} ${y1}] /ItalicAngle 0 ` +
      `/Ascent ${ttf.ascent} /Descent ${ttf.descent} /CapHeight ${ttf.ascent} /StemV 80 ` +
      `/FontFile2 ${fontFile} 0 R >>`
    );
  }

  // CIDToGIDMap /Identity means CID == GID. /W lists only the USED glyphs' widths (sparse, one
  // `gid [w]` entry each); everything else falls back to /DW.
  private buildCIDFont(
    name: string,
    ttf: TTFParser,
    descriptor: number,
    used: Set<number>,
  ): string {
    const all = ttf.glyphWidths();
    const w = [...used]
      .sort((a, b) => a - b)
      .map((g) => `${g} [${all[g] ?? 1000}]`)
      .join(" ");
    return (
      `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${pdfName(name)} ` +
      `/CIDSystemInfo << /Registry ${this.pdfString("Adobe")} /Ordering ${this.pdfString("Identity")} /Supplement 0 >> ` +
      `/FontDescriptor ${descriptor} 0 R /CIDToGIDMap /Identity ` +
      `/DW 1000 /W [${w}] >>`
    );
  }

  // Maps glyph id -> Unicode so the text stays copy-/searchable (rendering doesn't need it). Only
  // the used glyphs are listed, to match the subset.
  private buildToUnicode(
    ttf: TTFParser,
    used: Set<number>,
    shapedOrigins: Map<number, number[]> = new Map(),
  ): string {
    const hex4 = (n: number) => n.toString(16).padStart(4, "0").toUpperCase();
    // A code point above the BMP needs its surrogate PAIR here - a `bfchar` destination is UTF-16BE.
    const utf16 = (code: number) =>
      code > 0xffff
        ? hex4(0xd800 + ((code - 0x10000) >> 10)) + hex4(0xdc00 + ((code - 0x10000) & 0x3ff))
        : hex4(code);
    const rev = ttf.reverseCmap();
    // A SHAPED glyph wins: it is often absent from the cmap (a ligature) or maps back to a
    // presentation form rather than the letter that was written (a joining form), so the reverse
    // cmap alone would make copied text wrong.
    const entries = [...used]
      .sort((a, b) => a - b)
      .filter((g) => shapedOrigins.has(g) || rev.has(g))
      .map((g) => [g, shapedOrigins.get(g) ?? [rev.get(g)!]] as [number, number[]]);
    const blocks: string[] = [];
    for (let i = 0; i < entries.length; i += 100) {
      const block = entries.slice(i, i + 100);
      const lines = block.map(([gid, codes]) => `<${hex4(gid)}> <${codes.map(utf16).join("")}>`);
      blocks.push(`${block.length} beginbfchar\n${lines.join("\n")}\nendbfchar`);
    }
    const body =
      `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n` +
      `/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n` +
      `/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n` +
      `1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${blocks.join("\n")}\n` +
      `endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
    return this.stream("", bytesFromLatin1(body));
  }

  private buildType0(name: string, cidFont: number, toUnicode: number): string {
    return (
      `<< /Type /Font /Subtype /Type0 /BaseFont /${pdfName(name)} /Encoding /Identity-H ` +
      `/DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicode} 0 R >>`
    );
  }

  // The vertical metrics of a face, in em fractions - what seats the baseline and sizes the line
  // box (see text/line-metrics.ts). An embedded font answers from its own `hhea`; a standard-14
  // font from its AFM header. Nothing here is guessed: both numbers come out of the font data.
  //
  // Asked once per LINE (not per character), but a long document has a lot of lines and the
  // standard-14 lookup below is a linear scan, so the answer is memoised per face. Registering a
  // font clears the cache - a name can go from standard-14 to embedded.
  getFontVerticals(fontFamily: string, fontStyle: FontStyle): FontVerticals {
    let byStyle = this.verticalsCache.get(fontFamily);
    const hit = byStyle?.get(fontStyle);
    if (hit) return hit;

    const ttf = this.getCustomFont(fontFamily, fontStyle);
    const verticals = ttf
      ? {
          ascent: ttf.ascent / 1000,
          descent: -ttf.descent / 1000, // hhea writes the descent negative
          lineGap: ttf.lineGap / 1000,
        }
      : this.getAVMParserByFont(undefined, fontFamily, fontStyle).parser.verticals();

    if (!byStyle) {
      byStyle = new Map();
      this.verticalsCache.set(fontFamily, byStyle);
    }
    byStyle.set(fontStyle, verticals);
    return verticals;
  }

  // Underline / strikethrough geometry of a face, in em fractions. Same shape as getFontVerticals:
  // an embedded font answers from its `post`/`OS/2` tables, a standard-14 one from its AFM header,
  // and the answer is memoised per face because it is asked once per decorated run.
  getFontDecoration(fontFamily: string, fontStyle: FontStyle): FontDecoration {
    let byStyle = this.decorationCache.get(fontFamily);
    const hit = byStyle?.get(fontStyle);
    if (hit) return hit;

    const ttf = this.getCustomFont(fontFamily, fontStyle);
    const decoration = ttf
      ? ttf.decoration()
      : this.getAVMParserByFont(undefined, fontFamily, fontStyle).parser.decoration();

    if (!byStyle) {
      byStyle = new Map();
      this.decorationCache.set(fontFamily, byStyle);
    }
    byStyle.set(fontStyle, decoration);
    return decoration;
  }

  // Whether to kern. Document-level: measuring (via `runAdvance`, which reads this off the metrics)
  // and drawing (the backend emits a `TJ`) both consult it, so they can never disagree. OFF while the
  // embedded-font path (kern/GPOS) is unbuilt - a standard-14-only kerning would set the 14 system
  // fonts finer than a user's own font, which is worse than none. Flip to on when GPOS lands.
  kerningEnabled = false;

  setKerning(enabled: boolean): void {
    this.kerningEnabled = enabled;
  }

  /**
   * The kerning adjustment for each adjacent code-point pair of `text`, in em/1000 (the sign the
   * font declares: negative tightens). Length is `codePointCount - 1`. Zero at any pair next to a
   * space - letters are never kerned against a space, which also keeps a per-word measure equal to a
   * whole-line one (the space pairs contribute nothing either way).
   *
   * Standard-14 answers from the AFM `KPX` pairs. An embedded font has no kerning yet (its `kern` /
   * `GPOS` tables are unparsed), so it returns zeros - never a wrong value, just no adjustment.
   */
  /** Kerning between adjacent GLYPHS - what a shaped run needs, and what the backend already holds.
   *  Same lookup as the character path; `getKerning` is keyed by glyph id either way. */
  getGlyphKernPairs(glyphs: readonly number[], fontFamily: string, fontStyle: FontStyle): number[] {
    const ttf = this.getCustomFont(fontFamily, fontStyle);
    if (!ttf) return [];
    const pairs: number[] = [];
    for (let i = 0; i < glyphs.length - 1; i++) {
      pairs.push(ttf.getKerning(glyphs[i]!, glyphs[i + 1]!));
    }
    return pairs;
  }

  getKernPairs(text: string, fontFamily: string, fontStyle: FontStyle, ligatures = true): number[] {
    const chars = [...text];
    if (chars.length < 2) return [];
    // A shaped run kerns over its SHAPED glyphs, not its characters: after shaping there may be fewer
    // glyphs than code points (a ligature), and the pairs that matter are the ones actually drawn.
    // `getKerning` is keyed by glyph id anyway, so this is the same lookup - and the backend now emits
    // a `TJ` over glyph chunks, which is what used to be missing. One adjustment per adjacent DRAWN
    // pair, either path, so `runAdvance` measures exactly what is drawn.
    const shaped = this.shapeText(text, fontFamily, fontStyle, features(ligatures));
    if (shaped)
      return this.getGlyphKernPairs(
        shaped.map((g) => g.glyph),
        fontFamily,
        fontStyle,
      );
    const out: number[] = [];
    // An embedded font kerns by GLYPH id (kern table / GPOS); a standard-14 one by character (AFM).
    const ttf = this.getCustomFont(fontFamily, fontStyle);
    const parser = ttf
      ? undefined
      : this.getAVMParserByFont(undefined, fontFamily, fontStyle).parser;
    for (let i = 0; i < chars.length - 1; i++) {
      const a = chars[i];
      const b = chars[i + 1];
      if (a === " " || b === " ") {
        out.push(0);
      } else if (ttf) {
        out.push(
          ttf.getKerning(
            ttf.getGlyphIndex(a.codePointAt(0)!),
            ttf.getGlyphIndex(b.codePointAt(0)!),
          ),
        );
      } else {
        out.push(parser!.getKerning(a, b));
      }
    }
    return out;
  }

  /**
   * Where the glyphs of `text` put ink inside a horizontal band, as x-intervals in POINTS measured
   * from the start of the run. This is what an underline steps around ("skip-ink").
   *
   * `bandTop` / `bandBottom` are in points relative to the baseline, y UP (so both negative under
   * it). Only an EMBEDDED font can answer: the standard-14 outlines live in the viewer, not here.
   * Callers must check `isCustomFont` first rather than treat an empty result as "no descenders".
   */
  getInkSpansInBand(
    text: string,
    fontSize: number,
    fontFamily: string,
    fontStyle: FontStyle,
    bandTop: number,
    bandBottom: number,
    letterSpacing = 0,
  ): Array<[number, number]> {
    const ttf = this.getCustomFont(fontFamily, fontStyle);
    if (!ttf) return [];
    const scale = fontSize / ttf.unitsPerEm;
    const spans: Array<[number, number]> = [];
    let pen = 0;
    for (const ch of text) {
      const codePoint = ch.codePointAt(0);
      if (codePoint !== undefined) {
        for (const [x0, x1] of ttf.inkSpansInBand(codePoint, bandTop / scale, bandBottom / scale)) {
          spans.push([pen + x0 * scale, pen + x1 * scale]);
        }
      }
      // The pen advances by the glyph AND its letter-spacing, so the ink of the next glyph lands
      // where `Tc` actually draws it - otherwise the skipped gaps drift under the wrong letters.
      pen += this.getCharWidth(ch, fontSize, undefined, fontFamily, fontStyle) + letterSpacing;
    }
    return mergeSpans(spans);
  }

  // Returns the current width of a text, included kernings
  public getStringWidth(
    text: string,
    fontFamily: string,
    fontSize: number,
    fontStyle: FontStyle,
    ligatures = true,
  ): number {
    // Shaping first: a joined run is narrower than the same letters apart, so measuring the unshaped
    // form while drawing the shaped one would break every line. Both sides ask `shapeText`.
    const shaped = this.shapeText(text, fontFamily, fontStyle, features(ligatures));
    if (shaped) {
      const ttf = this.getCustomFont(fontFamily, fontStyle)!;
      return shaped.reduce((w, g) => w + ttf.unitsToPoints(g.advance, fontSize), 0);
    }

    let width = 0;

    // Iterate code points, not UTF-16 units: an astral char (emoji, CJK-ext) is a surrogate pair,
    // and indexing by unit would measure each half as its own (zero-width) "char". The spread splits
    // on code points; for BMP text this is one unit each, so the result is unchanged.
    //
    // NO KERNING. We write a run as a single `Tj`, and a viewer advances that by the font's plain
    // widths - PDF never kerns on its own; a producer has to say so with a `TJ` array. Folding the
    // AFM's kerning into the MEASUREMENT while the OUTPUT ignores it made every kerned string draw
    // wider than its box: "AVATAR Wave" at 40pt by 19pt, "Total" at 11pt by 5.7%. Measured must equal
    // drawn. The AFM kerning pairs stay parsed (`getKerning`) for the day we emit `TJ` - see the
    // "real kerning" item in todo.md, which must cover embedded fonts too (`kern`/`GPOS`).
    for (const char of text) {
      width += this.getCharWidth(char, fontSize, undefined, fontFamily, fontStyle);
    }

    return width;
  }

  private getAVMParserByFont(fullFontName?: string, fontName?: string, fontStyle?: FontStyle) {
    // A non-string family means font bytes were passed where a name belongs - hint at the fix instead of
    // stringifying the byte blob into an unreadable "parser not found".
    for (const name of [fullFontName, fontName])
      if (name != null && typeof name !== "string")
        throw new Error(
          `Font family must be a string name, got ${typeof name}. Register font bytes via the document \`fonts\` map (or addFont) and reference them by name.`,
        );
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
    const name = fullFontName ?? fontName;
    const ttf = this.getCustomFont(name, fontStyle);

    // Color-emoji fallback: a code point the current font can't color-render is measured with the
    // emoji font's advance (matching the renderer, which draws it from that font). Guarded on
    // emojiFontName so a normal document's measuring stays byte-identical.
    if (this.emojiFontName && this.emojiFontName !== name) {
      const cp = char.codePointAt(0);
      if (cp !== undefined && !(ttf && this.colorRenders(ttf, cp))) {
        const emoji = this.getColorFont(this.emojiFontName, fontStyle);
        if (emoji && this.colorRenders(emoji, cp)) return emoji.getCharWidth(char, fontSize);
      }
    }

    // Image emoji source: an emoji code point is drawn as a 1em-square image, so it advances one em.
    if (this.emojiImage) {
      const cp = char.codePointAt(0);
      if (cp !== undefined && isEmojiCodePoint(cp) && !(ttf && this.colorRenders(ttf, cp))) {
        return fontSize;
      }
    }

    if (ttf) return ttf.getCharWidth(char, fontSize);

    const currentParser = this.getAVMParserByFont(fullFontName, fontName, fontStyle);

    let advanceWidth = currentParser.parser.getAdvanceWidth(char);

    // A character a standard font cannot represent (not in Windows-1252) is drawn as "?" by the
    // encoder; measure it as "?" too so the width matches the glyph - graceful instead of a crash.
    if (!advanceWidth) {
      advanceWidth =
        currentParser.parser.getAdvanceWidth("?") || currentParser.parser.getAdvanceWidth(" ");
    }

    // Width of the character multiplied by the font size (scaled proportionally)
    return (advanceWidth / 1000) * fontSize;
  }

  // Method to get the kerning, if available, between two signs

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
    const enc = this.encryptObjNum ? ` /Encrypt ${this.encryptObjNum} 0 R` : "";
    return `trailer\n<< /Size ${objectCount + 1} /Root ${root} 0 R${id}${enc} >>\nstartxref\n${startxref}\n%%EOF`;
  }

  private contentId(): string {
    return `<${md5Hex(new TextEncoder().encode(this.objects.join(""))).toUpperCase()}>`;
  }

  // Returns the number of objects
  getObjectCount(): number {
    return this.objects.length;
  }
}
