// Build a GitHub Release for one package and create-or-update it (idempotent, so a re-triggered tag
// never duplicates or loses anything). Notes = changelogen's grouped feat/fix/chore for the delta range,
// plus a contributor list resolved via GitHub's per-commit attribution (correct person + profile link,
// works with a private commit email). Replaces the old `gh release create --generate-notes`.
//
// Driven by release.yml, which already resolves the package from the tag. Env in:
//   TAG (e.g. pdf-v1.0.0-alpha.4), NAME (@jasy/pdf), VERSION (1.0.0-alpha.4), DIST (alpha|latest),
//   GITHUB_REPOSITORY, GH_TOKEN. Set DRY_RUN=1 to print the notes instead of touching the release.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const gh = (args) => sh("gh", args);

// Filter changelogen's grouped markdown down to commits in scope, dropping any group heading left without
// entries. Entry lines look like "- Subject ([abc1234](…/commit/abc1234))"; the compare-changes link and
// blank lines before the first heading are kept as-is.
function scopeNotes(md, inScopeSha) {
  const out = [];
  let header = null;
  let items = [];
  const flush = () => {
    if (header && items.length) out.push(header, "", ...items, "");
    header = null;
    items = [];
  };
  for (const line of md.split("\n")) {
    if (/^#{2,6}\s/.test(line)) {
      flush();
      header = line;
      continue;
    }
    const m = line.match(/\(\[([0-9a-f]{7,40})\]\(/);
    if (m && /^\s*-\s/.test(line)) {
      if (inScopeSha(m[1])) items.push(line);
      continue;
    }
    if (!header && line.trim()) out.push(line); // compare-changes link etc., before any heading
  }
  flush();
  return out.join("\n").trim();
}

const { TAG: tag, NAME: name, VERSION: version, DIST: dist, GITHUB_REPOSITORY: repo } = process.env;
if (!tag || !name || !version || !repo) {
  throw new Error("missing env: TAG, NAME, VERSION, GITHUB_REPOSITORY required");
}

// Package prefix is everything before "-v" in the tag (pdf-v1.2.3 -> pdf). The previous tag of the SAME
// package (sorted by semver) bounds the changelog range; first release falls back to the root commit.
const prefix = tag.slice(0, tag.lastIndexOf("-v"));
// versionsort.suffix makes git treat -alpha/-beta/-rc as prereleases (sorted BELOW the stable release),
// so the previous-tag lookup is correct across the alpha -> stable boundary, not just between alphas.
const tags = sh("git", [
  "-c",
  "versionsort.suffix=-alpha",
  "-c",
  "versionsort.suffix=-beta",
  "-c",
  "versionsort.suffix=-rc",
  "tag",
  "--sort=-v:refname",
  "--list",
  `${prefix}-v*`,
])
  .split("\n")
  .filter(Boolean);
const i = tags.indexOf(tag);
const from =
  (i >= 0 && i + 1 < tags.length && tags[i + 1]) ||
  sh("git", ["rev-list", "--max-parents=0", "HEAD"]);

// Path-scope per package: a changelog only lists commits that touched THIS package's files. The root `pdf`
// package = everything EXCEPT the sub-packages. A commit touching several packages shows up in each of them,
// which is correct. inScope = the set of full shas in the range that touched the package's path.
const PATHSPEC = {
  pdf: [".", ":(exclude)packages"],
  zugferd: ["packages/zugferd"],
  cli: ["packages/cli"],
  vue: ["packages/vue"],
  nuxt: ["packages/nuxt"],
};
const pathspec = PATHSPEC[prefix] ? ["--", ...PATHSPEC[prefix]] : [];
const inScope = new Set(
  sh("git", ["log", `${from}..${tag}`, "--format=%H", ...pathspec]).split("\n").filter(Boolean),
);
const shaInScope = (short) => [...inScope].some((full) => full.startsWith(short));

// 1) Grouped notes for the delta (changelogen print mode), minus its own header line + contributor block.
// changelogen still writes a CHANGELOG.md even in print mode; we only want stdout, so remove that
// artifact afterwards (option B = no committed changelog file).
const hadChangelog = existsSync("CHANGELOG.md");
let notes = "";
try {
  notes = sh("npx", ["changelogen@latest", "--from", from, "--to", tag, "--no-output"]);
} catch {
  /* empty delta */
}
if (!hadChangelog && existsSync("CHANGELOG.md")) rmSync("CHANGELOG.md");
// changelogen logs via consola; in CI (non-TTY) that leaks a "[log]" prefix line onto stdout, which we
// capture here. Drop everything before the real changelog: the compare-changes link or the first heading.
const begin = notes.search(/^(\[compare changes\]|#{1,6}\s)/m);
if (begin > 0) notes = notes.slice(begin);
notes = notes
  .replace(/### ❤️ Contributors[\s\S]*$/m, "")
  .replace(/^##\s.*$/m, "")
  .trim();
// Drop entries for commits that did not touch this package, plus any group heading left empty.
notes = scopeNotes(notes, shaInScope);

// 2) Contributors via per-commit attribution (correct GitHub user, not an email-search org hit).
const seen = new Set();
const contributors = [];
for (const sha of sh("git", ["log", `${from}..${tag}`, "--pretty=format:%H", ...pathspec])
  .split("\n")
  .filter(Boolean)) {
  let data;
  try {
    data = JSON.parse(gh(["api", `repos/${repo}/commits/${sha}`]));
  } catch {
    continue;
  }
  const login = data.author?.login;
  if (!login || login.endsWith("[bot]") || seen.has(login)) continue;
  seen.add(login);
  contributors.push({ login, name: data.commit?.author?.name || login });
}
const contribBlock = contributors.length
  ? "### ❤️ Contributors\n\n" +
    contributors.map((c) => `- [${c.name}](https://github.com/${c.login}) (@${c.login})`).join("\n")
  : "";

const body = [notes, contribBlock].filter(Boolean).join("\n\n") || `${name} ${version}`;

if (process.env.DRY_RUN) {
  console.log(`--- title: ${name} ${version}  (range ${from} -> ${tag}) ---\n${body}`);
  process.exit(0);
}

// 3) Create-or-update the release with the per-package title.
writeFileSync("RELEASE_NOTES.md", body);
let exists = true;
try {
  gh(["release", "view", tag]);
} catch {
  exists = false;
}
if (exists) {
  gh(["release", "edit", tag, "--title", `${name} ${version}`, "--notes-file", "RELEASE_NOTES.md"]);
} else {
  gh([
    "release",
    "create",
    tag,
    "--title",
    `${name} ${version}`,
    "--notes-file",
    "RELEASE_NOTES.md",
    dist === "latest" ? "--latest" : "--prerelease",
  ]);
}
console.log(
  `${exists ? "updated" : "created"} release ${tag} (${name} ${version}); ${contributors.length} contributor(s)`,
);
