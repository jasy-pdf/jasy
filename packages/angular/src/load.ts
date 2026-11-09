import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { inject } from "@angular/core";

/** A file: its URL, its bytes, or a `Blob` - such as the `File` of an `<input type="file">`. */
export type FileSource = string | Uint8Array | Blob;

/**
 * Reads a source into bytes. A URL goes through Angular's `HttpClient` - always there from Angular 21,
 * on 20 when the app provides it - so the app's interceptors apply (an auth header, a base URL);
 * without one, through `fetch`. Call in an injection context.
 */
export function bytesLoader(): (source: FileSource) => Promise<Uint8Array> {
  const http = inject(HttpClient, { optional: true });
  return async (source) => {
    if (source instanceof Uint8Array) return source;
    if (typeof source !== "string") return new Uint8Array(await source.arrayBuffer());
    const fail = (reason: string, cause?: unknown) =>
      new Error(`jasy could not load ${source}: ${reason}`, { cause });
    const reasonOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

    if (http) {
      // An HttpErrorResponse is not an Error, and resource() would hide it behind a wrapper: it travels
      // on as the cause. Anything else (a backend that cannot run here) keeps its own message.
      const body = await new Promise<ArrayBuffer>((resolve, reject) =>
        http.get(source, { responseType: "arraybuffer" }).subscribe({
          next: resolve,
          error: (e: unknown) =>
            reject(
              !(e instanceof HttpErrorResponse)
                ? fail(reasonOf(e), e)
                : e.status === 0
                  ? fail("network error (offline, or blocked by CORS)", e)
                  : fail(`HTTP ${e.status} ${e.statusText}`.trim(), e),
            ),
        }),
      );
      return new Uint8Array(body);
    }

    const response = await fetch(source).catch((e: unknown) => {
      throw fail(reasonOf(e), e);
    });
    if (response.status === 401 || response.status === 403) {
      throw fail(
        `HTTP ${response.status}. It was requested with fetch, since the app has no HttpClient - ` +
          `if your interceptors add the credentials, add provideHttpClient() to the app config.`,
      );
    }
    if (!response.ok) throw fail(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
}
