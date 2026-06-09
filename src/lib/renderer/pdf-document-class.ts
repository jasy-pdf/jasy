import { PageSize } from "../constants/page-sizes";
import { PDFDocumentElement } from "../elements";
import { FontStyle, PDFObjectManager } from "../utils/pdf-object-manager";
import { PDFRenderer } from "./pdf-renderer";
import { ColorMode, Orientation } from "./pdf-config";

// Re-exported so existing `../renderer` consumers keep importing these from here.
export { ColorMode, Orientation } from "./pdf-config";

export interface Margin {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface DefaultFont {
  fontFamily: string;
  fontSize: number;
  fontStyle: FontStyle;
}

export interface MetaData {
  title?: string;
  author?: string;
  keywords: string[];
}

export interface PDFConfig {
  pageSize?: PageSize;
  orientation?: Orientation;
  margin?: Margin;
  colorMode?: ColorMode;
  defaultFont?: DefaultFont;
  metaData?: MetaData;
}

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
      objectManager.registerFont(font.fontName, font.fontStyle, font.fullName)
    );
  }
  //#endregion

  constructor(config?: PDFConfig) {
    // Add all standard font families
    this.registerStandardFonts(this._objectManager);
    if (config) this._objectManager.changePDFConfig(config);
  }

  get objectManager() {
    return this._objectManager;
  }

  abstract build(): PDFDocumentElement;

  protected beforeRenderer() {}

  public static async render<T extends PDFDocument>(
    this: new () => T
  ): Promise<string> {
    const instance = new this();
    instance.child = instance.build();
    return await PDFRenderer.render(instance.child, instance._objectManager);
  }
}
