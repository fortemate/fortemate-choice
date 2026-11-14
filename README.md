# Fortemate Choice

Two dice pairs. One choice. A standalone, experimental Dice Chess client for playing with a friend, without bots or ratings.

Roll once to reveal both pairs, confirm one whole pair, then play the two dice using the existing rules. Complete legal turns are sent automatically. The client supports invitation links, reconnect, finished-game review, transcript export, and light, dark or system appearance.

## Development

Use Node.js 26.13.1 from `mise.toml`, which also provides the optional Git-hook tools. The pinned rules package `@fortemate/dicechess-engine@0.18.2` and all tooling resolve from the public npm registry. Installation requires no private package credentials.

```sh
mise trust
mise exec -- npm ci
mise exec -- lefthook install
```

Set `VITE_LAB_API_URL` to the origin of your isolated API before starting or building, for example `http://127.0.0.1:8081`. `.env.example` contains the local example. An absent or invalid origin intentionally fails the build; there is no default production backend.

```sh
mise exec -- npm run dev
mise exec -- npm run check
mise exec -- npm test
mise exec -- npm run test:coverage
mise exec -- npm run build
mise exec -- npx playwright install chromium
mise exec -- npm run test:e2e
```

`npm run build` produces `dist-laboratory/` and verifies its module boundary, theme bootstrap, privacy headers and assets. `npm run preview` serves that artifact on port 4175. Browser smoke tests use local fixtures for transport; they never contact a public API. The `*:laboratory` aliases preserve compatibility with the extracted acceptance tooling.

## Real-service acceptance

`npm run test:laboratory:pilot` uses a pinned API container and disposable PostgreSQL databases in an owned local Docker/WSL project. Start from a clean, committed checkout; the runner records and checks its source revision. It tests real API/WebSocket gameplay, invitation lifecycle, isolation, exports, backup and rollback. See [the pilot runbook](ops/laboratory-pilot/README.md) and [configuration plan](ops/laboratory-pilot/PLAN.md) for local prerequisites and explicit opt-in configuration. The broader [staged-API acceptance harness](scripts/laboratory-acceptance/README.md) is also retained, with its separately provisioned API-stage prerequisites.

The reports imported with these harnesses describe earlier donor qualifications. New extraction evidence belongs in the current PR or a separately dated report.

## Hosting preview

The [hosting decision](docs/hosting-decision.md) selects Cloudflare Workers Static Assets for the client and keeps PostgreSQL for the separate API. The [preview runbook](docs/hosting-preview.md) covers the optional native build, loopback preview and full isolated-service qualification. These checks require Linux/WSL for the Cloudflare runtime on Windows ARM. No cloud account, deployment token or public resource is needed for local qualification.

## Repository boundaries

The [Choice launch runbook](ops/choice-launch/README.md) prepares a dedicated
`cloudflare-release` build with an explicitly selected branded origin and private
API service. It starts with a new isolated database and keeps closed Access; old
laboratory games, invitation links and browser storage are not migrated. The
release Worker is separate from the preview. `npm run build:release` builds only;
CI validates reserved example coordinates without deploying or changing DNS.

Dependabot PRs run the full test and build pipeline without Sonar credentials. Their
Sonar analysis and quality gate run on `main` after merge; ordinary same-repository
PRs retain their pre-merge Sonar check. The PR author determines this boundary,
including when a maintainer reruns a bot's workflow. Skipped analysis is explicitly
reported in the CI summary. Fork PRs also receive no Sonar credentials.

The PR policy accepts only verified, same-repository Dependabot updates to root npm
manifests or GitHub Actions workflows. Other PRs still require a conventional branch
and one closing leaf issue. Run `npm run test:ci-policy` to check these boundaries.
TypeScript 7 updates are temporarily ignored until the Svelte checking toolchain is
compatible; TypeScript 6 updates and other dependency checks remain enabled.

This repository owns the client, its package lock, tests, CI and optional hosting adapter. The API, laboratory database, game rules engine and live pilot remain separate. Its workflows check PRs and main; they do not deploy anything. Public hosting activation, domain cutover and removal of the donor client require separate changes.

Keep the existing backend contract and browser storage identifiers when changing the visible brand. A future domain change needs an explicit plan for existing invitation links and seat recovery; browser storage does not move between origins.

See [UPSTREAM.md](UPSTREAM.md) and [UPSTREAM.json](UPSTREAM.json) for provenance and attribution. Application code: AGPL-3.0-only. Chess-piece artwork: GPL-2.0-or-later.
