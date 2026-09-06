// Timing, and the honesty checks around it.
//
// A benchmark is only worth reading if both engines did the SAME work. The one that bit us before:
// jasy and react-pdf laid the same source out to 37 and 33 pages, and the published "124 vs 181 ms"
// was comparing two different documents. So every case reports its PAGE COUNT, the runner refuses to
// print a comparison whose page counts differ, and the output SIZE is shown next to the time.
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { cpus, totalmem, platform, release } from "node:os";
import { readFileSync } from "node:fs";

/** Median and p95 of `runs` timed calls, after `warmup` untimed ones (JIT, lazy imports, font parse). */
export async function measure(fn, { runs = 15, warmup = 3 } = {}) {
  for (let i = 0; i < warmup; i++) await fn();
  const times = [];
  let last;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    last = await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const at = (q) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
  return { median: at(0.5), p95: at(0.95), min: times[0], bytes: last?.length ?? 0, runs };
}

/** Page count straight out of the produced bytes - the check that the work really was the same. */
export function pageCount(bytes, tag) {
  mkdirSync(new URL("../out/", import.meta.url), { recursive: true });
  const file = new URL(`../out/${tag}.pdf`, import.meta.url);
  writeFileSync(file, bytes);
  try {
    const info = execFileSync("pdfinfo", [file.pathname], { encoding: "utf8" });
    return Number(/Pages:\s+(\d+)/.exec(info)?.[1] ?? -1);
  } catch {
    return -1; // poppler not installed; the runner says so rather than pretending
  }
}

/** Printed with the results, because a number without a machine under it cannot be reproduced. */
export function machine() {
  const c = cpus();
  return {
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: `${c[0]?.model?.trim() ?? "?"} x${c.length}`,
    ram: `${Math.round(totalmem() / 1e9)} GB`,
  };
}

/** Exactly which code produced a number - the page prints this, so a reader can install the same. */
export function versions() {
  const read = (spec) => {
    try {
      return JSON.parse(
        readFileSync(new URL(`../node_modules/${spec}/package.json`, import.meta.url), "utf8"),
      ).version;
    } catch {
      return null;
    }
  };
  return {
    jasy: read("@jasy/pdf"),
    reactPdf: read("@react-pdf/renderer"),
    react: read("react"),
  };
}

/**
 * What each page actually draws: its words, and where the ink sits.
 *
 * A matching page count is not enough. It missed a case where react-pdf silently dropped the label out
 * of every box (2 characters against our 1,382, on the same 2 pages), and a header whose spacing put
 * the whole body 8pt lower on one side.
 */
export function inkProfile(file) {
  let xml;
  try {
    xml = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8" });
  } catch {
    return null; // poppler missing; the caller says so rather than assuming agreement
  }
  return xml.split("<page ").slice(1).map((page) => {
    const words = [
      ...page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</g),
    ].map((m) => ({ x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4], text: m[5] }));
    return {
      count: words.length,
      // Sorted, so the comparison does not depend on which order an engine paints in.
      text: words.map((w) => w.text).sort().join(" "),
      box: words.length
        ? {
            left: Math.min(...words.map((w) => w.x1)),
            top: Math.min(...words.map((w) => w.y1)),
            right: Math.max(...words.map((w) => w.x2)),
            bottom: Math.max(...words.map((w) => w.y2)),
          }
        : null,
    };
  });
}

/**
 * What differs between two profiles. Three questions, each with a clear meaning: is the same amount of
 * text there, is it the SAME text, and does the ink sit in the same place.
 *
 * The tolerance is 3pt and it is not a fudge - it is the resolution of the question. Two independent
 * engines place a footer baseline a couple of points apart and always will; what must be identical is
 * the text and how it is broken across pages, and those are compared exactly. The runner prints the
 * observed offset, so the number is on the page rather than hidden in a threshold.
 */
export function compareInk(a, b, tolerance = 3) {
  if (!a || !b) return ["page positions unavailable (install poppler-utils)"];
  if (a.length !== b.length) return [`${a.length} pages vs ${b.length}`];
  const out = [];
  let worst = 0;
  for (const [i, pa] of a.entries()) {
    const pb = b[i];
    const page = `page ${i + 1}`;
    if (pa.count !== pb.count) {
      out.push(`${page}: ${pa.count} words vs ${pb.count} - one engine drew more than the other`);
      continue;
    }
    if (pa.text !== pb.text) {
      out.push(`${page}: the words differ - the pages do not carry the same text`);
      continue;
    }
    if (!pa.box || !pb.box) continue;
    for (const side of ["left", "top", "right", "bottom"]) {
      const d = Math.abs(pa.box[side] - pb.box[side]);
      worst = Math.max(worst, d);
      if (d > tolerance) out.push(`${page}: ink ends ${d.toFixed(1)}pt apart on the ${side}`);
    }
  }
  return { problems: out, worst };
}
