// Leaf module: type imports only, so it can never sit inside an import cycle. The page/color
// enums live here because they are runtime values used across modules that DO form
// cycles (object manager <-> document <-> elements); importing them from a cyclic
// module snapshots them as `undefined` under some load orders.
import type { PageSize } from "../constants/page-sizes.ts";
import type { FontStyle } from "./font-style.ts";

export enum Orientation {
  portrait = "PORTRAIT",
  landscape = "LANDSCAPE",
}

export enum ColorMode {
  color = "COLOR",
  grayscale = "GRAYSCALE",
}

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
  /** Register the 14 standard fonts (default true). Set false for PDF/A, where every font must be
   *  embedded - the non-embeddable standard-14 must not appear in the document at all. */
  registerStandardFonts?: boolean;
}
