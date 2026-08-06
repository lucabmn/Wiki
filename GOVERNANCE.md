# Governance

Wiki is a small project with a small maintainer group. This document says how
decisions get made and how releases work, so contributors know what to expect
before they invest time — not to impose more process than the project's size
warrants.

## Roles

**Users** run the software. Bug reports, deployment feedback and documentation
corrections from operators are treated as first-class contributions; most of the
operational hardening in this repository started as somebody's incident.

**Contributors** open pull requests. No agreement to sign and no membership to
apply for: see [CONTRIBUTING.md](CONTRIBUTING.md).

**Maintainers** have commit access, review and merge pull requests, and cut
releases. They are listed in [MAINTAINERS.md](MAINTAINERS.md), which is also the
list `.github/CODEOWNERS` draws on.

## How decisions are made

Day-to-day, by the reviewing maintainer: if a change is in scope, tested and
does not alter a documented contract, one approval is enough to merge.

Changes that need broader agreement — at least two maintainers, and a design
discussion in an issue _before_ the pull request:

- a breaking change to the API surface, the export format, or the database
  schema,
- a new runtime dependency or a new container in the compose stack,
- anything that changes a security or privacy default,
- adding or removing a maintainer,
- the licence.

Disagreements are settled by discussion in the open. Where that fails, the
maintainers decide by simple majority; a tie means the change does not land. The
bar is deliberately conservative: this is software people put their
organization's knowledge into, and reverting a bad default after it has shipped
is much more expensive than not shipping it.

## Scope

Wiki is a **self-hosted, single-host, organization-scoped wiki**. That framing
decides most feature questions:

- In scope: anything an operator or a team of writers needs on one host.
- Out of scope by default: multi-region deployment, horizontal scaling of the
  collaboration service beyond the documented Redis path, and anything that
  requires a hosted service the operator cannot run themselves.

A proposal outside that scope is not rejected out of hand, but it has to argue
why the project should grow to include it.

## Releases and versioning

Releases are tagged `vMAJOR.MINOR.PATCH` and follow
[Semantic Versioning](https://semver.org). While the major version is `0`, the
minor version carries breaking changes — `0.x → 0.(x+1)` may break,
`0.x.y → 0.x.(y+1)` may not.

What "breaking" means here — the contracts the project treats as public:

| Public contract                                  | Breaking change means                                                |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| REST surface (`/v1/**`) and its OpenAPI document | removing or renaming a route, field, or accepted value               |
| Space and page **export format**                 | anything an existing archive would no longer round-trip              |
| Environment variables                            | removing one, or changing its default in a way that alters behaviour |
| Database schema                                  | a migration that is not reversible by restoring a backup             |
| Docker compose service names and volume names    | a rename that orphans an existing deployment's data                  |

The RPC surface (`/rpc`) is **not** a public contract: it is generated from the
same router for this repository's own clients, and it changes with them.

Every release is published from a tag by
[.github/workflows/release.yml](.github/workflows/release.yml), which refuses to
publish a tag that is not an ancestor of `main`. Each release carries installer
binaries with SHA-256 checksums, an SBOM, and build provenance attestations;
container images are published to GHCR with attestations of their own. See
[Verifying a release](DEPLOY.md#verifying-a-release).

## Breaking-change policy

A breaking change lands only with all four of:

1. an issue discussing it, agreed by at least two maintainers,
2. an entry in [CHANGELOG.md](CHANGELOG.md) under **Breaking**, naming what
   breaks and what to do about it,
3. upgrade instructions in `DEPLOY.md` where an operator has to act,
4. a deprecation period of at least one minor release **where one is possible** —
   the old name keeps working and warns. Where it is not possible (a security
   default that is wrong), the changelog says so explicitly.

Security fixes are exempt from the deprecation period, never from the changelog.

## Supported versions

Fixes go to `main` and the latest release. Older releases are not patched — a
self-hosted instance is expected to track releases. See
[SECURITY.md](SECURITY.md).

## Becoming a maintainer

There is no application. A contributor with a track record of merged,
well-scoped changes and useful reviews is invited by an existing maintainer and
confirmed by a second. Maintainers who have been inactive for a year move to
emeritus in MAINTAINERS.md; this is bookkeeping, not a judgement, and it
reverses on request.
