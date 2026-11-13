# Notes for AI agents

For coding agents asked to install, adapt, test or edit this repository. Humans: [README.md](README.md).

## What is here

```
mods/session-restore/   the mod: main.js (saver and History), logic.mjs (pure functions), mod.json, clock.svg
hooks/                  session-restore-hook.sh: labels a Herdr terminal with an agent's conversation id
snippets/               the layout entries (floating saver, optional panel block) and a hook example
keys.json               ctrl-shift-o opens the History
install/                the one-line installer (install.sh, install.ps1, jsonedit.cjs, manifest)
docs/                   the documentation site (GitHub Pages from main /docs)
scripts/                validate, privacy-scan, check-docs, verify-install, check-local, the CI definition
tests/                  node --test: logic.test.mjs (the pure code), install.test.mjs (the installer)
```

## Installing for a person

1. Read RECIPE.md and every file in `mods/session-restore/` first. Tell the person what it reaches:
   - it runs `hc get`, `hc server status` and `hc send`;
   - it runs `herdr-app do`, only to recreate restored tabs;
   - it reads `~/.claude/sessions/` and, on demand, `~/.claude/history.jsonl`;
   - it writes `<Herdr home>/session-restore/`;
   - no network.
2. Copy `mods/session-restore/` into `<Herdr home>/mods/`. Never overwrite a different mod of the same
   name: rename this one, and its `HOME` constant in `main.js` and the `keys.json` action with it.
3. Merge `keys.json`, asking before you replace a key the person uses.
4. Add the floating entry from `snippets/layout-floating.json` to every layout the person uses. Herdr's
   own layouts are read-only: clone them first (`herdr-app do layout.clone`).
5. Run `herdr-app check <home>/mods/session-restore`, then confirm a `snap-*.json` appears within a
   minute.

## Do not break

- **`props.role === "background"`:** the saver copy. Layouts carry it.
- **The terminal label `session-restore.session`:** agent hooks write it.
- **The save format** (`v: 1`). Read older saves with `upgrade()`, never by refusing them.
- **The allowlist and `RESUME`:** add to them only with a source for the command, and update README.md,
  RECIPE.md and docs/configuration.html together.

## Test

- `node --test` with no argument (Node 22 or newer).
- `node scripts/check-local.mjs`: every CI check, plus `herdr-app check` when Herdr is installed.
- Commit titles are Conventional Commits (`feat:`, `fix:`, `docs:` ...): release-please builds the
  changelog from them.
