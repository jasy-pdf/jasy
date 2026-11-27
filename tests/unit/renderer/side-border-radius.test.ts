import { describe, it, expect } from "vitest";
import { Box, Column, Document, Page, renderPdf } from "../../../src/lib/api/index.ts";
import type { IRNode, Path, Rect } from "../../../src/lib/ir/display-list.ts";
import { drawnNodes } from "../support/drawn.ts";
import { sideBorderNodes } from "../../../src/lib/renderer/side-borders.ts";
import { Color } from "../../../src/lib/common/color.ts";

// Per-side borders on a rounded box (#87), drawn as CSS does: each side is the band of its stroke,
// two set sides meet on the corner's diagonal, and a side next to an unset one runs round the whole
// corner and tapers out. The band is centered on the box edge, like a uniform border.

const W = 100;
const H = 40;
const R = 8;
const HALF = 1; // borderWidth 2

const draw = async (box: Parameters<typeof Box>[0]) => {
  const pages = await drawnNodes(() =>
    renderPdf(
      Document([
        Page({ margin: 40 }, [
          Column([Box({ width: W, height: H, borderWidth: 2, bg: "#eeeeee", ...box }, [])]),
        ]),
      ]),
    ),
  );
  const nodes: IRNode[] = pages[0]!;
  const box0 = nodes.find((n): n is Rect => n.type === "rect")!;
  return { nodes, box: box0, paths: nodes.filter((n): n is Path => n.type === "path") };
};

const RED = "1.000 0.000 0.000";
const colorOf = (p: Path) => (p.fill as { toPDFColorString(): string }).toPDFColorString();
const points = (p: Path) => p.commands.flatMap((c) => (c.op === "z" ? [] : [{ x: c.x, y: c.y }]));
const bounds = (p: Path) => {
  const ps = points(p);
  return {
    minX: Math.min(...ps.map((q) => q.x)),
    maxX: Math.max(...ps.map((q) => q.x)),
    minY: Math.min(...ps.map((q) => q.y)),
    maxY: Math.max(...ps.map((q) => q.y)),
  };
};
const hasPoint = (p: Path, x: number, y: number) =>
  points(p).some((q) => Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6);

describe("per-side borders follow the radius", () => {
  it("one side runs round both corners and tapers out on the box edge", async () => {
    const { nodes, box, paths } = await draw({ borderBottom: "red", radius: R });
    expect(box.radius).toBe(R);
    expect(nodes.some((n) => n.type === "line")).toBe(false);
    expect(paths).toHaveLength(1);
    expect(colorOf(paths[0]!)).toBe(RED);

    const b = bounds(paths[0]!);
    // Up the whole corner, to where the side edges start, and no further out than the box.
    expect(b.minY).toBeCloseTo(box.y + H - R, 6);
    expect(b.minX).toBeCloseTo(box.x, 6);
    expect(b.maxX).toBeCloseTo(box.x + W, 6);
    // Down by half the stroke, like a uniform border.
    expect(b.maxY).toBeCloseTo(box.y + H + HALF, 6);
  });

  it("two set sides meet on the corner's diagonal", async () => {
    const { box, paths } = await draw({ border: "gray", borderBottom: "red", radius: R });
    expect(paths).toHaveLength(2);
    const red = paths.find((p) => colorOf(p) === RED)!;
    // Bottom-left: the outer edge (radius R + half) cut at 135 degrees, round the corner's center.
    const d = (R + HALF) * Math.SQRT1_2;
    expect(hasPoint(red, box.x + R - d, box.y + H - R + d)).toBe(true);
  });

  it("sides of one color are one shape; all four make a ring", async () => {
    const { paths } = await draw({
      borderTop: "blue",
      borderRight: "blue",
      borderBottom: "blue",
      borderLeft: "blue",
      radius: R,
    });
    expect(paths).toHaveLength(1);
    expect(paths[0]!.fillRule).toBe("evenodd");
    // The outer edge and the inner one, each closed.
    expect(paths[0]!.commands.filter((c) => c.op === "z")).toHaveLength(2);
  });

  it("a radius smaller than the band leaves the inner corner sharp, never bulging out", () => {
    const blue = new Color(0, 0, 255);
    const [ring] = sideBorderNodes(
      0,
      0,
      W,
      H,
      10,
      { top: blue, right: blue, bottom: blue, left: blue },
      2,
    );
    const cmds = (ring as Path).commands;
    const inner = cmds.slice(cmds.findIndex((c) => c.op === "z") + 1);
    // The inner edge is the box shrunk by half the stroke; no point of it may leave that rectangle.
    for (const c of inner) {
      if (c.op === "z") continue;
      expect(c.x).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(c.x).toBeLessThanOrEqual(W - 5 + 1e-9);
      expect(c.y).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(c.y).toBeLessThanOrEqual(H - 5 + 1e-9);
    }
  });

  it("a sharp corner stays square", async () => {
    const { box, paths } = await draw({ borderTop: "red", radius: { topLeft: R } });
    // Top-right is sharp and the right side unset: the band ends straight on the box's right edge.
    expect(hasPoint(paths[0]!, box.x + W, box.y - HALF)).toBe(true);
    expect(hasPoint(paths[0]!, box.x + W, box.y + HALF)).toBe(true);
  });

  it("any radius, width and set of sides stays finite and inside the band (seeded)", () => {
    let seed = 87;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const colors = [undefined, new Color(255, 0, 0), new Color(0, 0, 255)];
    for (let run = 0; run < 500; run++) {
      const w = 5 + rand() * 200;
      const h = 5 + rand() * 200;
      const sw = rand() * 20;
      const pick = () => colors[Math.floor(rand() * 3)];
      const sides = { top: pick(), right: pick(), bottom: pick(), left: pick() };
      const r =
        rand() < 0.5 ? rand() * 60 : { tl: rand() * 60, tr: 0, br: rand() * 60, bl: rand() * 5 };
      const nodes = sideBorderNodes(10, 20, w, h, sw, sides, r);
      for (const n of nodes) {
        if (n.type !== "path") continue;
        for (const q of points(n)) {
          const ctx = JSON.stringify({ run, w, h, sw, r });
          expect(Number.isFinite(q.x) && Number.isFinite(q.y), ctx).toBe(true);
          expect(q.x, ctx).toBeGreaterThanOrEqual(10 - sw / 2 - 1e-9);
          expect(q.x, ctx).toBeLessThanOrEqual(10 + w + sw / 2 + 1e-9);
          expect(q.y, ctx).toBeGreaterThanOrEqual(20 - sw / 2 - 1e-9);
          expect(q.y, ctx).toBeLessThanOrEqual(20 + h + sw / 2 + 1e-9);
        }
      }
    }
  });

  it("without a radius the sides stay plain lines (byte-identical)", async () => {
    const { nodes, paths } = await draw({ borderBottom: "red" });
    expect(paths).toHaveLength(0);
    expect(nodes.filter((n) => n.type === "line")).toHaveLength(1);
  });
});
