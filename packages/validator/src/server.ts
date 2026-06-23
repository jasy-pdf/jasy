import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A thin HTTP wrapper around `jasy validate --json`. The same code runs locally (`tsx`, uses the
// machine's CLI/Java/veraPDF) and in the container (CLI + JRE + veraPDF baked in). It NEVER imports
// the CLI - it spawns the `jasy` binary - so the service stays tiny and decoupled from a CLI version.
const PORT = Number(process.env.PORT ?? 4000);
const MAX_BYTES = Number(process.env.MAX_BYTES ?? 12 * 1024 * 1024); // upload size cap (12 MB)
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 20_000); // hard-kill a validation after this
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT ?? 2); // simultaneous validations
const RATE_PER_MIN = Number(process.env.RATE_PER_MIN ?? 20); // requests per IP per minute
// Either a binary on PATH ("jasy", in the container) or a path to the built CLI entry
// (".../cli/dist/index.js", in local dev) - the latter is run through node, so no global install.
const JASY_BIN = process.env.JASY_BIN ?? "jasy";

// Tiny in-memory rate limiter (fixed one-minute window per IP). Good enough for a public demo widget.
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string, now: number): boolean {
  const e = hits.get(ip);
  if (!e || now >= e.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  e.count++;
  return e.count > RATE_PER_MIN;
}

let inFlight = 0;

// Reads the request body into a Buffer, aborting the moment it exceeds `cap`.
function readBody(req: IncomingMessage, cap: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > cap) {
        req.destroy();
        reject(new Error("file too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Runs `jasy validate <file> --json` with a hard timeout; resolves the parsed report. No shell, args
// as an array, the path is ours - so there is no command injection from the upload.
function runValidate(file: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const [cmd, ...pre] = JASY_BIN.endsWith(".js") ? ["node", JASY_BIN] : [JASY_BIN];
    const child = spawn(cmd, [...pre, "validate", file, "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("validation timed out"));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        reject(new Error("validator produced no JSON: " + (err || out).slice(0, 200)));
      }
    });
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "?";

  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
  if (req.method !== "POST" || req.url !== "/validate")
    return send(res, 404, { error: "POST the invoice file to /validate" });

  if (rateLimited(ip, Date.now())) return send(res, 429, { error: "rate limit - try again shortly" });
  if (inFlight >= MAX_CONCURRENT) return send(res, 503, { error: "busy - try again shortly" });

  inFlight++;
  const dir = mkdtempSync(join(tmpdir(), "jasy-val-"));
  try {
    const bytes = await readBody(req, MAX_BYTES);
    if (bytes.length === 0)
      return send(res, 400, { error: "empty body - POST the invoice file as the request body" });

    const isPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-";
    const file = join(dir, isPdf ? "upload.pdf" : "upload.xml");
    writeFileSync(file, bytes);

    const report = await runValidate(file);
    send(res, 200, report);
  } catch (e) {
    const msg = (e as Error).message;
    send(res, msg === "file too large" ? 413 : 500, { error: msg });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    inFlight--;
  }
});

server.listen(PORT, () => console.log(`validator listening on :${PORT}  (jasy="${JASY_BIN}")`));
