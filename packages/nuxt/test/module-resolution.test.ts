import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";

// A bare "@jasy/pdf" is resolved separately for our runtime and for the user's server code, so one Nitro
// build could end up with two instances of the library - measured, with a single copy on disk. The
// element-to-renderer registry is keyed on constructors, so elements built by one instance rendered as
// nothing at all: the route answered with a valid PDF whose content stream was empty. A blank page.

const viteConfig = { optimizeDeps: {} } as Record<string, any>;

vi.mock("@nuxt/kit", async (importOriginal) => {
  const kit = await importOriginal<typeof import("@nuxt/kit")>();
  return {
    ...kit,
    // Hand back the plain definition so the test can call setup() directly.
    defineNuxtModule: (def: any) => def,
    addComponent: () => {},
    addImports: () => {},
    addImportsDir: () => {},
    addServerImports: () => {},
    addServerImportsDir: () => {},
    extendViteConfig: (fn: (c: any) => void) => fn(viteConfig),
  };
});

const runSetup = async (options: { autoImport: boolean; prefix?: string }) => {
  const nuxt = { options: { nitro: {} } } as any;
  const mod: any = (await import("../src/module.ts")).default;
  await mod.setup(options, nuxt);
  return nuxt.options.nitro.alias ?? {};
};

describe("pinning @jasy/pdf to one instance", () => {
  it("aliases the specifier to a resolved path for the whole Nitro build", async () => {
    const alias = await runSetup({ autoImport: true });

    expect(alias["@jasy/pdf"]).toBeDefined();
    expect(alias["@jasy/pdf"]).not.toBe("@jasy/pdf");
    expect(alias["@jasy/pdf"].startsWith("/")).toBe(true);
  });

  it("does it with autoImport off too, since our runtime renders either way", async () => {
    const alias = await runSetup({ autoImport: false });

    expect(alias["@jasy/pdf"]).toBeDefined();
  });

  it("pre-bundles fflate by its path through @jasy/pdf, since it is transitive", async () => {
    await runSetup({ autoImport: true });
    // A bare "fflate" does not resolve at the consumer's root under pnpm, so Vite silently skips it - it
    // warned "Unresolvable optimizeDeps.include entries: fflate" in a real install.
    expect(viteConfig.optimizeDeps.include).toContain("@jasy/pdf > fflate");
    expect(viteConfig.optimizeDeps.include).not.toContain("fflate");
  });
});

// A Nitro route that builds elements from the auto-imported names and renders them through
// definePdfHandler - our runtime. That split is where the two instances met.
describe("a Nitro route using the auto-imported factories", async () => {
  const { setup, $fetch } = await import("@nuxt/test-utils/e2e");
  await setup({ rootDir: fileURLToPath(new URL("./fixtures/basic", import.meta.url)) });

  it("renders a PDF that actually contains drawing operators", async () => {
    const res = await $fetch<{ bytes: number; pdf: string }>("/api/pdf");

    expect(res.pdf).toMatch(/^%PDF-/);
    // A blank page is a valid PDF too - what it lacks is this. (Kerning splits the string across the TJ
    // array, so match the operator and a leading fragment rather than the whole text.)
    expect(res.pdf).toMatch(/BT\n.*\(HELLO FR.*TJ\nET/s);
    expect(res.bytes).toBeGreaterThan(1000);
  });

  it("renders through definePdfHandler, which does the render inside our own runtime", async () => {
    const buf = await $fetch<ArrayBuffer>("/api/handler", { responseType: "arrayBuffer" });
    const pdf = new TextDecoder("latin1").decode(new Uint8Array(buf));

    expect(pdf).toMatch(/^%PDF-/);
    expect(pdf).toMatch(/BT\n.*\(HELLO FR.*TJ\nET/s);
  });
});
