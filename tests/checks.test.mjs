// The repository checks themselves: they pass on this repository, and they catch what they promise to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeModCode } from "../scripts/modrules.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (script, root) => spawnSync(process.execPath, [join(root, "scripts", script), "--root", root], { encoding: "utf8", env: { ...process.env, CI: "" } });

// A copy of the repository's files (no .git), changed by `edit`, checked by `script`.
function failsWith(script, edit, pattern) {
  const d = mkdtempSync(join(tmpdir(), "sr-checks-"));
  try {
    cpSync(REPO, d, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|\.wt)([\\/]|$)/.test(src.slice(REPO.length)) });
    edit(d);
    const r = run(script, d);
    assert.notEqual(r.status, 0, `${script} passed but should fail\n${r.stdout}`);
    assert.match(r.stdout, pattern);
  } finally { rmSync(d, { recursive: true, force: true }); }
}
const sub = (d, f, a, b) => { const p = join(d, f), s = readFileSync(p, "utf8"); assert.ok(s.includes(a), `${f} has no ${a}`); writeFileSync(p, s.replace(a, b)); };
const MAIN = "mods/session-restore/main.js";

test("validate and check-docs pass on the repository", () => {
  for (const s of ["validate.mjs", "check-docs.mjs"]) { const r = run(s, REPO); assert.equal(r.status, 0, r.stdout); }
});

test("validate refuses network use", () => failsWith("validate.mjs", (d) => sub(d, MAIN, "const STEPS = 1000;", 'const STEPS = 1000; fetch("x");'), /network use found/));
test("validate refuses a non-portable key", () => failsWith("validate.mjs", (d) => sub(d, "keys.json", '"ctrl-shift-o"', '"cmd-shift-o"'), /not portable/));
test("validate refuses a missing licence header", () => failsWith("validate.mjs", (d) => sub(d, MAIN, "// SPDX-License-Identifier: Apache-2.0\n", ""), /SPDX/));
test("validate catches a RECIPE number that no longer matches the code", () => failsWith("validate.mjs", (d) => sub(d, "mods/session-restore/logic.mjs", "KEEP_DAYS = 30", "KEEP_DAYS = 14"), /keep daily/));
test("check-docs catches a stale configuration value", () => failsWith("check-docs.mjs", (d) => sub(d, "mods/session-restore/logic.mjs", "KEEP_MIN = 10", "KEEP_MIN = 12"), /KEEP_MIN/));

test("modrules: hc, exec and herdr-app do stay on their allow-lists", () => {
  const ok = 'import { hc, exec } from "herdr";\nhc(["get", t]); hc(["send", t, x]); exec("herdr-app", ["do", c, j]); doJson("tab.new", {});';
  assert.deepEqual(analyzeModCode(ok, "f").problems, []);
  const bad = (code) => analyzeModCode('import { hc, exec } from "herdr";\n' + code, "f").problems.length > 0;
  assert.ok(bad('hc(["kill", t]);'), "hc kill");
  assert.ok(bad('exec("rm", ["-rf", x]);'), "another program");
  assert.ok(bad('doJson("space.close", {});'), "a do command off the list");
  assert.ok(bad('const h = hc; h(["kill"]);'), "an alias");
});
