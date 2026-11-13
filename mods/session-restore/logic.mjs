// SPDX-License-Identifier: Apache-2.0
// session-restore: pure functions (snapshots, diffs, restore plans, retention, timeline).
// No herdr imports here, so `node --test` can load it.

export const SAVE_EVERY_MS = 60_000;
// Programs brought back without asking (tmux-resurrect's idea: a short, safe allowlist).
export const ALLOW = ["nvim", "vim", "vi", "lazygit", "less", "htop", "btop", "yazi"];
// How each coding agent resumes a conversation by its id, keyed by Herdr's program table key
// (pane.program.key). From Herdr's own session-restore integrations (herdr.dev/tui/docs/integrations),
// plus Codex's `codex resume`. An agent missing here, or with no id, comes back by hand only.
export const RESUME = {
  claude: (id) => ["claude", "--resume", id],
  codex: (id) => ["codex", "resume", id],
  copilot: (id) => ["copilot", `--resume=${id}`],
  opencode: (id) => ["opencode", "--session", id],
  cursor: (id) => ["cursor-agent", "--resume", id],
  grok: (id) => ["grok", "--resume", id],
  antigravity: (id) => ["agy", "--conversation", id],
  hermes: (id) => ["hermes", "--resume", id],
  kimi: (id) => ["kimi", "--session", id],
  qoder: (id) => ["qodercli", "--resume", id],
  droid: (id) => ["droid", "--resume", id],
  devin: (id) => ["devin", "--resume", id],
  qwen: (id) => ["qwen", "--resume", id],
  kilo: (id) => ["kilo", "--session", id],
  omp: (id) => ["omp", `--resume=${id}`],
  mastracode: (id) => ["mastracode", "--thread", id],
  letta: (id) => ["letta", "--conversation", id],
};
export const KEEP_ALL_HOURS = 48;            // every distinct save from the last 48 hours
const KEEP_ALL_MS = KEEP_ALL_HOURS * 3600_000;
export const KEEP_DAYS = 30;                 // then the newest save of each day, for 30 days
export const KEEP_MIN = 10;                  // and never fewer than the 10 newest

const base = (p) => String(p ?? "").split("/").pop();

// One shell word: plain words as they are, anything else in single quotes.
export const quote = (s) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, `'\\''`)}'`;
export const commandLine = (argv) => argv.map(quote).join(" ");

// What a pane runs, as a snapshot stores it. `fg` is the foreground process from `hc get`
// ({argv, cwd, pid}). `found` is what is known about an agent's conversation: {id, title}, from
// the agent's own records or a hook's terminal label; null when nothing is known.
export function program(pane, fg, found) {
  const p = pane.program ?? {};
  if (p.shell || !fg?.argv?.length) return { kind: "shell" };
  const name = base(fg.argv[0]);
  if (p.agent || pane.app) {
    const agent = p.key && p.key !== "agent" ? p.key : name, session = found?.id ?? null, resume = RESUME[agent];
    return { kind: "agent", agent, label: p.name || name, session, title: found?.title ?? null, argv: fg.argv,
      cmd: session && resume ? commandLine(resume(session)) : null, auto: Boolean(session && resume) };
  }
  return { kind: "app", name, argv: fg.argv, cmd: commandLine(fg.argv), auto: ALLOW.includes(name) };
}

// The whole saved state: spaces in order, their tabs, each tab's panes. This machine only.
export function buildSnapshot({ spaces, panes, programs, at, coreStart }) {
  return {
    v: 1, at, coreStart,
    spaces: spaces.filter((s) => !s.machine).map((s) => ({
      id: s.id, name: s.name, folder: s.folder,
      tabs: s.tabs.map((t) => ({
        id: t.id, name: t.name,
        panes: panes.filter((p) => p.tab === t.id && p.terminal).map((p) => ({
          pane: p.pane, terminal: p.terminal, cwd: p.cwd, branch: p.branch,
          icon: p.program?.icon ?? null, tint: Boolean(p.program?.tint), label: p.program?.name ?? "",
          prog: programs.get(p.terminal) ?? { kind: "shell" },
        })),
      })),
    })),
  };
}

// Two snapshots that differ only in time are the same save (resurrect drops those too).
export const sameState = (a, b) => Boolean(a && b) && JSON.stringify(a.spaces) === JSON.stringify(b.spaces);

const progKey = (prog) => prog.kind === "shell" ? "shell" : prog.kind === "agent" ? `agent:${prog.agent}:${prog.session ?? ""}` : `app:${prog.cmd}`;
export const progName = (prog) => prog.kind === "agent" ? (prog.title || prog.label) : prog.kind === "app" ? prog.name : "shell";

// Counts for a timeline entry and the header.
export function summarize(snap) {
  const out = { spaces: snap.spaces.length, tabs: 0, panes: 0, agents: {}, apps: {} };
  for (const s of snap.spaces) for (const t of s.tabs) {
    out.tabs++;
    for (const p of t.panes) {
      out.panes++;
      if (p.prog.kind === "agent") out.agents[p.prog.label] = (out.agents[p.prog.label] ?? 0) + 1;
      else if (p.prog.kind === "app") out.apps[p.prog.name] = (out.apps[p.prog.name] ?? 0) + 1;
    }
  }
  return out;
}

// Words a search can find this save by: space and tab names, folders, conversation names.
export function searchText(snap) {
  const words = [];
  for (const s of snap.spaces) {
    words.push(s.name);
    for (const t of s.tabs) {
      words.push(t.name);
      for (const p of t.panes) words.push(p.cwd ?? "", progName(p.prog));
    }
  }
  return words.join("\n").toLowerCase();
}

// Every pane of `snap` compared with `now`:
//   same     the terminal is there and runs the same thing
//   stopped  the terminal is there, now only a shell, and the save ran a program: it can restart in place
//   changed  the terminal is there but runs something else (never touched)
//   missing  the terminal is gone: its tab (and space, if gone too) can be recreated
export function compare(snap, now) {
  const live = new Map();
  for (const s of now.spaces) for (const t of s.tabs) for (const p of t.panes) live.set(p.terminal, p);
  const spaceIds = new Set(now.spaces.map((s) => s.id));
  return snap.spaces.map((s) => ({
    ...s, missing: !spaceIds.has(s.id),
    tabs: s.tabs.map((t) => {
      const panes = t.panes.map((p) => {
        const cur = live.get(p.terminal);
        let state = "missing";
        if (cur) state = progKey(cur.prog) === progKey(p.prog) ? "same" : cur.prog.kind === "shell" ? "stopped" : "changed";
        return { ...p, state };
      });
      return { ...t, panes, missing: panes.length > 0 && panes.every((p) => p.state === "missing") };
    }),
  }));
}

// One-line difference with now, for the header: "+2 tabs +1 space · 3 to restart".
export function diffLine(rows) {
  let spaces = 0, tabs = 0, restart = 0;
  for (const s of rows) {
    if (s.missing) spaces++;
    for (const t of s.tabs) {
      if (t.missing) tabs++;
      restart += t.panes.filter((p) => p.state === "stopped" && p.prog.kind !== "shell").length;
    }
  }
  const parts = [];
  if (tabs) parts.push(`+${tabs} tab${tabs > 1 ? "s" : ""}`);
  if (spaces) parts.push(`+${spaces} space${spaces > 1 ? "s" : ""}`);
  if (restart) parts.push(`${restart} to restart`);
  return parts.length ? parts.join("  ") : "same as now";
}

// What restoring `rows` (from compare) does. `chosen(key)` says if the person kept that row
// ticked (keys: "pane:<terminal>", "tab:<id>"). Never closes or replaces what runs now.
//   restart  {terminal, cwd, cmd}                  a stopped pane gets its program back
//   tab      {space | newSpace, name, panes[]}     a missing tab, rebuilt with its panes
// Programs off the allowlist come back as a shell in their folder, their command listed in `manual`.
export function plan(rows, chosen = () => true) {
  const actions = [], manual = [];
  const run = (p) => (p.prog.kind !== "shell" && p.prog.auto && p.prog.cmd ? p.prog.cmd : null);
  const note = (p) => { if (p.prog.kind !== "shell" && !run(p) && p.prog.cmd) manual.push(p.prog.cmd); };
  for (const s of rows) {
    let made = null; // the first missing tab of a missing space makes the space
    for (const t of s.tabs) {
      if (t.missing) {
        if (!chosen(`tab:${t.id}`)) continue;
        const panes = t.panes.map((p) => ({ cwd: p.cwd, cmd: run(p), argv: run(p) ? restoreArgv(p.prog) : null }));
        t.panes.forEach(note);
        if (s.missing && !made) { made = s; actions.push({ type: "tab", newSpace: { name: s.name, folder: s.folder }, name: t.name, panes }); }
        else actions.push({ type: "tab", space: s.missing ? null : s.id, sameNewSpace: s.missing, name: t.name, panes });
        continue;
      }
      for (const p of t.panes) {
        if (p.state !== "stopped" || !chosen(`pane:${p.terminal}`)) continue;
        if (run(p)) actions.push({ type: "restart", terminal: p.terminal, cwd: p.cwd, cmd: run(p) });
        else note(p);
      }
    }
  }
  return { actions, manual };
}

// The program to start in a new tab or pane (no shell line needed there).
export const restoreArgv = (prog) => prog.kind === "agent" ? RESUME[prog.agent](prog.session) : prog.argv;

// The shell line that brings a program back in its folder.
export const restartLine = (a) => a.cwd ? `cd ${quote(a.cwd)} && ${a.cmd}` : a.cmd;

// After a reboot: the last save made before the terminal service started again. Only panes
// that are now a bare shell get their allowlisted program back; tabs stay as Herdr kept them.
export function autoRestore(entries, coreStart) {
  const before = entries.filter((e) => e.at < coreStart).sort((a, b) => b.at - a.at)[0];
  return before ?? null;
}
export function autoActions(snap, now) {
  return plan(compare(snap, now).map((s) => ({ ...s, tabs: s.tabs.filter((t) => !t.missing) })));
}

// Which save files to delete: keep pins, the newest KEEP_MIN, everything from the last
// KEEP_ALL_MS, then the newest of each day for KEEP_DAYS. `entries` are {file, at}.
export function prune(entries, now, pins = new Set()) {
  const sorted = [...entries].sort((a, b) => b.at - a.at), keep = new Set(), days = new Set();
  sorted.forEach((e, i) => {
    const age = now - e.at, day = new Date(e.at).toDateString();
    if (pins.has(e.file) || i < KEEP_MIN || age <= KEEP_ALL_MS) keep.add(e.file);
    else if (age <= KEEP_DAYS * 86400_000 && !days.has(day)) keep.add(e.file);
    days.add(day);
  });
  return sorted.filter((e) => !keep.has(e.file)).map((e) => e.file);
}

// Slider position 0..1 (0 oldest, 1 now): log-compressed, so the last hours get most room.
export function position(at, now, span = KEEP_DAYS * 86400_000) {
  const h = Math.max(0, now - at) / 3600_000, max = span / 3600_000;
  return Math.max(0, Math.min(1, 1 - Math.log1p(h) / Math.log1p(max)));
}
// The entry nearest to a slider position.
export function nearest(entries, x, now) {
  let best = null, gap = Infinity;
  for (const e of entries) { const d = Math.abs(position(e.at, now) - x); if (d < gap) { gap = d; best = e; } }
  return best;
}

// The activity strip: `width` cells of ▁..█ (busiest save in each cell), and ▲ where the
// terminal service restarted (a reboot or crash) between two saves.
const BARS = " ▁▂▃▄▅▆▇█";
export function strip(entries, now, width) {
  const level = new Array(width).fill(0), marks = new Array(width).fill(false);
  const sorted = [...entries].sort((a, b) => a.at - b.at);
  let top = 1;
  sorted.forEach((e, i) => {
    const c = Math.min(width - 1, Math.floor(position(e.at, now) * width));
    const sum = (o) => Object.values(o ?? {}).reduce((a, b) => a + b, 0), busy = sum(e.counts?.agents) + sum(e.counts?.apps);
    level[c] = Math.max(level[c], busy); top = Math.max(top, busy);
    if (i > 0 && Math.abs(e.coreStart - sorted[i - 1].coreStart) > 60_000) marks[c] = true;
  });
  return {
    bars: level.map((v) => BARS[v ? Math.max(1, Math.round((v / top) * 8)) : 0]).join(""),
    marks: marks.map((m) => (m ? "▲" : " ")).join(""),
  };
}
// The last save before each restart: what "go back to before the crash" lands on.
export function beforeRestarts(entries) {
  const sorted = [...entries].sort((a, b) => a.at - b.at), out = [];
  for (let i = 1; i < sorted.length; i++) if (Math.abs(sorted[i].coreStart - sorted[i - 1].coreStart) > 60_000) out.push(sorted[i - 1]);
  return out;
}

// What changed from `prev` to `snap`, as short lines (the "Show events" list).
export function events(prev, snap) {
  if (!prev) return [];
  const out = [], tabs = (x) => new Map(x.spaces.flatMap((s) => s.tabs.map((t) => [t.id, { s, t }])));
  const panesOf = (x) => new Map(x.spaces.flatMap((s) => s.tabs.flatMap((t) => t.panes.map((p) => [p.terminal, { s, t, p }]))));
  const a = tabs(prev), b = tabs(snap), pa = panesOf(prev), pb = panesOf(snap);
  for (const [id, { s, t }] of b) if (!a.has(id)) out.push(`opened tab ${t.name} in ${s.name}`);
  for (const [id, { s, t }] of a) if (!b.has(id)) out.push(`closed tab ${t.name} in ${s.name}`);
  for (const [term, { s, p }] of pb) {
    const old = pa.get(term)?.p;
    if (p.prog.kind !== "shell" && (!old || progKey(old.prog) !== progKey(p.prog))) out.push(`started ${progName(p.prog)} in ${s.name}`);
    if (old && old.prog.kind !== "shell" && progKey(old.prog) !== progKey(p.prog)) out.push(`stopped ${progName(old.prog)} in ${s.name}`);
  }
  return out;
}

// "2h ago", "yesterday", "5d ago".
export function ago(at, now) {
  const m = Math.round((now - at) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}
export const fileName = (at) => `snap-${new Date(at).toISOString().replace(/[:.]/g, "-")}.json`;

// "Fri 13 Nov · 08:36" (the app's date formatting ignores locale options, so by hand).
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function when(at, { day = true } = {}) {
  const d = new Date(at), hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `${day ? `${DAYS[d.getDay()]} ` : ""}${d.getDate()} ${MONTHS[d.getMonth()]} · ${hm}`;
}

// "3 Claude Code · 1 Codex" from summarize()'s agents.
export const agentCounts = (agents) => Object.entries(agents ?? {}).map(([n, k]) => `${k} ${n}`);
// A space's badge color when the layout keeps none: one of six theme colors, by its id.
export function badgeColor(id, palette) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

// Saves made before agents were generic stored Claude as kind "claude": read them as agents.
export function upgrade(snap) {
  if (!snap) return snap;
  for (const s of snap.spaces) for (const t of s.tabs) for (const p of t.panes) {
    if (p.prog.kind === "claude") p.prog = { ...p.prog, kind: "agent", agent: "claude", label: "Claude Code" };
  }
  return snap;
}
