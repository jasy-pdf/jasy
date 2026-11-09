import {
  DestroyRef,
  Injector,
  PLATFORM_ID,
  assertInInjectionContext,
  inject,
  resource,
  signal,
  type ResourceRef,
  type Signal,
} from "@angular/core";
import { DomSanitizer, type SafeResourceUrl } from "@angular/platform-browser";
import type { RenderOptions } from "@jasy/pdf";
import type { PdfDocumentFn } from "./document.js";
import { JasyPdf, RENDER_IN, type RenderIn } from "./service.js";

/** A rendered PDF, ready for a preview or a link. */
export interface PdfFile {
  bytes: Uint8Array;
  /** A `blob:` URL of the PDF. Revoked when the next one replaces it, or when its owner is destroyed. */
  url: string;
  /** The same URL, marked safe for `<iframe [src]>`. */
  safeUrl: SafeResourceUrl;
}

/**
 * Angular's `ResourceRef` for a PDF, plus `latest()`: the last PDF that rendered, kept while the next
 * one renders and when it fails. `value()` is empty in between - Angular drops a resource's value when its
 * params change - so a preview bound to `latest()` does not blink on every change.
 */
export interface PdfResourceRef extends ResourceRef<PdfFile | undefined> {
  readonly latest: Signal<PdfFile | undefined>;
  // Angular's own guard narrows to an intersection whose first `value()` is still the wide one; naming
  // the narrowed resource first keeps `if (ref.hasValue()) ref.value()` a PdfFile, as users write it.
  hasValue(): this is ResourceRef<PdfFile> & PdfResourceRef;
}

export interface PdfResourceOptions {
  /** Render options; a function is tracked like `data`, so a signal in it re-renders the PDF. */
  options?: RenderOptions | (() => RenderOptions);
  /** Where to run, when called outside an injection context. */
  injector?: Injector;
}

/**
 * A PDF that follows your signals: `data` is read like `resource({ params })`, and the PDF is rendered
 * again whenever it changes. Return `undefined` from `data` to wait; a document without data takes none.
 * The document runs in this resource's injector, so it sees the providers of its component and route.
 *
 * `latest()` holds the last PDF that rendered - bind a preview to it. `isLoading()`, `error()` and
 * `reload()` are Angular's own; read `value()` behind `hasValue()`, since it throws in an error state.
 *
 * Renders only in the browser - on the server it stays idle, since a preview there has nobody to
 * look at it. Use `inject(JasyPdf).render()` on the server.
 *
 * ```ts
 * preview = pdfResource(invoicePdf, () => this.invoice());
 * // @if (preview.latest(); as pdf) { <iframe [src]="pdf.safeUrl"></iframe> }
 * ```
 */
export function pdfResource(
  document: PdfDocumentFn,
  data?: undefined,
  options?: PdfResourceOptions,
): PdfResourceRef;
export function pdfResource<T>(
  document: PdfDocumentFn<T>,
  data: () => T | undefined,
  options?: PdfResourceOptions,
): PdfResourceRef;
export function pdfResource<T>(
  document: PdfDocumentFn<T>,
  data?: () => T | undefined,
  { options, injector }: PdfResourceOptions = {},
): PdfResourceRef {
  if (!injector) assertInInjectionContext(pdfResource);
  injector ??= inject(Injector);
  const renderIn = (injector.get(JasyPdf) as unknown as { [RENDER_IN]: RenderIn })[RENDER_IN];
  const own = injector;

  return previewResource(
    injector,
    // Wrapped in an object: a document without data still renders, where `undefined` would mean "wait".
    () => {
      const value = data?.() as T;
      if (data && value === undefined) return undefined;
      return { value, options: typeof options === "function" ? options() : options };
    },
    ({ value, options }) => renderIn(own, document, value, options),
  );
}

/**
 * What every preview shares: idle on the server, the PDF as a `blob:` URL, the previous URL revoked
 * when a new one replaces it, and the last one when the owner is destroyed. `params` returns
 * `undefined` to wait.
 */
export function previewResource<P extends object>(
  injector: Injector,
  params: () => P | undefined,
  produce: (params: P) => Promise<Uint8Array>,
): PdfResourceRef {
  const sanitizer = injector.get(DomSanitizer);
  const browser = injector.get(PLATFORM_ID) === "browser";

  let current: string | undefined;
  const replace = (url?: string) => {
    if (current) URL.revokeObjectURL(current);
    current = url;
  };
  injector.get(DestroyRef).onDestroy(() => replace());

  const latest = signal<PdfFile | undefined>(undefined);
  const ref = resource({
    injector,
    params: () => (browser ? params() : undefined),
    loader: async ({ params, abortSignal }) => {
      // One task later: when the next change has already arrived (typing), this one is not even started.
      await new Promise((r) => setTimeout(r));
      if (abortSignal.aborted) return undefined;
      const bytes = await produce(params);
      if (abortSignal.aborted) return undefined;
      const url = URL.createObjectURL(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }),
      );
      replace(url);
      const file = { bytes, url, safeUrl: sanitizer.bypassSecurityTrustResourceUrl(url) };
      latest.set(file);
      return file;
    },
  });
  return Object.assign(ref, { latest: latest.asReadonly() }) as PdfResourceRef;
}
