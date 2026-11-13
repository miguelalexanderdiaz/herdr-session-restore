// The local gate before a commit or a PR: every CI check, plus `herdr-app check` on each mod.
//   node scripts/check-local.mjs
// `herdr-app check` is the desktop app's own binary; hosted CI cannot run it, so it
// runs here when `herdr-app` is on PATH and is skipped with a notice otherwise.
// verify-install on the repository copy of each mod needs no Herdr and always runs.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;

// herdr-app is the desktop app's own binary. On Windows a command installed as a .cmd shim needs a shell to
// be found; only that call uses one (the paths passed to it are the repository's own).
function step(name, cmd, args, opts = {}) {
  console.log(`\n== ${name}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
  if (r.error) { console.log(`   could not run ${cmd}: ${r.error.code ?? r.error.message}`); return false; }
  if (r.status !== 0) failed++;
  return r.status === 0;
}

const node = process.execPath;
step("validate", node, ["scripts/validate.mjs"]);
step("privacy-scan", node, ["scripts/privacy-scan.mjs"]);
if (existsSync(join(root, "scripts", "check-docs.mjs"))) step("check-docs", node, ["scripts/check-docs.mjs"]);
step("node --test", node, ["--test"]);
const modDirs = readdirSync(join(root, "mods"), { withFileTypes: true }).filter((d) => d.isDirectory());
for (const m of modDirs) step(`verify-install mods/${m.name}`, node, ["scripts/verify-install.mjs", join("mods", m.name)]);

const shell = process.platform === "win32";
const probe = spawnSync("herdr-app", ["--version"], { encoding: "utf8", shell });
if (probe.error || probe.status !== 0) {
  console.log("\n== herdr-app check: skipped (herdr-app is not on PATH; install Herdr to run it)");
} else {
  console.log(`\n== herdr-app check (${probe.stdout.trim()})`);
  for (const m of modDirs) {
    step(`herdr-app check mods/${m.name}`, "herdr-app", ["check", join(root, "mods", m.name)], { shell });
  }
}

console.log(failed ? `\ncheck-local: ${failed} step(s) failed` : "\ncheck-local: all steps passed");
process.exitCode = failed ? 1 : 0;
