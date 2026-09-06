// Reproducible render benchmark.
//
//   cd bench && pnpm install && pnpm bench            # every case
//   pnpm bench text boxes                             # just these
//
// It prints the machine it ran on, and the PAGE COUNT of every result. A comparison whose page counts
// differ is not a comparison - the runner marks it rather than quietly reporting the faster half.
import { readdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { measure, pageCount, machine, versions } from "./lib/measure.mjs";

const ENGINES = [
  { key: "jasy", label: "jasy" },
  { key: "reactPdf", label: "react-pdf" },
];

const wanted = process.argv.slice(2);
const files = readdirSync(new URL("./cases/", import.meta.url)).filter((f) => f.endsWith(".mjs"));
const cases = [];
for (const f of files) {
  const mod = await import(`./cases/${f}`);
  if (wanted.length === 0 || wanted.includes(mod.name)) cases.push(mod);
}
cases.sort((a, b) => a.name.localeCompare(b.name));

const m = machine();
const v = versions();
console.log(`\njasy benchmark`);
console.log(`  ${m.cpu}`);
console.log(`  node ${m.node} · ${m.os} · ${m.ram}`);
console.log(`  @jasy/pdf ${v.jasy} · @react-pdf/renderer ${v.reactPdf}\n`);

const fmt = (n) => `${n.toFixed(1)} ms`.padStart(9);
const rows = [];

for (const c of cases) {
  console.log(`${c.name} - ${c.about}`);
  const results = {};
  for (const e of ENGINES) {
    if (typeof c[e.key] !== "function") continue;
    const r = await measure(() => c[e.key]());
    r.pages = pageCount(await c[e.key](), `${c.name}-${e.key}`);
    results[e.key] = r;
    console.log(
      `  ${e.label.padEnd(11)} ${fmt(r.median)}  p95 ${fmt(r.p95)}  ` +
        `${String(r.pages).padStart(3)} pages  ${(r.bytes / 1024).toFixed(0).padStart(5)} KB`,
    );
  }
  const pages = [...new Set(Object.values(results).map((r) => r.pages))];
  if (pages.length > 1) {
    console.log(`  !! page counts differ (${pages.join(" vs ")}) - these are DIFFERENT documents`);
  } else if (results.jasy && results.reactPdf) {
    const x = results.reactPdf.median / results.jasy.median;
    console.log(`  -> jasy is ${x.toFixed(2)}x ${x >= 1 ? "faster" : "SLOWER"}`);
  }
  rows.push({ name: c.name, ...results });
  console.log("");
}

// The machine-readable result, so the published page and this run can never drift apart.
const out = {
  ranAt: new Date().toISOString(),
  machine: m,
  versions: v,
  cases: rows.map((r) => ({
    name: r.name,
    about: cases.find((c) => c.name === r.name)?.about ?? "",
    jasy: r.jasy && {
      median: r.jasy.median,
      p95: r.jasy.p95,
      pages: r.jasy.pages,
      bytes: r.jasy.bytes,
    },
    reactPdf: r.reactPdf && {
      median: r.reactPdf.median,
      p95: r.reactPdf.p95,
      pages: r.reactPdf.pages,
      bytes: r.reactPdf.bytes,
    },
    runs: r.jasy?.runs ?? 0,
  })),
};
writeFileSync(new URL("./out/results.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("out/results.json geschrieben");
