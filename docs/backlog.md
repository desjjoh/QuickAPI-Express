# Technical backlog

[Documentation index](../README.md#documentation)

This backlog contains remaining hardening work for QuickAPI-Express, scaled to the application's existing scope. Remove completed entries; describe implemented behavior and verification boundaries in the relevant guides instead.

The backlog was reorganized against commit `cdd04ca` on 2026-10-25. Recheck the implementation and evidence before starting each item. Passing CI does not establish protection for paths it does not exercise.

## Scope and order

Finish the system/server review first, then begin business/API contract work. Keep repository-level checks separate from deployment-owned verification; record unavailable deployment evidence explicitly rather than treating local tests as proof.

Harden existing HTTP policies, persistence infrastructure, diagnostics, release checks, and item operations. New business features, authentication, audit-history functionality, queues, and provider integrations are outside this roadmap. Review behavior changes before implementation.

## 1. System/server logic

### Repository hardening

| Area                                 | Current gap                                                                                                                                       | Follow-up and completion criteria                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows favicon report (conditional) | Another review reported a favicon unit-test 500 on Windows; focused tests passed in this checkout, and Linux CI passed. The cause is unconfirmed. | Investigate if the failure recurs. Capture checkout, working directory, asset presence, and underlying file error before changing behavior. Add a regression only after identifying a reproducible cause. |

### Deployment verification

These checks require the actual deployment or hosted release configuration. They are not all repository code changes.

- Configure the release environment and registry permissions, then verify the first GitHub dry run and publication record. Local candidate/registry proof does not establish hosted permissions.
- Verify the real ingress trust boundary, client IP resolution, and browser CORS behavior.
- Verify authorized diagnostics/metrics access, public denial, and direct-port denial.
- Exercise orchestrator traffic withdrawal, termination grace, and database failover/recovery.
- Verify deployment CA/DNS settings, certificate rotation, and total database connection capacity across instances.
- Establish log access/retention, dashboard compatibility, and backup restoration evidence.
- Decide whether the deployment requires shared rate limiting; current enforcement is process-local.

Before moving to business/API work, resolve or explicitly defer the repository gaps and record which deployment checks passed, remain unavailable, or need deployment-owner action. The conditional favicon report does not require a speculative fix.

See [deployment](deployment.md), [database lifecycle](database-lifecycle.md), [database settings](database-settings.md), [logging](logging.md), and [rate limiting](rate-limiting.md) for current contracts. Request expiry observed before the shared pre-commit check causes transaction rollback after outstanding work settles. A response or acquisition deadline does not cancel running SQL; expiry racing an already-started commit can still leave committed data without a successful response.

## 2. Business/API logic

Start this work after the system/server review. These items intentionally change item contracts and need separate discussion before implementation.

### Agreed direction and decisions still required

- Add a numeric item `version` and require `expected_version` for PUT, PATCH, and DELETE. Updates must atomically compare the expected revision and advance it once; stale requests return `409` without mutation. Deletion must atomically compare the expected revision before removing the row.
- Use `expected_version` in update bodies. Decide its DELETE transport before implementation: the current middleware rejects DELETE bodies. Document the chosen transport and client migration explicitly.
- Start optional `Idempotency-Key` support with POST item creation. Extend to other mutations only after defining a concrete replay benefit and contract for each operation.
- Define idempotency scope for this public API before implementation. NestJS's authenticated-actor scope cannot be copied unchanged; do not introduce authentication or use an IP address as client identity implicitly.
- Keep concurrency and replay protection independent. Versions prevent stale writes; idempotency prevents duplicate execution. An identical completed keyed retry replays its original response without another mutation or version increment.
- Revision requirements are an intentional request/response contract change, requiring migrations, OpenAPI updates, client coordination, and rollback planning.

### Item mutation and query safety

| Area                                     | Current gap                                                                                                                                                                                       | Follow-up and completion criteria                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Item revisions                           | Items have timestamps but no revision. Services perform transactional lookups and writes, but there is no atomic stale-write condition.                                                           | Add and backfill numeric revisions. Enforce atomic revision checks for every update/delete writer; define missing/deleted-target outcomes and accepted no-op updates. Test simultaneous edits, update/delete races, stale requests, and rollback. Do not rely on an automatically incremented column alone as proof of stale-write rejection.                                                          |
| Request idempotency                      | There is no durable claim, request fingerprint, or replay store. Retrying creation can create another item.                                                                                       | Implement opt-in POST creation replay with validated opaque keys, an explicit public-API scope, request fingerprints, original status/body replay, conflicting-payload and in-flight conflict behavior, expiry, and cleanup. Coordinate across API instances using persistence, not an in-memory map. Test concurrent duplicates, lost-response retries, restart/replay, failure rollback, and expiry. |
| Replay transaction and response snapshot | Manager-based mutation transactions exist, but no replay record participates in them. Update rereads the row within its transaction after saving; there is no durable original-response snapshot. | Build on the existing transactional response-validation boundary. Commit the item and validated replay snapshot together using the same manager. Return/replay the accepted operation's representation, not a projection of later item state. Test replay-record failures without partial commits.                                                                                                     |
| Data and query contracts                 | Price validation and MySQL decimal storage need an explicit precision/rounding contract. Pagination orders by one potentially non-unique column.                                                  | Agree price precision, coercion, and rounding behavior before changing validation. Add deterministic pagination tie-breaking and consistent validation/error contracts. Test equal sort values, boundary prices, and invalid inputs. Document limits of offset pagination under concurrent writes.                                                                                                     |

For keyed operations, a completed identical retry returns the original response snapshot, not a projection of the current item. A changed payload under the same unexpired key must conflict. Failed validation or a rolled-back transaction must not leave a successful replay record. Expiry and physical cleanup are separate concerns; define retention and bound response storage.

### Migration upgrade and rollback evidence

Fresh-schema migration validation does not establish upgrades over existing data, backfill correctness, or compatible rollback. Add this evidence alongside the revision/replay migrations, when their schemas and contracts are defined:

- Exercise upgrades against representative existing rows; verify data preservation, defaults/backfills, and required indexes.
- Define deployment ordering and compatibility. Older writers that ignore revision checks must not silently coexist with the enforced concurrency contract.
- Document and test the supported rollback strategy. A destructive down migration is not automatically a safe application rollback.

## Verification and release boundaries

Require CI for the exact candidate commit and evidence for its actual production image. Distinguish passed, failed, skipped, and unavailable checks. Disposable CI infrastructure does not establish deployment-owned conditions.

Add focused regression evidence alongside each change. Update the API, development, testing, and deployment guides with implementation changes. Keep this file limited to remaining work; remove an entry when its completion criteria are met.
