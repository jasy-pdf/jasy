import { describe, it, expect } from "vitest";
import * as vue from "@jasy/vue";
import * as pdf from "@jasy/pdf";
import { COMPONENTS, SERVER_FACTORIES, SERVER_UTILS } from "../src/module.ts";

// The module auto-registers by NAME, from two hand-written lists. Hand-written lists drift: the form
// fields shipped in @jasy/vue and this module knew nothing about them for a while, so a Nuxt user got a
// stale surface with no error anywhere. These tests are the guard - not that the lists are complete
// (that is a judgement call), but that every name in them EXISTS. A typo or a removed export would
// otherwise surface as a component that silently does not resolve in a template.

describe("what the module claims to auto-import", () => {
  it("names only components @jasy/vue really exports", () => {
    const missing = COMPONENTS.filter((n) => !(n in vue));
    expect(missing).toEqual([]);
  });

  it("names only factories @jasy/pdf really exports", () => {
    const missing = [...SERVER_FACTORIES, ...SERVER_UTILS].filter((n) => !(n in pdf));
    expect(missing).toEqual([]);
  });

  it("covers every form field on both sides", () => {
    // The one group where client and server are deliberately identical: a form built in a template and
    // one built in a Nitro route should offer the same seven things.
    const fields = [
      "TextField",
      "Checkbox",
      "RadioGroup",
      "Dropdown",
      "ListBox",
      "PushButton",
      "SignatureField",
    ];
    expect(fields.filter((n) => !COMPONENTS.includes(n))).toEqual([]);
    expect(fields.filter((n) => !SERVER_FACTORIES.includes(n))).toEqual([]);
  });

  it("registers each name exactly once", () => {
    // A duplicate registers the same name twice and Nuxt warns at build time - easy to add by hand,
    // invisible until someone reads the log.
    expect(new Set(COMPONENTS).size).toBe(COMPONENTS.length);

    // The server side goes further: factories and utils are spread into ONE addImports call, so a name
    // in both lists collides just as a repeat within one does. Checking them together covers both.
    const server = [...SERVER_FACTORIES, ...SERVER_UTILS];
    expect(new Set(server).size).toBe(server.length);
  });
});
