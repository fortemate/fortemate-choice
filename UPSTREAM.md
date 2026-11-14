# Source and compatibility

The imported qualification tooling also receives explicit deterministic comparators, clearer credential-key validation, a unary participant-frame predicate, and an absolute interpreter path for process startup. These address the first independent Sonar review without changing application rules or protocol behavior. CI installs locked dependencies without dependency lifecycle scripts and runs the repository's own localization preparation explicitly.

The follow-up Sonar review splits transcript validation and browser recovery into focused helpers, adds rejection/order regression tests, and concurrently reads independent assets, routes and fixture data. Concurrent fixture work settles before cleanup and keeps report order; artifact hashing keeps its original byte-sorted directory traversal. Shared game transitions, retry backoff, viewport changes and owned-service startup remain sequential.

The initial client was extracted from [fortemate/dicechess-play at d383a4109d040e39533af24653579cb783b39936](https://github.com/fortemate/dicechess-play/tree/d383a4109d040e39533af24653579cb783b39936). `UPSTREAM.json` records original SHA-256 hashes and source-to-target mappings before adaptations. It is an import inventory, not a checksum of the current working tree.

Adaptations are limited to the standalone package, tooling and documentation, the Fortemate Choice display name, three laboratory-only message catalogs, and relocation of the component-test stub. `src/lib/moveTreeWalker.ts` retains only the shared `MoveTree` interface from that revision; the ordinary site's chessground runtime walker is excluded. The artifact directory and compatibility command aliases remain unchanged for the isolated runners.

These remain compatibility identifiers:

- Variant `choice-2x2d6`, revision 1; protocol and public-export version 1.
- Dice algorithm `choice-2x2d6-hmac-sha256-v1` and rules package `0.18.2`.
- Laboratory endpoints, browser storage keys, invitation fragments, export schema and first-frame WebSocket authentication.

This extraction does not fork the engine or API. The UI keeps one-click reveal of both pairs, confirmation of the selected pair, automatic submission of a complete legal turn, and light/dark/system appearance. The server remains authoritative.

Application code is licensed under AGPL-3.0-only; see [LICENSE](LICENSE). The twelve cburnett chess-piece SVGs are by Colin M. L. Burnett, under GPL-2.0-or-later as documented in [Lichess's artwork notices](https://github.com/lichess-org/lila/blob/master/COPYING.md). They are unchanged from the donor assets; their original artwork is available on [Wikimedia Commons](https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces). The distribution includes the license and [third-party notices](THIRD_PARTY_NOTICES.md).

The copied acceptance reports and evidence are historical qualifications of the donor revision. They do not by themselves qualify this repository or authorize deployment. Run the independent checks described in [README.md](README.md) for a new revision.
