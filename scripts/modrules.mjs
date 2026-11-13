// Rules about the CODE and mod.json of a Herdr mod, shared by validate.mjs (the repository) and
// verify-install.mjs (an installed copy). Pure Node, no dependencies.

const PLACES = ["right", "left", "top", "bottom", "none"];
const KINDS = ["dialog", "popup", "window"];

// mod.json: the fields Herdr documents, with the types it expects. Unknown fields are not an error
// (herdr-app check ignores them too), but a wrong type or an unknown value is.
export function checkModJson(mj, label, fail) {
  if (typeof mj !== "object" || mj === null || Array.isArray(mj)) { fail(`${label} must be an object`); return; }
  if (mj.place !== undefined && !PLACES.includes(mj.place)) fail(`${label}: place "${mj.place}" is not one of ${PLACES.join("|")}`);
  if (mj.size !== undefined && typeof mj.size !== "number") fail(`${label}: size must be a number`);
  if (mj.focusable !== undefined && typeof mj.focusable !== "boolean") fail(`${label}: focusable must be a boolean`);
  if (mj.title !== undefined && typeof mj.title !== "string") fail(`${label}: title must be a string`);
  const o = mj.overlay;
  if (o !== undefined) {
    if (typeof o !== "object" || o === null) fail(`${label}: overlay must be an object`);
    else {
      if (o.kind !== undefined && !KINDS.includes(o.kind)) fail(`${label}: overlay.kind "${o.kind}" is not one of ${KINDS.join("|")}`);
      for (const k of ["width", "height"]) if (o[k] !== undefined && typeof o[k] !== "number") fail(`${label}: overlay.${k} must be a number`);
    }
  }
}

// Second line of defence: names that should not appear in code lines at all (comments already removed).
export const NETWORK_RE = /\bfetch\s*\(|new\s+(XMLHttpRequest|WebSocket|EventSource)\b|sendBeacon\s*\(/;
export const EXEC_RE = /\bexecFile\s*\(|child_process/; // exec() itself is checked by its arguments (below); cx.spawn is Herdr's task helper
export const FILE_RE = /\b(writeTextFile|writeFile|readTextFile|readFile|readdir|readDir|unlink|mkdir)\s*\(/;

// What a mod's code may import and call (allow-lists, so an alias cannot get past them)
// To allow something new: update RECIPE.md "What it reaches" and README "Privacy and permissions" FIRST,
// then add it here, on purpose. Names, not behaviour, are what a script can check; this is a policy
// check on the source, not a sandbox (Herdr does not sandbox mods).
export const HERDR_NAMES = ["spaces", "panes", "terminals", "machines", "hc", "exec", "home", "appHome", "props", "shared", "setShared", "notify", "theme"];
export const RUN_COMMANDS = [];
// hc: what each pane runs (get), the terminal service's start time (server status), typing a restart line (send).
export const HC_FIRST_ARGS = ["get", "server", "send"];
// exec: only `herdr-app do <command>`, to recreate closed tabs and spaces.
export const EXEC_PROGRAM = "herdr-app";
export const DO_COMMANDS = ["space.new", "tab.new", "terminal.open"];
export const IMPORT_SPECIFIERS = ["./logic.mjs", "gpui-kit", "gpui-base", "herdr", "fs/promises"];
export const SPDX_LINE = "// SPDX-License-Identifier: Apache-2.0";

// Returns { imports: [{ spec, names: [{ imported, local }] }], problems: [string] } for one file's code
// (comments already removed). Line numbers are not kept: the file name is enough to find a one-line finding.
export function analyzeModCode(code, file = "file") {
  const problems = [];
  const imports = [];
  const bad = (m) => problems.push(`${file}: ${m}`);
  const importRe = /\bimport\b\s*(?:([\w$*{}\s,]*?)\s*\bfrom\s*)?(["'])([^"']+)\2/g;
  for (const m of code.matchAll(importRe)) {
    const clause = (m[1] ?? "").trim();
    const entry = { spec: m[3], names: [] };
    if (clause) {
      const braces = /\{([^}]*)\}/.exec(clause);
      if (/\*\s*as\b/.test(clause)) entry.namespace = true;
      const dflt = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
      if (dflt && !entry.namespace) entry.default = dflt;
      if (braces) {
        for (const part of braces[1].split(",").map((x) => x.trim()).filter(Boolean)) {
          const [imported, , local] = part.split(/\s+/);
          entry.names.push({ imported, local: local ?? imported });
        }
      }
    }
    imports.push(entry);
  }
  for (const m of code.matchAll(/\bexport\b[^;\n]*?\bfrom\s*(["'])([^"']+)\1/g)) imports.push({ spec: m[2], names: [], reexport: true });
  for (const e of imports) {
    if (!IMPORT_SPECIFIERS.includes(e.spec)) bad(`imports "${e.spec}", which is not on the allow-list (${IMPORT_SPECIFIERS.join(", ")}). Update RECIPE.md "What it reaches" first, then IMPORT_SPECIFIERS in scripts/validate.mjs`);
  }
  if (/\bimport\s*\(/.test(code)) bad("dynamic import() is not allowed (it could load anything)");
  if (/\brequire\s*\(/.test(code)) bad("require() is not allowed");
  if (/\beval\s*\(|\bnew\s+Function\b|(^|[^.\w$])Function\s*\(/.test(code)) bad("eval / Function constructors are not allowed");
  if (/\bglobalThis\s*\[|Reflect\s*\.\s*get\s*\(\s*globalThis|\bglobalThis\s*\.\s*(fetch|exec|process)\b|\bprocess\s*\./.test(code)) bad("reaching globals by name or by computed property is not allowed");
  const local = {}; // imported name -> local names, for names from "herdr"
  for (const e of imports.filter((x) => x.spec === "herdr")) {
    if (e.namespace || e.default) bad('imports "herdr" as a namespace or default; list the names so they can be checked');
    for (const n of e.names) {
      if (!HERDR_NAMES.includes(n.imported)) bad(`imports "${n.imported}" from "herdr", which is not on the allow-list (${HERDR_NAMES.join(", ")}). Update RECIPE.md "What it reaches" first, then HERDR_NAMES in scripts/validate.mjs`);
      (local[n.imported] ??= []).push(n.local);
    }
  }
  const body = code.replace(importRe, " ");
  const calls = (names, test, what) => {
    for (const name of names) {
      const esc = name.replace(/[$]/g, "\\$");
      const at = new RegExp(`(?<![.\\w$])${esc}(?![\\w$])`, "g");
      for (const m of body.matchAll(at)) {
        const after = body.slice(m.index + m[0].length);
        const call = /^\s*\(\s*([\s\S]{0,80})/.exec(after);
        if (!call) { bad(`${what} is used as a value, not called directly; aliasing it would defeat the check`); continue; }
        if (!test(call[1])) bad(`${what} is called with an argument that is not on the allow-list`);
      }
    }
  };
  calls(local.run ?? [], () => false, "run() (this mod runs no app command directly)");
  calls(local.hc ?? [], (a) => new RegExp(`^\\[\\s*(["'])(${HC_FIRST_ARGS.join("|")})\\1\\s*[,\\]]`).test(a), `hc() (only an array literal starting ${HC_FIRST_ARGS.map((x) => `"${x}"`).join(", ")})`);
  calls(local.exec ?? [], (a) => new RegExp(`^(["'])${EXEC_PROGRAM}\\1\\s*,\\s*\\[\\s*(["'])do\\2\\s*,`).test(a), `exec() (only "${EXEC_PROGRAM}", ["do", <command>, ...])`);
  // The commands given to `herdr-app do` are string literals on the allow-list.
  for (const m of code.matchAll(/\bdoJson\(\s*(["'])([^"']+)\1/g)) if (!DO_COMMANDS.includes(m[2])) bad(`herdr-app do "${m[2]}" is not on the allow-list (${DO_COMMANDS.join(", ")})`);
  return { imports, problems, herdr: Object.keys(local).sort() };
}
