import { describe, it, expect } from "vitest";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend";
import { PDFObjectManager, FontStyle } from "../../../src/lib/utils/pdf-object-manager";
import { TextRun, Path } from "../../../src/lib/ir/display-list";
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
    expect(PdfBackend.escapePdfString("Muenchen, Groesse")).toBe("Muenchen, Groesse");
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

describe("PdfBackend path serialization", () => {
  const om = new PDFObjectManager();

  it("emits move/line/curve/close ops then a nonzero fill in the path's color", () => {
    const node: Path = {
      type: "path",
      fill: new Color(255, 0, 0),
      commands: [
        { op: "m", x: 10, y: 20 },
        { op: "l", x: 30, y: 20 },
        { op: "c", x1: 40, y1: 20, x2: 40, y2: 30, x: 40, y: 40 },
        { op: "z" },
      ],
    };
    const out = PdfBackend.serializeNode(node, om);
    expect(out).toContain("1.000 0.000 0.000 rg"); // red fill
    expect(out).toContain("10.000 20.000 m");
    expect(out).toContain("30.000 20.000 l");
    expect(out).toContain("40.000 20.000 40.000 30.000 40.000 40.000 c");
    expect(out).toContain("h\n"); // close
    expect(out.trimEnd().endsWith("f")).toBe(true); // nonzero fill paints last
    expect(out.startsWith("q")).toBe(false); // opaque path needs no isolating q/Q
  });

  it("wraps a transparent fill in an isolating q/Q with a graphics state", () => {
    const node: Path = {
      type: "path",
      fill: new Color(0, 0, 0, 0.5),
      commands: [{ op: "m", x: 0, y: 0 }],
    };
    const out = PdfBackend.serializeNode(node, om);
    expect(out.startsWith("q\n")).toBe(true);
    expect(out).toContain(" gs\n");
    expect(out.trimEnd().endsWith("Q")).toBe(true);
  });

  it("fills a gradient path by clipping to it and painting a registered shading", () => {
    const gradOm = new PDFObjectManager();
    const node: Path = {
      type: "path",
      fill: {
        type: "linear",
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 50,
        stops: [
          { offset: 0, color: new Color(255, 0, 0) },
          { offset: 1, color: new Color(0, 0, 255) },
        ],
        extend: "pad",
      },
      commands: [
        { op: "m", x: 0, y: 0 },
        { op: "l", x: 50, y: 0 },
        { op: "l", x: 50, y: 50 },
        { op: "z" },
      ],
    };
    const out = PdfBackend.serializeNode(node, gradOm);
    expect(out).toContain("W n"); // path becomes the clip
    expect(out).toMatch(/\/Sh\d+ sh/); // shading painted inside it
    expect(out.startsWith("q")).toBe(true);
    expect(out.trimEnd().endsWith("Q")).toBe(true);
    expect(out).not.toContain(" rg"); // no solid fill color for a gradient
    // A shading (+ its color function) was registered for the page /Resources.
    expect(gradOm.getAllShadingsRaw().size).toBe(1);
  });

  it("stitches a multi-stop gradient into a FunctionType 3 (over FunctionType 2 pieces)", () => {
    const gradOm = new PDFObjectManager();
    const node: Path = {
      type: "path",
      fill: {
        type: "linear",
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 10,
        stops: [
          { offset: 0, color: new Color(255, 0, 0) },
          { offset: 0.5, color: new Color(0, 255, 0) },
          { offset: 1, color: new Color(0, 0, 255) },
        ],
        extend: "pad",
      },
      commands: [{ op: "m", x: 0, y: 0 }],
    };
    PdfBackend.serializeNode(node, gradOm);
    const objects = gradOm.getRenderedObjects();
    expect(objects).toContain("/FunctionType 3"); // the stitching function
    expect(objects).toContain("/Bounds [0.5000]"); // the interior stop
    expect((objects.match(/\/FunctionType 2/g) ?? []).length).toBe(2); // two linear pieces
  });

  it("does not throw on an empty color line (malformed gradient) - falls back to opaque black", () => {
    const gradOm = new PDFObjectManager();
    const node: Path = {
      type: "path",
      fill: { type: "linear", x0: 0, y0: 0, x1: 0, y1: 10, stops: [], extend: "pad" },
      commands: [{ op: "m", x: 0, y: 0 }],
    };
    expect(() => PdfBackend.serializeNode(node, gradOm)).not.toThrow();
    expect(gradOm.getRenderedObjects()).toContain("/C0 [0 0 0] /C1 [0 0 0]"); // black fallback
  });

  it("flipY flips a gradient fill's anchor points too", () => {
    const node: Path = {
      type: "path",
      fill: {
        type: "linear",
        x0: 1,
        y0: 100,
        x1: 2,
        y1: 300,
        stops: [{ offset: 0, color: new Color(0, 0, 0) }],
        extend: "pad",
      },
      commands: [{ op: "m", x: 0, y: 0 }],
    };
    const [flipped] = PdfBackend.flipY([node], 1000) as [Path];
    const fill = flipped.fill as Extract<typeof node.fill, { type: "linear" }>;
    expect(fill.y0).toBe(900);
    expect(fill.y1).toBe(700);
    expect(fill.x0).toBe(1); // x unchanged
  });

  it("flipY flips every point's y around the page height (endpoints and control points)", () => {
    const node: Path = {
      type: "path",
      fill: new Color(0, 0, 0),
      commands: [
        { op: "m", x: 1, y: 100 },
        { op: "c", x1: 2, y1: 200, x2: 3, y2: 300, x: 4, y: 400 },
        { op: "z" },
      ],
    };
    const [flipped] = PdfBackend.flipY([node], 1000) as [Path];
    expect(flipped.commands[0]).toEqual({ op: "m", x: 1, y: 900 });
    expect(flipped.commands[1]).toEqual({
      op: "c",
      x1: 2,
      y1: 800,
      x2: 3,
      y2: 700,
      x: 4,
      y: 600,
    });
    expect(flipped.commands[2]).toEqual({ op: "z" }); // no coordinates to flip
  });
});
