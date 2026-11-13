// Checks an INSTALLED copy of the mod, which `herdr-app check` cannot: that command only loads the code,
// and passes a broken mod.json or a folder that was renamed (so HOME and the key point nowhere).
//   node scripts/verify-install.mjs <installed mod folder> [--home <Herdr home>]
// Read-only, no network, pure Node (Linux, macOS, Windows). With --home (or HERDR_APP_HOME set) it also
// checks that the person's keys.json has a key that opens this mod. Without either it checks the folder only:
// the default home differs per system and was only verified on macOS (~/.config/herdr-app).
// Exit 0 = ok, 1 = findings, 2 = bad usage.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, normalize, resolve, sep } from "node:path";
import { codeLines, reporter } from "./lib.mjs";
import { analyzeModCode, checkModJson, EXEC_RE, FILE_RE, NETWORK_RE, SPDX_LINE } from "./modrules.mjs";

const argv = process.argv.slice(2);
const homeAt = argv.indexOf("--home");
const homeArg = homeAt >= 0 ? argv[homeAt + 1] : process.env.HERDR_APP_HOME;
const skip = new Set(homeAt >= 0 ? [homeAt, homeAt + 1] : []);
const positional = argv.filter((a, i) => !skip.has(i) && !a.startsWith("--"));
const target = positional[0];
if (!target || (homeAt >= 0 && !argv[homeAt + 1])) {
  console.log("usage: node scripts/verify-install.mjs <installed mod folder> [--home <Herdr home>]");
  process.exit(2);
}

const r = reporter("verify-install");
const dir = resolve(target);
const name = basename(dir);
// Files Herdr writes into every mod folder; they are not part of the mod.
const HERDR_WRITTEN = new Set(["gpui-kit.d.ts", "herdr.d.ts", "jsconfig.json"]);

if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.log(`verify-install: ${dir} is not a folder`);
  process.exit(2);
}

const mainPath = join(dir, "main.js");
if (!existsSync(mainPath)) r.fail(`${name}/main.js is missing (is this the mod folder itself, not its parent?)`);

// mod.json
const modJsonPath = join(dir, "mod.json");
if (!existsSync(modJsonPath)) r.fail(`${name}/mod.json is missing`);
else {
  try { checkModJson(JSON.parse(readFileSync(modJsonPath, "utf8")), `${name}/mod.json`, (m) => r.fail(m)); }
  catch (e) { r.fail(`${name}/mod.json: invalid JSON (${e.message})`); }
}

// Code: allow-lists, HOME, icons, other mods, licence header.
const jsFiles = readdirSync(dir).filter((f) => /\.m?js$/.test(f) && !HERDR_WRITTEN.has(f));
const reaches = { hc: false, exec: false, files: false, storage: false, imports: new Set() };
let home = null;
for (const f of jsFiles) {
  const src = readFileSync(join(dir, f), "utf8");
  const code = codeLines(src);
  const a = analyzeModCode(code.map((l) => l.text).join("\n"), `${name}/${f}`);
  for (const p of a.problems) r.fail(p);
  for (const e of a.imports) reaches.imports.add(e.spec);
  if (a.herdr.includes("hc")) reaches.hc = true;
  if (a.herdr.includes("exec")) reaches.exec = true;
  if (code.some((l) => /\b(localStorage|sessionStorage|indexedDB)\b/.test(l.text))) reaches.storage = true;
  if (!src.split(/\r?\n/, 3).some((l) => l.trim() === SPDX_LINE)) r.note(`${name}/${f}: no SPDX licence header in the first 3 lines (copies of the mod should carry it)`);
  for (const { text } of code) {
    if (NETWORK_RE.test(text) || /https?:\/\//.test(text)) r.fail(`${name}/${f}: network use found`);
    if (EXEC_RE.test(text)) r.fail(`${name}/${f}: program execution found`);
    if (FILE_RE.test(text)) reaches.files = true;
    const h = /\bconst HOME\s*=\s*["']mods\/([^"'/]+)["']/.exec(text);
    if (h) home = h[1];
    // Another mod's folder is something a stranger's Herdr does not have.
    for (const m of text.matchAll(/mods\/(?!\$\{)([A-Za-z0-9_.-]+)\//g)) {
      if (m[1] !== name && m[1] !== home) r.fail(`${name}/${f}: reaches into another mod's folder (mods/${m[1]}/)`);
    }
  }
}
if (existsSync(mainPath)) {
  if (!home) r.fail(`${name}/main.js has no 'const HOME = "mods/<folder>"'; cannot tell which folder name the code expects`);
  else if (home !== name) {
    r.fail(`the folder is called "${name}" but main.js expects "mods/${home}" (HOME): its icons would not load. Rename the folder to "${home}", or change HOME (and the keys.json action) together`);
  }
  // Every asset the code loads through HOME exists.
  const mainCode = codeLines(readFileSync(mainPath, "utf8")).map((l) => l.text).join("\n");
  for (const m of mainCode.matchAll(/\$\{HOME\}\/([^`"'\s)]+)/g)) {
    const rel = normalize(m[1]);
    if (rel.startsWith("..") || rel.split(sep).includes("..")) { r.fail(`${name}/main.js: asset path "${m[1]}" leaves the mod folder`); continue; }
    if (!existsSync(join(dir, rel))) r.fail(`${name}/main.js loads ${m[1]} but ${name}/${m[1]} does not exist`);
  }
}

// The person's keys.json, when we know where Herdr's home is.
if (homeArg) {
  const homeDir = resolve(homeArg);
  const lower = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  if (lower(resolve(dir, "..")) !== lower(join(homeDir, "mods"))) {
    r.fail(`${dir} is not ${join(homeDir, "mods", name)}: Herdr loads mods from <home>/mods/<name>`);
  }
  const keysPath = join(homeDir, "keys.json");
  if (!existsSync(keysPath)) r.fail(`${keysPath} does not exist: no key opens the mod yet (merge the repository's keys.json into it)`);
  else {
    try {
      const keys = JSON.parse(readFileSync(keysPath, "utf8"));
      const bound = Object.entries(keys).flatMap(([section, map]) => Object.entries(map ?? {}).filter(([, action]) => action === `mod.open:${name}`).map(([key]) => `${section} ${key}`));
      if (!bound.length) r.fail(`${keysPath} has no key whose action is "mod.open:${name}" (merge the repository's keys.json, or run the command mod.open:${name} by hand)`);
      else r.note(`key: ${bound.join(", ")} opens ${name}`);
    } catch (e) { r.fail(`${keysPath}: invalid JSON (${e.message})`); }
  }
} else {
  r.note("keys.json not checked: pass --home <Herdr home> or set HERDR_APP_HOME (the default location was only verified on macOS)");
}

// What an installer should know before keeping it (read from the code, not from the docs).
r.note(`reaches: network no; programs ${[reaches.hc && "hc get / server status / send", reaches.exec && "herdr-app do (recreate tabs and spaces)"].filter(Boolean).join(", ") || "none"}; files ${reaches.files ? "its saves in <home>/session-restore/, Claude Code's ~/.claude/sessions/ and history.jsonl (read)" : "none"}; storage ${reaches.storage ? "localStorage" : "none"}`);
r.note(`imports: ${[...reaches.imports].sort().join(", ")}`);
r.note("this is a policy check on the source, not a sandbox, and `herdr-app check <folder>` is still the check that the code loads");
r.finish();
