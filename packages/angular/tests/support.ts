// Angular's own server test platform, so DI, resource() and the sanitizer are the real ones in Node.
import "@angular/compiler";
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
