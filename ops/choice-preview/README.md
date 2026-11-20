# Closed preview backend

This Compose project provides a dedicated laboratory API, PostgreSQL database, and Cloudflare Tunnel connector for a closed client preview. The API and database have no published host ports. The API is reachable only over this project's internal Docker networks; the connector is the only service with outbound network access. There is no Caddy container, shared external Docker network, or gateway service.

## Isolation and prerequisites

Use an operator-selected Compose project name, such as `choice-preview`, on every Compose operation. Do not set a global Compose project name. This scopes the named database volume and networks to this deployment. Use a dedicated, clean PostgreSQL volume and dedicated app/admin password files and tunnel-token file stored outside the repository. Never put secret values in Compose environment variables, shell history, CI variables, or this repository.

Provide these required values in the operator's local environment before using the Compose file. Set host file permissions/ACLs so Docker can read each file and the intended non-root container can read its mounted secret; keep access limited to the operator and preview services:

| Variable                                | Purpose                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `CHOICE_PREVIEW_ORIGIN`                 | Exact HTTPS origin of the approved client preview; required by the laboratory API.                         |
| `CHOICE_PREVIEW_ADMISSION_OPEN`         | Optional admission switch; defaults to `false`. Keep closed until Access and anonymous-denial checks pass. |
| `CHOICE_PREVIEW_APP_PASSWORD_FILE`      | Path to the dedicated database application-role password file.                                             |
| `CHOICE_PREVIEW_DB_ADMIN_PASSWORD_FILE` | Path to the PostgreSQL bootstrap administrator password file.                                              |
| `CHOICE_PREVIEW_TUNNEL_TOKEN_FILE`      | Path to the token file for this dedicated Cloudflare Tunnel.                                               |
| `CHOICE_DATABASE_SUBNET`                | Reserved IPv4 CIDR for this project's private database network.                                            |
| `CHOICE_EDGE_SUBNET`                    | Different reserved IPv4 CIDR for this project's internal API/connector network.                            |
| `CHOICE_CONNECTOR_SUBNET`               | Different reserved IPv4 CIDR for this project's outbound connector network.                                |

Copy [operator.env.example](operator.env.example) to a private operator file outside
the repository, then replace every fixture value. Reserve three mutually disjoint
CIDRs that do not overlap LANs, VLANs, VPNs, host routes or existing container networks.
Use different ranges for every preview and release deployment. A project name scopes
resource names; it does not reserve distinct IP ranges. Even an `internal` Docker
network adds a host route and can divert traffic intended for a real LAN.

Compose requires all three subnet values and refuses to render when one is missing.
The example ranges are fixtures, not an allocation or a guarantee that they are free
on an operator's network. Small subnets are enough for these services; allow room for
the gateway, service addresses and transient replacement containers. Record the actual
allocation privately and use the same operator file for every Compose operation.

The Compose file reads secrets through file-backed Compose secrets. The API and PostgreSQL use distinct non-root identities, read-only root filesystems, dropped Linux capabilities, `no-new-privileges`, bounded CPU/memory, and narrowly sized temporary filesystems. The API uses the pinned laboratory API image and the existing laboratory entrypoint and database initialization SQL. PostgreSQL 18.6 creates its own `laboratory` database and `laboratory_app` role. Admission defaults closed (`LAB_ADMISSION_OPEN=false`). Set `CHOICE_PREVIEW_ADMISSION_OPEN=true` only after the Access policy is active and anonymous-denial checks pass.

The API joins only the private database and internal edge networks. PostgreSQL joins only the private database network. `cloudflared` joins the internal edge network and its own outbound-capable network; its internal API alias is `choice-preview-api`. It runs as UID/GID 65532 with a read-only filesystem, no capabilities, no-new-privileges, a token file secret, and no host port. No TLS key is mounted: traffic between the Worker and API stays private HTTP through the encrypted tunnel.

## Owner-controlled activation order

1. Confirm the owner-approved preview hostname, account access policy, data-retention decision, and isolated resource budget. Do not reuse a production API, database, role, volume, tunnel, or network.
2. Create the dedicated secret files and start this Compose project under its chosen project name. Check the API health endpoint from inside the project network; do not publish an API port.
3. Associate the dedicated connector with its own Cloudflare Tunnel and verify its connection status in Cloudflare. Configure that tunnel's VPC Service to target `choice-preview-api` on port `8081`.
4. Configure the owner-approved Access policy for the preview hostname **before** publishing or attaching the hostname. A private-looking or unlisted URL is not access control.
5. Bind only the new preview Worker to the API service through the tunnel. Keep `workers.dev` and preview URLs disabled. Configure the client/API for the same preview origin and verify anonymous access is blocked. Only then, if gameplay is owner-approved, open admission with `CHOICE_PREVIEW_ADMISSION_OPEN=true` and confirm an authorized user can complete the intended game flow, including HTTP and WebSocket session behavior.
6. Record the resource identities, health/authorization results, and backup/retention choice in the owner-controlled operations record. Do not include account identifiers, tunnel tokens, public/live origins, or private host details in this repository.

This is an activation sequence, not authorization to create Cloudflare resources, publish a hostname, or change any live pilot. There are no credentials, DNS operations, or deployment commands in this document.

## Network allocation changes

Changing a subnet requires recreating the affected project's networks. Before an
owner-approved network migration, save the configuration and take a verified database
backup, stop writes to that project and preserve its existing named volume. Recreate
only that project's containers and networks with the reserved CIDRs; never use
volume-removing shutdown or cleanup. Verify the volume identity and database contents,
API health, connector transport and affected LAN routes afterwards. Update the private
deployment record and operator file so the next deployment retains the allocation.

## Shutdown and data retention

First remove or disable the preview Worker binding and hostname route under the approved Access policy. Then stop only the Compose project using the same operator-selected project name. Keep its database volume until the owner has decided the retention and backup requirements; do not use volume-removal cleanup as part of routine shutdown. Once deletion is approved, verify the project and volume identities before removing only those owned resources. Do not stop or remove unrelated containers, networks, volumes, tunnels, or account resources.
