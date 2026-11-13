// Privacy scan: no personal information in any file or in git history.
//   node scripts/privacy-scan.mjs [--root <dir>]
// Env PRIVACY_EXTRA: comma-separated extra words to refuse (a username, an employer,
// a hostname). Keep that list OUT of the repo: set it in your shell or as a CI secret.
// Env PRIVACY_AUTHORS: "all" (default) also checks the author and committer e-mail of every commit;
// "skip" does not. CI uses "skip" on pull_request events: an outside contributor's own e-mail is theirs
// and already public in git. Added lines and commit messages are scanned in both modes, and the
// owner-controlled push to main runs "all".
// Pure Node, no dependencies. Exit 0 = clean, 1 = findings.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { join } from "node:path";
import { git, gitBuf, isBinary, isGitRepo, reporter, repoFiles, rootFromArgs } from "./lib.mjs";

const root = rootFromArgs();
const r = reporter("privacy-scan");
const files = repoFiles(root);

// Exact strings that are deliberate and public: the clone URL / herdr.dev path, and the Pages address.
const ALLOWED_STRINGS = ["miguelalexanderdiaz/herdr-session-restore", "miguelalexanderdiaz.github.io/herdr-session-restore"];
const OWNER = ALLOWED_STRINGS[0].split("/")[0];
// E-mail addresses that are fine: GitHub's no-reply addresses (also bots: name[bot]@users.noreply...), the
// committer GitHub's web buttons (merge, squash, update branch) write, the support address Dependabot signs
// with, the Claude co-author line, and the git@ host of SSH clone URLs. Written as patterns so no address
// appears literally in this repository.
const ALLOWED_MAIL = [
  /@users\.noreply\.github\.com$/i,
  /^noreply@github\.com$/i,
  /^support@github\.com$/i,
  /^noreply@anthropic\.com$/i,
  /^git@github\.com$/i,
  /^theoverfittingclub@gmail\.com$/i, // the author's public commit address
];
const AUTHORS = (process.env.PRIVACY_AUTHORS || "all").trim().toLowerCase();
if (!["all", "skip"].includes(AUTHORS)) { console.log(`privacy-scan: PRIVACY_AUTHORS must be "all" or "skip", not "${AUTHORS}"`); process.exit(2); }
// Home folder names that are not a person: CI runners and the placeholders tests and docs use.
const GENERIC_HOMES = new Set(["runner", "vsts", "ubuntu", "user", "username", "name", "you", "me", "dev", "example", "someone", "alice", "bob"]);
// A bare ellipsis (a path written as "..." in prose) names no one.
const generic = (m) => GENERIC_HOMES.has(m[1].toLowerCase()) || /^\.+$/.test(m[1]);

// Patterns are written so this file does not match itself.
const RULES = [
  { id: "home-path-mac", re: /\/Users\/(?![<{$%])([^\/\s"'`<>)\]}]+)/, ok: generic },
  { id: "home-path-linux", re: /\/home\/(?![<{$%])([^\/\s"'`<>)\]}]+)/, ok: generic },
  { id: "home-path-windows", re: /[A-Za-z]:[\\/]+Users[\\/]+(?![<{$%])([^\\\/\s"'`<>)\]}]+)/, ok: generic },
  { id: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/, ok: (m) => ALLOWED_MAIL.some((a) => a.test(m[0])) },
  { id: "hostname", re: /(?<![.\w])[A-Za-z0-9][A-Za-z0-9-]+\.(?:local|lan|home\.arpa)(?![\w(])/ },
  { id: "token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const extra = (process.env.PRIVACY_EXTRA ?? "").split(",").map((s) => s.trim()).filter((s) => s.length >= 3);
if (AUTHORS === "skip") r.note("PRIVACY_AUTHORS=skip: commit author and committer e-mails were not checked (added lines and messages were)");
if (extra.length) r.note(`PRIVACY_EXTRA: ${extra.length} extra word(s) checked`);
else r.note("PRIVACY_EXTRA not set: only the built-in rules ran (set it locally or as a CI secret to add your own words)");

// The copyright holder named on LICENSE's line may appear nowhere else.
let holder = null;
try {
  const m = /^\s*Copyright\s+(?:\(c\)\s+)?\d{4}\s+(.+?)\s*$/m.exec(readFileSync(join(root, "LICENSE"), "utf8"));
  if (m && !/^the\b/i.test(m[1])) holder = m[1];
} catch { /* no LICENSE: validate reports it */ }

function mask(text) {
  let t = text;
  for (const a of ALLOWED_STRINGS) t = t.split(a).join(" ".repeat(a.length));
  return t;
}

// Round plans and logs under plans/ may talk about the owner's handle (it is public, it is in the
// clone URL); every other rule still applies to them.
const isPlan = (f) => f.startsWith("plans/");

function scanText(text, where, { license = false, plan = false } = {}) {
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = mask(raw);
    for (const rule of RULES) {
      const g = new RegExp(rule.re.source, "g");
      for (const m of line.matchAll(g)) {
        if (rule.ok?.(m)) continue;
        r.fail(`${where}:${i + 1}: ${rule.id}: ${m[0].slice(0, 48)}`);
      }
    }
    const low = line.toLowerCase();
    if (!plan && low.includes(OWNER.toLowerCase())) r.fail(`${where}:${i + 1}: username outside the allowed owner/repo string`);
    if (holder && !(license && /^\s*Copyright\s/.test(raw)) && low.includes(holder.toLowerCase())) r.fail(`${where}:${i + 1}: the copyright holder's name appears outside LICENSE's copyright line`);
    for (const w of extra) if (low.includes(w.toLowerCase())) r.fail(`${where}:${i + 1}: PRIVACY_EXTRA word found`);
  });
}

// PNG files can carry text (title, source path, profile, camera data) that no one sees in the picture.
// Every text-bearing chunk is read and scanned with the same rules; the only keyword allowed is Software
// (what rasterised it); EXIF is refused outright. Other formats are not inspected (there are none in the repo).
function pngText(buf) {
  const out = [];
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return out;
  let o = 8;
  while (o + 12 <= buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("latin1", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "eXIf") out.push({ keyword: "eXIf", text: "" });
    else if (type === "tEXt") {
      const z = data.indexOf(0);
      out.push({ keyword: data.toString("latin1", 0, z), text: data.toString("latin1", z + 1) });
    } else if (type === "zTXt") {
      const z = data.indexOf(0);
      let text = "";
      try { text = inflateSync(data.subarray(z + 2)).toString("utf8"); } catch { text = "(unreadable)"; }
      out.push({ keyword: data.toString("latin1", 0, z), text });
    } else if (type === "iTXt") {
      const z = data.indexOf(0);
      const compressed = data[z + 1] === 1;
      let p = z + 3;
      p = data.indexOf(0, p) + 1; // language tag
      p = data.indexOf(0, p) + 1; // translated keyword
      let text;
      try { text = (compressed ? inflateSync(data.subarray(p)) : data.subarray(p)).toString("utf8"); } catch { text = "(unreadable)"; }
      out.push({ keyword: data.toString("latin1", 0, z), text });
    }
    o += 12 + len;
  }
  return out;
}
function scanPng(buf, where) {
  for (const c of pngText(buf)) {
    if (c.keyword !== "Software") r.fail(`${where}: PNG text chunk "${c.keyword}" (only Software is allowed; screenshot tools can write titles, paths or profile names here)`);
    scanText(c.text, `${where} (PNG ${c.keyword})`);
  }
}

// 1. The tree.
for (const f of files) {
  if (/\.png$/i.test(f)) { try { scanPng(readFileSync(join(root, f)), f); } catch { /* unreadable: validate reports it */ } continue; }
  if (isBinary(f)) continue;
  let text;
  try { text = readFileSync(join(root, f), "utf8"); } catch { continue; }
  if (text.includes("\0")) continue;
  scanText(text, f, { license: f === "LICENSE", plan: isPlan(f) });
}

// 2. History: commit metadata, messages, and every line ever added.
if (isGitRepo(root)) {
  const meta = git(root, ["log", "--all", "--format=%x1e%H%x1f%ae%x1f%ce%x1f%an%x1f%cn%x1f%B"]);
  if (meta === null) r.note("git log failed: history not scanned");
  else {
    for (const rec of meta.split("\x1e").filter(Boolean)) {
      const [hash, ae, ce, an, cn, body = ""] = rec.split("\x1f");
      const short = hash.trim().slice(0, 7);
      for (const [what, mail] of AUTHORS === "skip" ? [] : [["author", ae], ["committer", ce]]) {
        if (mail && !ALLOWED_MAIL.some((a) => a.test(mail.trim()))) r.fail(`commit ${short}: ${what} e-mail is not a no-reply address`);
      }
      for (const w of extra) {
        if ([an, cn].some((v) => v.toLowerCase().includes(w.toLowerCase()))) r.fail(`commit ${short}: PRIVACY_EXTRA word in author/committer name`);
      }
      // GitHub's merge button writes "Merge pull request #N from <owner>/<branch>": the owner there is
      // the same public handle as in the clone URL, so it is blanked before the message is scanned.
      const merge = new RegExp(`^(Merge pull request #\\d+ from )${OWNER}/`, "i");
      scanText(body.replace(merge, (_, head) => head + " ".repeat(OWNER.length) + "/"), `commit ${short} message`);
      for (const m of body.matchAll(/^Co-Authored-By:\s*(.*)$/gim)) {
        if (!/<noreply@anthropic\.com>\s*$/i.test(m[1]) && !/@users\.noreply\.github\.com>\s*$/i.test(m[1])) r.fail(`commit ${short}: Co-Authored-By names someone other than Claude: ${m[1].slice(0, 40)}`);
      }
    }
    // PNG files of any revision (the patch scan below skips binary content).
    const objs = git(root, ["rev-list", "--objects", "--all"]);
    for (const line of (objs ?? "").split("\n")) {
      const sp = line.indexOf(" ");
      if (sp < 0 || !/\.png$/i.test(line)) continue;
      const blob = gitBuf(root, ["cat-file", "blob", line.slice(0, sp)]);
      if (blob) scanPng(blob, `history ${line.slice(0, 7)} ${line.slice(sp + 1)}`);
    }
    const patch = git(root, ["log", "--all", "-p", "-U0", "--no-color", "--format=%x1ecommit %H"]);
    if (patch !== null) {
      for (const chunk of patch.split("\x1e").filter(Boolean)) {
        const short = chunk.slice(7, 14);
        let file = "?";
        for (const line of chunk.split("\n")) {
          if (line.startsWith("+++ ")) { file = line.slice(6); continue; }
          if (!line.startsWith("+") || isBinary(file)) continue;
          scanText(line.slice(1), `history ${short} ${file}`, { license: file === "LICENSE", plan: isPlan(file) });
        }
      }
    }
  }
} else {
  r.note("not a git checkout: history not scanned");
}

// Same line found in the tree and in history is reported twice; keep the output short.
r.finish();
