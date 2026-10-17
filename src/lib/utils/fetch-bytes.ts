/**
 * Bytes from a URL, bounded - what a font and an image from a URL both go through.
 *
 * `fetch` is used directly: it is in every browser and in Node since 18, so this needs no platform
 * port. A hung server must not hang a render, and a URL pointing at the wrong file (a video, a disk
 * image) must not be read into memory in full before anyone notices: a timeout and a size ceiling that
 * is enforced WHILE the body arrives.
 */

/** The error a caller wants its failures in - `FontUrlError`, `ImageUrlError`. */
export type UrlErrorClass = new (message: string) => Error;

export interface FetchLimits {
  timeoutMs: number;
  maxBytes: number;
}

/**
 * Fetch `url` and hand back its body. Every failure is a `Fail` naming the URL and what it was meant
 * to be (`what`: "font", "image"), never a raw network error a caller would not expect.
 */
export async function fetchBytes(
  url: string,
  what: string,
  Fail: UrlErrorClass,
  limits: FetchLimits,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(limits.timeoutMs) });
  } catch (e) {
    const why =
      (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError"
        ? `it did not respond within ${limits.timeoutMs} ms`
        : String((e as Error)?.message ?? e);
    throw new Fail(`could not fetch the ${what} at ${url}: ${why}`);
  }
  if (!response.ok) {
    throw new Fail(`the ${what} at ${url} could not be fetched: HTTP ${response.status}`);
  }

  // Everything past here still talks to the network, so a failure mid-body must not escape as a raw
  // TypeError - a caller catching its own error class would miss it.
  try {
    return await readBounded(response, url, what, Fail, limits.maxBytes);
  } catch (e) {
    if (e instanceof Fail) throw e;
    throw new Fail(
      `the ${what} at ${url} could not be read: ${String((e as Error)?.message ?? e)}`,
    );
  }
}

/** Read the body with a running ceiling, so an oversized response is dropped WHILE it arrives. */
async function readBounded(
  response: Response,
  url: string,
  what: string,
  Fail: UrlErrorClass,
  maxBytes: number,
): Promise<Uint8Array> {
  // `Content-Length` is the cheap early exit; a server may omit or misstate it, so it is a hint only
  // and the real ceiling is enforced below while reading.
  const declared = Number(response.headers?.get?.("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Fail(`the ${what} at ${url} is ${declared} bytes; the limit is ${maxBytes}`);
  }

  const body = response.body;
  if (!body?.getReader) {
    // No streaming body (an older runtime, or a stubbed response): fall back to reading it whole and
    // checking afterwards. Weaker, but never worse than not checking at all.
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.length > maxBytes) {
      throw new Fail(`the ${what} at ${url} is larger than the ${maxBytes} byte limit`);
    }
    return whole;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Fail(`the ${what} at ${url} is larger than the ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
