// install/install.sh (macOS, Linux) and install/install.ps1 (Windows, both PowerShells) against a
// scratch Herdr home: install, install again, the piped download, uninstall. What to expect comes
// from install/manifest, so the same file tests all three repositories.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = readFileSync(join(root, "install/manifest"), "utf8").split(/\r?\n/);
const field = (w) => (manifest.find((l) => new RegExp(`^${w}\\s+`).test(l)) ?? "").replace(new RegExp(`^${w}\\s+`), "").trim();
const words = (w) => field(w).split(/\s+/).filter(Boolean);
const MODS = words("mods"), BUNDLED = words("bundled"), LAYOUTS = words("layouts"), PANEL = words("panel");
const repoKeys = field("keys") ? JSON.parse(readFileSync(join(root, field("keys")), "utf8")) : {};
const slug = readFileSync(join(root, "install/install.sh"), "utf8").match(/^REPO="[^/]+\/([^"]+)"/m)[1];

const win = process.platform === "win32";
const has = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }).status === 0;
const shells = win
  ? [["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass"]], ...(has("pwsh", ["-NoProfile", "-Command", "exit 0"]) ? [["pwsh", ["-NoProfile"]]] : [])]
  : [["sh", []]];
// No herdr-app in the tests' PATH: the check and the layout switch are skipped, as on a machine without Herdr on PATH.
const env = (extra = {}) => {
  const e = { ...process.env, HERDR_APP_HOME: "", ...extra };
  e.PATH = (e.PATH ?? e.Path ?? "").split(win ? ";" : ":").filter((d) => !existsSync(join(d, win ? "herdr-app.exe" : "herdr-app"))).join(win ? ";" : ":");
  if (win) e.Path = e.PATH;
  return e;
};
function run([shell, pre], args, extra = {}) {
  const script = join(root, "install", win ? "install.ps1" : "install.sh");
  const r = win ? spawnSync(shell, [...pre, "-File", script, ...args], { encoding: "utf8", env: env(extra) })
    : spawnSync(shell, [script, ...args], { encoding: "utf8", env: env(extra) });
  assert.equal(r.status, 0, `${shell} ${args.join(" ")}\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
const freshHome = () => {
  const h = mkdtempSync(join(tmpdir(), "herdr-home-"));
  // A key of the person's that clashes with one of the repo's, and the panel's mod when there is one.
  const [section, binds] = Object.entries(repoKeys)[0] ?? [];
  const mine = section ? { [section]: { [Object.keys(binds)[0]]: "app.help" } } : {};
  writeFileSync(join(h, "keys.json"), JSON.stringify(mine, null, 2));
  if (PANEL[0]) mkdirSync(join(h, "mods", PANEL[0]), { recursive: true });
  return { h, clash: section ? [section, Object.keys(binds)[0]] : null };
};
const readKeys = (h) => JSON.parse(readFileSync(join(h, "keys.json"), "utf8"));
const yesArgs = (h, ...more) => (win ? ["-Yes", "-Home", h, ...more] : ["--yes", "--home", h, ...more]);

for (const shell of shells) {
  test(`${shell[0]}: install, install again, uninstall`, () => {
    const { h, clash } = freshHome();
    const out = run(shell, yesArgs(h));
    for (const m of [...MODS, ...BUNDLED]) assert.ok(existsSync(join(h, "mods", m, "main.js")), `mods/${m}`);
    for (const l of LAYOUTS) {
      const layout = readFileSync(join(h, "layouts", `${l}.json`), "utf8");
      JSON.parse(layout);
      if (PANEL[0]) assert.ok(layout.includes(`"${PANEL[0]}"`), `${l} has the ${PANEL[0]} panel`);
    }
    const keys = readKeys(h);
    for (const [section, binds] of Object.entries(repoKeys)) for (const [chord, action] of Object.entries(binds)) {
      if (clash && section === clash[0] && chord === clash[1]) assert.equal(keys[section][chord], "app.help", "--yes keeps the person's key");
      else assert.equal(keys[section]?.[chord], action, `${section} ${chord}`);
    }
    assert.match(out, /herdr-app is not on PATH/);
    // Again: an update in place, nothing new in keys.json, the old folders backed up.
    const again = run(shell, yesArgs(h));
    assert.match(again, /keys\.json: nothing to add/);
    assert.ok(readdirSync(join(h, "community", slug)).some((d) => d.startsWith("backup-")));
    assert.deepEqual(readKeys(h), keys);
    // Uninstall: what it added goes; the person's clashing key and the panel's mod stay.
    run(shell, yesArgs(h, win ? "-Uninstall" : "--uninstall"));
    for (const m of [...MODS, ...BUNDLED]) assert.ok(!existsSync(join(h, "mods", m)), `mods/${m} removed`);
    for (const l of LAYOUTS) assert.ok(!existsSync(join(h, "layouts", `${l}.json`)));
    const left = readKeys(h);
    if (clash) assert.equal(left[clash[0]][clash[1]], "app.help");
    for (const [section, binds] of Object.entries(repoKeys)) for (const chord of Object.keys(binds)) {
      if (!(clash && section === clash[0] && chord === clash[1])) assert.equal(left[section]?.[chord], undefined, `${section} ${chord} removed`);
    }
    if (PANEL[0]) assert.ok(existsSync(join(h, "mods", PANEL[0])));
    rmSync(h, { recursive: true, force: true });
  });

  test(`${shell[0]}: the one-liner (the script from stdin, the repository downloaded)`, () => {
    const { h } = freshHome();
    const work = mkdtempSync(join(tmpdir(), "herdr-dl-"));
    const copy = join(work, `${slug}-main`);
    cpSync(root, copy, { recursive: true, filter: (p) => !/[\\/](\.git|node_modules|\.wt)([\\/]|$)/.test(p) });
    let r;
    if (win) {
      const zip = join(work, "repo.zip");
      const z = spawnSync(shell[0], [...shell[1], "-Command", `Compress-Archive -Path '${copy}' -DestinationPath '${zip}'`], { encoding: "utf8" });
      assert.equal(z.status, 0, z.stderr);
      const cmd = `$env:HERDR_YES = 1; $env:HERDR_INSTALL_URL = '${zip}'; $env:HERDR_APP_HOME = '${h}'; Get-Content -Raw '${join(root, "install", "install.ps1")}' | Invoke-Expression`;
      r = spawnSync(shell[0], [...shell[1], "-Command", cmd], { encoding: "utf8", env: env() });
    } else {
      const tgz = join(work, "repo.tgz");
      assert.equal(spawnSync("tar", ["-czf", tgz, "-C", work, `${slug}-main`]).status, 0);
      r = spawnSync("sh", ["-s", "--", "--yes", "--home", h], { input: readFileSync(join(root, "install/install.sh")), encoding: "utf8", env: env({ HERDR_INSTALL_URL: pathToFileURL(tgz).href }) });
    }
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /Downloading/);
    for (const m of [...MODS, ...BUNDLED]) assert.ok(existsSync(join(h, "mods", m, "main.js")), `mods/${m}`);
    rmSync(work, { recursive: true, force: true });
    rmSync(h, { recursive: true, force: true });
  });
}

test("macOS's own JavaScript edits the JSON when there is no Node (macOS only)", { skip: process.platform !== "darwin" }, () => {
  const { h } = freshHome();
  run(["sh", []], yesArgs(h), { HERDR_INSTALL_ENGINE: "osascript" });
  for (const [section, binds] of Object.entries(repoKeys)) assert.ok(readKeys(h)[section], section);
  rmSync(h, { recursive: true, force: true });
});

test("the installer files are the same in every repository (only the REPO line differs)", () => {
  // The other repositories' copies, when they sit next to this one (a checkout of all three).
  const strip = (t) => t.replace(/^\$?Repo\s*=.*$|^REPO=.*$/gim, "");
  for (const f of ["install.sh", "install.ps1", "jsonedit.cjs"]) {
    const mine = strip(readFileSync(join(root, "install", f), "utf8"));
    for (const other of ["herdr-portrait-layout", "herdr-agents-waiting", "herdr-obsidian-vault", "herdr-session-restore"]) {
      const p = join(root, "..", other, "install", f);
      if (other === slug || !existsSync(p)) continue;
      assert.equal(strip(readFileSync(p, "utf8")), mine, `${other}/install/${f} differs`);
    }
  }
});
