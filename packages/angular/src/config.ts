import { InjectionToken, makeEnvironmentProviders, type EnvironmentProviders } from "@angular/core";
import type { RenderOptions } from "@jasy/pdf";

/** A font file: its URL (fetched once, on first use) or its bytes. */
export type FontFile = string | Uint8Array;
/** One font, or a family whose styles map to `bold` / `italic` on a `Text`. */
export type FontInput =
  | FontFile
  | { normal: FontFile; bold?: FontFile; italic?: FontFile; boldItalic?: FontFile };

export interface JasyConfig {
  /**
   * Fonts every document can use by name, `Text("...", { font: "Inter" })`. A URL is fetched the first
   * time a PDF needs it and kept for the app's lifetime; `.ttf`, `.woff` and `.woff2` all work.
   */
  fonts?: Record<string, FontInput>;
  /** Render options applied to every PDF; the options of a single call win over these. */
  defaults?: Omit<RenderOptions, "fonts">;
}

export const JASY_CONFIG = new InjectionToken<JasyConfig>("JASY_CONFIG", {
  providedIn: "root",
  factory: () => ({}),
});

/**
 * jasy for the whole app, in `app.config.ts`. Optional - without it, `inject(JasyPdf)` works with the
 * standard fonts and the engine's defaults.
 *
 * ```ts
 * providers: [provideJasy({ fonts: { Inter: "/fonts/Inter.woff2" } })]
 * ```
 */
export function provideJasy(config: JasyConfig = {}): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: JASY_CONFIG, useValue: config }]);
}
