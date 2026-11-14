# Security and dependencies

Do not include seat capabilities, server seeds before terminal reveal, credentials, private room snapshots or operational backups in public reports. Report security concerns privately to the repository owner through GitHub.

The browser rules dependency is exactly pinned at `0.18.2`. All packages resolve from the public npm registry. There are no deployment credentials or deployment workflows in this repository.

The initial extraction upgrades ESLint to `10.15.0` and overrides `minimatch` to `11.0.5` to address the glob-amplification advisory GHSA-g3hv-75wg-m249 in development tooling. The rule tests, full lint run and independent CI verify that tooling combination.

On 14 November 2026, `npm audit --omit=dev` reports no vulnerabilities. Full `npm audit` reports the low-severity deepmerge prototype-poisoning advisory GHSA-gcqx-w48m-w2h4, also attributed to its Svelte Vite plugin consumer; no upstream fix is available. This dependency runs only in trusted build tooling, is absent from the shipped browser bundle, and receives repository-owned configuration rather than player data. Dependabot monitors npm and Action updates. Reassess the advisory when an upstream fix becomes available.
