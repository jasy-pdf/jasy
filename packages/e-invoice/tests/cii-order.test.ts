import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { toCII } from "../src/cii";
import { computeInvoice } from "../src/compute";
import { maximalInvoice as maximal } from "./support/maximal";

/**
 * CII element order, checked against the VENDORED XSD.
 *
 * In CII the sequence is binding: a correct set of elements in the wrong order is an invalid file.
 * The EN 16931 schematron does NOT catch it - it asks about business rules, not about sequence - so
 * three real ordering bugs sat in the generator while every validator we ran said VALID. They only
 * surfaced when an invoice used the optional fields that made the pairs collide.
 *
 * The expected order is DERIVED from `schema/cii`, never written down here: a hand-copied list would
 * be one more thing that can drift from the schema it claims to mirror.
 */

const SCHEMA_DIR = join(__dirname, "..", "schema", "cii");

/** element name -> its complexType, and complexType -> the order of its children, both from the XSD. */
function readSchema(): { typeOf: Map<string, string>; orderOf: Map<string, string[]> } {
  const typeOf = new Map<string, string>();
  const orderOf = new Map<string, string[]>();
  const strip = (s: string) => s.replace(/^[a-z]+:/i, "");

  for (const file of readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith(".xsd"))
    .sort()) {
    const xsd = readFileSync(join(SCHEMA_DIR, file), "utf8");

    for (const m of xsd.matchAll(/<xs:element[^>]*\sname="(\w+)"[^>]*\stype="([\w:]+)"/g)) {
      if (!typeOf.has(m[1])) typeOf.set(m[1], strip(m[2]));
    }
    for (const m of xsd.matchAll(/<xs:complexType name="(\w+)">([\s\S]*?)<\/xs:complexType>/g)) {
      orderOf.set(
        m[1],
        [...m[2].matchAll(/<xs:element[^>]*\sname="(\w+)"/g)].map((e) => e[1]),
      );
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

describe("the CII respects the XSD sequence", () => {
  const { typeOf, orderOf } = readSchema();
  const xml = toCII(maximal, computeInvoice(maximal), "en16931");

  it("read the schema at all", () => {
    expect(orderOf.size).toBeGreaterThan(50);
    expect(orderOf.get("TradePartyType")?.slice(0, 4)).toEqual([
      "ID",
      "GlobalID",
      "Name",
      "Description",
    ]);
  });

  it("puts every child of every element in the order the schema declares", () => {
    const wrong: string[] = [];

    for (const { parent, children } of parentsOf(xml)) {
      const order = orderOf.get(typeOf.get(parent) ?? "");
      if (!order) continue; // an element the schema does not type this way - nothing to check

      let highest = -1;
      let previous = "";
      for (const child of children) {
        const at = order.indexOf(child);
        if (at === -1) continue; // not part of this type; the XSD validator would say so
        if (at < highest) wrong.push(`${parent}: ${child} must come before ${previous}`);
        else {
          highest = at;
          previous = child;
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  it("carries the two fields that were printed but never emitted", () => {
    expect(xml).toContain("<ram:PaymentReference>MARK-PAYREF</ram:PaymentReference>"); // BT-83
    expect(xml).toContain("<ram:Description>MARK-SELLERLEGAL</ram:Description>"); // BT-33
  });
});
