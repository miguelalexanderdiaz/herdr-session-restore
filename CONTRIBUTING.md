# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Before a pull request

```sh
node scripts/check-local.mjs
```

That runs the structure check, the privacy scan, the documentation check, the tests, `verify-install`
on the mod, and `herdr-app check` when Herdr is installed. CI runs the same on Linux, macOS and Windows,
on Node 22 and 24.

## Rules

- **Pull request titles are Conventional Commits** (`feat: ...`, `fix: ...`, `docs: ...`). The title
  becomes the commit on `main` and the changelog line.
- **Network:** none.
  - Programs: only the `hc` and `herdr-app do` calls on the allow-lists in `scripts/modrules.mjs`.
  - Files: only the ones named in README.md.

  To reach anything new, say so in README.md and RECIPE.md first, then widen the allow-list.
- **Restore never runs a command it was not sure of.** A new program on the allowlist, or a new agent in
  `RESUME`, needs a reason and a source.
- **Numbers RECIPE.md and the docs quote are checked against the code** (`scripts/validate.mjs`,
  `scripts/check-docs.mjs`). Change both together.
- **Pure logic goes in `logic.mjs`, with a test in `tests/logic.test.mjs`.**
