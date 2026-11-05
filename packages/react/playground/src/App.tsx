import { useEffect, useMemo, useRef, useState } from "react";
import { renderToPdf } from "@jasy/react";
import type { Diagnostic } from "@jasy/pdf";
import { SAMPLES, type Assets, type Sample } from "./samples";

const GROUPS = ["Start", "Documents", "jasy's power"] as const;
const initialValues = (s: Sample) =>
  Object.fromEntries((s.controls ?? []).map((c) => [c.key, c.initial]));

async function loadAssets(): Promise<Assets> {
  const grab = (file: string) =>
    fetch(`${import.meta.env.BASE_URL}${file}`)
      .then((r) => r.arrayBuffer())
      .then((b) => new Uint8Array(b));
  const [font, photo, logo] = await Promise.all([
    grab("GreatVibes-Regular.ttf"),
    grab("photo.jpg"),
    grab("logo.png"),
  ]);
  return { font, photo, logo };
}

interface Result {
  url: string;
  ms: number;
  pages: number;
  kb: number;
  diagnostics: Diagnostic[];
}

// Page objects are written uncompressed, so counting them is a cheap, honest page count.
const countPages = (bytes: Uint8Array) =>
  (new TextDecoder("latin1").decode(bytes).match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

export function App() {
  const [id, setId] = useState(() => location.hash.slice(1) || SAMPLES[0].id);
  const sample = SAMPLES.find((s) => s.id === id) ?? SAMPLES[0];
  const [values, setValues] = useState(() => initialValues(sample));
  const [tagged, setTagged] = useState(false);
  const [showCode, setShowCode] = useState(true);
  const [assets, setAssets] = useState<Assets>();
  const [result, setResult] = useState<Result>();
  const [error, setError] = useState<string>();
  const run = useRef(0);

  useEffect(() => {
    loadAssets().then(setAssets, (e) => setError(String(e)));
  }, []);

  const select = (s: Sample) => {
    location.hash = s.id;
    setId(s.id);
    setValues(initialValues(s));
  };

  // Render on every change, debounced for typing and sliders; a stale render never overwrites a newer one.
  useEffect(() => {
    if (!assets) return;
    const ticket = ++run.current;
    const timer = setTimeout(async () => {
      const diagnostics: Diagnostic[] = [];
      const started = performance.now();
      try {
        const bytes = await renderToPdf(sample.element(values, assets), {
          ...sample.options?.(values),
          accessible: tagged,
          onDiagnostic: (d) => diagnostics.push(d),
        });
        const ms = performance.now() - started;
        if (ticket !== run.current) return;
        setError(undefined);
        setResult((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return {
            url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })),
            ms,
            pages: countPages(bytes),
            kb: bytes.length / 1024,
            diagnostics,
          };
        });
      } catch (e: any) {
        if (ticket === run.current) setError(String(e?.stack ?? e));
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [sample, values, tagged, assets]);

  const groups = useMemo(
    () => GROUPS.map((g) => ({ name: g, samples: SAMPLES.filter((s) => s.group === g) })),
    [],
  );

  return (
    <div className={showCode ? "app" : "app no-code"}>
      <aside>
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
          <div>
            <strong>@jasy/react</strong>
            <span>playground</span>
          </div>
        </div>
        {groups.map((g) => (
          <nav key={g.name}>
            <h2>{g.name}</h2>
            {g.samples.map((s) => (
              <button
                key={s.id}
                className={s.id === sample.id ? "active" : ""}
                onClick={() => select(s)}
              >
                <span className="title">{s.title}</span>
                <span className="look">{s.look}</span>
              </button>
            ))}
          </nav>
        ))}
        <p className="footnote">Every PDF is rendered right here, in your browser. No server.</p>
      </aside>

      <section className="code">
        <header>
          <span>{sample.title}.tsx</span>
        </header>
        {sample.controls && (
          <div className="controls">
            {sample.controls.map((c) => (
              <label key={c.key}>
                <span>{c.label}</span>
                {c.type === "text" ? (
                  <input
                    value={values[c.key]}
                    spellCheck={false}
                    onChange={(e) => setValues({ ...values, [c.key]: e.target.value })}
                  />
                ) : (
                  <>
                    <input
                      type="range"
                      min={c.min}
                      max={c.max}
                      value={values[c.key]}
                      onChange={(e) => setValues({ ...values, [c.key]: Number(e.target.value) })}
                    />
                    <output>{values[c.key]}</output>
                  </>
                )}
              </label>
            ))}
          </div>
        )}
        <pre>
          <code>{sample.source}</code>
        </pre>
      </section>

      <section className="viewer">
        <header>
          <button className="toggle" onClick={() => setShowCode(!showCode)}>
            {showCode ? "Hide code" : "Show code"}
          </button>
          {result && (
            <span className="stats">
              <b>{result.ms.toFixed(0)} ms</b> · {result.pages}{" "}
              {result.pages === 1 ? "page" : "pages"} · {result.kb.toFixed(1)} KB
            </span>
          )}
          <label className="tagged" title="A structure tree for screen readers (PDF/UA)">
            <input type="checkbox" checked={tagged} onChange={(e) => setTagged(e.target.checked)} />
            Tagged PDF
          </label>
          {result && (
            <a className="download" href={result.url} download={`${sample.id}.pdf`}>
              Download
            </a>
          )}
        </header>
        {result && result.diagnostics.length > 0 && (
          <ul className="diagnostics">
            {result.diagnostics.map((d, i) => (
              <li key={i}>
                <code>{d.code}</code> {d.message}
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <pre className="error">{error}</pre>
        ) : (
          result && <iframe key={result.url} src={`${result.url}#view=FitH`} title="PDF" />
        )}
      </section>
    </div>
  );
}
