import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Jimp } from "jimp";
import {
  Document,
  Image,
  Page,
  PageBuilder,
  Table,
  renderToBytes,
} from "../../../src/lib/api/index.ts";
import type { Diagnostic } from "../../../src/lib/common/diagnostics.ts";
import type { PDFElement } from "../../../src/lib/elements/pdf-element.ts";
import { drawnNodes } from "../support/drawn.ts";

// An image that gives one side takes the other from its own ratio - also when it is first built during
// layout: in a PageBuilder, in a table with `auto` columns. Bytes and a local file are read when layout
// asks; a URL is fetched before layout, so one that only a PageBuilder creates is reported instead.

const png = async (w: number, h: number) =>
  new Uint8Array(await new Jimp({ width: w, height: h, color: 0x1450aaff }).getBuffer("image/png"));

const ok = (bytes: Uint8Array) =>
  ({ ok: true, status: 200, arrayBuffer: async () => bytes.slice().buffer }) as unknown as Response;
afterEach(() => vi.unstubAllGlobals());

const drawnImage = async (body: PDFElement, seen: Diagnostic[] = []) => {
  const page = Page({ size: { width: 400, height: 400 }, margin: 20 }, [body]);
  const [nodes] = await drawnNodes(() =>
    renderToBytes(Document([page]), { onDiagnostic: (d) => seen.push(d) }),
  );
  const image = nodes!.find((n) => n.type === "image") as { width: number; height: number };
  return [image.width, image.height];
};

describe("an image built during layout keeps its ratio", () => {
  it("from bytes, in a PageBuilder", async () => {
    const bytes = await png(40, 20);
    expect(await drawnImage(PageBuilder(() => Image(bytes, { width: 100 })))).toEqual([100, 50]);
  });

  it("from a local file, in a PageBuilder", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "jasy-")), "wide.png");
    writeFileSync(path, await png(40, 20));
    expect(await drawnImage(PageBuilder(() => Image(path, { width: 100 })))).toEqual([100, 50]);
  });

  it("from a local file that is read when it is named - layout and render never touch the disk", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "jasy-")), "gone.png");
    writeFileSync(path, await png(40, 20));
    const image = Image(path, { width: 100 });
    rmSync(path);
    expect(await drawnImage(image)).toEqual([100, 50]);
  });

  it("from bytes, in an auto table column", async () => {
    const bytes = await png(40, 20);
    expect(
      await drawnImage(Table({ columns: ["auto"] }, [[Image(bytes, { width: 100 })]])),
    ).toEqual([100, 50]);
  });

  it("from a URL, in an auto table column - in the header too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(await png(40, 20))),
    );
    const cell = () => Image("https://x.example/wide.png", { width: 100 });
    expect(await drawnImage(Table({ columns: ["auto"] }, [[cell()]]))).toEqual([100, 50]);
    expect(await drawnImage(Table({ columns: ["auto"], header: [cell()] }, [["text"]]))).toEqual([
      100, 50,
    ]);
  });

  it("from a URL, in a copy of a table that is the only one in the document", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(await png(40, 20))),
    );
    const table = Table({ columns: ["auto"] }, [
      [Image("https://x.example/wide.png", { width: 100 })],
    ]);
    const seen: Diagnostic[] = [];
    expect(await drawnImage(table.clone(), seen)).toEqual([100, 50]);
    expect(seen.filter((d) => d.code === "image-unsized")).toEqual([]);
  });
});

describe("an image whose size cannot be known at layout", () => {
  it("is reported once, not drawn wrong in silence: a URL first built in a PageBuilder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(await png(40, 20))),
    );
    const seen: Diagnostic[] = [];
    await drawnImage(
      PageBuilder(() => Image("https://x.example/wide.png", { width: 100 })),
      seen,
    );
    const unsized = seen.filter((d) => d.code === "image-unsized");
    expect(unsized).toHaveLength(1);
    expect(unsized[0]!.message).toMatch(/width and a height/);
  });

  it("is not reported when both sides are given", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok(await png(40, 20))),
    );
    const seen: Diagnostic[] = [];
    const size = await drawnImage(
      PageBuilder(() => Image("https://x.example/wide.png", { width: 100, height: 30 })),
      seen,
    );
    expect(size).toEqual([100, 30]);
    expect(seen.filter((d) => d.code === "image-unsized")).toEqual([]);
  });
});
