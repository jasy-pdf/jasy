// @jasy/angular against a real Angular injector, in Node (see support.ts).
// First: it loads the Angular compiler, which the Angular packages below need when they load.
import { NO_HTTP_CLIENT, latin1, settle, setup } from "./support.ts";
import { InjectionToken, Injector, LOCALE_ID, PLATFORM_ID, inject, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Document, Page, Text } from "@jasy/pdf";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  JasyBrowserOnlyError,
  JasyPdf,
  JasyPopupBlockedError,
  pdfResource,
  provideJasy,
  type PdfDocumentFn,
} from "../src/index.ts";

const FONT = readFileSync(
  new URL("../../e-invoice/assets/fonts/LiberationSerif-Regular.ttf", import.meta.url),
);

const hello: PdfDocumentFn<string> = (name) => Document([Page([Text(`Hello ${name}`)])]);

describe("JasyPdf", () => {
  it("renders a document to PDF bytes", async () => {
    setup();
    const bytes = await TestBed.inject(JasyPdf).render(hello, "Angular");
    expect(latin1(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("runs the document in an injection context, and takes the language from LOCALE_ID", async () => {
    setup({ provide: LOCALE_ID, useValue: "de-DE" });
    const localized: PdfDocumentFn = () => Document([Page([Text(`Sprache ${inject(LOCALE_ID)}`)])]);
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
    const doc: PdfDocumentFn = () => Document([Page([Text("Serif", { font: "Liberation" })])]);
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
    setup(provideJasy({ fonts: { Liberation: "https://example.com/serif.ttf" } }), NO_HTTP_CLIENT);
    const pdf = TestBed.inject(JasyPdf);
    const doc: PdfDocumentFn = () => Document([Page([Text("Serif", { font: "Liberation" })])]);

    await expect(pdf.render(doc, undefined)).rejects.toThrow(/serif\.ttf: HTTP 404/);
    fail = false;
    await pdf.render(doc, undefined);
    await pdf.render(doc, undefined);
    expect(calls).toBe(2);
  });

  it("throws a named error when the browser blocks the tab, and renders nothing", async () => {
    setup({ provide: PLATFORM_ID, useValue: "browser" });
    vi.stubGlobal("window", { open: () => null });
    const rendered = vi.fn(hello);
    await expect(TestBed.inject(JasyPdf).open(rendered, "a")).rejects.toThrow(
      JasyPopupBlockedError,
    );
    expect(rendered).not.toHaveBeenCalled();
  });

  it("refuses download() and open() on the server, by name", async () => {
    setup();
    const pdf = TestBed.inject(JasyPdf);
    await expect(pdf.download(hello, "a")).rejects.toThrow(JasyBrowserOnlyError);
    await expect(pdf.open(hello, "a")).rejects.toThrow(JasyBrowserOnlyError);
  });
});

describe("preloading", () => {
  const fontServer = (status = 200) => {
    const fetched = vi.fn(async () =>
      status === 200 ? new Response(FONT) : new Response("", { status }),
    );
    vi.stubGlobal("fetch", fetched);
    return fetched;
  };
  const fonts = { Liberation: "https://example.com/serif.ttf" };
  const serif: PdfDocumentFn = () => Document([Page([Text("Serif", { font: "Liberation" })])]);

  it("preload() loads the configured fonts before the first PDF needs them", async () => {
    const fetched = fontServer();
    setup(provideJasy({ fonts }), NO_HTTP_CLIENT);
    const pdf = TestBed.inject(JasyPdf);
    await pdf.preload();
    expect(fetched).toHaveBeenCalledTimes(1);
    await pdf.render(serif, undefined);
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("provideJasy({ preload: true }) preloads in the browser once the app is idle", async () => {
    const fetched = fontServer();
    setup(provideJasy({ fonts, preload: true }), NO_HTTP_CLIENT, {
      provide: PLATFORM_ID,
      useValue: "browser",
    });
    TestBed.inject(JasyPdf); // starts the app's injector, and with it the initializer
    await settle();
    expect(fetched).toHaveBeenCalledTimes(1);
  });

  it("does nothing without the flag, and nothing on the server", async () => {
    const fetched = fontServer();
    setup(provideJasy({ fonts }), NO_HTTP_CLIENT, { provide: PLATFORM_ID, useValue: "browser" });
    TestBed.inject(JasyPdf);
    await settle();
    TestBed.resetTestingModule();
    setup(provideJasy({ fonts, preload: true }), NO_HTTP_CLIENT);
    TestBed.inject(JasyPdf);
    await settle();
    expect(fetched).not.toHaveBeenCalled();
  });

  it("stays quiet when a preload fails, and the first render reports it", async () => {
    fontServer(404);
    setup(provideJasy({ fonts, preload: true }), NO_HTTP_CLIENT, {
      provide: PLATFORM_ID,
      useValue: "browser",
    });
    const pdf = TestBed.inject(JasyPdf);
    await settle(); // an unhandled rejection here would fail the test run
    await expect(pdf.render(serif, undefined)).rejects.toThrow(/serif\.ttf: HTTP 404/);
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

  it("keeps the last PDF in latest() while the next one renders, where value() is empty", async () => {
    setup({ provide: PLATFORM_ID, useValue: "browser" });
    const name = signal("first");
    const preview = TestBed.runInInjectionContext(() => pdfResource(hello, name));
    await settle();
    const first = preview.latest()!;
    expect(preview.value()).toBe(first);

    name.set("second");
    TestBed.tick();
    expect(preview.hasValue()).toBe(false); // Angular drops the value when the params change
    expect(preview.latest()).toBe(first); // the preview keeps showing the last PDF
    await settle();
    expect(preview.latest()).not.toBe(first);
    expect(preview.latest()).toBe(preview.value());
  });

  it("runs the document in its own injector, so it sees the component's providers", async () => {
    setup({ provide: PLATFORM_ID, useValue: "browser" });
    const CUSTOMER = new InjectionToken<string>("CUSTOMER");
    const own = Injector.create({
      providers: [{ provide: CUSTOMER, useValue: "Ada from the component" }],
      parent: TestBed.inject(Injector),
    });
    const letter: PdfDocumentFn = () => Document([Page([Text(`Dear ${inject(CUSTOMER)}`)])]);
    const preview = pdfResource(letter, undefined, { injector: own, options: { compress: false } });
    await settle();
    expect(preview.error()).toBeUndefined();
    expect(latin1(preview.latest()!.bytes)).toContain("Ada from the component");
  });

  it("renders a document without data, and re-renders when its options change", async () => {
    setup({ provide: PLATFORM_ID, useValue: "browser" });
    const tagged = signal(false);
    const page: PdfDocumentFn = () => Document([Page([Text("Hi")])]);
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
