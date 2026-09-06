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
