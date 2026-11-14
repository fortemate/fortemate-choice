# Isolated client preview runbook

For the separately prepared branded release, use the [Choice launch runbook](../ops/choice-launch/README.md).
Its explicit release mode uses a different Worker and a fresh isolated backend;
the two preview modes below retain their existing targets and behavior.

The local commands below build and check the client preview without deployment. A separately authorized closed deployment uses the additional mode described below and the [closed backend runbook](../ops/choice-preview/README.md). Neither mode changes the live pilot.

## Requirements and API target

- Use Node.js 26.13.1 (the project requires Node.js 26.12 or newer).
- Use Linux x64 or Linux through WSL. `workerd` does not support Windows ARM.
- The pinned Cloudflare CLI is `cf@1.0.0-beta.32`, with Vite plugin `2.0.0-beta.v.17`. These are beta tools; this project does not use Wrangler.
- Set `CHOICE_PREVIEW_API_URL` explicitly before each preview build or browser run. There is no default or production fallback:
  - CI asset-preview fixture: `http://127.0.0.1:8081`.
  - Local real-API acceptance: `https://localhost:9443`.
  - A separately approved future preview: an HTTPS API hostname starting with `choice-preview-`.

For local Linux/WSL shell use, select the API intentionally, then run the needed commands:

```sh
export CHOICE_PREVIEW_API_URL=https://localhost:9443
npm ci
npm run check:hosting
npm run build:hosting
npm run preview:hosting
```

The preview server listens on loopback port `8787`. Keep it local. `build:hosting` writes Cloudflare output under `.cloudflare/output/v0/`; the existing `dist-laboratory/` output is unchanged. Use `http://127.0.0.1:8081` instead when exercising the CI fixture. The preview must never silently select an API target when the variable is absent. A hostname prefix is a build guard, not proof that its API and database are isolated.

## Checks

`npm run test:hosting` runs the isolated browser checks against the local asset preview and fixture API. They cover native asset delivery, allowed navigation fallback, `404` for missing resources and unknown routes, cache behavior, and security/privacy response headers.

The full real-service acceptance command is `npm run test:hosting:acceptance`. Run it from a clean, committed Git checkout on Linux/WSL with a local Docker Unix socket, OpenSSL, Playwright Chromium and its system dependencies installed. Ports `8443`, `9443` and `8787` must be free. The runner builds both artifacts, provisions its own real API at `https://localhost:9443` and fresh PostgreSQL 18.6 database, role and volume, then removes its resources during cleanup. It refuses existing services and shared storage. The browser journey covers invitation, phone and desktop themes, one-click rolls, automatic moves, recovery and records. Reports under `test-results/hosting-preview/` record the candidate revision, native artifact digest and redacted findings. This isolated rehearsal does not deploy or contact the live pilot.

## Routing and response policy

The Worker serves native static assets first. It may return the application shell only for the explicit allowlist of verified application navigation routes. Missing assets, API paths, and all other unknown paths return `404`; never use a catch-all shell fallback. HTML, fallback, and error responses use `Cache-Control: no-store`. Apply the approved security and privacy headers to the shell, static assets, and error responses, and keep the preview non-indexable. The local browser checks validate these response rules.

## Before any future public preview

Public hosting needs a separate owner decision and isolated preview API, database, and database role. The API must allow only the exact preview origin through CORS. If invitation links contain seat capabilities, protect access with Cloudflare Access; a preview hostname or an unlisted URL is not authentication. Keep preview data and credentials separate from production. This runbook supplies no cloud credentials, deploy procedure, DNS change, or automatic deployment workflow.

## Authorized closed deployment

`npm run build:closed-preview` selects `cloudflare-closed-preview`. It requires an HTTPS `CHOICE_PREVIEW_API_URL` whose hostname begins with `choice-preview-`, and an explicit `CHOICE_PREVIEW_VPC_SERVICE_ID`. The client and API share that origin. The Worker binds only to the selected private VPC Service; it cannot select arbitrary upstream URLs and does not expose ordinary API routes. Both alternate `workers.dev` and version-preview URLs are disabled. The operator must configure Access before attaching the custom domain and verify the effective policy afterward.

The browser includes the Access session only for an exact same-origin API target. Other origins retain credential omission. The proxy forwards only the laboratory route/method allowlist, enforces the browser origin for mutations and WebSocket upgrades, and removes Access credentials before reaching the API. Seat authentication remains in the first WebSocket frame; rematch consent retains its existing capability header. The Worker returns WebSocket upgrade responses unchanged.

Workers VPC is a beta dependency. Unit tests and a successful build do not prove remote HTTP/WebSocket connectivity: both must pass against the deployed, restricted preview before it is handed to testers. CI validates closed configuration using reserved example coordinates, without deploying or contacting a real VPC service.
