# Fortemate Choice

Standalone Svelte 5 + TypeScript + Vite client for the two-pair Dice Chess experiment.

- Keep source, comments, commits, issues and pull requests in English.
- Work on a feature branch. Stage explicit filenames, never `git add .` or `git add -A`.
- Do not merge PRs, publish releases, deploy, or change the live pilot without explicit owner approval.
- Every source read must first pass `sonar analyze secrets <path>`; do not read a flagged file.
- This public repository must not contain private infrastructure names, live origins, seat
  capabilities, private snapshots, credentials or backups. Use loopback fixtures and placeholders.
- Preserve variant/protocol/dice identifiers, browser storage keys, invitation fragments and the
  first-frame WebSocket authentication contract. Display-name changes are not wire migrations.
- The server is authoritative. Keep the rules engine pinned and do not implement new chess rules here.
- Run `mise exec -- npm ci`, install hooks with `mise exec -- lefthook install`, then run
  `npm run check`, `npm test`, `npm run build` and `npm run test:e2e` as appropriate.
- The ordinary built artifact remains `dist-laboratory/`; the optional Cloudflare preview uses
  `.cloudflare/output/v0/`. There is no automatic public deployment workflow.
- Issues use native GitHub Types and the Fortemate Engineering project. Follow the
  `github-issue-workflow` skill for triage, relationships and metadata read-back.
- Delegate routine inventory/configuration/test work when its specification is complete; keep
  architecture, contract and deployment decisions with the supervising agent and owner.
