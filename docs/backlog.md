# Technical backlog

[Documentation index](../README.md#documentation)

This backlog contains remaining hardening work for QuickAPI-Express, scaled to the application's existing scope. Remove completed entries; describe implemented behavior and verification boundaries in the relevant guides instead.

The remaining work was reviewed against commit `aa3d0a9416bcf029c3f6476678a1cc489dd98a78` on 2026-10-23. Recheck the implementation before starting each item. Passing CI does not establish protection for paths it does not exercise.

## Scope and agreed contracts

- Harden existing item operations, HTTP policies, persistence, diagnostics, and release checks. New business features, authentication, audit-history functionality, queues, and provider integrations are outside this roadmap.
- Add a numeric item `version` and require `expected_version` for PUT, PATCH, and DELETE. Updates must atomically compare the expected revision and advance it once; stale requests return `409` without mutation. Deletion must atomically compare the expected revision before removing the row.
- Use `expected_version` in update bodies. Decide its DELETE transport before implementation: the current middleware rejects DELETE bodies. Document the chosen transport and client migration explicitly.
- Start optional `Idempotency-Key` support with POST item creation. Extend to other mutations only after defining a concrete replay benefit and contract for each operation.
- Define idempotency scope for this public API before implementation. NestJS's authenticated-actor scope cannot be copied unchanged; do not introduce authentication or use an IP address as client identity implicitly.
- Keep concurrency and replay protection independent. Versions prevent stale writes; idempotency prevents duplicate execution. An identical completed keyed retry replays its original response without another mutation or version increment.
- Review other behavior changes explicitly before implementation. Revision requirements are an intentional request/response contract change, requiring migrations, OpenAPI updates, client coordination, and rollback planning.

## Packaging, tooling, and release evidence

Prioritize triage of reported dependency findings. Future mutation and upgrade evidence is tracked below. Add focused regression evidence alongside each change. Item mutation tests and representative upgrades belong with the corresponding mutation-safety implementation below.

| Area                              | Current gap                                                                                                                                                                                                                                  | Follow-up and completion criteria                                                                                                                                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nonblocking dependency advisories | After runtime remediation on 2026-10-24, the final-image scan reports high findings in `body-parser@2.3.0` and `zod@4.4.3`, with no critical findings. The separate npm audit also reports three moderate development-tool package findings. | Review compatible dependency updates and rerun relevant tests and scans. The agreed critical-only gate continues to report these findings; no exceptions or severity suppressions were added. Treat versions/counts as dated evidence rather than permanent status. |
| Windows favicon report            | Another review reported a favicon unit-test 500 on Windows; the focused tests passed in this checkout, and Linux CI passed. The cause is unconfirmed.                                                                                        | Investigate if the failure recurs. Capture checkout, working directory, asset presence, and underlying file error before changing behavior. Add a regression only after identifying a reproducible cause.                                                           |

## Migration history and upgrade safety

| Area                                 | Current gap                                                                                                                     | Follow-up and completion criteria                                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Representative upgrades and rollback | Fresh-schema migration validation does not establish upgrades over existing data, backfill correctness, or compatible rollback. | Exercise upcoming revision/replay migrations against representative existing rows. Verify data preservation, defaults/backfills, required indexes, deployment ordering, and the supported rollback strategy. Older writers that ignore revision checks must not silently coexist with the enforced concurrency contract. |

## Item mutation safety

| Area                     | Current gap                                                                                                                                                | Follow-up and completion criteria                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Item revisions           | Items have timestamps but no revision. Controllers read an entity before repository merge/save or removal, with no stale-write condition.                  | Add and backfill numeric revisions. Enforce atomic revision checks for every update/delete writer; define missing/deleted-target outcomes and accepted no-op updates. Test simultaneous edits, update/delete races, stale requests, and rollback. Do not rely on an automatically incremented column alone as proof of stale-write rejection.                                                          |
| Request idempotency      | There is no durable claim, request fingerprint, or replay store. Retrying creation can create another item.                                                | Implement opt-in POST creation replay with validated opaque keys, an explicit public-API scope, request fingerprints, original status/body replay, conflicting-payload and in-flight conflict behavior, expiry, and cleanup. Coordinate across API instances using persistence, not an in-memory map. Test concurrent duplicates, lost-response retries, restart/replay, failure rollback, and expiry. |
| Transaction ownership    | There is no application transaction boundary spanning the item write, response validation, and planned replay record. Update rereads the row after saving. | Establish explicit transaction ownership with the same transaction manager used by all participating writes. Validate and capture the response before commit, and commit the item and replay state together. Return the representation from the accepted operation rather than an unrelated later update. Test validation/persistence failures and replay-record failures without partial commits.     |
| Data and query contracts | Price validation and MySQL decimal storage need an explicit precision/rounding contract. Pagination orders by one potentially non-unique column.           | Agree price precision, coercion, and rounding behavior before changing validation. Add deterministic pagination tie-breaking and consistent validation/error contracts. Test equal sort values, boundary prices, and invalid inputs. Document limits of offset pagination under concurrent writes.                                                                                                     |

For keyed operations, a completed identical retry returns the original response snapshot, not a projection of the current item. A changed payload under the same unexpired key must conflict. Failed validation or a rolled-back transaction must not leave a successful replay record. Expiry and physical cleanup are separate concerns; define retention and bound response storage.

## Deployment verification still required

- Configure the release environment and registry permissions, then verify the first GitHub dry run and publication record. Local candidate/registry proof does not establish hosted permissions.

- Verify the real ingress trust boundary, client IP resolution, and browser CORS behavior.
- Verify authorized diagnostics/metrics access, public denial, and direct-port denial.
- Exercise orchestrator traffic withdrawal, termination grace, and database failover/recovery.
- Verify deployment CA/DNS settings, certificate rotation, and total database connection capacity across instances.
- Establish log access/retention, dashboard compatibility, and backup restoration evidence.
- Decide whether the deployment requires shared rate limiting; current enforcement is process-local.

See [deployment](deployment.md), [database lifecycle](database-lifecycle.md), [database settings](database-settings.md), [logging](logging.md), and [rate limiting](rate-limiting.md) for current contracts. A response or acquisition deadline does not cancel running SQL or establish rollback.

## Release boundaries

Require CI for the exact candidate commit and evidence for its actual production image. Distinguish passed, failed, skipped, and unavailable checks. Disposable CI infrastructure does not establish deployment-owned conditions.

Update the API, development, testing, and deployment guides with implementation changes. Keep this file limited to remaining work; remove an entry when its completion criteria are met.
