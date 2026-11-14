# Hosting decision and six-month worksheet

**Decision: use Cloudflare Workers Static Assets with a small Worker for the client preview.** This is a client-hosting choice only: the existing Scala/JVM API and its protocol remain separate and unchanged. Do not use Cloudflare Pages for this preview.

This selects a target for an isolated preview; it does not authorize deployment, DNS changes, or live-pilot changes.

Cloudflare lists requests served as static assets as free and unlimited, with no additional asset-storage charge. The small Worker must check native assets first, then serve the app shell only for an explicit allowlist of verified client navigation routes. Every other missing resource or unknown path must return `404`; do not use the default SPA fallback, which can return `200` for unmatched paths. Send HTML, fallback, and error responses with `Cache-Control: no-store`, and apply the chosen security and privacy headers consistently to HTML, static assets, and errors. Worker invocations count separately from static-asset requests: the Free plan includes 100,000 Worker requests per day and 10 ms CPU time per invocation. Requests over the Free limit can receive `429` responses; sustained use beyond it requires an owner decision about a paid plan. No Cloudflare credits are assumed. [Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), [SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/), [Workers pricing and limits](https://developers.cloudflare.com/workers/platform/pricing/)

## Six-month frontend cost worksheet

Prices checked 2026-11-14. AWS Amplify’s standard rates below are the comparable cash-cost estimate before tax or any private credits. The scenario assumes each month has 100 build minutes, a 0.1 GB stored build, and 1 GB served.

| AWS Amplify line item |  Monthly use |   Standard rate |     Monthly estimate |   Six-month estimate |
| --------------------- | -----------: | --------------: | -------------------: | -------------------: |
| Builds                |  100 minutes |    $0.01/minute |                $1.00 |                $6.00 |
| CDN storage           | 0.1 GB-month | $0.023/GB-month |              $0.0023 |              $0.0138 |
| Data transfer         |         1 GB |        $0.15/GB |                $0.15 |                $0.90 |
| **Total**             |              |                 | **$1.1523 (~$1.15)** | **$6.9138 (~$6.91)** |

The account is eligible for AWS credits, but its balance and exact expiry are account-private and are omitted here. Credits may reduce eligible bills; they are not a six-month free-hosting guarantee. The current AWS Free Plan ends before the six-month review horizon. AWS says a Free Plan ends at six months or when credits run out, whichever comes first, and then the account closes unless upgraded. Continuing with Amplify after that point requires an owner-approved Paid Plan. [Amplify pricing](https://aws.amazon.com/amplify/pricing/), [AWS Free Tier plan rules](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier-FAQ.html)

For Cloudflare, static-asset request and storage charges are **$0** for this scenario. Worker invocations are separately limited to 100,000 per day on the Free plan; requests beyond the limit can fail with `429`. Workers Paid is a separate plan with a $5 monthly minimum; it is not included in either provider estimate. Recheck build minutes, bundle size, transfer, Worker invocation volume, and account plan each month. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

## Preview boundary and database

Point the preview build only at a preview-specific API origin. That API must allow only the preview origin through CORS and use its own database and role; do not connect the preview to production data or enable production-origin access.

Use **PostgreSQL 18.6** for the isolated preview database. The current API already uses PostgreSQL through JDBC and relies on its existing transaction and `jsonb` behavior, so keeping PostgreSQL avoids an API/data-layer rewrite. `jsonb` is PostgreSQL’s binary JSON type with native operators and indexing. Do not substitute D1 or Durable Objects for this preview. [PostgreSQL JSON types](https://www.postgresql.org/docs/current/datatype-json.html), [pgJDBC](https://jdbc.postgresql.org/)

Hosting the client does not choose a database vendor. Any future move of the API and database to AWS should be estimated separately: RDS for PostgreSQL charges for instance hours, provisioned storage, backups, and applicable data transfer. No API or database cost is included in the frontend worksheet. [Amazon RDS for PostgreSQL pricing](https://aws.amazon.com/rds/postgresql/pricing/)
