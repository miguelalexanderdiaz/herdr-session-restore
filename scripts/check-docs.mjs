// Documentation check: links resolve, the Pages site loads nothing from elsewhere,
// the site's preview is the repo's preview. Pages run no inline script; the only scripts are the site's own
// files in docs/assets/, and those may not reach the network, load code or store anything.
//   node scripts/check-docs.mjs [--root <dir>]
// Checks README.md, CONTRIBUTING.md, AGENTS.md, CHANGELOG.md, RECIPE.md and docs/*.html: links and anchors;
// the numbers and constants the documents quote against main.js; the same navigation on every page;
// keyboard-reachable tables; header cells with a scope.
// Pure Node, no dependencies.
import { readFileSync, statSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { has, reporter, repoFiles, rootFromArgs } from "./lib.mjs";

const root = rootFromArgs();
const r = reporter("check-docs");
const files = repoFiles(root);
const text = (f) => readFileSync(join(root, f), "utf8");

const MD = ["README.md", "RECIPE.md", "AGENTS.md", "CONTRIBUTING.md", "CHANGELOG.md"].filter((f) => has(root, f));
const HTML = files.filter((f) => /^docs\/.+\.html$/.test(f));
const isExternal = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//");

// ---- links
function targetExists(fromFile, ref) {
  const clean = decodeURIComponent(ref.split("#")[0].split("?")[0]);
  if (!clean) return true; // "#anchor" only
  const base = posix.dirname(fromFile);
  const full = posix.normalize(clean.startsWith("/") ? clean.slice(1) : posix.join(base, clean));
  if (full.startsWith("..")) return false;
  if (files.includes(full)) return true;
  if (files.some((f) => f.startsWith(full.replace(/\/$/, "") + "/"))) return true; // a folder
  return false;
}

function anchorsOf(file) {
  const t = text(file);
  const set = new Set();
  for (const m of t.matchAll(/\bid="([^"]+)"/g)) set.add(m[1]);
  for (const m of t.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    set.add(m[1].toLowerCase().replace(/[`*_~]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-"));
  }
  return set;
}

function checkLinks(file, refs) {
  for (const ref of refs) {
    if (!ref || isExternal(ref) || ref.startsWith("mailto:")) continue;
    if (!targetExists(file, ref)) { r.fail(`${file}: broken link "${ref}"`); continue; }
    const hash = ref.split("#")[1];
    if (hash) {
      const path = ref.split("#")[0] ? posix.normalize(posix.join(posix.dirname(file), ref.split("#")[0])) : file;
      if (files.includes(path) && /\.(md|html)$/.test(path) && !anchorsOf(path).has(decodeURIComponent(hash).toLowerCase()) && !anchorsOf(path).has(decodeURIComponent(hash))) {
        r.fail(`${file}: link "${ref}" points to a heading/id that does not exist in ${path}`);
      }
    }
  }
}

for (const f of MD) {
  const t = text(f).replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const refs = [...t.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]);
  checkLinks(f, refs);
}

for (const f of HTML) {
  const t = text(f);
  const refs = [];
  for (const m of t.matchAll(/\b(?:href|src|poster|data)\s*=\s*["']([^"']*)["']/gi)) refs.push(m[1]);
  checkLinks(f, refs);
  // A page may link out with <a href="https://...">, but must not LOAD anything from another origin.
  for (const m of t.matchAll(/<(link|script|img|iframe|source|video|audio|object|embed|use|image)\b[^>]*>/gi)) {
    const tag = m[0];
    const url = /\b(?:src|href|data|poster|srcset)\s*=\s*["']\s*((?:https?:)?\/\/[^"'\s,]+)/i.exec(tag);
    if (url) r.fail(`${f}: <${m[1].toLowerCase()}> loads an external origin: ${url[1]}`);
  }
  for (const m of t.matchAll(/(?:@import|url\()\s*["']?\s*((?:https?:)?\/\/[^"')\s]+)/gi)) r.fail(`${f}: CSS loads an external origin: ${m[1]}`);
  if (!/<html[^>]*\blang\s*=\s*["'][a-z-]+["']/i.test(t)) r.fail(`${f}: <html> has no lang`);
  if (!/<title>\s*\S[\s\S]*?<\/title>/i.test(t)) r.fail(`${f}: no <title>`);
  if (!/<meta[^>]+name\s*=\s*["']viewport["']/i.test(t)) r.fail(`${f}: no viewport meta`);
  if (!/<meta[^>]+charset/i.test(t)) r.fail(`${f}: no charset meta`);
  // No inline script. The only scripts are the site's own files in docs/assets/ (<script src="assets/x.js">).
  for (const m of t.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1];
    if (!src || m[2].trim()) r.fail(`${f}: an inline <script>; a page may only load the site's own scripts with <script src="assets/...">`);
    if (src && !(/^assets\/[\w.-]+\.js$/.test(src) && has(root, `docs/${src}`))) r.fail(`${f}: <script src="${src}"> must be an existing file in docs/assets/`);
  }
  if ((t.match(/<script\b/gi) ?? []).length !== (t.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) ?? []).length) r.fail(`${f}: a <script> is not closed`);
  const imgs = [...t.matchAll(/<img\b[^>]*>/gi)];
  for (const i of imgs) if (!/\balt\s*=/.test(i[0])) r.fail(`${f}: <img> without alt`);
}
// The site's scripts: no network, no loading code, no storage, no addresses (the site stays static and offline).
for (const f of files.filter((f) => /^docs\/.+\.m?js$/.test(f))) {
  const bad = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|eval|Function|localStorage|sessionStorage|indexedDB|document\.cookie|Worker)\b\s*[.(]|\bimport\s*[(\s{*"']|\bnew\s+(Function|Worker|WebSocket|EventSource|XMLHttpRequest|Image)\b|\.src\s*=|https?:\/\//.exec(text(f));
  if (bad) r.fail(`${f}: uses ${bad[0]}; the site's scripts may not reach the network, load code or store anything`);
}
for (const f of files.filter((f) => /^docs\/.+\.css$/.test(f))) {
  for (const m of text(f).matchAll(/(?:@import|url\()\s*["']?\s*((?:https?:)?\/\/[^"')\s]+)/gi)) r.fail(`${f}: CSS loads an external origin: ${m[1]}`);
}

// ---- the constants and the numbers the documents quote are the ones in the code
// The mod's files own the values; a document that disagrees is wrong, whatever it says.
const MOD = "mods/session-restore/";
const plain = (html) => html.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&middot;/g, "·").replace(/\s+/g, " ");
const consts = {};
for (const f of files.filter((f) => f.startsWith(MOD) && /\.m?js$/.test(f))) {
  for (const m of text(f).matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]*)\s*=\s*("[^"\n]*"|'[^'\n]*'|-?\d[\d_]*(?:\.\d+)?)\s*;/gm)) {
    consts[m[1]] = /^["']/.test(m[2]) ? m[2].slice(1, -1) : Number(m[2].replace(/_/g, ""));
  }
}
const CONFIG_CONSTANTS = ["HOME", "REV", "SAVE_EVERY_MS", "KEEP_ALL_HOURS", "KEEP_DAYS", "KEEP_MIN"];
if (has(root, "docs/configuration.html") && Object.keys(consts).length) {
  const rows = [...text("docs/configuration.html").matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((m) => plain(m[0]));
  for (const name of CONFIG_CONSTANTS) {
    if (!(name in consts)) { r.fail(`${MOD}: no 'const ${name} = <literal>;' (docs/configuration.html lists it)`); continue; }
    const row = rows.find((t) => new RegExp(`(^|[^A-Z_])${name}([^A-Z_]|$)`).test(t));
    if (!row) { r.fail(`docs/configuration.html: no table row for ${name}`); continue; }
    if (!row.includes(String(consts[name]))) r.fail(`docs/configuration.html: the ${name} row does not show the value in ${MOD} (${consts[name]})`);
  }
}
// "every N seconds" and "N hours" in the prose match the code.
if ("SAVE_EVERY_MS" in consts) {
  for (const f of ["README.md", "AGENTS.md", "CONTRIBUTING.md", "llms.txt", ...HTML].filter((f) => has(root, f))) {
    const t = f.endsWith(".html") ? plain(text(f)) : text(f);
    for (const m of t.matchAll(/\b(?:once )?every (\d+) (seconds?|minutes?)\b/gi)) {
      const ms = Number(m[1]) * (/^m/i.test(m[2]) ? 60_000 : 1000);
      if (ms !== consts.SAVE_EVERY_MS) r.fail(`${f}: says "${m[0]}" but the code saves every ${consts.SAVE_EVERY_MS / 1000} seconds`);
    }
    for (const m of t.matchAll(/\blast (\d+) hours\b/gi)) if (Number(m[1]) !== consts.KEEP_ALL_HOURS) r.fail(`${f}: says "${m[0]}" but KEEP_ALL_HOURS = ${consts.KEEP_ALL_HOURS}`);
    for (const m of t.matchAll(/\bfor (\d+) days\b/gi)) if (Number(m[1]) !== consts.KEEP_DAYS) r.fail(`${f}: says "${m[0]}" but KEEP_DAYS = ${consts.KEEP_DAYS}`);
  }
}

// ---- the pages share one navigation, each marks itself; tables can be scrolled by keyboard
const pages = HTML.filter((f) => f !== "docs/404.html"); // 404 is not part of the nav set (it has no place in it)
const navOf = (f) => {
  const nav = /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(text(f));
  if (!nav) return null;
  return [...nav[1].matchAll(/<li>\s*<a\b([^>]*)>/gi)].map((m) => ({ href: /\bhref="([^"]*)"/.exec(m[1])?.[1], current: /\baria-current=/.test(m[1]) }));
};
let refNav = null;
for (const f of pages) {
  const items = navOf(f);
  if (!items) { r.fail(`${f}: no <nav> with a list of pages`); continue; }
  const set = items.map((i) => i.href).sort().join(",");
  refNav ??= { f, set };
  if (set !== refNav.set) r.fail(`${f}: navigation lists [${set}], ${refNav.f} lists [${refNav.set}]; every page must show the same pages`);
  const current = items.filter((i) => i.current);
  const self = f.slice("docs/".length);
  if (current.length !== 1) r.fail(`${f}: ${current.length} navigation items have aria-current, expected exactly one`);
  else if (current[0].href !== self) r.fail(`${f}: aria-current is on "${current[0].href}", expected "${self}"`);
}
for (const f of HTML) {
  const t = text(f);
  for (const m of t.matchAll(/<div\b[^>]*\bclass="[^"]*\btable-wrap\b[^"]*"[^>]*>/g)) {
    if (!/\btabindex=/.test(m[0])) r.fail(`${f}: a .table-wrap has no tabindex (a wide table could not be scrolled by keyboard)`);
  }
  for (const m of t.matchAll(/<pre\b([^>]*)>([\s\S]*?)<\/pre>/g)) {
    const lines = m[2].split("\n");
    if ((lines.length > 10 || lines.some((l) => l.length > 70)) && !/\btabindex=/.test(m[1])) r.fail(`${f}: a long <pre> has no tabindex`);
  }
  for (const m of t.matchAll(/<th\b([^>]*)>/g)) if (!/\bscope=/.test(m[1])) r.fail(`${f}: a <th> has no scope`);
}

// ---- Pages basics (only once the docs/ site exists)
if (HTML.length) {
  if (!has(root, "docs/.nojekyll")) r.fail("docs/.nojekyll is missing (Pages would run Jekyll over the site)");
  if (!has(root, "docs/index.html")) r.fail("docs/index.html is missing");
  if (!has(root, "docs/assets/preview.png")) r.fail("docs/assets/preview.png is missing (Pages from main /docs cannot see the repo root)");
  else if (has(root, "preview.png") && !readFileSync(join(root, "preview.png")).equals(readFileSync(join(root, "docs/assets/preview.png")))) {
    r.fail("docs/assets/preview.png differs from preview.png: copy the current one");
  }
} else {
  r.note("no docs/*.html yet: Pages checks skipped");
}

// ---- the key the docs name is the key keys.json binds
if (has(root, "keys.json")) {
  try {
    const keys = Object.values(JSON.parse(text("keys.json"))).flatMap((m) => Object.keys(m));
    const bound = [...new Set(keys)];
    for (const f of ["README.md", "RECIPE.md"].filter((f) => has(root, f))) {
      const t = text(f);
      for (const k of bound) {
        // "ctrl-shift-a", "Ctrl+Shift+A" and "Ctrl-Shift-A" all name the same key.
        const re = new RegExp(k.split("-").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[-+ ]"), "i");
        if (!re.test(t)) r.fail(`${f}: does not name the key from keys.json ("${k}")`);
      }
    }
  } catch { /* validate reports invalid JSON */ }
}

r.finish();
