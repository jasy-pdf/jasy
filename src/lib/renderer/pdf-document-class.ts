import { preloadStandardFonts } from "../utils/afm-parser.ts";
import { PDFDocumentElement } from "../elements/index.ts";
import { FontStyle } from "../common/font-style.ts";
import { PDFObjectManager } from "../utils/pdf-object-manager.ts";
import { PDFRenderer } from "./pdf-renderer.ts";
import type { PDFConfig } from "../common/pdf-config.ts";

export abstract class PDFDocument {
  // One object manager per document instance - no global singleton. Threaded
  // explicitly into the renderer.
  private _objectManager = new PDFObjectManager();

  private child!: PDFDocumentElement;
  //#region  Helper
  // Method to register all standard fonts
  private registerStandardFonts(objectManager: PDFObjectManager) {
    const standardFonts = [
      {
        fontName: "Helvetica",
        fontStyle: FontStyle.Normal,
        fullName: "Helvetica",
      },
      {
        fontName: "Helvetica",
        fontStyle: FontStyle.Bold,
        fullName: "Helvetica-Bold",
      },
      {
        fontName: "Helvetica",
        fontStyle: FontStyle.Italic,
        fullName: "Helvetica-Oblique",
      },
      {
        fontName: "Helvetica",
        fontStyle: FontStyle.BoldItalic,
        fullName: "Helvetica-BoldOblique",
      },

      { fontName: "Courier", fontStyle: FontStyle.Normal, fullName: "Courier" },
      {
        fontName: "Courier",
        fontStyle: FontStyle.Bold,
        fullName: "Courier-Bold",
      },
      {
        fontName: "Courier",
        fontStyle: FontStyle.Italic,
        fullName: "Courier-Oblique",
      },
      {
        fontName: "Courier",
        fontStyle: FontStyle.BoldItalic,
        fullName: "Courier-BoldOblique",
      },

      {
        fontName: "Times-Roman",
        fontStyle: FontStyle.Normal,
        fullName: "Times-Roman",
      },
      {
        fontName: "Times-Roman",
        fontStyle: FontStyle.Bold,
        fullName: "Times-Bold",
      },
      {
        fontName: "Times-Roman",
        fontStyle: FontStyle.Italic,
        fullName: "Times-Italic",
      },
      {
        fontName: "Times-Roman",
        fontStyle: FontStyle.BoldItalic,
        fullName: "Times-BoldItalic",
      },

      {
        fontName: "Symbol",
        fontStyle: FontStyle.Normal,
        fullName: "Symbol",
      },

      {
        fontName: "ITC Zapf Dingbats",
        fontStyle: FontStyle.Normal,
        fullName: "ZapfDingbats",
      },
    ];

    standardFonts.forEach((font) =>
      objectManager.registerFont(font.fontName, font.fontStyle, font.fullName),
    );
  }
  //#endregion

  constructor(config?: PDFConfig) {
    // Add all standard font families - unless the document is PDF/A, which forbids non-embedded
    // fonts (the caller then supplies embedded fonts for every name it uses).
    if (config?.registerStandardFonts !== false) {
      this.registerStandardFonts(this._objectManager);
    }
    if (config) this._objectManager.changePDFConfig(config);
    // Kerning is on by default at the document level (the `renderToBytes` path sets the same). A
    // bare `PDFObjectManager` still defaults OFF, so unit tests keep predictable un-kerned metrics.
    this._objectManager.setKerning(true);
  }

  get objectManager() {
    return this._objectManager;
  }

  abstract build(): PDFDocumentElement;

  protected beforeRenderer() {}

  public static async render<T extends PDFDocument>(this: new () => T): Promise<string> {
    // Before build(): a subclass may measure text there, through `objectManager`.
    await preloadStandardFonts();
    const instance = new this();
    instance.child = instance.build();
    return await PDFRenderer.render(instance.child, instance._objectManager);
  }
}
