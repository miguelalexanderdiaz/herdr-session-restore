# Security

This is a Herdr mod. It does not use the network, start programs or read files outside its own folder; the one
program it runs is `hc read` on the agents that are waiting, and it stores a small record in the app's
`localStorage` (see `RECIPE.md`, "Watch out"). `node scripts/validate.mjs` checks this on the source. That is a
policy check, not a sandbox: Herdr does not sandbox mods.

## Reporting a problem

Please report a vulnerability, or a case where the mod reaches something it says it does not, through GitHub's
private reporting: on the repository page open Security, then Report a vulnerability. If that button is not
there, open an ordinary issue that says only that you have a security report, without the details, and a
maintainer will arrange a private channel. Please do not post details in public first.

Do not include terminal text from real agents, paths from your machine or any other private data in a report.
