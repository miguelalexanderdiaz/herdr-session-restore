// SPDX-License-Identifier: Apache-2.0
// session-restore: saves what every pane runs (agent conversations, nvim, lazygit, ...),
// brings it back after a reboot or crash, and lets you go back to an earlier save.
//
// Two copies of this mod run:
//   props.role === "background"  a hidden floating block: saves every minute, restores after a restart
//   otherwise                    the History panel: timeline, tree compared with now, Restore
// They meet through files in <app home>/session-restore/ and shared "session-restore.rev".

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Slider, SliderState, SliderTrack, SliderIndicator, SliderThumb } from "gpui-base";
import { spaces, panes, terminals, machines, hc, exec, home, appHome, props, shared, setShared, notify, theme } from "herdr";
import * as fs from "fs/promises";
import * as L from "./logic.mjs";

const HOME = "mods/session-restore"; // the one place the folder name is written
const REV = "session-restore.rev";
// Space colors a layout may keep in shared "space.colors" (names below, or a hex); otherwise one is picked from the theme.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const OVERLAY_H = 640; // the popup's height, as mod.json says
const STEPS = 1000; // slider resolution; the value is a timeline position, snapped to a save

export default class SessionRestore extends View {
  init(_props, cx) {
    this.dir = `${appHome()}/session-restore`;
    this.index = []; this.snaps = new Map(); this.pins = new Set(); this.state = {};
    if (props()?.role === "background") return this.initBackground(cx);

    this.handle = cx.focus_handle();
    this.sel = null; this.unticked = new Set(); this.showEvents = false; this.detail = null; this.prompts = new Map();
    this.rev = undefined; this.busy = false; this.query = "";
    this.slider = SliderState.new({ min: 0, max: STEPS, step: 1, value: STEPS });
    this.slider.on("change", (v, cx) => { this.pick(L.nearest(this.index, v / STEPS, Date.now()), cx, false); });
    this.slider.on("release", (_v, cx) => this.snapSlider(cx));
    this.search = InputState.new({ placeholder: "Find a conversation, tab or folder" });
    this.search.on("change", (_e, cx) => { this.query = this.search.value().trim().toLowerCase(); this.find(cx); });
  }

  // ---------- files ----------

  async readJson(name, fallback) {
    try { return JSON.parse(await fs.readFile(`${this.dir}/${name}`, "utf8")); } catch { return fallback; }
  }
  async writeJson(name, value) {
    await fs.writeFile(`${this.dir}/${name}`, JSON.stringify(value));
  }
  async loadAll() {
    try { await fs.mkdir(this.dir, { recursive: true }); } catch {}
    this.index = (await this.readJson("index.json", [])).sort((a, b) => a.at - b.at);
    this.pins = new Set(await this.readJson("pins.json", []));
    this.state = await this.readJson("state.json", {});
  }
  async snap(file) {
    if (!this.snaps.has(file)) this.snaps.set(file, L.upgrade(await this.readJson(file, null)));
    return this.snaps.get(file);
  }

  // ---------- what runs now ----------

  async coreStart() {
    try { const s = JSON.parse((await hc(["server", "status"])).stdout); return Date.now() - s.uptime_ms; } catch { return null; }
  }
  ready() {
    return machines().find((m) => m.name === null)?.layout === "ready" && panes().length > 0;
  }
  // The live state as a snapshot. Only panes that aren't a bare shell need `hc get`.
  async gather(coreStart) {
    const ps = panes(), labels = new Map(terminals().map((t) => [t.address, t.labels ?? {}])), programs = new Map();
    for (const p of ps) {
      if (!p.terminal || p.terminal.includes("/") || p.program?.shell) continue;
      let fg = null, rec = null;
      try { fg = JSON.parse((await hc(["get", p.terminal])).stdout).foreground; } catch {}
      programs.set(p.terminal, L.program(p, fg, await this.conversation(p, fg, labels.get(p.terminal) ?? {})));
    }
    return L.buildSnapshot({ spaces: spaces(), panes: ps, programs, at: Date.now(), coreStart });
  }

  // What is known about an agent's conversation: {id, title} or null. A hook may label the
  // terminal (`session-restore.session`, `session-restore.title`) for any agent; Claude Code
  // also keeps a record per process, read without any setup.
  async conversation(p, fg, labels) {
    if (!(p.program?.agent || p.app)) return null;
    if (p.program?.key === "claude" && fg?.pid) {
      try { const r = JSON.parse(await fs.readFile(`${home()}/.claude/sessions/${fg.pid}.json`, "utf8")); if (r.sessionId) return { id: r.sessionId, title: r.name ?? null }; } catch {}
    }
    const id = labels["session-restore.session"] ?? labels["claude.session"];
    return id ? { id, title: labels["session-restore.title"] ?? null } : null;
  }

  // ---------- background copy ----------

  initBackground(cx) {
    cx.spawn(async (cx) => {
      await this.loadAll();
      this.last = this.index.length ? await this.snap(this.index.at(-1).file) : null;
      for (;;) {
        try { await this.tick(cx); } catch (e) { console.log(`session-restore: ${e?.message ?? e}`); }
        await cx.sleep(L.SAVE_EVERY_MS);
      }
    });
  }

  async tick(cx) {
    if (!this.ready()) return;
    const coreStart = await this.coreStart();
    if (coreStart == null) return;
    // The terminal service started again since the last restore: a reboot, a crash, a logout.
    if (this.state.restoredFor == null || Math.abs(coreStart - this.state.restoredFor) > 60_000) await this.afterRestart(cx, coreStart);
    const now = await this.gather(coreStart);
    if (L.sameState(now, this.last)) return;
    const file = L.fileName(now.at);
    await fs.writeFile(`${this.dir}/${file}`, JSON.stringify(now));
    this.last = now;
    this.index.push({ file, at: now.at, coreStart, counts: L.summarize(now), text: L.searchText(now) });
    const gone = new Set(L.prune(this.index, now.at, this.pins));
    for (const f of gone) { try { await fs.unlink(`${this.dir}/${f}`); } catch {} }
    this.index = this.index.filter((e) => !gone.has(e.file));
    await this.writeJson("index.json", this.index);
    setShared(REV, now.at);
  }

  // Bring back what ran in each pane at the last save before the restart. Two passes: some
  // terminals come back a little after the window does. A pane is typed into at most once.
  async afterRestart(cx, coreStart) {
    const before = L.autoRestore(this.index, coreStart);
    const sent = new Set(), names = [];
    let manual = [];
    if (before) {
      const old = await this.snap(before.file);
      for (let pass = 0; old && pass < 2; pass++) {
        await cx.sleep(pass ? 10_000 : 3_000);
        const plan = L.autoActions(old, await this.gather(coreStart));
        manual = plan.manual;
        for (const a of plan.actions) {
          if (sent.has(a.terminal)) continue;
          const r = await hc(["send", a.terminal, L.restartLine(a)]);
          if (r.code === 0) { sent.add(a.terminal); names.push(a.cmd.split(" ")[0]); }
        }
      }
    }
    this.state.restoredFor = coreStart;
    await this.writeJson("state.json", this.state);
    if (names.length || manual.length) {
      const counts = Object.entries(names.reduce((m, n) => ({ ...m, [n]: (m[n] ?? 0) + 1 }), {})).map(([n, c]) => `${c} ${n}`).join(", ");
      notify({
        title: names.length ? `Restored ${counts}` : "Nothing restarted",
        body: manual.length ? `Not restarted (not on the allowlist): ${manual.join(" · ")}. History has the save.` : `From the save of ${L.when(before.at)}.`,
        level: "success", icon: `${HOME}/clock.svg`,
      });
    }
  }

  // ---------- History panel ----------

  async refresh(cx) {
    const following = !this.sel || this.sel.file === this.latestFile; // on the newest save: stay on the newest
    await this.loadAll();
    const latest = this.index.at(-1) ?? null;
    this.latestFile = latest?.file;
    if (following || !this.index.some((e) => e.file === this.sel.file)) this.sel = latest;
    this.nowSnap = await this.gather(null); // what runs now, not the newest save (up to a minute old)
    if (this.sel) { await this.snap(this.sel.file); await this.prev(); this.slider.set_value(Math.round(L.position(this.sel.at, Date.now()) * STEPS)); }
    cx.notify();
  }
  async prev() {
    const i = this.index.findIndex((e) => e.file === this.sel?.file);
    if (i > 0) await this.snap(this.index[i - 1].file);
  }
  pick(entry, cx, moveSlider = true) {
    if (!entry || entry.file === this.sel?.file) return;
    this.sel = entry; this.unticked = new Set(); this.detail = null;
    if (moveSlider) this.slider.set_value(Math.round(L.position(entry.at, Date.now()) * STEPS));
    cx.spawn(async (cx) => { await this.snap(entry.file); await this.prev(); cx.notify(); });
    cx.notify();
  }
  snapSlider(cx) {
    if (this.sel) this.slider.set_value(Math.round(L.position(this.sel.at, Date.now()) * STEPS));
    cx.notify();
  }
  step(by, cx) {
    const i = this.index.findIndex((e) => e.file === this.sel?.file);
    this.pick(this.index[Math.max(0, Math.min(this.index.length - 1, i + by))], cx);
  }
  // Day jumps: the newest save of the day before / after the selected one.
  stepDay(by, cx) {
    const day = (at) => new Date(at).toDateString(), cur = this.sel?.at ?? Date.now();
    const list = by < 0 ? [...this.index].reverse().filter((e) => e.at < cur && day(e.at) !== day(cur)) : this.index.filter((e) => e.at > cur && day(e.at) !== day(cur));
    this.pick(list[0], cx);
  }
  find(cx) {
    if (!this.query) return cx.notify();
    const hit = [...this.index].reverse().find((e) => e.text?.includes(this.query));
    if (hit) this.pick(hit, cx); else cx.notify();
  }
  async togglePin(cx) {
    if (!this.sel) return;
    if (this.pins.has(this.sel.file)) this.pins.delete(this.sel.file); else this.pins.add(this.sel.file);
    await this.writeJson("pins.json", [...this.pins]);
    cx.notify();
  }
  // The last thing asked in a Claude Code conversation, from its prompt history on this machine.
  async lastPrompt(session, cx) {
    if (!session || this.prompts.has(session)) return;
    this.prompts.set(session, "…");
    let found = "";
    try {
      const lines = (await fs.readFile(`${home()}/.claude/history.jsonl`, "utf8")).split("\n");
      for (let i = lines.length - 1; i >= 0 && !found; i--) {
        if (!lines[i].includes(session)) continue;
        try { const o = JSON.parse(lines[i]); if (o.sessionId === session) found = String(o.display ?? ""); } catch {}
      }
    } catch {}
    this.prompts.set(session, found || "(no prompt found)");
    cx.notify();
  }

  async restore(cx) {
    if (this.busy || !this.sel) return;
    this.busy = true; cx.notify();
    try {
      const rows = L.compare(await this.snap(this.sel.file), await this.gather(null));
      const { actions, manual } = L.plan(rows, (k) => !this.unticked.has(k));
      let newSpace = null, done = 0;
      const doJson = async (cmd, args) => { const r = await exec("herdr-app", ["do", cmd, JSON.stringify(args)]); return r.code === 0 ? JSON.parse(r.stdout || "{}") : null; };
      for (const a of actions) {
        if (a.type === "restart") { if ((await hc(["send", a.terminal, L.restartLine(a)])).code === 0) done++; continue; }
        const [first, ...rest] = a.panes, start = (p) => (p.argv ? { argv: p.argv } : {});
        let made;
        if (a.newSpace) { made = await doJson("space.new", { name: a.newSpace.name, folder: first?.cwd ?? a.newSpace.folder, tab: a.name, ...start(first) }); newSpace = made?.space ?? null; }
        else made = await doJson("tab.new", { space: a.sameNewSpace ? newSpace : a.space, folder: first?.cwd, name: a.name, ...start(first) });
        if (!made) continue;
        done++;
        // shortcut: extra panes stack below the new one; the saved split shape isn't known to mods.
        for (const p of rest) await doJson("terminal.open", { folder: p.cwd, place: "down", ...start(p) });
      }
      notify({
        title: done ? `Restored ${done} item${done > 1 ? "s" : ""} from ${L.when(this.sel.at)}` : "Nothing to restore",
        body: manual.length ? `Opened as a shell, run by hand: ${manual.join(" · ")}` : undefined,
        level: done ? "success" : "info", icon: `${HOME}/clock.svg`,
      });
    } finally { this.busy = false; cx.notify(); }
  }

  // ---------- drawing ----------

  render(cx) {
    if (props()?.role === "background") return div();
    const t = theme(), rev = shared(REV);
    if (rev !== this.rev) { this.rev = rev; cx.spawn((cx) => this.refresh(cx)); }
    // As a popup (any layout) the window sizes to its content, so it gets a height of its own.
    const root = v_flex().id("history").size_full().min_h(0).when(Boolean(props()?.overlay), (el) => el.h(OVERLAY_H)).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border)
      .text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_size_change((size, cx) => { this.size = size; cx.notify(); })
      .on_mouse_down("left", () => this.handle.focus())
      .on_key_down((e, cx) => {
        const k = e.keystroke ?? "";
        if (k === "left") this.step(-1, cx); else if (k === "right") this.step(1, cx);
        else if (k === "shift-left") this.stepDay(-1, cx); else if (k === "shift-right") this.stepDay(1, cx);
      });
    if (!this.index.length || !this.sel) {
      return root.child(this.title(t)).child(div().p(16).text_color(t.muted).child("No saves yet. The first one is made within a minute of opening Herdr."));
    }
    const now = Date.now(), sel = this.sel, snap = this.snaps.get(sel.file), latest = this.nowSnap;
    const rows = snap && latest ? L.compare(snap, latest) : [];
    const { actions } = L.plan(rows, (k) => !this.unticked.has(k));
    const c = sel.counts ?? {}, apps = Object.entries(c.apps ?? {}).map(([n, k]) => `${k} ${n}`);
    const isLatest = sel.file === this.index.at(-1).file;
    return root
      .child(this.title(t))
      .child(v_flex().px(14).gap(2)
        .child(h_flex().gap(8).items_center()
          .child(div().font_semibold().text_size(15).child(L.when(sel.at)))
          .child(div().text_color(t.dim).text_size(12).child(isLatest ? "latest save" : L.ago(sel.at, now)))
          .when(this.pins.has(sel.file), (el) => el.child(div().text_color(t.accent).text_size(12).child("pinned"))))
        .child(div().text_color(t.muted).text_size(12).child([`${c.tabs ?? 0} tabs`, ...L.agentCounts(c.agents), ...apps].join(" · ")))
        .child(div().text_size(12).text_color(actions.length ? t.done : t.dim).child(L.diffLine(rows))))
      .child(this.footer(t, actions.length))
      .when(this.showEvents, (el) => el.child(this.eventList(t)))
      .child(div().px(14).pt(2).child(h_flex().h(30).rounded(8).px(10).items_center().border_1().border_color(t.border)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(this.search).w_full().text_size(12).text_color(t.foreground))))
      .child(this.timeline(t, now))
      .child(this.tree(t, rows));
  }

  title(t) {
    return h_flex().px(14).pt(12).pb(8).gap(8).items_center()
      .child(svg(`${HOME}/clock.svg`).size(14).text_color(t.muted))
      .child(div().font_semibold().text_size(13).child("History"))
      .child(div().flex_1())
      .child(div().text_color(t.dim).text_size(11).child(`${this.index.length} saves`));
  }

  timeline(t, now) {
    const width = Math.max(10, Math.floor(((this.size?.width ?? 360) - 28) / 7));
    const { bars, marks } = L.strip(this.index, now, width);
    const cell = (i) => {
      const entry = L.nearest(this.index, (i + 0.5) / width, now);
      return v_flex().id(`cell-${i}`).flex_1().items_center().cursor_pointer().on_click((_e, cx) => this.pick(entry, cx))
        .child(div().text_size(11).text_color(t.muted).child(bars[i] === " " ? "·" : bars[i]))
        .child(div().text_size(9).h(10).text_color(t.blocked).child(marks[i]));
    };
    const span = (this.size?.width ?? 360) - 28;
    const tick = (label, ms) => div().absolute().top(0).left(Math.round(L.position(now - ms, now) * span) - 10).text_size(10).text_color(t.dim).child(label);
    const restarts = L.beforeRestarts(this.index).slice(-3).reverse();
    return v_flex().px(14).pt(12).gap(4)
      .child(h_flex().w_full().children(Array.from({ length: width }, (_, i) => cell(i))))
      .child(Slider.new(this.slider).child(SliderTrack.new(this.slider).flex().items_center().h(20).w_full().child(
        SliderIndicator.new(this.slider).relative().w_full().h(4).rounded(2).bg(t.border)
          .range_style((fill) => fill.rounded(2).bg(t.accent))
          .child(SliderThumb.new(this.slider).id("thumb").size(14).rounded(7).bg(t.accent).ml(-7)))))
      .child(div().relative().h(14).w_full()
        .child(tick("30d", 30 * 86400_000)).child(tick("7d", 7 * 86400_000)).child(tick("48h", 48 * 3600_000)).child(tick("6h", 6 * 3600_000))
        .child(div().absolute().top(0).right(0).text_size(10).text_color(t.dim).child("now")))
      .when(restarts.length > 0, (el) => el.child(h_flex().gap(6).flex_wrap().children(restarts.map((e) =>
        div().id(`before-${e.file}`).px(7).py(2).rounded(6).border_1().border_color(t.border).text_size(11).text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.pick(e, cx))
          .child(`▲ before restart ${L.when(e.at, { day: false })}`)))));
  }

  tree(t, rows) {
    const glyph = { same: "=", stopped: "↻", changed: "~", missing: "+" };
    const color = { same: t.dim, stopped: t.done, changed: t.muted, missing: t.done };
    const icon = (p) => p.icon ? (p.tint ? svg(p.icon).size(13).flex_none().text_color(t.muted) : image(p.icon).w(13).h(13).flex_none()) : div().w(13).flex_none();
    const tickBox = (key, on) => div().id(`tick-${key}`).size(12).flex_none().rounded(3).border_1().border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { if (this.unticked.has(key)) this.unticked.delete(key); else this.unticked.add(key); cx.stop_propagation(); cx.notify(); });
    // A pane: icon, what it runs, where. The state mark only shows when it differs from now.
    const paneRow = (p, tab) => {
      const key = `pane:${p.terminal}`, restorable = p.state === "stopped" && p.prog.kind !== "shell";
      const shellRow = p.prog.kind === "shell";
      const name = shellRow ? (p.label || "shell") : L.progName(p.prog);
      const open = this.detail === key, tick = tab.missing ? `tab:${tab.id}` : key;
      return v_flex()
        .child(h_flex().id(`row-${key}`).h(26).pl(6).pr(8).gap(8).items_center().rounded(5).cursor_pointer().hover((s) => s.bg(t.hover))
          .when(open, (el) => el.bg(t.selected))
          .on_click((_e, cx) => { this.detail = open ? null : key; if (p.prog.agent === "claude") this.lastPrompt(p.prog.session, cx); cx.notify(); })
          .when(restorable || tab.missing, (el) => el.child(tickBox(tick, !this.unticked.has(tick))))
          .child(icon(p))
          .child(div().flex_1().min_w(0).truncate().text_color(shellRow ? t.muted : t.foreground).child(name))
          .child(div().max_w(130).truncate().text_size(11).text_color(t.dim).child((p.cwd ?? "").replace(home(), "~").split("/").slice(-2).join("/")))
          .when(p.state !== "same", (el) => el.child(div().px(5).rounded(4).text_size(11).font_semibold().bg(t.hover).text_color(color[p.state]).child(glyph[p.state]))))
        .when(open, (el) => el.child(this.paneDetail(t, p)));
    };
    // A tab: its name, then its panes hanging off a guide line.
    const tabBlock = (tb) => v_flex().mt(4)
      .child(h_flex().h(20).pl(4).gap(6).items_center().text_size(11).text_color(tb.missing ? t.done : t.dim)
        .child(div().font_semibold().child(tb.name)).when(tb.missing, (el) => el.child(div().child("· closed since"))))
      .child(v_flex().ml(10).pl(6).border_l_1().border_color(tb.missing ? t.done : t.border).children(tb.panes.map((p) => paneRow(p, tb))));
    // A space: a card with the sidebar's letter badge and color, and what it runs.
    const colors = shared("space.colors") ?? {};
    const card = (s) => {
      const c = colors[s.id], accent = typeof c === "string" ? (c.startsWith("#") ? c : (MARK[c] ?? t[c] ?? t.accent)) : L.badgeColor(s.id, [t.ansi6, t.ansi3, t.ansi4, t.ansi5, t.ansi2, t.ansi1]);
      const all = s.tabs.flatMap((tb) => tb.panes), apps = all.filter((p) => p.prog.kind === "app").length;
      const agents = L.agentCounts(L.summarize({ spaces: [s] }).agents);
      const changed = s.missing || s.tabs.some((tb) => tb.missing || tb.panes.some((p) => p.state !== "same"));
      return v_flex().mx(10).mt(10).rounded(8).overflow_hidden().border_1().border_color(s.missing ? t.done : changed ? t.input : t.border).bg(t.surface)
        .child(h_flex().h(34).px(10).gap(8).items_center().bg(t.raised).border_b_1().border_color(t.border)
          .child(h_flex().size(18).flex_none().rounded(5).bg(accent).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...s.name][0]?.toUpperCase() ?? "?"))
          .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(13).child(s.name))
          .when(s.missing, (el) => el.child(div().text_size(11).text_color(t.done).child("closed since")))
          .children(agents.map((a) => div().px(6).py(1).rounded(4).bg(t.hover).text_size(10.5).text_color(t.muted).child(a)))
          .when(apps > 0, (el) => el.child(div().px(6).py(1).rounded(4).bg(t.hover).text_size(10.5).text_color(t.muted).child(`${apps} app${apps > 1 ? "s" : ""}`))))
        .child(v_flex().px(6).pt(2).pb(8).children(s.tabs.map(tabBlock)));
    };
    return v_flex().id("history-tree").flex_1().min_h(0).mt(6).pb(10).overflow_y_scrollbar().border_t_1().border_color(t.border).children(rows.map(card))
      .child(div().px(14).pt(10).text_size(11).text_color(t.dim).child("↻ can restart   ~ different now   + closed since   (unmarked: same as now)"));
  }

  paneDetail(t, p) {
    const line = (k, v) => h_flex().gap(8).child(div().w(52).flex_none().text_color(t.dim).child(k)).child(div().flex_1().min_w(0).child(v));
    const rows = [line("folder", (p.cwd ?? "").replace(home(), "~"))];
    if (p.branch) rows.push(line("branch", p.branch));
    if (p.prog.kind === "agent") {
      rows.push(line("agent", p.prog.label));
      rows.push(line("chat", p.prog.title || "(no name)"));
      rows.push(line("id", p.prog.session ?? "unknown: comes back as a shell"));
      if (p.prog.session && !p.prog.auto) rows.push(line("", "no resume command known for this agent"));
      if (p.prog.agent === "claude") rows.push(line("last ask", this.prompts.get(p.prog.session) ?? "…"));
    } else if (p.prog.kind === "app") {
      rows.push(line("runs", p.prog.cmd));
      if (!p.prog.auto) rows.push(line("", "not on the allowlist: comes back as a shell"));
    }
    return v_flex().ml(30).mr(12).mb(4).p(8).gap(3).rounded(6).bg(t.surface).text_size(11).text_color(t.muted).children(rows);
  }

  eventList(t) {
    const i = this.index.findIndex((e) => e.file === this.sel.file);
    const prev = i > 0 ? this.snaps.get(this.index[i - 1].file) : null, list = L.events(prev, this.snaps.get(this.sel.file) ?? { spaces: [] });
    return v_flex().mx(14).mb(8).p(8).gap(2).rounded(6).bg(t.surface).text_size(11).text_color(t.muted)
      .child(div().text_color(t.dim).child(i > 0 ? `Since ${L.when(this.index[i - 1].at)}` : "The first save"))
      .children((list.length ? list : ["no changes"]).slice(0, 12).map((x) => div().truncate().child(x)));
  }

  footer(t, count) {
    const button = (id, label, on, action) => div().id(id).px(10).h(28).flex().items_center().rounded(7).text_size(12).cursor_pointer()
      .when(on, (el) => el.bg(t.solid).text_color(t.solid_foreground)).when(!on, (el) => el.border_1().border_color(t.border).text_color(t.muted).hover((s) => s.bg(t.hover)))
      .on_click(action).child(label);
    return h_flex().px(14).pt(10).pb(8).gap(8).items_center()
      .child(count > 0
        ? button("restore", this.busy ? "Restoring…" : `Restore ${count}`, true, (_e, cx) => cx.spawn((cx) => this.restore(cx)))
        : div().px(10).h(28).flex().items_center().rounded(7).text_size(12).border_1().border_color(t.border).text_color(t.dim).child("Nothing to restore"))
      .child(button("pin", this.pins.has(this.sel.file) ? "Unpin" : "Pin", false, (_e, cx) => cx.spawn((cx) => this.togglePin(cx))))
      .child(button("events", this.showEvents ? "Hide events" : "Events", false, (_e, cx) => { this.showEvents = !this.showEvents; cx.notify(); }))
      .child(div().flex_1())
      .child(div().text_size(11).text_color(t.dim).child("← → · ⇧ day"));
  }
}
