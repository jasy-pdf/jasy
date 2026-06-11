import { describe, it, expect } from "vitest";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { TextRun } from "../../../src/lib/ir/display-list";
import { Color } from "../../../src/lib/common/color";

describe("PdfBackend.escapePdfString", () => {
  it("escapes the parens that delimit a literal string", () => {
    expect(PdfBackend.escapePdfString("a (b) c")).toBe("a \\(b\\) c");
  });

  it("doubles backslashes, and does so before touching parens", () => {
    // A lone backslash becomes two; an escaped-looking "\(" must not collapse.
    expect(PdfBackend.escapePdfString("x\\y")).toBe("x\\\\y");
    expect(PdfBackend.escapePdfString("\\(")).toBe("\\\\\\(");
  });

  it("leaves ordinary text untouched", () => {
    expect(PdfBackend.escapePdfString("Muenchen, Groesse")).toBe(
      "Muenchen, Groesse"
    );
  });
});

describe("PdfBackend text serialization", () => {
  it("emits a parenthesised string that cannot break out of (...)", () => {
    const om = new PDFObjectManager();
    om.registerFont("Helvetica");
    const node: TextRun = {
      type: "text",
      x: 0,
      y: 0,
      text: "can't split (yet)",
      fontFamily: "Helvetica",
      fontStyle: FontStyle.Normal,
      fontSize: 12,
      color: new Color(0, 0, 0),
    };

    const out = PdfBackend.serializeNode(node, om);
    expect(out).toContain("(can't split \\(yet\\)) Tj");
    // No bare ")" that would terminate the string early before " Tj".
    expect(out).not.toContain("(yet)) Tj");
  });
});
