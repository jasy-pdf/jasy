// @jasy/angular against a real Angular injector, in Node: Angular's own server test platform, so DI,
// resource() and the sanitizer are the real ones and no browser is needed.
import "@angular/compiler";
import {
  LOCALE_ID,
  PLATFORM_ID,
  inject,
  signal,
  provideZonelessChangeDetection,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ServerTestingModule, platformServerTesting } from "@angular/platform-server/testing";
import { Document, Page, Text } from "@jasy/pdf";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  JasyBrowserOnlyError,
  JasyPdf,
  pdfResource,
  provideJasy,
  type PdfDocument,
} from "../src/index.ts";

const FONT = readFileSync(
  new URL("../../e-invoice/assets/fonts/LiberationSerif-Regular.ttf", import.meta.url),
);
const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

beforeAll(() => TestBed.initTestEnvironment(ServerTestingModule, platformServerTesting()));
afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const setup = (...providers: unknown[]) =>
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), ...(providers as never[])],
  });
const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 5));
    TestBed.tick();
  }
};

const hello: PdfDocument<string> = (name) => Document([Page([Text(`Hello ${name}`)])]);

describe("JasyPdf", () => {
  it("renders a document to PDF bytes", async () => {
    setup();
    const bytes = await TestBed.inject(JasyPdf).render(hello, "Angular");
    expect(latin1(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("runs the document in an injection context, and takes the language from LOCALE_ID", async () => {
    setup({ provide: LOCALE_ID, useValue: "de-DE" });
    const localized: PdfDocument = () => Document([Page([Text(`Sprache ${inject(LOCALE_ID)}`)])]);
    const bytes = await TestBed.inject(JasyPdf).render(localized, undefined, {
      accessible: true,
      compress: false,
    });
    expect(latin1(bytes)).toContain("/Lang (de-DE)");
  });

  it("lets a single call's options win over provideJasy defaults", async () => {
    setup(provideJasy({ defaults: { compress: false, title: "From config" } }));
    const pdf = TestBed.inject(JasyPdf);
    expect(latin1(await pdf.render(hello, "a", { accessible: true }))).toContain("From config");
    const own = latin1(await pdf.render(hello, "a", { accessible: true, title: "From the call" }));
    expect(own).toContain("From the call");
    expect(own).not.toContain("From config");
  });

  it("embeds a font configured by name", async () => {
    setup(provideJasy({ fonts: { Liberation: FONT } }));
    const doc: PdfDocument = () => Document([Page([Text("Serif", { font: "Liberation" })])]);
    expect(latin1(await TestBed.inject(JasyPdf).render(doc, undefined))).toContain("/FontFile2");
  });

  it("fetches a font URL once for every PDF, and retries one that failed", async () => {
    let calls = 0;
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (fail) return new Response("nope", { status: 404 });
        return new Response(FONT);
      }),
    );
    setup(provideJasy({ fonts: { Liberation: "https://example.com/serif.ttf" } }));
    const pdf = TestBed.inject(JasyPdf);
    const doc: PdfDocument = () => Document([Page([Text("Serif", { font: "Liberation" })])]);

    await expect(pdf.render(doc, undefined)).rejects.toThrow(/serif\.ttf: HTTP 404/);
    fail = false;
    await pdf.render(doc, undefined);
    await pdf.render(doc, undefined);
    expect(calls).toBe(2);
  });

  it("refuses download() and open() on the server, by name", async () => {
    setup();
    const pdf = TestBed.inject(JasyPdf);
    await expect(pdf.download(hello, "a")).rejects.toThrow(JasyBrowserOnlyError);
    await expect(pdf.open(hello, "a")).rejects.toThrow(JasyBrowserOnlyError);
  });
});

describe("pdfResource", () => {
  it("stays idle on the server", async () => {
    setup();
    const preview = TestBed.runInInjectionContext(() => pdfResource(hello, () => "a"));
    await settle();
    expect(preview.status()).toBe("idle");
  });

  it("renders in the browser, follows its signal and revokes the URL it replaced", async () => {
    setup({ provide: PLATFORM_ID, useValue: "browser" });
    const revoked = vi.spyOn(URL, "revokeObjectURL");
    const name = signal<string | undefined>(undefined);
    const preview = TestBed.runInInjectionContext(() => pdfResource(hello, name));

    await settle();
    expect(preview.status()).toBe("idle"); // undefined data means: wait

    name.set("first");
    await settle();
    const first = preview.value()!;
    expect(first.url).toMatch(/^blob:/);
    expect(first.safeUrl).toBeTruthy();
    expect(latin1(first.bytes.slice(0, 5))).toBe("%PDF-");

    name.set("second");
    await settle();
    expect(preview.value()!.url).not.toBe(first.url);
    expect(revoked).toHaveBeenCalledWith(first.url);
  });

  it("renders a document without data, and re-renders when its options change", async () => {
    setup({ provide: PLATFORM_ID, useValue: "browser" });
    const tagged = signal(false);
    const page: PdfDocument = () => Document([Page([Text("Hi")])]);
    const preview = TestBed.runInInjectionContext(() =>
      pdfResource(page, undefined, { options: () => ({ accessible: tagged(), compress: false }) }),
    );
    await settle();
    expect(latin1(preview.value()!.bytes)).not.toContain("/StructTreeRoot");

    tagged.set(true);
    await settle();
    expect(latin1(preview.value()!.bytes)).toContain("/StructTreeRoot");
  });
});
