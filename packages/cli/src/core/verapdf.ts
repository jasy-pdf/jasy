import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { inflateRawSync } from "node:zlib";

// Optional veraPDF adapter. veraPDF (verapdf.org) is the official open-source PDF/A validator from the
// PDF Association - we shell out to a local copy for the FULL ISO 19005 (PDF/A) check. It is NEVER a
// gate: our own structural checks (core/pdfa.ts) carry the everyday case; this is the opt-in "official
// seal". Self-contained: `--install` drops veraPDF into ~/.jasy/verapdf (no admin, no account). The one
// real requirement is a Java runtime - veraPDF is a Java app - which the doctor flags clearly.

const WIN = process.platform === "win32";
export const VERAPDF_HOME = join(homedir(), ".jasy", "verapdf");
const MANAGED_BIN = join(VERAPDF_HOME, WIN ? "verapdf.bat" : "verapdf");
const INSTALLER_URL = "https://software.verapdf.org/releases/verapdf-installer.zip";

export interface Tools {
  java?: string; // Java version (e.g. "21.0.11"), or undefined if no JRE is on PATH
  verapdf?: string; // veraPDF version, or undefined if not installed
  verapdfPath?: string; // the resolved verapdf binary
}

/** The veraPDF binary we'd use: our managed install first, then any system install on PATH. */
export function findVerapdf(): string | undefined {
  if (existsSync(MANAGED_BIN)) return MANAGED_BIN;
  const r = spawnSync(WIN ? "where" : "which", ["verapdf"], { encoding: "utf-8" });
  const p = r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : "";
  return p || undefined;
}

/** What's available right now - drives the `jasy verapdf` doctor. */
export function detectTools(): Tools {
  const jv = spawnSync("java", ["-version"], { encoding: "utf-8" }); // java prints the version to stderr
  const java = jv.error
    ? undefined
    : ((jv.stderr || jv.stdout).match(/version "([^"]+)"/)?.[1] ?? "found");
  const verapdfPath = findVerapdf();
  let verapdf: string | undefined;
  if (verapdfPath) {
    const vv = spawnSync(verapdfPath, ["--version"], { encoding: "utf-8" });
    verapdf = vv.error ? undefined : (vv.stdout.match(/veraPDF (\S+)/)?.[1] ?? "found");
  }
  return { java, verapdf, verapdfPath };
}

export interface VeraReport {
  ok: boolean; // PDF/A compliant?
  profile?: string; // e.g. "PDF/A-3b validation profile"
  passedRules?: number;
  failedRules?: number;
  failures: { clause: string; failedChecks: number }[]; // failed ISO clauses
}

/** Parse veraPDF's `--format xml` report (the real 1.30 shape - verified against live output). */
export function parseVeraReport(xml: string): VeraReport {
  const ok = /isCompliant="true"/.test(xml);
  const det = xml.match(/passedRules="(\d+)"\s+failedRules="(\d+)"/);
  const failures = [
    ...xml.matchAll(
      /<rule\b[^>]*\bclause="([^"]*)"[^>]*\bstatus="failed"[^>]*\bfailedChecks="(\d+)"/g,
    ),
  ].map((m) => ({ clause: m[1], failedChecks: Number(m[2]) }));
  return {
    ok,
    profile: xml.match(/profileName="([^"]*)"/)?.[1],
    passedRules: det ? Number(det[1]) : undefined,
    failedRules: det ? Number(det[2]) : undefined,
    failures,
  };
}

/** Run veraPDF on a PDF (auto-detecting the PDF/A flavour) and return the parsed report. */
export function runVeraPdf(file: string, bin = findVerapdf()): VeraReport {
  if (!bin) throw new Error("veraPDF is not installed - run `jasy verapdf --install`");
  const r = spawnSync(bin, ["--format", "xml", file], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw r.error; // e.g. Java missing - the verapdf launcher couldn't start
  const xml = r.stdout ?? "";
  if (!xml.includes("<validationReport")) {
    throw new Error(
      "veraPDF returned no report" + (r.stderr ? `: ${r.stderr.split("\n")[0]}` : ""),
    );
  }
  return parseVeraReport(xml);
}

// ── self-contained install into ~/.jasy/verapdf (no admin, no installer GUI) ────────────────────────

/** Extract one entry from a ZIP by name, via the central directory (robust vs data descriptors). */
function extractFromZip(zip: Buffer, pattern: RegExp): Buffer | undefined {
  let eo = zip.length - 22;
  while (eo >= 0 && zip.readUInt32LE(eo) !== 0x06054b50) eo--; // end-of-central-directory record
  if (eo < 0) return undefined;
  let cd = zip.readUInt32LE(eo + 16);
  const count = zip.readUInt16LE(eo + 10);
  for (let k = 0; k < count && zip.readUInt32LE(cd) === 0x02014b50; k++) {
    const method = zip.readUInt16LE(cd + 10);
    const comp = zip.readUInt32LE(cd + 20);
    const nameLen = zip.readUInt16LE(cd + 28);
    const extraLen = zip.readUInt16LE(cd + 30);
    const commentLen = zip.readUInt16LE(cd + 32);
    const lho = zip.readUInt32LE(cd + 42);
    const name = zip.subarray(cd + 46, cd + 46 + nameLen).toString("utf-8");
    if (pattern.test(name)) {
      const dataStart = lho + 30 + zip.readUInt16LE(lho + 26) + zip.readUInt16LE(lho + 28);
      const body = zip.subarray(dataStart, dataStart + comp);
      return method === 8 ? inflateRawSync(body) : Buffer.from(body);
    }
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return undefined;
}

/** veraPDF's IzPack auto-install descriptor - installs the CLI (no GUI prompts) into `home`. */
function autoInstallXml(home: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
    <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
    <com.izforge.izpack.panels.target.TargetPanel id="install_dir"><installpath>${home}</installpath></com.izforge.izpack.panels.target.TargetPanel>
    <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
        <pack index="0" name="veraPDF GUI" selected="true"/>
        <pack index="1" name="veraPDF Mac and *nix Scripts" selected="true"/>
        <pack index="2" name="veraPDF Batch files" selected="true"/>
        <pack index="3" name="veraPDF Sample Files" selected="false"/>
        <pack index="4" name="Documentation" selected="false"/>
    </com.izforge.izpack.panels.packs.PacksPanel>
    <com.izforge.izpack.panels.install.InstallPanel id="install"/>
    <com.izforge.izpack.panels.finish.SimpleFinishPanel id="finish"/>
</AutomatedInstallation>`;
}

/** Download + headless-install veraPDF into ~/.jasy/verapdf. `log` streams progress to the UI. */
export async function installVeraPdf(log: (s: string) => void): Promise<string> {
  const tools = detectTools();
  if (!tools.java) {
    throw new Error(
      "Java is required (veraPDF is a Java app). Install a JRE 11+ first, then re-run `jasy verapdf --install`.",
    );
  }
  log(`Java ${tools.java} found.`);
  const tmp = mkdtempSync(join(tmpdir(), "jasy-vera-"));
  try {
    log("Downloading veraPDF (~33 MB) ...");
    const res = await fetch(INSTALLER_URL);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    const zip = Buffer.from(await res.arrayBuffer());

    log("Extracting the installer ...");
    const jar = extractFromZip(zip, /izpack-installer-[^/]*\.jar$/);
    if (!jar) throw new Error("could not find the veraPDF installer inside the download");
    const jarPath = join(tmp, "installer.jar");
    const xmlPath = join(tmp, "auto-install.xml");
    writeFileSync(jarPath, jar);
    writeFileSync(xmlPath, autoInstallXml(VERAPDF_HOME));

    rmSync(VERAPDF_HOME, { recursive: true, force: true }); // clean (re)install
    log(`Installing into ${VERAPDF_HOME} ...`);
    const r = spawnSync("java", ["-Djava.awt.headless=true", "-jar", jarPath, xmlPath], {
      encoding: "utf-8",
    });
    if (!existsSync(MANAGED_BIN)) {
      throw new Error(
        "install did not complete: " + (r.stderr || r.stdout || "").split("\n").slice(-3).join(" "),
      );
    }
    return MANAGED_BIN;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
