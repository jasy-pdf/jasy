import { HttpClient } from "@angular/common/http";
import { inject } from "@angular/core";

/** A file: its URL, its bytes, or a `Blob` - such as the `File` of an `<input type="file">`. */
export type FileSource = string | Uint8Array | Blob;

/**
 * Reads a source into bytes. A URL goes through the app's `HttpClient` when it has one, so its
 * interceptors apply (an auth header, a base URL); otherwise through `fetch`. Call in an injection context.
 */
export function bytesLoader(): (source: FileSource) => Promise<Uint8Array> {
  const http = inject(HttpClient, { optional: true });
  return async (source) => {
    if (source instanceof Uint8Array) return source;
    if (typeof source !== "string") return new Uint8Array(await source.arrayBuffer());
    if (http) {
      const body = await new Promise<ArrayBuffer>((resolve, reject) =>
        http
          .get(source, { responseType: "arraybuffer" })
          .subscribe({ next: resolve, error: reject }),
      );
      return new Uint8Array(body);
    }
    const fail = (reason: string, cause?: unknown) =>
      new Error(`jasy could not load ${source}: ${reason}`, { cause });
    const response = await fetch(source).catch((e: unknown) => {
      throw fail(e instanceof Error ? e.message : String(e), e);
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
