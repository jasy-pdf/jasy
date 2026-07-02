import { describe, it, expect } from "vitest";
import { uaXmp } from "../../../src/lib/utils/ua-xmp";

describe("uaXmp", () => {
  it("declares PDF/UA-1 and carries the title", () => {
    const xmp = uaXmp({ title: "My Report" });
    expect(xmp).toContain("<pdfuaid:part>1</pdfuaid:part>");
    expect(xmp).toContain("My Report");
  });

  it("stays byte-safe (every char <= 0xFF) so the stream /Length matches, BOM = UTF-8 bytes", () => {
    const xmp = uaXmp({ title: "Résumé — €" });
    // The PDF writer emits one byte per char (Latin-1); every char must fit so /Length is correct.
    expect([...xmp].every((c) => c.codePointAt(0)! <= 0xff)).toBe(true);
    expect(xmp).not.toContain("﻿"); // a raw U+FEFF would be mangled to "?"
    expect(xmp.startsWith('<?xpacket begin="ï»¿"')).toBe(true); // 3-byte UTF-8 BOM
  });

  it("escapes non-ASCII and XML metacharacters in the title", () => {
    const xmp = uaXmp({ title: "Résumé <b> & Co" });
    expect(xmp).toContain("R&#233;sum&#233;"); // é -> numeric character references
    expect(xmp).toContain("&lt;b&gt; &amp; Co"); // < > & escaped
    expect(xmp).not.toContain("é"); // no raw non-ASCII survives
  });
});
