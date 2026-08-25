import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { toUBL } from "../src/ubl";
import { computeInvoice } from "../src/compute";
import { Invoice } from "../src/invoice";
import { maximalInvoice } from "./support/maximal";

/**
 * UBL element order, checked against the VENDORED OASIS schema - the twin of `cii-order.test.ts`.
 *
 * It earned its place immediately: it found `cac:DeliveryLocation` holding a `cac:PostalAddress`
 * (a LocationType takes `cac:Address`) and the item identifiers emitted seller-before-buyer, where
 * UBL declares buyer first. Both files passed the EN 16931 schematron, which does not look at
 * sequence at all.
 *
 * As in the CII twin, the expected order is DERIVED from the schema, never copied into this file.
 */

const SCHEMA_DIRS = [
  join(__dirname, "..", "schema", "ubl", "maindoc"),
  join(__dirname, "..", "schema", "ubl", "common"),
];

function readSchema(): { typeOf: Map<string, string>; orderOf: Map<string, string[]> } {
  const typeOf = new Map<string, string>();
  const orderOf = new Map<string, string[]>();
  const strip = (s: string) => s.replace(/^[a-z]+:/i, "");

  for (const dir of SCHEMA_DIRS) {
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".xsd"))
      .sort()) {
      const xsd = readFileSync(join(dir, file), "utf8");

      // UBL declares elements globally and REFERENCES them inside a type, unlike the CII schema.
      for (const m of xsd.matchAll(/<xsd?:element[^>]*\sname="(\w+)"[^>]*\stype="([\w:]+)"/g)) {
        if (!typeOf.has(m[1])) typeOf.set(m[1], strip(m[2]));
      }
      for (const m of xsd.matchAll(
        /<xsd?:complexType name="(\w+)">([\s\S]*?)<\/xsd?:complexType>/g,
      )) {
        const children = [...m[2].matchAll(/<xsd?:element[^>]*\sref="[\w]+:(\w+)"/g)].map(
          (e) => e[1],
        );
        if (children.length > 0) orderOf.set(m[1], children);
      }
    }
  }
  return { typeOf, orderOf };
}

/** Every element that has children, as (parent name, child names in document order). */
function parentsOf(xml: string): { parent: string; children: string[] }[] {
  const stack: { name: string; children: string[] }[] = [];
  const out: { parent: string; children: string[] }[] = [];

  for (const m of xml.matchAll(/<(\/?)([\w:]+)([^>]*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (name.startsWith("?")) continue;
    const bare = name.replace(/^[a-z]+:/i, "");
    if (closing) {
      const done = stack.pop();
      if (done && done.children.length > 0)
        out.push({ parent: done.name, children: done.children });
      continue;
    }
    stack[stack.length - 1]?.children.push(bare);
    if (!selfClosing) stack.push({ name: bare, children: [] });
  }
  return out;
}

const invoice: Invoice = maximalInvoice;

describe("the UBL respects the OASIS schema sequence", () => {
  const { typeOf, orderOf } = readSchema();
  const xml = toUBL(invoice, computeInvoice(invoice), "en16931");

  it("read the schema at all", () => {
    expect(orderOf.size).toBeGreaterThan(200);
    // The pair that was wrong: buyer's identifier is declared BEFORE the seller's.
    const item = orderOf.get("ItemType") ?? [];
    expect(item.indexOf("BuyersItemIdentification")).toBeLessThan(
      item.indexOf("SellersItemIdentification"),
    );
  });

  it("puts every child of every element in the order the schema declares", () => {
    const wrong: string[] = [];

    for (const { parent, children } of parentsOf(xml)) {
      const order = orderOf.get(typeOf.get(parent) ?? "");
      if (!order) continue;

      let highest = -1;
      let previous = "";
      for (const child of children) {
        const at = order.indexOf(child);
        if (at === -1) continue;
        if (at < highest) wrong.push(`${parent}: ${child} must come before ${previous}`);
        else {
          highest = at;
          previous = child;
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it("uses cac:Address inside a location, not cac:PostalAddress", () => {
    // A LocationType has no PostalAddress at all; emitting one is not a re-ordering but a wrong name.
    const location = xml.slice(
      xml.indexOf("<cac:DeliveryLocation>"),
      xml.indexOf("</cac:DeliveryLocation>"),
    );
    expect(location).toContain("<cac:Address>");
    expect(location).not.toContain("<cac:PostalAddress>");
  });
});
