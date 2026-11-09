import {
  PLATFORM_ID,
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from "@angular/core";
import { JASY_CONFIG, type JasyConfig } from "./config.js";
import { JasyPdf } from "./service.js";

/**
 * jasy for the whole app, in `app.config.ts`. Optional - without it, `inject(JasyPdf)` works with the
 * standard fonts and the engine's defaults.
 *
 * ```ts
 * providers: [provideJasy({ fonts: { Inter: "/fonts/Inter.woff2" }, preload: true })]
 * ```
 */
export function provideJasy(config: JasyConfig = {}): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: JASY_CONFIG, useValue: config },
    config.preload ? provideEnvironmentInitializer(preloadWhenIdle) : [],
  ]);
}

/** In the browser, after start-up and off the critical path; the server renders on demand anyway. */
function preloadWhenIdle() {
  if (inject(PLATFORM_ID) !== "browser") return;
  const pdf = inject(JasyPdf);
  // A failure stays quiet here: the first render loads again, and that one reports it.
  const run = () => void pdf.preload().catch(() => {});
  if (typeof requestIdleCallback === "function") requestIdleCallback(run);
  else setTimeout(run);
}
