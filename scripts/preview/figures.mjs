// Author-only tool: writes the animated illustrations of docs/usage.html to docs/assets/fig-*.svg.
// node scripts/preview/figures.mjs
// Every figure is an ILLUSTRATION with invented data, drawn from the mod's real layout. Not a screenshot.
// The animation is CSS inside each SVG (it plays in an <img>, on GitHub too). With reduced motion
// asked for, each figure shows its last, most telling frame and does not move.
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "assets");
const SANS = "Geist, Inter, 'Segoe UI', 'DejaVu Sans', 'Liberation Sans', Arial, sans-serif";
const MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'DejaVu Sans Mono', monospace";
const C = {
  page: "#14161a", chrome: "#191c21", win: "#101317", line: "#2a2f37", line2: "#3a4350",
  fg: "#e6e8eb", muted: "#9aa1ad", dim: "#6b7280", faint: "#3a404c", accent: "#7fb4ca", red: "#e46876",
  card: "#15181d", cardHead: "#1b1f25", chip: "#242a31", pane: "#0e1013",
  claude: "#d97757", codex: "#9a9a9a", nvim: "#57a143", git: "#e3814f", ok: "#87a987", yellow: "#c4b28a",
};
const CW = 7.2; // a 12px monospace character

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const attrs = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== false).map(([k, v]) => ` ${k}="${v}"`).join("");
const T = (x, y, s, { size = 12, w = 400, fill = C.fg, anchor = "start", mono = false, cls, op } = {}) =>
  `<text${attrs({ x, y, "font-size": size, "font-weight": w === 400 ? undefined : w, fill, "text-anchor": anchor === "start" ? undefined : anchor, "font-family": mono ? MONO : undefined, class: cls, opacity: op })}>${esc(s)}</text>`;
const R = (x, y, w, h, { rx, fill = "none", stroke, cls, op, sw } = {}) =>
  `<rect${attrs({ x, y, width: w, height: h, rx, fill, stroke, "stroke-width": sw, class: cls, opacity: op })}/>`;
// A class animates `transform`, which would replace a translate attribute: so the class goes on an inner group.
const G = (body, { x = 0, y = 0, cls, op, clip } = {}) => {
  const inner = cls ? `<g class="${cls}">${body}</g>` : body;
  return `<g${attrs({ transform: x || y ? `translate(${x},${y})` : undefined, opacity: op, "clip-path": clip ? `url(#${clip})` : undefined })}>${inner}</g>`;
};
const clock = (x, y, color = C.muted) =>
  `<g transform="translate(${x},${y})" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="6"/><path d="M7 4v3l2 1.4"/></g>`;
const cursor = (cls) =>
  `<g class="${cls}"><path d="M0 0v17l4.5-4.2 3 6.6 2.6-1.2-3-6.4h6.2z" fill="#f4f5f6" stroke="#101317" stroke-width="1.2" stroke-linejoin="round"/></g>`;

// ---- animation helpers: one keyframe block per class
function kf(cls, dur, frames, { timing = "ease-in-out" } = {}) {
  return `.${cls}{animation:${cls} ${dur}s ${timing} infinite both}@keyframes ${cls}{${frames}}`;
}
// Visible from a% to b% of the loop (a fade of f% at each end).
function show(a, b, f = 1.5) {
  const k = [];
  if (a <= 0) k.push("0%{opacity:1}"); else k.push(`0%,${(a - f).toFixed(2)}%{opacity:0}`, `${a}%{opacity:1}`);
  if (b >= 100) k.push("100%{opacity:1}"); else k.push(`${b}%{opacity:1}`, `${(b + f).toFixed(2)}%,100%{opacity:0}`);
  return k.join("");
}
// A cover in the pane's colour that slides off the text from a% to b%: the text looks typed.
function typed(cls, dur, a, b, width, hideAt = 100) {
  const steps = Math.max(1, Math.round(width / CW));
  return `.${cls}{animation:${cls} ${dur}s steps(${steps},end) infinite both}@keyframes ${cls}{0%,${a}%{transform:translateX(0)}${b}%,${hideAt}%{transform:translateX(${width + 2}px)}}`;
}
function svg(w, h, title, body, css, reduced = "") {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${SANS}" role="img">
<title>${esc(title)}</title>
<!-- Illustration with invented data, drawn from the mod's real layout (see RECIPE.md). Not a screenshot.
     Made by scripts/preview/figures.mjs; edit that, not this file. -->
<defs><filter id="sh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.55"/></filter></defs>
<style>${css}
@media (prefers-reduced-motion: reduce){*{animation:none!important}${reduced}}</style>
${R(0, 0, w, h, { fill: C.page })}
${body}
${T(w - 12, h - 10, "Illustration with invented data", { size: 10, fill: C.faint, anchor: "end" })}
</svg>
`;
}

// ---- the History window (440 wide), as main.js draws it
const W = 440;
function paneRow(p, y, x0 = 0) {
  let s = "", x = x0 + 30;
  if (p.tick !== undefined) {
    s += p.tick ? R(x, y - 11, 12, 12, { rx: 3, fill: C.accent, cls: p.tickCls }) : R(x + 0.5, y - 10.5, 11, 11, { rx: 3, stroke: C.line2, cls: p.tickCls });
    x += 20;
  }
  s += R(x, y - 12, 13, 13, { rx: 3, fill: p.color });
  s += T(x + 22, y - 1, p.text, { size: 12.5, fill: p.dim ? C.muted : C.fg });
  const right = W - 30 - (p.mark ? 26 : 0);
  s += T(right, y - 1, p.folder, { size: 11, fill: C.dim, anchor: "end" });
  if (p.mark) {
    s += G(R(0, 0, 18, 16, { rx: 4, fill: C.chip }) + T(9, 12, p.mark, { size: 11, w: 600, fill: p.mark === "+" ? C.yellow : C.accent, anchor: "middle" }), { x: W - 46, y: y - 13, cls: p.markCls });
  }
  return s;
}
function card(c, y) {
  // header 34, each tab 24 + 26 per pane, 10 at the bottom
  const h = 34 + c.tabs.reduce((n, t) => n + 24 + 26 * t.panes.length, 0) + 6;
  let s = R(10, y, W - 20, h, { rx: 8, fill: C.card, stroke: c.missing ? C.yellow : C.line2, cls: c.cls });
  s += `<path d="M18 ${y}h${W - 36}a8 8 0 0 1 8 8v26h-${W - 20}v-26a8 8 0 0 1 8-8z" fill="${C.cardHead}"/>`;
  s += R(20, y + 8, 18, 18, { rx: 5, fill: c.color }) + T(29, y + 21, c.name[0].toUpperCase(), { size: 10.5, w: 700, fill: "#fff", anchor: "middle" });
  s += T(46, y + 22, c.name, { size: 13, w: 600 });
  if (c.missing) s += T(46 + c.name.length * 7.6 + 8, y + 22, "closed since", { size: 11, fill: C.yellow });
  let cx = W - 26;
  for (const chip of c.chips) {
    const cw = chip.length * 6.1 + 12; cx -= cw;
    s += R(cx, y + 9, cw, 17, { rx: 4, fill: C.chip }) + T(cx + 6, y + 21, chip, { size: 10.5, fill: C.muted });
    cx -= 6;
  }
  let ty = y + 34;
  for (const t of c.tabs) {
    ty += 18;
    s += T(24, ty, t.name, { size: 11, w: 600, fill: t.missing ? C.yellow : C.dim });
    if (t.missing) s += T(24 + t.name.length * 6.6 + 8, ty, "closed since", { size: 10.5, fill: C.yellow, op: 0.8 });
    s += `<line x1="30" y1="${ty + 4}" x2="30" y2="${ty + 4 + 26 * t.panes.length - 4}" stroke="${C.line}"/>`;
    ty += 6;
    for (const p of t.panes) { ty += 26; s += paneRow(p, ty - 6); }
  }
  return { s, h };
}
// opts: date, ago, counts, diff, restore, saves, thumb (0..1 or null), cards, compact, events
function history(o) {
  let s = "", y = 0;
  s += clock(16, 14) + T(38, 26, "History", { size: 13, w: 600 }) + T(W - 16, 26, `${o.saves ?? 312} saves`, { size: 11, fill: C.dim, anchor: "end" });
  s += T(16, 56, o.date, { size: 16, w: 600 }) + T(16 + o.date.length * 8.9 + 10, 56, o.ago, { size: 12, fill: C.dim });
  s += T(16, 76, o.counts, { size: 12, fill: C.muted });
  s += T(16, 95, o.diff, { size: 12, fill: o.diff === "same as now" ? C.dim : C.accent });
  const rw = o.restore.length * 6.6 + 22;
  s += o.restoreOn === false
    ? R(16.5, 108.5, rw, 27, { rx: 7, stroke: C.line }) + T(27, 127, o.restore, { size: 12, fill: C.dim })
    : G(R(16, 108, rw, 28, { rx: 7, fill: "#c5c9c5" }) + T(27, 127, o.restore, { size: 12, fill: C.win }), { cls: o.restoreCls });
  s += R(rw + 24.5, 108.5, 42, 27, { rx: 7, stroke: C.line }) + T(rw + 35, 127, "Pin", { size: 12, fill: C.muted });
  s += R(rw + 74.5, 108.5, 63, 27, { rx: 7, stroke: C.line }) + T(rw + 85, 127, "Events", { size: 12, fill: C.muted });
  s += T(W - 16, 127, "← → · ⇧ day", { size: 11, fill: C.dim, anchor: "end" });
  y = 146;
  if (!o.compact) {
    s += R(16.5, 146.5, W - 33, 29, { rx: 8, stroke: o.searchOn ? C.accent : C.line });
    s += o.search
      ? T(28, 166, o.search, { size: 12, fill: C.fg }) + R(28 + o.search.length * 6.7, 155, 1.5, 14, { fill: C.accent })
      : T(28, 166, "Find a conversation, tab or folder", { size: 12, fill: C.dim });
    s += T(16, 200, "▁▂▃▅▇▆▅▃▂▁▂▃▅▆▇▆▅▃▂▃▅▇▆▅▃▂▃▅▆▇█▇▆▅▃", { size: 11, fill: C.dim });
    s += T(230, 212, "▲", { size: 9, fill: C.red }) + T(310, 212, "▲", { size: 9, fill: C.red });
    s += R(16, 222, W - 32, 4, { rx: 2, fill: C.line });
    if (o.thumb !== null && o.thumb !== undefined) {
      const tx = 16 + (W - 32) * o.thumb;
      s += R(16, 222, tx - 16, 4, { rx: 2, fill: C.accent }) + `<circle cx="${tx}" cy="224" r="7" fill="${C.accent}"/>`;
    }
    s += [["30d", 16], ["7d", 86], ["48h", 146], ["6h", 256], ["now", 400]].map(([l, x]) => T(x, 246, l, { size: 10, fill: C.dim })).join("");
    s += R(16.5, 256.5, 176, 19, { rx: 6, stroke: C.line }) + T(24, 270, "▲ before restart 12 Nov · 20:05", { size: 11, fill: C.muted });
    y = 286;
  }
  s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${C.line}"/>`;
  y += 10;
  for (const c of o.cards) { const r = card(c, y); s += r.s; y += r.h + 10; }
  const h = o.height ?? y + 6;
  return { s: `<g filter="url(#sh)">${R(0, 0, W, h, { rx: 10, fill: C.win, stroke: C.line })}</g>` + s, h };
}

// The sample saves.
const web = (marks = {}) => ({
  name: "web-app", color: "#22a99a", chips: ["1 nvim", "2 Claude Code"], tabs: [
    { name: "agents", panes: [
      { color: C.claude, text: "checkout refactor", folder: "web-app/src", ...marks.a },
      { color: C.claude, text: "flaky e2e tests", folder: "web-app", ...marks.b }] },
    { name: "editor", panes: [{ color: C.nvim, text: "nvim src/cart.ts", folder: "web-app/src", ...marks.c }] }],
});
const infra = (extra = {}) => ({
  name: "infra", color: "#e3814f", chips: ["1 Codex"], ...extra, tabs: [
    { name: "ops", panes: [
      { color: C.codex, text: "terraform plan review", folder: "infra/envs", ...extra.p },
      { color: C.faint, text: "zsh", folder: "infra", dim: true }] }],
});

// ---- a Herdr window around any layout: a top bar, a list of spaces, tabs, panes
function herdr(w, h, { spaces, tabs, active = 0, panes, historyLit = false, tabCls = {} }) {
  let s = R(0, 0, w, h, { rx: 10, fill: C.page, stroke: C.line });
  s += `<path d="M10 0h${w - 20}a10 10 0 0 1 10 10v24h-${w}v-24a10 10 0 0 1 10-10z" fill="${C.chrome}"/>`;
  s += [20, 38, 56].map((x) => `<circle cx="${x}" cy="17" r="5" fill="${C.faint}"/>`).join("");
  s += T(84, 21, "Search", { size: 11.5, fill: C.muted }) + T(140, 21, "Settings", { size: 11.5, fill: C.muted });
  const right = [["Files", 0], ["Changes", 0], ["History", 1]];
  let rx = w - 14;
  for (const [l, isClock] of right.reverse()) {
    const bw = l.length * 6.3 + (isClock ? 30 : 12); rx -= bw;
    if (isClock) s += G(R(0, 0, bw, 20, { rx: 5, fill: historyLit ? "#262b33" : "none" }) + clock(6, 3, historyLit ? C.fg : C.muted) + T(24, 14, l, { size: 11.5, fill: historyLit ? C.fg : C.muted }), { x: rx, y: 7, cls: "histbtn" });
    else s += T(rx + 6, 21, l, { size: 11.5, fill: C.muted });
    rx -= 6;
  }
  s += `<line x1="0" y1="34" x2="${w}" y2="34" stroke="${C.line}"/>`;
  // spaces
  s += R(0, 35, 150, h - 35, { fill: "#121418" }) + `<line x1="150" y1="35" x2="150" y2="${h}" stroke="${C.line}"/>`;
  s += T(14, 58, "SPACES", { size: 10, w: 600, fill: C.dim });
  spaces.forEach((sp, i) => {
    const y = 70 + i * 30;
    s += G((i === 0 ? R(6, 0, 138, 24, { rx: 6, fill: "#1d2127" }) : "") + R(14, 4, 16, 16, { rx: 4, fill: sp.color }) + T(22, 16, sp.name[0].toUpperCase(), { size: 10, w: 700, fill: "#fff", anchor: "middle" }) + T(38, 16, sp.name, { size: 12, fill: i === 0 ? C.fg : C.muted }), { y, cls: sp.cls });
  });
  // tabs
  let tx = 160;
  tabs.forEach((t, i) => {
    const tw = t.length * 7 + 22;
    s += G(R(0, 0, tw, 24, { rx: 6, fill: i === active ? "#1d2127" : "none", stroke: i === active ? C.line : undefined }) + T(11, 16, t, { size: 12, fill: i === active ? C.fg : C.muted }), { x: tx, y: 42, cls: tabCls[i] });
    tx += tw + 4;
  });
  s += `<line x1="150" y1="72" x2="${w}" y2="72" stroke="${C.line}"/>`;
  return s + panes;
}
// pane bodies, drawn at (x, y) with size (w, h)
const prompt = (x, y, dir) => T(x, y, `${dir} ❯`, { size: 12, mono: true, fill: C.accent });
let clipN = 0;
function paneBox(x, y, w, h, title, body, { cls, focus } = {}) {
  const id = `pc${++clipN}`;
  return G(R(0, 0, w, h, { rx: 6, fill: C.pane, stroke: focus ? C.line2 : C.line }) + T(10, 16, title, { size: 10.5, fill: C.dim }) + `<line x1="0" y1="24" x2="${w}" y2="24" stroke="${C.line}"/>` +
    `<clipPath id="${id}"><rect x="1" y="25" width="${w - 2}" height="${h - 26}" rx="5"/></clipPath><g clip-path="url(#${id})">${body}</g>`, { x, y, cls });
}
// Before a% the first is shown, from b% the second, and back to the first for the loop's restart.
function swap(a, b, end = 96) {
  const f = 0.8;
  return [`0%,${a}%{opacity:1}${a + f}%,${end}%{opacity:0}${end + f}%,100%{opacity:1}`, `0%,${b - f}%{opacity:0}${b}%,${end}%{opacity:1}${end + f}%,100%{opacity:0}`];
}
function bars(x, y, rows, color = C.faint) {
  return rows.map(([dx, len, c], i) => R(x + dx, y + i * 16, len, 6, { rx: 3, fill: c ?? color })).join("");
}
const claudeBody = (w, h, title, name = "✻ Claude Code", color = C.claude) =>
  T(12, 46, name, { size: 12, w: 600, fill: color, mono: true }) + T(12, 64, title, { size: 11.5, fill: C.muted, mono: true }) +
  bars(12, 82, [[0, w * 0.62], [0, w * 0.48], [14, w * 0.55, "#2c3440"], [14, w * 0.3, "#2c3440"], [0, w * 0.66]]) +
  R(10, h - 34, w - 20, 24, { rx: 5, stroke: C.line2 }) + T(20, h - 18, ">", { size: 12, mono: true, fill: color });
const nvimBody = (w, h) =>
  Array.from({ length: Math.floor((h - 60) / 16) }, (_, i) => T(20, 46 + i * 16, String(i + 1), { size: 11, mono: true, fill: C.faint, anchor: "end" })).join("") +
  bars(30, 40, [[0, 90, "#957fb8"], [12, 150], [12, 120, "#7aa89f"], [24, 80], [12, 60, "#c4b28a"], [0, 30, "#957fb8"], [0, 110], [12, 140, "#7aa89f"], [12, 70]].slice(0, Math.floor((h - 60) / 16))) +
  R(0, h - 20, w, 20, { fill: "#1b1f25" }) + R(0, h - 20, 58, 20, { fill: C.nvim }) + T(8, h - 6, "NORMAL", { size: 10.5, w: 700, mono: true, fill: C.win }) + T(66, h - 6, "src/cart.ts", { size: 10.5, mono: true, fill: C.muted });
const gitBody = (w, h) => {
  const bw = (w - 30) / 2, bh = (h - 44) / 2;
  return [["Status", 10, 32], ["Files", 20 + bw, 32], ["Branches", 10, 40 + bh], ["Commits", 20 + bw, 40 + bh]].map(([l, x, y], i) =>
    R(x, y, bw, bh - 4, { rx: 4, stroke: i === 1 ? C.ok : C.line2 }) + T(x + 8, y + 14, l, { size: 10.5, fill: i === 1 ? C.ok : C.dim, mono: true }) + bars(x + 8, y + 24, [[0, bw * 0.6], [0, bw * 0.4]].slice(0, Math.max(1, Math.floor((bh - 30) / 16))))).join("");
};
// a line typed after the prompt (with its cover), then the line's own box
function typedLine(x, y, text, cls) {
  const w = text.length * CW;
  return T(x, y, text, { size: 12, mono: true, fill: C.fg }) + R(x - 1, y - 13, w + 4, 18, { fill: C.pane, cls });
}

// ======================================================================================
// 1. Open: the key, then the popup over any layout
function figOpen() {
  const D = 7, w = 1000, h = 560;
  const pop = history({
    date: "Fri 13 Nov · 09:41", ago: "now", counts: "12 tabs · 5 Claude Code · 2 Codex · 2 nvim", diff: "same as now",
    restore: "Nothing to restore", restoreOn: false, thumb: 1,
    cards: [web()],
  });
  const panes =
    paneBox(160, 80, 400, 470, "agents · checkout refactor", claudeBody(400, 470, "Refactor the checkout flow")) +
    paneBox(568, 80, 422, 470, "agents · flaky e2e tests", claudeBody(422, 470, "Why does cart.spec fail?"));
  const body =
    G(herdr(w, h, { spaces: [{ name: "web-app", color: "#22a99a" }, { name: "infra", color: "#e3814f" }, { name: "docs-site", color: "#957fb8" }], tabs: ["agents", "editor", "server"], panes }), {}) +
    R(0, 0, w, h, { rx: 10, fill: "#000", cls: "dimmer", op: 0.35 }) +
    `<g class="pop"><g clip-path="url(#popclip)">${G(pop.s, { x: 280, y: 44 })}</g></g>` +
    `<clipPath id="popclip"><rect x="270" y="40" width="460" height="${h - 44}"/></clipPath>` +
    G(R(0, 0, 162, 44, { rx: 10, fill: "#1d2127", stroke: C.line2 }) +
      [["Ctrl", 12, 40], ["⇧ Shift", 60, 58], ["O", 126, 24]].map(([k, x, kw]) => R(x, 9, kw, 26, { rx: 5, fill: C.chip, stroke: C.line2 }) + T(x + kw / 2, 26, k, { size: 12, w: 600, fill: C.fg, anchor: "middle" })).join("") +
      "", { x: 170, y: h - 66, cls: "keys" });
  const css =
    kf("keys", D, "0%,8%{opacity:0;transform:translateY(8px)}14%,40%{opacity:1;transform:translateY(0)}48%,100%{opacity:0;transform:translateY(0)}") +
    kf("pop", D, "0%,18%{opacity:0;transform:translateY(-14px)}26%,84%{opacity:1;transform:translateY(0)}92%,100%{opacity:0;transform:translateY(-8px)}") +
    kf("dimmer", D, "0%,18%{opacity:0}26%,84%{opacity:.35}92%,100%{opacity:0}");
  return svg(w, h, "Ctrl+Shift+O opens the History as a popup over any layout", body, css, ".keys{opacity:0}");
}

// ======================================================================================
// 2. The window, part by part
function figWindow() {
  const D = 14, w = 1020, h = 700, X = 60, Y = 30;
  const win = history({
    date: "Thu 12 Nov · 19:37", ago: "yesterday", counts: "12 tabs · 5 Claude Code · 2 Codex · 2 nvim", diff: "+1 tab  +1 space  1 to restart",
    restore: "Restore 4", thumb: 0.78,
    cards: [web({ a: { tick: true }, b: { tick: true }, c: { tick: true, mark: "↻" } }), infra({ missing: true, chips: ["1 Codex"], p: { tick: true, mark: "+" } })],
  });
  const parts = [
    ["The save", "Its date, how long ago, what ran then, and how it", "differs from now.", 40, 46, 62],
    ["Restore · Pin · Events", "Restore what is ticked. Pin keeps a save forever.", "Events: what changed since the save before.", 104, 108, 30],
    ["Search", "Part of a conversation, tab, space or folder:", "jumps to the newest save that has it.", 142, 146, 30],
    ["Timeline", "How busy each moment was; ▲ marks a restart.", "The slider snaps to saves; ← → step, ⇧ a day.", 180, 186, 92],
    ["Spaces, tabs and panes", "A card per space. Tick what to bring back.", "Click a pane for its folder, branch, conversation.", 290, 296, 300],
    ["Marks", "↻ restarts in place · ~ runs something else now", "+ closed since · no mark: same as now", 540, 410, 20],
  ];
  let body = G(win.s, { x: X, y: Y });
  const slot = 100 / parts.length;
  let css = "";
  parts.forEach(([title, l1, l2, ry, hy, hh], i) => {
    const cy = 60 + i * 104, bx = i === 5 ? X + W + 20 : X - 22, by = i === 5 ? Y + 490 : Y + hy + 10;
    // the outline on the window
    const box = i === 5 ? R(X + W - 50, Y + 425, 26, 135, { rx: 6, stroke: C.accent, sw: 1.5 }) : R(X + 6, Y + hy - 4, W - 12, hh + 8, { rx: 8, stroke: C.accent, sw: 1.5 });
    body += G(box, { cls: `hl${i}` });
    body += G(
      R(0, 0, 400, 86, { rx: 10, fill: "#1a1d22", stroke: C.line, cls: `bg${i}` }) +
      `<circle cx="26" cy="28" r="12" fill="${C.chip}" stroke="${C.line2}"/>` + T(26, 32, String(i + 1), { size: 12, w: 700, fill: C.accent, anchor: "middle" }) +
      T(48, 33, title, { size: 15, w: 600 }) + T(48, 54, l1, { size: 12, fill: C.muted }) + T(48, 71, l2, { size: 12, fill: C.muted }),
      { x: 580, y: cy - 20 });
    body += G(`<circle cx="${bx}" cy="${by}" r="9" fill="${C.accent}"/>` + T(bx, by + 4, String(i + 1), { size: 10.5, w: 700, fill: C.win, anchor: "middle" }));
    const a = i * slot, b = (i + 1) * slot - 1.5;
    css += kf(`hl${i}`, D, show(a + 1, b));
    css += kf(`bg${i}`, D, `0%,${Math.max(0, a - 0.5)}%{stroke:${C.line}}${a + 1}%,${b}%{stroke:${C.accent}}${b + 1.5}%,100%{stroke:${C.line}}`);
  });
  return svg(w, h, "The History window, part by part", body, css, parts.map((_, i) => `.hl${i}{opacity:0}`).join(""));
}

// ======================================================================================
// 3. The timeline: drag back, the window follows the save under the slider
function figTimeline() {
  const D = 16, w = 1000, h = 700, X = 40, Y = 30;
  const phases = [
    { thumb: 1, date: "Fri 13 Nov · 09:41", ago: "now", counts: "11 tabs · 4 Claude Code · 1 Codex · 2 nvim", diff: "same as now", restore: "Nothing to restore", restoreOn: false,
      cards: [web(), infra({ p: {} })], say: ["Now", "The newest save is the same as what runs.", "Nothing to restore."] },
    { thumb: 0.9, date: "Fri 13 Nov · 07:58", ago: "2h ago", counts: "11 tabs · 4 Claude Code · 1 Codex · 2 nvim", diff: "1 to restart", restore: "Restore 1",
      cards: [web({ c: { tick: true, mark: "↻" } }), infra({ p: {} })], say: ["2 hours ago", "nvim ran in the editor tab; it is a", "bare shell now, so it can restart there."] },
    { thumb: 0.5, date: "Thu 12 Nov · 19:37", ago: "yesterday", counts: "12 tabs · 5 Claude Code · 2 Codex · 2 nvim", diff: "+1 tab  +1 space  1 to restart", restore: "Restore 4",
      cards: [web({ a: { tick: true }, b: { tick: true }, c: { tick: true, mark: "↻" } }), infra({ missing: true, p: { tick: true, mark: "+" } })], say: ["Yesterday, before the restart ▲", "The infra space was open, with its", "Codex conversation. Restore brings it back."] },
    { thumb: 0.2, date: "Sat 7 Nov · 18:02", ago: "6 days ago", counts: "6 tabs · 2 Claude Code · 1 nvim", diff: "+1 tab  2 to restart", restore: "Restore 3",
      cards: [web({ a: { tick: true, mark: "~" }, b: { tick: true, mark: "~" }, c: { tick: true, mark: "↻" } })], say: ["Last week", "Older saves thin out to one a day", "for 30 days. Pins never go."] },
  ];
  const slot = 100 / phases.length;
  let body = "", css = "";
  phases.forEach((p, i) => {
    const win = history({ ...p, thumb: null });
    body += G(G(win.s, { x: X, y: Y }), { cls: `ph${i}` });
    body += G(T(0, 0, p.say[0], { size: 22, w: 600 }) + T(0, 34, p.say[1], { size: 14, fill: C.muted }) + T(0, 56, p.say[2], { size: 14, fill: C.muted }), { x: 560, y: 120, cls: `ph${i}` });
    const a = i * slot + 1, b = (i + 1) * slot;
    css += kf(`ph${i}`, D, i === 0 ? `0%,${b}%{opacity:1}${b + 0.8}%,97.6%{opacity:0}98.4%,100%{opacity:1}` : i === phases.length - 1 ? `0%,${a - 0.8}%{opacity:0}${a}%,97.6%{opacity:1}98.4%,100%{opacity:0}` : show(a, b, 0.8));
  });
  // the slider thumb, moved by a pointer, over every phase
  const tx = (t) => X + 16 + (W - 32) * t;
  const stops = phases.map((p, i) => [i * slot, tx(p.thumb)]);
  const thumbFrames = stops.map(([at, x], i) => {
    const prev = i === 0 ? stops[0][1] : stops[i - 1][1];
    return i === 0 ? `0%,${slot - 4}%{transform:translateX(${x}px)}` : `${at - 4}%{transform:translateX(${prev}px)}${at + 1}%,${at + slot - 4}%{transform:translateX(${x}px)}`;
  }).join("") + `97.6%{transform:translateX(${stops[3][1]}px)}98.4%,100%{transform:translateX(${stops[0][1]}px)}`;
  body += `<g class="thumb"><circle cx="0" cy="${Y + 224}" r="7" fill="${C.accent}"/><circle cx="0" cy="${Y + 224}" r="12" fill="${C.accent}" opacity="0.18"/>${G(cursor(""), { x: 2, y: Y + 228 })}</g>`;
  css += `.thumb{transform:translateX(${stops[3][1]}px)}` + kf("thumb", D, thumbFrames);
  // the steps at the bottom
  body += phases.map((p, i) => G(R(0, 0, 90, 4, { rx: 2, fill: C.line }) + R(0, 0, 90, 4, { rx: 2, fill: C.accent, cls: `ph${i}` }) + T(0, 22, p.ago, { size: 11, fill: C.dim }), { x: 560 + i * 100, y: 620 })).join("");
  const reduced = [0, 1, 3].map((j) => `.ph${j}{opacity:0}`).join("") + `.ph2{opacity:1}.thumb{transform:translateX(${tx(phases[2].thumb)}px)}`;
  return svg(w, h, "Moving the slider back through the saves", body, css, reduced);
}

// ======================================================================================
// 4. Restore: press Restore, a line is typed into the bare shell, the closed space comes back
function figRestore() {
  const D = 12, w = 1100, h = 600;
  const before = history({
    date: "Thu 12 Nov · 19:37", ago: "yesterday", counts: "12 tabs · 5 Claude Code · 2 Codex · 2 nvim", diff: "+1 space  1 to restart",
    restore: "Restore 2", restoreCls: "rbtn", compact: true,
    cards: [web({ c: { tick: true, mark: "↻" } }), infra({ missing: true, p: { tick: true, mark: "+" } })],
  });
  const after = history({
    date: "Thu 12 Nov · 19:37", ago: "yesterday", counts: "12 tabs · 5 Claude Code · 2 Codex · 2 nvim", diff: "same as now",
    restore: "Nothing to restore", restoreOn: false, compact: true,
    cards: [web(), infra({ p: {} })],
  });
  const PX = 500, PW = 590, pw = PW - 170;
  const l1 = "cd ~/code/web-app/src && nvim src/cart.ts";
  const shellPane = paneBox(160, 80, pw, 220, "editor · zsh",
    prompt(12, 46, "~/code/web-app") + typedLine(12, 66, l1, "t1") + R(12, 54, 8, 15, { fill: C.accent, cls: "caret" }), { cls: "hb" });
  const nvimPane = paneBox(160, 80, pw, 220, "editor · nvim src/cart.ts", nvimBody(pw, 220), { cls: "ha" });
  const lazy = paneBox(160, 308, pw, 202, "editor · lazygit", gitBody(pw, 202));
  const ws = herdr(PW, 520, {
    spaces: [{ name: "web-app", color: "#22a99a" }, { name: "docs-site", color: "#957fb8" }, { name: "infra", color: "#e3814f", cls: "newsp" }],
    tabs: ["agents", "editor"], active: 1, panes: shellPane + nvimPane + lazy,
  });
  const toast = G(R(0, 0, 300, 58, { rx: 8, fill: "#1d2127", stroke: C.line2 }) + clock(12, 12, C.accent) + T(34, 24, "History", { size: 12, w: 600 }) + T(12, 44, "Restarted 1 pane · opened 1 space", { size: 12, fill: C.muted }), { x: PX + PW - 314, y: 474, cls: "toast" });
  const body =
    G(G(before.s, { cls: "hb" }) + G(after.s, { cls: "ha" }), { x: 30, y: 40 }) +
    G(ws, { x: PX, y: 40 }) + toast + `<g class="ptr">${cursor("")}</g>`;
  const [hb, ha] = swap(50, 52);
  const css =
    kf("ptr", D, "0%{transform:translate(380px,420px);opacity:0}6%{opacity:1}18%,24%{transform:translate(90px,166px);opacity:1}30%{opacity:1}36%,100%{transform:translate(120px,250px);opacity:0}") +
    kf("rbtn", D, "0%,20%{opacity:1}21.5%,23%{opacity:.6}24.5%,100%{opacity:1}") +
    typed("t1", D, 26, 46, l1.length * CW) +
    kf("caret", D, "0%,26%{transform:translateX(0)}46%,100%{transform:translateX(" + (l1.length * CW + 2) + "px)}", { timing: `steps(${l1.length},end)` }) +
    kf("hb", D, hb) + kf("ha", D, ha) +
    kf("newsp", D, "0%,54%{opacity:0;transform:translateX(-10px)}58%,95%{opacity:1;transform:translateX(0)}96.8%,100%{opacity:0}") +
    kf("toast", D, "0%,60%{opacity:0;transform:translateY(8px)}64%,92%{opacity:1;transform:translateY(0)}95%,100%{opacity:0}");
  return svg(w, h, "Restore types a restart line into a bare shell and reopens a closed space", body, css, ".hb,.ptr{opacity:0}");
}

// ======================================================================================
// 5. After a reboot: running, the restart, bare shells, the lines typed, running again
function figReboot() {
  const D = 16, w = 1000, h = 620, PW = 920, pw = (PW - 170 - 8) / 2, x2 = 160 + pw + 8;
  const codexBody = (bw, bh, title) => claudeBody(bw, bh, title, "› Codex", C.muted);
  const lines = [
    ["cd ~/code/web-app/src && claude --resume 7f3c2a", 160, 80, 250, "agents · checkout refactor", (bw, bh) => claudeBody(bw, bh, "Refactor the checkout flow")],
    ["cd ~/code/web-app && codex resume 019a3f", x2, 80, 250, "agents · flaky e2e tests", (bw, bh) => codexBody(bw, bh, "Why does cart.spec fail?")],
    ["cd ~/code/web-app/src && nvim src/cart.ts", 160, 338, 182, "editor · nvim src/cart.ts", nvimBody],
    ["npm run dev", x2, 338, 182, "server · npm run dev", (bw) => bars(12, 40, [[0, bw * 0.5, "#4c5a48"], [0, bw * 0.7], [0, bw * 0.35], [0, bw * 0.6]])],
  ];
  let running = "", shells = "", after = "", css = "";
  lines.forEach(([cmd, x, y, ph, title, draw], i) => {
    running += paneBox(x, y, pw, ph, title, draw(pw, ph));
    const tab = title.split(" · ")[0];
    if (i < 3) {
      shells += paneBox(x, y, pw, ph, `${tab} · zsh`, prompt(12, 46, "~/code/web-app") + typedLine(12, 66, cmd, `ty${i}`));
      const a = 52 + i * 6;
      css += typed(`ty${i}`, D, a, a + 10, cmd.length * CW);
      after += paneBox(x, y, pw, ph, title, draw(pw, ph));
    } else {
      const idle = paneBox(x, y, pw, ph, `${tab} · zsh`, prompt(12, 46, "~/code/web-app") + R(130, 34, 8, 15, { fill: C.accent }));
      shells += idle; after += idle;
    }
  });
  const ws = (panes, cls) => G(herdr(PW, 530, {
    spaces: [{ name: "web-app", color: "#22a99a" }, { name: "docs-site", color: "#957fb8" }],
    tabs: ["agents", "editor", "server"], active: 0, panes,
  }), { x: 40, y: 30, cls });
  const steps = [["running", 0, 24], ["restart", 25, 34], ["bare shells", 35, 51], ["restarting", 51, 72], ["back", 73, 97]];
  const body =
    ws(running, "s0") + ws(shells, "s2") + ws(after, "s3") +
    G(R(0, 0, PW, 530, { rx: 10, fill: "#07080a" }) + T(PW / 2, 250, "▲", { size: 28, fill: C.red, anchor: "middle" }) + T(PW / 2, 290, "The computer restarts", { size: 18, w: 600, anchor: "middle" }) + T(PW / 2, 314, "Herdr's terminal service starts again, and every pane is a bare shell", { size: 13, fill: C.muted, anchor: "middle" }), { x: 40, y: 30, cls: "s1" }) +
    G(R(0, 0, 330, 62, { rx: 8, fill: "#1d2127", stroke: C.line2 }) + clock(12, 12, C.accent) + T(34, 24, "History · after the restart", { size: 12, w: 600 }) + T(12, 46, "Restarted 3 panes · left alone: npm run dev", { size: 12, fill: C.muted }), { x: 40 + PW - 344, y: 30 + 530 - 76, cls: "toast" }) +
    steps.map(([l], i) => G(R(0, 0, 150, 3, { rx: 1.5, fill: C.line }) + R(0, 0, 150, 3, { rx: 1.5, fill: i === 1 ? C.red : C.accent, cls: `st${i}` }) + T(0, 18, l, { size: 11, fill: C.dim }), { x: 40 + i * 166, y: 578 })).join("");
  css += kf("s0", D, "0%,24%{opacity:1}24.6%,98.4%{opacity:0}99.2%,100%{opacity:1}") + kf("s1", D, show(25, 34, 1)) + kf("s2", D, show(35, 72, 0.6)) +
    kf("s3", D, "0%,72.4%{opacity:0}73%,97.6%{opacity:1}98.4%,100%{opacity:0}") +
    kf("toast", D, "0%,76%{opacity:0;transform:translateY(8px)}79%,95%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}") +
    steps.map(([, a, b], i) => kf(`st${i}`, D, show(a, b, 0.6))).join("");
  return svg(w, h, "After a reboot, each pane's agent or program restarts where it ran", body, css, ".s0,.s1,.s2,.st0,.st1,.st2,.st3{opacity:0}.s3,.st4{opacity:1}");
}

const figs = { "fig-open.svg": figOpen, "fig-window.svg": figWindow, "fig-timeline.svg": figTimeline, "fig-restore.svg": figRestore, "fig-reboot.svg": figReboot };
for (const [f, make] of Object.entries(figs)) { writeFileSync(join(OUT, f), make()); console.log("wrote docs/assets/" + f); }
