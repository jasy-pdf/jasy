// Angular's own server test platform, so DI, resource() and the sanitizer are the real ones in Node.
import "@angular/compiler";
import { HttpClient } from "@angular/common/http";
import { provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ServerTestingModule, platformServerTesting } from "@angular/platform-server/testing";
import { afterEach, beforeAll, vi } from "vitest";

beforeAll(() => TestBed.initTestEnvironment(ServerTestingModule, platformServerTesting()));
afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

export const setup = (...providers: unknown[]) =>
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), ...(providers as never[])],
  });

/** Lets resources load and change detection run. */
export const settle = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 5));
    TestBed.tick();
  }
};

export const latin1 = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

/** An app without HttpClient - Angular 20 without provideHttpClient(); from 21 on there always is one.
 *  Tests that stub `fetch` need it, or the request would go through HttpClient instead. */
export const NO_HTTP_CLIENT = { provide: HttpClient, useValue: null };
