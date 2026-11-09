import {
  DestroyRef,
  Injector,
  PLATFORM_ID,
  assertInInjectionContext,
  inject,
  resource,
  type ResourceRef,
} from "@angular/core";
import { DomSanitizer, type SafeResourceUrl } from "@angular/platform-browser";
import type { RenderOptions } from "@jasy/pdf";
import type { PdfDocument } from "./document.js";
import { JasyPdf } from "./service.js";

/** A rendered PDF, ready for a preview or a link. */
export interface PdfFile {
  bytes: Uint8Array;
  /** A `blob:` URL of the PDF. Revoked when the next one replaces it, or when its owner is destroyed. */
  url: string;
  /** The same URL, marked safe for `<iframe [src]>` - Angular blocks a plain one there. */
  safeUrl: SafeResourceUrl;
}

export interface PdfResourceOptions {
  /** Render options; a function is tracked like `data`, so a signal in it re-renders the PDF. */
  options?: RenderOptions | (() => RenderOptions);
  /** Where to run, when called outside an injection context. */
  injector?: Injector;
}

/**
 * A PDF that follows your signals: `data` is read like `resource({ params })`, and the PDF is rendered
 * again whenever it changes. Return `undefined` from `data` to wait. `value()`, `isLoading()`,
 * `error()` and `reload()` are Angular's own `ResourceRef`.
 *
 * Renders only in the browser - on the server it stays idle, since a preview there has nobody to
 * look at it. Use `inject(JasyPdf).render()` on the server.
 *
 * ```ts
 * preview = pdfResource(invoicePdf, () => this.invoice());
 * // <iframe [src]="preview.value()?.safeUrl"></iframe>
 * ```
 */
export function pdfResource<T>(
  document: PdfDocument<T>,
  data?: () => T | undefined,
  { options, injector }: PdfResourceOptions = {},
): ResourceRef<PdfFile | undefined> {
  if (!injector) assertInInjectionContext(pdfResource);
  injector ??= inject(Injector);
  const pdf = injector.get(JasyPdf);
  const sanitizer = injector.get(DomSanitizer);
  const browser = injector.get(PLATFORM_ID) === "browser";

  let current: string | undefined;
  const replace = (url?: string) => {
    if (current) URL.revokeObjectURL(current);
    current = url;
  };
  injector.get(DestroyRef).onDestroy(() => replace());

  return resource({
    injector,
    // Wrapped in an object: a document without data still renders, where `undefined` would mean "wait".
    params: () => {
      if (!browser) return undefined;
      const value = data?.() as T;
      if (data && value === undefined) return undefined;
      return { value, options: typeof options === "function" ? options() : options };
    },
    loader: async ({ params, abortSignal }) => {
      const bytes = await pdf.render(document, params.value, params.options);
      if (abortSignal.aborted) return undefined;
      const url = URL.createObjectURL(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
      );
      replace(url);
      return { bytes, url, safeUrl: sanitizer.bypassSecurityTrustResourceUrl(url) };
    },
  });
}
