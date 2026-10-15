import { vi } from "vitest";
import { PdfBackend } from "../../../src/lib/renderer/pdf-backend.ts";
import type { IRNode, TextRun } from "../../../src/lib/ir/display-list.ts";

/**
 * Every text run DRAWN while `render` runs, in page coordinates (top-left, before the Y flip). An
 * element's own x/y is relative to its parent, so positions in different parents can only be compared
 * here.
 */
export async function drawnTextRuns(render: () => Promise<unknown>): Promise<TextRun[]> {
  const runs: TextRun[] = [];
  const flipY = PdfBackend.flipY.bind(PdfBackend);
  const spy = vi.spyOn(PdfBackend, "flipY").mockImplementation((nodes, height) => {
    for (const n of nodes) if (n.type === "text") runs.push(n);
    return flipY(nodes, height);
  });
  try {
    await render();
  } finally {
    spy.mockRestore();
  }
  return runs;
}

/** The drawn run whose text is exactly `text`. */
export function runOf(runs: TextRun[], text: string): TextRun {
  const hit = runs.find((r) => r.text === text);
  if (!hit) throw new Error(`no text "${text}" drawn`);
  return hit;
}

/** Every node DRAWN while `render` runs, one list per page in page order (top-left coordinates). */
export async function drawnNodes(render: () => Promise<unknown>): Promise<IRNode[][]> {
  const pages: IRNode[][] = [];
  const flipY = PdfBackend.flipY.bind(PdfBackend);
  const spy = vi.spyOn(PdfBackend, "flipY").mockImplementation((nodes, height) => {
    pages.push([...nodes]);
    return flipY(nodes, height);
  });
  try {
    await render();
  } finally {
    spy.mockRestore();
  }
  return pages;
}

/** Like `drawnTextRuns`, one list per page in page order. */
export async function drawnPages(render: () => Promise<unknown>): Promise<TextRun[][]> {
  return (await drawnNodes(render)).map((nodes) =>
    nodes.filter((n): n is TextRun => n.type === "text"),
  );
}
