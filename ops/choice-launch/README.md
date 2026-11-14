# Fresh-start Choice launch

This runbook prepares a separate Choice installation on a new branded origin. It does
not deploy anything. Activation follows the merged release candidate and an explicit
owner instruction. Keep the owner-only Cloudflare Access policy until the owner changes
the audience. A new address does not authorize public access.

Old pilot games, invitations and browser storage do not need migration. Start with an
empty database and new invitation links. Do not redirect old capability links, export
seat tokens or seeds, or copy browser storage. Keep old-resource retirement separate
from release activation; no command below stops the pilot or preview.

## Prepare and validate

Use the pinned [backend blueprint](../choice-preview/README.md) with a **new** project,
database volume, app/admin secret files, Tunnel and VPC Service. The blueprint's
`CHOICE_PREVIEW_*` names are intentionally retained as its configuration interface;
they must point only to the new release resources. Logical names such as
`choice-preview-data` are scoped by the explicit Compose project name, not shared with
the preview. Never reuse an existing project name or set a global `COMPOSE_PROJECT_NAME`.

On Linux/WSL, run from the repository root. These reserved examples are configuration
fixtures; put real coordinates and absolute secret-file paths in the private operator
record outside the repository. Secret files contain the values; environment variables
contain paths only.

```sh
export CHOICE_RELEASE_ORIGIN=https://choice.example.test
export CHOICE_RELEASE_VPC_SERVICE_ID=01234567-89ab-cdef-0123-456789abcdef
export CHOICE_PREVIEW_ORIGIN="$CHOICE_RELEASE_ORIGIN"
export CHOICE_PREVIEW_ADMISSION_OPEN=false
export CHOICE_PREVIEW_JOIN_WINDOW_SECONDS=300
export CHOICE_PREVIEW_APP_PASSWORD_FILE=/run/choice-example/app-password
export CHOICE_PREVIEW_DB_ADMIN_PASSWORD_FILE=/run/choice-example/admin-password
export CHOICE_PREVIEW_TUNNEL_TOKEN_FILE=/run/choice-example/tunnel-token

docker compose --project-name choice-release-example \
  --file ops/choice-preview/compose.yaml \
  --file ops/choice-launch/compose.yaml config --quiet
npm run build:release
npm run check:hosting
npm exec --no -- cf deploy --prebuilt --mode cloudflare-release \
  --no-provision --dry-run
```

Supply **both** Compose files, base first, and the same explicit new project name on
every operation. The overlay changes only restart policies to `unless-stopped`; image
pins, resource bounds, file-backed secrets, health checks and network isolation remain
in the base file. There are no published API/database ports or external shared networks.
An operator stop remains stopped across daemon restarts; a container failure restarts
the owned service. Recheck the rendered configuration before activation.

The release build selects Worker `fortemate-choice`, separately from the preview
Worker. Its private binding points only at the release VPC Service. The API's exact
`LAB_FRONTEND_ORIGIN` must equal `CHOICE_RELEASE_ORIGIN`; using the same value for
`CHOICE_PREVIEW_ORIGIN` above enforces that configuration choice. Build mode and an
origin name are not evidence that the service or database is isolated.

Record the source revision, artifact digest, project/resource identities, operating
review date, capacity/budget and rollback candidate privately. Do not infer an operating
extension from cloud credits or silently extend the existing pilot's deadline.

## Authorized activation sequence

1. Check that the chosen new hostname and Worker do not already serve another app.
   Verify the exact owned project and ensure its database volume does not exist. Create
   new protected secret files, then start only the new Compose project with admission
   closed. Verify internal API health, pinned rules version and private database access.
2. Connect its dedicated Tunnel and configure a VPC Service targeting the blueprint's
   internal `choice-preview-api` alias on port `8081`. Verify provider-side connection
   health. Do not expose a public backend hostname or host port.
3. Protect the new hostname with the owner-only Access policy **before** the first
   publication. Confirm the reviewed configuration disables `workers.dev` and
   version-preview URLs, then publish only the reviewed prebuilt artifact using the
   recorded release coordinates. Admission stays closed and the hostname is already
   protected during publication. Obtain the newly created Worker's tag and immediately
   add its **Worker destination** to the same owner-only Access application before any
   admission. Verify effective Access, hostname routing and disabled alternate endpoints
   from the provider after both steps. No unexposed registration or extra build mode is
   required to obtain the tag.
4. Confirm anonymous denial for shell, assets, API and WebSocket paths; verify authorized
   HTTPS health and bidirectional WSS with first-frame seat authentication. Preserve
   no-store/no-referrer/noindex headers and capability fragments. Workers VPC is beta:
   a build or dry run does not replace these deployed transport checks.
5. Create an encrypted baseline database backup and keep a protected off-host recovery
   copy. Restore it into another disposable, owned database and verify the schema/data
   before opening admission. Do not test recovery by replacing either live database.
6. Open admission only for the authorized acceptance session. Test new invitations, a
   complete two-player game, phone/desktop themes, one-click pairs, automatic moves,
   reconnect/restart recovery, records, export and mutual rematch. Verify source/artifact
   identity and that unrelated services are unchanged. Close admission if acceptance
   fails. Keep the owner-only Access boundary when acceptance passes.
7. Record results and final admission state. Establish the next backup/recovery and
   operating review before treating the installation as ongoing service. CI does not
   provision resources or publish releases automatically.

## Rollback and old-site retirement

For a failed first launch, close admission for the new project, disable only its
hostname/Worker route and stop only its services using both Compose files and its
recorded project name. Preserve the new database volume, backup and records; there is
no earlier release artifact to restore. Leave the existing pilot and preview untouched.

For later client updates, retain the previous compatible artifact before publishing.
Restore that artifact on the same new origin if its acceptance fails. This does not
restore old data or point the release at a pilot/preview database. If the installation
must be stopped, use the same new-project-only procedure. Do not use volume-removing
shutdown.

After successful new-site acceptance, retire old resources only through a separate
operation naming their exact project, routes and resource identities. Preserving old
game links is unnecessary, but that is not blanket authorization to delete database
volumes, backups or unrelated services. No redirect, automatic old-site shutdown or
donor-source cleanup is part of this release configuration.
