import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { setup, $fetch } from "@nuxt/test-utils/e2e";

// With autoImport off the user writes their own imports - but definePdfHandler is still ours and still
// available, and it has to render with the same @jasy/pdf instance those imports resolve to. Taking
// renderToBytes from #imports is what makes that true; importing it inside our runtime gave Nitro a
// second instance and every element was skipped, so the route answered with a blank page.
//
// This also pins the registration: renderToBytes must be registered even with the option off, or the
// Nitro build fails outright with `"renderToBytes" is not exported by "virtual:#imports"`.

describe("autoImport off, user imports @jasy/pdf themselves", async () => {
  await setup({ rootDir: fileURLToPath(new URL("./fixtures/no-autoimport", import.meta.url)) });

  it("builds, and definePdfHandler renders what the user's own imports produced", async () => {
    const buf = await $fetch<ArrayBuffer>("/api/manual", { responseType: "arrayBuffer" });
    const pdf = new TextDecoder("latin1").decode(new Uint8Array(buf));

    expect(pdf).toMatch(/^%PDF-/);
    // A blank page is a valid PDF too - what it lacks is drawing operators. (Kerning splits the string
    // across the TJ array, so match the operator and a leading fragment.)
    expect(pdf).toMatch(/BT\n.*\(MANU.*TJ\nET/s);
  });
});
