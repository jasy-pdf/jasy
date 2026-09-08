// Reproducible render benchmark.
//
//   cd bench && pnpm install && pnpm bench            # every case
//   pnpm bench text boxes                             # just these
//
// It prints the machine it ran on, and the PAGE COUNT of every result. A comparison whose page counts
// differ is not a comparison - the runner marks it rather than quietly reporting the faster half.
import { readdirSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { measure, pageCount, machine, versions, inkProfile, compareInk } from "./lib/measure.mjs";

const ENGINES = [
  { key: "jasy", label: "jasy" },
  { key: "reactPdf", label: "react-pdf" },
  { key: "jsPdf", label: "jsPDF" },
  { key: "pdfmake", label: "pdfmake" },
];

/** Cases an engine cannot express at all, and why - shown rather than quietly left out. */
const CANNOT = {
  jsPdf: {
    svg: "no SVG support (that is svg2pdf.js, a separate library)",
    typography: "no kerning, so the same words do not land in the same places",
  },
};

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
  // Each engine is held against jasy: the documents must MATCH, not merely take the same page count.
  const file = (engine) => new URL(`./out/${c.name}-${engine}.pdf`, import.meta.url).pathname;
  const mine = results.jasy ? inkProfile(file("jasy")) : null;
  for (const e of ENGINES.slice(1)) {
    const note = CANNOT[e.key]?.[c.name];
    if (note) {
      console.log(`  ${e.label.padEnd(11)} cannot render this case - ${note}`);
      continue;
    }
    if (!results[e.key] || !mine) continue;
    const diff = compareInk(mine, inkProfile(file(e.key)));
    results[e.key].ink = diff.worst;
    results[e.key].comparable = diff.problems.length === 0;
    for (const d of diff.problems) console.log(`  !! ${e.label}: ${d}`);
  }

  const counts = Object.values(results).map((r) => r.pages);
  const pages = [...new Set(counts)];
  if (counts.some((p) => p <= 0)) {
    // `pageCount` returns -1 when poppler is missing. Two unknowns are not a match, and nothing else
    // holds the documents to the same shape - so say so and print no ratio.
    console.log("  !! page counts unavailable (install poppler-utils) - not comparing");
  } else if (pages.length > 1) {
    console.log(`  !! page counts differ (${pages.join(" vs ")}) - these are DIFFERENT documents`);
  } else if (results.jasy && results.reactPdf) {
    for (const e of ENGINES.slice(1)) {
      const r = results[e.key];
      if (!r) continue;
      if (!r.comparable) {
        console.log(`  -> ${e.label}: not comparable, the documents differ`);
        continue;
      }
      const x = r.median / results.jasy.median;
      console.log(
        `  -> vs ${e.label.padEnd(10)} jasy is ${x.toFixed(2)}x ${x >= 1 ? "faster" : "SLOWER"}` +
          `  (same text, same pages; ink within ${(r.ink ?? 0).toFixed(1)}pt)`,
      );
    }
  }
  rows.push({ name: c.name, ...results });
  console.log("");
}

// The machine-readable result, so the published page and this run can never drift apart. Written
// from ENGINES rather than a fixed pair, or adding an engine would silently leave it out of the JSON.
const out = {
  ranAt: new Date().toISOString(),
  machine: m,
  versions: v,
  cases: rows.map((r) => {
    const c = cases.find((x) => x.name === r.name);
    const engines = {};
    for (const e of ENGINES) {
      const res = r[e.key];
      if (res) {
        engines[e.key] = {
          median: res.median,
          p95: res.p95,
          pages: res.pages,
          bytes: res.bytes,
          // Absent for jasy itself; false when the two documents did not match.
          ...(e.key === "jasy" ? {} : { comparable: res.comparable !== false, ink: res.ink ?? 0 }),
        };
      } else if (CANNOT[e.key]?.[r.name]) {
        engines[e.key] = { cannot: CANNOT[e.key][r.name] };
      }
    }
    return { name: r.name, about: c?.about ?? "", runs: r.jasy?.runs ?? 0, engines };
  }),
};
writeFileSync(new URL("./out/results.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("out/results.json geschrieben");
