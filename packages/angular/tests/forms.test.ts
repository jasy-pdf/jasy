// JasyForms and filledPdfResource against a real Angular injector, in Node (see support.ts).
// First: it loads the Angular compiler, which the Angular packages below need when they load.
import { NO_HTTP_CLIENT, settle, setup } from "./support.ts";
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { PLATFORM_ID, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Checkbox, Document, Page, TextField, renderToBytes } from "@jasy/pdf";
import { throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { JasyBrowserOnlyError, JasyForms, JasyPdf, filledPdfResource } from "../src/index.ts";

const FORM = await renderToBytes(
  Document([
    Page([
      TextField({ name: "full_name", value: "", height: 24 }),
      Checkbox({ name: "agree", label: "I agree" }),
    ]),
  ]),
);
const valueOf = async (bytes: Uint8Array, name: string) =>
  (await TestBed.inject(JasyForms).read(bytes))?.fields.find((f) => f.name === name)?.value;

describe("JasyForms", () => {
  it("reads the fields of an existing PDF", async () => {
    setup();
    const form = await TestBed.inject(JasyForms).read(FORM);
    expect(form?.fields.map((f) => [f.name, f.type])).toEqual([
      ["full_name", "Tx"],
      ["agree", "Btn"],
    ]);
  });

  it("fills a form, and flattens it on request", async () => {
    setup();
    const forms = TestBed.inject(JasyForms);
    const filled = await forms.fill(FORM, { full_name: "Ada Lovelace", agree: true });
    expect(filled.filled).toEqual(["full_name", "agree"]);
    expect(await valueOf(filled.bytes, "full_name")).toBe("Ada Lovelace");

    const flat = await forms.fill(FORM, { full_name: "Ada" }, { flatten: true });
    expect(flat.flattened).toContain("full_name");
    expect((await forms.read(flat.bytes))?.fields ?? []).toEqual([]);
  });

  it("leaves a field alone when its value is undefined, as for a disabled form control", async () => {
    setup();
    const filled = await TestBed.inject(JasyForms).fill(FORM, {
      full_name: "Ada",
      agree: undefined,
    });
    expect(filled.filled).toEqual(["full_name"]);
  });

  it("takes a Blob, such as the File of an <input type=file>", async () => {
    setup();
    const file = new Blob([FORM as Uint8Array<ArrayBuffer>], { type: "application/pdf" });
    const filled = await TestBed.inject(JasyForms).fill(file, { full_name: "From a file" });
    expect(await valueOf(filled.bytes, "full_name")).toBe("From a file");
  });

  it("loads a URL through the app's HttpClient, so its interceptors apply", async () => {
    setup(
      provideHttpClient(
        withInterceptors([
          (req, next) => next(req.clone({ setHeaders: { Authorization: "Bearer token" } })),
        ]),
      ),
      provideHttpClientTesting(),
    );
    const read = TestBed.inject(JasyForms).read("/forms/application.pdf");
    // The PDF reader loads lazily: give the dynamic import a moment before the request goes out.
    await vi
      .waitFor(() => TestBed.inject(HttpTestingController).expectOne("/forms/application.pdf"))
      .then((req) => {
        expect(req.request.headers.get("Authorization")).toBe("Bearer token");
        req.flush(FORM.buffer.slice(FORM.byteOffset, FORM.byteOffset + FORM.byteLength));
      });
    expect((await read)?.fields).toHaveLength(2);
  });
});

describe("loading a URL through HttpClient", () => {
  it("fails with an Error naming the URL, the HttpErrorResponse as its cause", async () => {
    setup(provideHttpClient(), provideHttpClientTesting());
    const read = TestBed.inject(JasyForms).read("/forms/missing.pdf");
    const failed = expect(read).rejects;
    await vi.waitFor(() =>
      TestBed.inject(HttpTestingController)
        .expectOne("/forms/missing.pdf")
        .flush(null, { status: 404, statusText: "Not Found" }),
    );
    await failed.toThrow("jasy could not load /forms/missing.pdf: HTTP 404 Not Found");
    await read.catch((e: Error) => expect(e.cause).toBeInstanceOf(HttpErrorResponse));
  });

  it("names a network failure, which HttpClient reports as status 0", async () => {
    setup(provideHttpClient(), provideHttpClientTesting());
    const failed = expect(TestBed.inject(JasyForms).read("/forms/a.pdf")).rejects;
    await vi.waitFor(() =>
      TestBed.inject(HttpTestingController)
        .expectOne("/forms/a.pdf")
        .error(new Event("error") as ProgressEvent),
    );
    await failed.toThrow(
      "jasy could not load /forms/a.pdf: network error (offline, or blocked by CORS)",
    );
  });

  it("keeps the message of an error that is not an HTTP response", async () => {
    // Angular 21.0's own HttpClient uses XMLHttpRequest, which a server does not have.
    const broken = {
      get: () => throwError(() => new ReferenceError("XMLHttpRequest is not defined")),
    };
    setup({ provide: HttpClient, useValue: broken });
    await expect(TestBed.inject(JasyForms).read("/forms/a.pdf")).rejects.toThrow(
      "jasy could not load /forms/a.pdf: XMLHttpRequest is not defined",
    );
  });
});

describe("loading a URL without HttpClient", () => {
  it("names the URL when the network fails", async () => {
    setup(NO_HTTP_CLIENT);
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(TestBed.inject(JasyForms).read("/forms/a.pdf")).rejects.toThrow(
      "jasy could not load /forms/a.pdf: Failed to fetch",
    );
  });

  it("says that HttpClient is missing when the server wants credentials", async () => {
    setup(NO_HTTP_CLIENT);
    vi.stubGlobal("fetch", async () => new Response("", { status: 401 }));
    await expect(TestBed.inject(JasyForms).read("/forms/a.pdf")).rejects.toThrow(
      /HTTP 401.*add provideHttpClient\(\)/,
    );
  });
});

describe("JasyPdf with finished bytes", () => {
  it("downloads bytes as they are, and a document after rendering it", async () => {
    setup({ provide: PLATFORM_ID, useValue: "browser" });
    const anchors: { href: string; download: string }[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const a = { href: "", download: "", click: () => anchors.push(a) };
        return a;
      },
    });
    const pdf = TestBed.inject(JasyPdf);
    await pdf.download(FORM, "filled.pdf");
    await pdf.download(() => Document([Page([])]), undefined, "made.pdf");
    expect(anchors.map((a) => a.download)).toEqual(["filled.pdf", "made.pdf"]);
    expect(anchors.every((a) => a.href.startsWith("blob:"))).toBe(true);
  });

  it("still refuses download() of bytes on the server", async () => {
    setup();
    await expect(TestBed.inject(JasyPdf).download(FORM, "x.pdf")).rejects.toThrow(
      JasyBrowserOnlyError,
    );
  });
});

describe("filledPdfResource", () => {
  it("fills again when the values change, and reads its source once", async () => {
    setup(NO_HTTP_CLIENT, { provide: PLATFORM_ID, useValue: "browser" });
    const fetched = vi.fn(async () => new Response(FORM as Uint8Array<ArrayBuffer>));
    vi.stubGlobal("fetch", fetched);
    const values = signal<{ full_name: string } | undefined>(undefined);
    const preview = TestBed.runInInjectionContext(() =>
      filledPdfResource("/forms/application.pdf", values),
    );

    await settle();
    expect(preview.status()).toBe("idle"); // undefined values mean: wait

    values.set({ full_name: "First" });
    await settle();
    const first = preview.value()!;
    expect(first.url).toMatch(/^blob:/);
    expect(await valueOf(first.bytes, "full_name")).toBe("First");

    values.set({ full_name: "Second" });
    await settle();
    expect(await valueOf(preview.value()!.bytes, "full_name")).toBe("Second");
    expect(fetched).toHaveBeenCalledTimes(1);
  });
});
