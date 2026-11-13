import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../mods/session-restore/logic.mjs";

const H = 3600_000, NOW = Date.UTC(2026, 10, 13, 12);
const shell = { kind: "shell" };
const claude = (id, title = "work") => ({ kind: "agent", agent: "claude", label: "Claude Code", session: id, title, argv: ["claude"], cmd: `claude --resume ${id}`, auto: true });
const nvim = { kind: "app", name: "nvim", argv: ["nvim", "a.py"], cmd: "nvim a.py", auto: true };
const pane = (terminal, prog, cwd = "/w") => ({ pane: `p${terminal}`, terminal, cwd, branch: null, icon: null, tint: false, label: "", prog });
const snap = (spaces, at = NOW) => ({ v: 1, at, coreStart: 0, spaces });
const space = (id, tabs) => ({ id, name: id, folder: "/w", tabs });
const tab = (id, panes) => ({ id, name: id, panes });

test("program: shells, agents by id, allowlisted and other programs", () => {
  assert.deepEqual(L.program({ program: { shell: true } }, { argv: ["zsh"] }), shell);
  const c = L.program({ program: { key: "claude", name: "Claude Code", agent: true }, app: "claude-code" }, { argv: ["claude", "--x"] }, { id: "S", title: "github" });
  assert.equal(c.cmd, "claude --resume S"); assert.equal(c.title, "github"); assert.ok(c.auto); assert.equal(L.progName(c), "github");
  const noId = L.program({ program: { key: "claude", name: "Claude Code", agent: true } }, { argv: ["/usr/bin/claude"] }, null);
  assert.equal(noId.auto, false); assert.equal(noId.cmd, null); assert.equal(L.progName(noId), "Claude Code");
  // Any agent in Herdr's table, by its key; one with no known resume command stays by hand.
  const cx = L.program({ program: { key: "codex", name: "Codex", agent: true } }, { argv: ["codex"] }, { id: "019a" });
  assert.equal(cx.cmd, "codex resume 019a"); assert.ok(cx.auto);
  assert.equal(L.program({ program: { key: "copilot", name: "Copilot", agent: true } }, { argv: ["copilot"] }, { id: "x y" }).cmd, "copilot '--resume=x y'");
  const pi = L.program({ program: { key: "pi", name: "Pi", agent: true } }, { argv: ["pi"] }, { id: "1" });
  assert.equal(pi.auto, false, "no verified resume command for pi");
  const unknown = L.program({ program: { key: "agent", name: "my-agent", agent: true }, app: "mine" }, { argv: ["/x/my-agent"] }, null);
  assert.equal(unknown.agent, "my-agent");
  assert.deepEqual(L.program({ program: {} }, { argv: ["/opt/bin/nvim", "my file.py"] }), { kind: "app", name: "nvim", argv: ["/opt/bin/nvim", "my file.py"], cmd: "/opt/bin/nvim 'my file.py'", auto: true });
  assert.equal(L.program({ program: {} }, { argv: ["npm", "run", "dev"] }).auto, false);
});

test("quote keeps plain words and escapes the rest", () => {
  assert.equal(L.commandLine(["a", "b c", "it's", "x=1"]), `a 'b c' 'it'\\''s' x=1`);
});

test("buildSnapshot keeps this machine's spaces, tabs and panes in order", () => {
  const s = L.buildSnapshot({
    at: 5, coreStart: 1,
    spaces: [{ id: "s1", name: "a", folder: "/a", machine: null, tabs: [{ id: "t1", name: "x" }] }, { id: "r", machine: "vps", tabs: [] }],
    panes: [{ pane: "p1", terminal: "t9", tab: "t1", cwd: "/a", program: { name: "zsh", shell: true } }, { pane: "m", terminal: null, tab: "t1" }],
    programs: new Map([["t9", nvim]]),
  });
  assert.equal(s.spaces.length, 1);
  assert.equal(s.spaces[0].tabs[0].panes.length, 1, "mod panes are left out");
  assert.equal(s.spaces[0].tabs[0].panes[0].prog, nvim);
});

test("sameState ignores time", () => {
  const a = snap([space("s", [])], 1), b = snap([space("s", [])], 2);
  assert.ok(L.sameState(a, b)); assert.ok(!L.sameState(a, snap([space("z", [])])));
});

test("compare: same, stopped, changed, missing tab and space", () => {
  const old = snap([
    space("s1", [tab("ta", [pane("t1", claude("A")), pane("t2", nvim), pane("t3", claude("B"))]), tab("tb", [pane("t4", nvim)])]),
    space("s2", [tab("tc", [pane("t5", claude("C"))])]),
  ]);
  const now = snap([space("s1", [tab("ta", [pane("t1", claude("A")), pane("t2", shell), pane("t3", nvim)])])]);
  const rows = L.compare(old, now);
  assert.deepEqual(rows[0].tabs[0].panes.map((p) => p.state), ["same", "stopped", "changed"]);
  assert.ok(rows[0].tabs[1].missing); assert.ok(rows[1].missing);
  assert.equal(L.diffLine(rows), "+2 tabs  +1 space  1 to restart");
  assert.equal(L.diffLine(L.compare(now, now)), "same as now");

  const { actions, manual } = L.plan(rows);
  assert.deepEqual(actions[0], { type: "restart", terminal: "t2", cwd: "/w", cmd: "nvim a.py" });
  assert.deepEqual(actions[1], { type: "tab", space: "s1", sameNewSpace: false, name: "tb", panes: [{ cwd: "/w", cmd: "nvim a.py", argv: ["nvim", "a.py"] }] });
  assert.deepEqual(actions[2].panes[0].argv, ["claude", "--resume", "C"]);
  assert.deepEqual(actions[2].newSpace, { name: "s2", folder: "/w" });
  assert.equal(actions[2].panes[0].cmd, "claude --resume C");
  assert.deepEqual(manual, []);
  // Unticked rows stay out.
  assert.equal(L.plan(rows, (k) => k !== "tab:tb" && k !== "pane:t2").actions.length, 1);
});

test("plan: programs off the allowlist come back as a shell, listed for the person", () => {
  const dev = { kind: "app", name: "npm", argv: ["npm", "run", "dev"], cmd: "npm run dev", auto: false };
  const rows = L.compare(snap([space("s", [tab("t", [pane("t1", dev)]), tab("u", [pane("t2", dev)])])]), snap([space("s", [tab("t", [pane("t1", shell)])])]));
  const { actions, manual } = L.plan(rows);
  assert.deepEqual(actions, [{ type: "tab", space: "s", sameNewSpace: false, name: "u", panes: [{ cwd: "/w", cmd: null, argv: null }] }]);
  assert.deepEqual(manual, ["npm run dev", "npm run dev"]);
});

test("auto restore: the last save before the restart, panes only", () => {
  const entries = [{ at: 10 }, { at: 20 }, { at: 40 }];
  assert.equal(L.autoRestore(entries, 30).at, 20);
  assert.equal(L.autoRestore(entries, 5), null);
  const old = snap([space("s", [tab("t", [pane("t1", claude("A"))]), tab("gone", [pane("t9", nvim)])])]);
  const now = snap([space("s", [tab("t", [pane("t1", shell)])])]);
  const { actions } = L.autoActions(old, now);
  assert.deepEqual(actions, [{ type: "restart", terminal: "t1", cwd: "/w", cmd: "claude --resume A" }], "never recreates closed tabs on its own");
  assert.equal(L.restartLine(actions[0]), "cd /w && claude --resume A");
});

test("prune: pins, the newest 10, 48 hours of everything, then one a day for 30 days", () => {
  const e = (h, file = `f${h}`) => ({ file, at: NOW - h * H });
  const entries = [...Array.from({ length: 12 }, (_, i) => e(i)), e(50), e(51), e(80), e(24 * 40), e(24 * 45, "pinned")];
  const gone = L.prune(entries, NOW, new Set(["pinned"]));
  assert.deepEqual(gone.sort(), ["f51", `f${24 * 40}`].sort(), "50h and 51h share a day: the older goes; 40 days is past 30");
});

test("prune keeps the newer save of a day", () => {
  const day = Date.UTC(2026, 10, 1, 12);
  const entries = [{ file: "late", at: day + H }, { file: "early", at: day }, ...Array.from({ length: 10 }, (_, i) => ({ file: `n${i}`, at: NOW - i }))];
  assert.deepEqual(L.prune(entries, NOW), ["early"]);
});

test("timeline: position, nearest, strip and restart marks", () => {
  assert.equal(L.position(NOW, NOW), 1);
  assert.ok(L.position(NOW - H, NOW) > 0.7, "the last hour gets a lot of room");
  assert.equal(L.position(NOW - 400 * 24 * H, NOW), 0);
  const entries = [{ at: NOW - 30 * H, coreStart: 1, counts: { agents: { C: 4 }, apps: {} } }, { at: NOW - H, coreStart: 9e12, counts: { agents: { C: 8 }, apps: { nvim: 1 } } }];
  assert.equal(L.nearest(entries, 0.99, NOW), entries[1]);
  const { bars, marks } = L.strip(entries, NOW, 20);
  assert.equal(bars.length, 20); assert.ok(bars.includes("█"));
  assert.equal(marks.trim(), "▲");
  assert.deepEqual(L.beforeRestarts(entries), [entries[0]]);
});

test("events between two saves", () => {
  const a = snap([space("s", [tab("t", [pane("t1", claude("A", "alpha"))])])]);
  const b = snap([space("s", [tab("t", [pane("t1", shell)]), tab("u", [pane("t2", nvim)])])]);
  assert.deepEqual(L.events(a, b), ["opened tab u in s", "stopped alpha in s", "started nvim in s"]);
  assert.deepEqual(L.events(null, b), []);
});

test("summarize, search text, ago, file names", () => {
  const s = snap([space("work", [tab("t", [pane("t1", claude("A", "Github Worker")), pane("t2", nvim)])])]);
  assert.deepEqual(L.summarize(s), { spaces: 1, tabs: 1, panes: 2, agents: { "Claude Code": 1 }, apps: { nvim: 1 } });
  assert.deepEqual(L.agentCounts({ "Claude Code": 3, Codex: 1 }), ["3 Claude Code", "1 Codex"]);
  assert.equal(L.badgeColor("sp1", ["a", "b", "c"]), L.badgeColor("sp1", ["a", "b", "c"]));
  assert.ok(L.searchText(s).includes("github worker"));
  assert.equal(L.ago(NOW - 2 * H, NOW), "2h ago"); assert.equal(L.ago(NOW - 26 * H, NOW), "yesterday");
  assert.equal(L.fileName(NOW), "snap-2026-11-13T12-00-00-000Z.json");
});

test("when formats day, date and time", () => {
  const at = new Date(2026, 10, 13, 8, 5).getTime();
  assert.equal(L.when(at), "Fri 13 Nov · 08:05");
  assert.equal(L.when(at, { day: false }), "13 Nov · 08:05");
});

test("upgrade reads old Claude saves as agents", () => {
  const old = snap([space("s", [tab("t", [pane("t1", { kind: "claude", session: "A", title: "x", cmd: "claude --resume A", auto: true })])])]);
  const p = L.upgrade(old).spaces[0].tabs[0].panes[0].prog;
  assert.equal(p.kind, "agent"); assert.equal(p.agent, "claude"); assert.equal(L.restoreArgv(p).join(" "), "claude --resume A");
});
