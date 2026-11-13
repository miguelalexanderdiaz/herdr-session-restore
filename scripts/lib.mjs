// Shared helpers for the repo checks (validate, privacy-scan, check-docs, check-local).
// Pure Node, no dependencies, paths through node:path so it runs the same on
// Linux, macOS and Windows. Every script accepts `--root <dir>` to check
// another copy of the repo (used to prove that the checks fail when they should).
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export function rootFromArgs(argv = process.argv.slice(2)) {
  const i = argv.indexOf("--root");
  if (i >= 0 && argv[i + 1]) return resolve(argv[i + 1]);
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

// Same as git(), but returns the raw bytes (blobs).
export function gitBuf(root, args) {
  const r = spawnSync("git", args, { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
}

export const isGitRepo = (root) => git(root, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true" && existsSync(join(root, ".git"));

const SKIP_DIRS = new Set([".git", "node_modules"]);

function walk(dir, root, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, out);
    else out.push(relative(root, full).split(sep).join("/"));
  }
}

// The files that count: what git tracks (so ignored files never matter), or,
// in a plain copy without .git, every file except .git and node_modules.
export function repoFiles(root) {
  if (isGitRepo(root)) {
    const out = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    if (out !== null) return [...new Set(out.split("\0").filter(Boolean))].filter((f) => existsSync(join(root, f))).sort();
  }
  const out = [];
  walk(root, root, out);
  return out.sort();
}

export const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|zip|gz)$/i;
export const isBinary = (rel) => BINARY_EXT.test(rel);

export const read = (root, rel) => readFileSync(join(root, rel), "utf8");
export const has = (root, rel) => existsSync(join(root, rel));

// Source lines with comments removed, so a rule can tell code from prose.
// Crude on purpose: it understands `// ...` after whitespace, `/* ... */` and
// leading `*`; it does not parse strings. Good enough for the rules below.
export function codeLines(text) {
  const out = [];
  let inBlock = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    for (;;) {
      const start = line.indexOf("/*");
      if (start < 0) break;
      const end = line.indexOf("*/", start + 2);
      if (end < 0) { line = line.slice(0, start); inBlock = true; break; }
      line = line.slice(0, start) + " " + line.slice(end + 2);
    }
    line = line.replace(/(^|\s)\/\/.*$/, "$1");
    if (line.trim()) out.push({ n: i + 1, text: line });
  });
  return out;
}

// A tiny reporter: findings are printed as they come, exit code says the result.
export function reporter(name) {
  const problems = [];
  const notes = [];
  return {
    fail: (msg) => problems.push(msg),
    note: (msg) => notes.push(msg),
    get failed() { return problems.length > 0; },
    finish() {
      for (const n of notes) console.log(`  ${n}`);
      if (problems.length) {
        console.log(`${name}: FAILED (${problems.length})`);
        for (const p of problems) console.log(`  - ${p}`);
        process.exitCode = 1;
      } else {
        console.log(`${name}: ok`);
      }
    },
  };
}
