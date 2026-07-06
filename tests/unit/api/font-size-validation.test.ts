import { describe, it, expect } from "vitest";
import { Text, span } from "../../../src/lib/api/text";
import { Document } from "../../../src/lib/api/structure";
import { Page } from "../../../src/lib/api/structure";

// A non-numeric / non-positive font size used to become a silent NaN height deep in layout (it only
// surfaced as a misleading "StructGroup is NaNpt tall" crash once the page paginated). The classic
// footgun is Document({ size: "A4" }), where "A4" is the PAGE size. These lock in a clear early error.
const bad = (v: unknown) => v as unknown as number;

describe("font size validation", () => {
  it("rejects a string size and points at the page-size mistake", () => {
    expect(() => Document({ size: bad("A4") }, [Page([Text("hi")])])).toThrow(
      /Invalid font size "A4"/,
    );
    expect(() => Document({ size: bad("A4") }, [Page([Text("hi")])])).toThrow(/Page\(\{ size/);
  });

  it("rejects a string / negative / NaN size on Text and span", () => {
    expect(() => Text("hi", { size: bad("A4") })).toThrow(/Invalid font size/);
    expect(() => span("hi", { size: bad(-5) })).toThrow(/Invalid font size -5/);
    expect(() => Text("hi", { size: bad(NaN) })).toThrow(/Invalid font size NaN/);
    expect(() => Text("hi", { size: bad(0) })).toThrow(/Invalid font size 0/);
  });

  it("adds the Page-size hint only for a string, not for a plain bad number", () => {
    expect(() => Document({ size: bad("A4") }, [Page([Text("hi")])])).toThrow(/Page\(\{ size/);
    let msg = "";
    try {
      span("hi", { size: bad(-5) });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/expected a positive number/);
    expect(msg).not.toContain("Page("); // no page hint for a plain invalid number
  });

  it("accepts a valid positive size, and leaves an unset size to inherit", () => {
    expect(() => Text("hi", { size: 11 })).not.toThrow();
    expect(() => Document({ size: 12 }, [Page([Text("hi")])])).not.toThrow();
    expect(() => Text("hi")).not.toThrow(); // unset -> inherits the cascade
  });
});
