// Random documents around Flow: templates, wrappers and content mixed by a seed. Every piece of text
// carries a marker (`#seed-n`), so a check can count what was drawn against what was placed. Content is
// set to fit its column, as a real document would be - words break, tables get no more columns than
// their Region holds - so what is drawn past an edge, on top of something, or not at all is a fault.
import { Document, Page } from "../../../src/lib/api/structure.ts";
import {
  Box,
  Column,
  Expanded,
  Padding,
  PageBreak,
  Row,
  keepTogether,
} from "../../../src/lib/api/layout.ts";
import { Canvas } from "../../../src/lib/api/content.ts";
import { Text } from "../../../src/lib/api/text.ts";
import { Table } from "../../../src/lib/api/table.ts";
import { ColumnBreak, Flow, Region, SplitView } from "../../../src/lib/api/flow.ts";
import type { FlowTemplate } from "../../../src/lib/elements/layout/flow-element.ts";
import type { PDFElement } from "../../../src/lib/elements/pdf-element.ts";
import { renderToBytes } from "../../../src/lib/api/index.ts";
import { FontStyle, PDFObjectManager } from "../../../src/lib/utils/pdf-object-manager.ts";
import type { Diagnostic } from "../../../src/lib/common/diagnostics.ts";
import type { TextRun } from "../../../src/lib/ir/display-list.ts";
import { runAdvance } from "../../../src/lib/text/advance.ts";
import { drawnPages } from "./drawn.ts";

const WORDS = (
  "the quick brown fox jumps over a lazy dog while invoices reports and datasheets flow through " +
  "columns page after page with tables images and headings"
).split(" ");
const COLORS = ["#eef3fb", "#fdf6e3", "#f0f0f0", "#e8f5e9"];
const SIZES = {
  A4: { width: 595.28, height: 841.89 },
  A5: { width: 419.53, height: 595.28 },
  A6: { width: 297.64, height: 419.53 },
  Letter: { width: 612, height: 792 },
};
const FOOTER = "footer";
const headerOf = (seed: number) => `random seed ${seed}`;
/** The narrowest Region a template may make: a table cell in it still holds a character. */
const MIN_REGION = 60;

export interface RandomDocument {
  doc: ReturnType<typeof Document>;
  /** How often each marker must be drawn. */
  expected: Map<string, number>;
}

export function randomDocument(seed: number): RandomDocument {
  let state = seed * 9301 + 49297;
  const rnd = () => (state = (state * 16807) % 2147483647) / 2147483647;
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)]!;
  const int = (from: number, to: number) => from + Math.floor(rnd() * (to - from + 1));
  const expected = new Map<string, number>();
  let next = 0;
  const mark = () => {
    const m = `#${seed}-${next++}`;
    expected.set(m, 1);
    return m;
  };
  const words = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(" ");
  const fit = (text: string, size = 9) => Text(text, { size, breakWord: true });

  const para = () =>
    Text(`${mark()} ${words(int(4, 70))}`, {
      size: pick([8, 9, 10, 11]),
      lineHeight: pick([1.2, 1.4]),
      breakWord: true,
    });
  const table = (width: number): PDFElement[] => {
    const cols = int(1, Math.max(1, Math.min(3, Math.floor(width / 40))));
    const rows = Array.from({ length: int(2, 14) }, () =>
      Array.from({ length: cols }, () => `${mark()} ${words(int(1, 4))}`),
    );
    const t = Table(
      {
        columns: Array<string>(cols).fill("1fr"),
        header: Array.from({ length: cols }, (_, i) => fit(`Col ${i}`, 8)),
        cellPadding: 2,
        cellBorder: "#999",
      },
      rows.map((r) => r.map((c) => fit(c, 8))),
    );
    if (rnd() < 0.15) {
      for (const c of rows.flat()) expected.set(c.split(" ")[0]!, 2);
      return [t, t.clone()];
    }
    return [t];
  };

  const item = (depth: number, width: number): PDFElement[] => {
    const r = rnd();
    if (r < 0.52) return [para()];
    if (r < 0.66) return table(width);
    if (r < 0.74) return [Canvas({ height: int(20, 120) }, () => {})];
    if (r < 0.8) return [ColumnBreak()];
    if (r < 0.82) return [PageBreak()];
    if (r < 0.88)
      return [
        keepTogether([
          Text(`${mark()} Heading`, { size: 13, bold: true, breakWord: true }),
          para(),
        ]),
      ];
    if (r < 0.93 && depth < 1 && width >= 2 * MIN_REGION + 20) return [flow(depth + 1, width)];
    return [Box({ border: "#999", padding: 4, bg: pick(COLORS) }, [para(), para()])];
  };
  const content = (depth: number, width: number) =>
    Array.from({ length: int(1, depth ? 8 : 30) }, () => item(depth, width)).flat();

  /** A template and the width of its narrowest Region, for a body `width` wide. */
  const template = (width: number): { make: FlowTemplate | null; narrowest: number } => {
    const gap = int(0, 18);
    const two = () => Row({ gap }, [Expanded(Region()), Expanded(Region())]);
    const kinds: { make: FlowTemplate | null; narrowest: number }[] = [
      { make: () => Column({ gap }, [Expanded(Region()), Expanded(Region())]), narrowest: width },
      {
        make: ({ index }) =>
          Column({ gap: 6 }, [
            ...(index === 0 ? [Text("Title area", { size: 16, bold: true })] : []),
            two(),
          ]),
        narrowest: (width - gap) / 2,
      },
      {
        make: () => Box({ border: "#1450aa", padding: 6 }, [two()]),
        narrowest: (width - 14 - gap) / 2,
      },
      {
        make: () =>
          Row({ gap }, [Expanded(Region()), Box({ width: 1, bg: "#999" }, []), Expanded(Region())]),
        narrowest: (width - 1 - 2 * gap) / 2,
      },
      {
        make: ({ index }) =>
          Row(
            { gap },
            index % 2
              ? [Expanded(Region())]
              : [Expanded({ flex: 2 }, Region()), Expanded(Region())],
          ),
        narrowest: (width - gap) / 3,
      },
      {
        make: () => Row([Expanded(Region({ height: "60%" })), Expanded(Region())]),
        narrowest: width / 2,
      },
    ];
    kinds.push({
      make: () =>
        Column({ gap: 4 }, [
          Region({ height: "70%" }),
          Text("Notes below the Region", { size: 8, italic: true }),
        ]),
      narrowest: width,
    });
    const side = int(MIN_REGION, 140);
    kinds.push({
      make: () => Row({ gap }, [Region({ width: side }), Expanded(Region())]),
      narrowest: Math.min(side, width - side - gap),
    });
    kinds.push({ make: null, narrowest: width }); // a SplitView, sized below
    return pick(kinds.filter((k) => k.narrowest >= MIN_REGION));
  };
  const flow = (depth: number, width: number): PDFElement => {
    const t = template(width);
    if (t.make) return Flow({ template: t.make, gap: int(0, 8) }, content(depth, t.narrowest));
    const colGap = int(4, 20);
    const columns = int(
      1,
      Math.max(1, Math.min(4, Math.floor((width + colGap) / (MIN_REGION + colGap)))),
    );
    const narrowest = (width - (columns - 1) * colGap) / columns;
    return SplitView({ columns, colGap, rowGap: int(0, 8) }, content(depth, narrowest));
  };

  const name = pick(Object.keys(SIZES) as (keyof typeof SIZES)[]);
  const margin = int(20, 50);
  const body = SIZES[name].width - 2 * margin;
  const wrapped = (): PDFElement => {
    const inset = int(0, 12);
    return pick<() => PDFElement>([
      () => flow(0, body),
      () =>
        Box({ border: "#1450aa", borderWidth: 2, padding: inset, bg: pick(COLORS) }, [
          flow(0, body - 2 * (inset + 2)),
        ]),
      () => Box({ bg: pick(COLORS) }, [flow(0, body)]),
      () => Padding(inset, flow(0, body - 2 * inset)),
      () => keepTogether([flow(0, body)]),
      () => Expanded(flow(0, body)),
      () => Column([flow(0, body)]),
    ])();
  };
  const children = Array.from({ length: int(1, 4) }, () =>
    rnd() < 0.5 ? [para(), wrapped()] : [wrapped()],
  ).flat();
  const doc = Document([
    Page(
      {
        size: name,
        margin,
        header: Text(headerOf(seed), { size: 7 }),
        footer: Text(FOOTER, { size: 7 }),
      },
      children,
    ),
  ]);
  return { doc, expected };
}

const metrics = new PDFObjectManager();
metrics.registerFont("Helvetica");
metrics.registerFont("Helvetica", FontStyle.Bold, "Helvetica-Bold");
metrics.registerFont("Helvetica", FontStyle.Italic, "Helvetica-Oblique");
metrics.registerFont("Helvetica", FontStyle.BoldItalic, "Helvetica-BoldOblique");
// Measured as the engine measures - kerned, as rendering does by default.
metrics.setKerning(true);

/** What a seed got wrong, in words - empty when nothing. */
export async function faultsOf(
  seed: number,
  save?: (bytes: Uint8Array) => void,
): Promise<string[]> {
  const { doc, expected } = randomDocument(seed);
  const faults: string[] = [];
  const seen: Diagnostic[] = [];
  let bytes: Uint8Array | undefined;
  let pages: TextRun[][];
  try {
    pages = await drawnPages(async () => {
      bytes = await renderToBytes(doc, { onOverflow: "warn", onDiagnostic: (d) => seen.push(d) });
    });
  } catch (e) {
    return [`throws ${(e as Error).name}: ${(e as Error).message}`];
  }
  if (bytes) save?.(bytes);

  // Joined with nothing, the header and footer left out: a marker that `breakWord` split over two
  // lines - or two pages - reads whole again.
  const drawn = new Map<string, number>();
  for (const m of pages
    .flat()
    .map((r) => r.text)
    .filter((t) => t !== FOOTER && t !== headerOf(seed))
    .join("")
    .matchAll(/#\d+-\d+/g))
    drawn.set(m[0], (drawn.get(m[0]) ?? 0) + 1);
  for (const [m, n] of expected)
    if ((drawn.get(m) ?? 0) !== n) faults.push(`${m} drawn ${drawn.get(m) ?? 0}x, placed ${n}x`);

  pages.forEach((runs, p) => {
    const boxes = runs.map((r) => ({
      r,
      x0: r.x,
      x1: r.x + runAdvance(metrics, r.text, r, r.letterSpacing ?? 0),
      y0: r.y - 0.75 * r.fontSize,
      y1: r.y,
    }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const across = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const down = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (across > 0.5 && down > 0.5)
          faults.push(`page ${p + 1}: "${a.r.text}" and "${b.r.text}" overlap`);
      }
  });

  for (const d of seen)
    // A block that cannot break and is taller than its Region is placed whole and reported: correct.
    if (!(d.code === "overflow-clipped" && ["Canvas", "StructGroup"].includes(d.element ?? "")))
      faults.push(`page ${d.page}: ${d.code} - ${d.message}`);
  return faults;
}
