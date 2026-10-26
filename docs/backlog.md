# Technical backlog

[Documentation index](../README.md#documentation)

This backlog contains remaining hardening work for QuickAPI-Express, scaled to the application's existing scope. Remove completed entries; describe implemented behavior and verification boundaries in the relevant guides instead.

The backlog was reorganized against commit `cdd04ca` on 2026-10-25. Recheck the implementation and evidence before starting each item. Passing CI does not establish protection for paths it does not exercise.

## Scope and order

Finish the system/server review first, then begin business/API contract work. Keep repository-level checks separate from deployment-owned verification; record unavailable deployment evidence explicitly rather than treating local tests as proof.

Harden existing HTTP policies, persistence infrastructure, diagnostics, release checks, and item operations. New business features, authentication, audit-history functionality, queues, and provider integrations are outside this roadmap. Review behavior changes before implementation.

## 1. System/server logic

### Hosted release verification

- Verify the manual `workflow_dispatch` dry-run path from `main` without publication. Automatic release publication and effective registry permissions have been verified against retained GitHub evidence; see [hosted release evidence](releases.md#hosted-verification-evidence). The manual dry-run path has not yet been exercised in the available run history.

### Deployment verification — deferred until hosting is chosen

The application currently runs only in local Docker. The user deferred the following checks on 2026-10-25 until a hosted environment exists. They require that environment and its operations configuration; they are not outstanding application implementation work.

- Verify the real ingress trust boundary, client IP resolution, and browser CORS behavior.
- Verify authorized diagnostics/metrics access, public denial, and direct-port denial.
- Exercise orchestrator traffic withdrawal, termination grace, and database failover/recovery.
- Verify deployment CA/DNS settings, certificate rotation, and total database connection capacity across instances.
- Establish log access/retention, dashboard compatibility, and backup restoration evidence.
- Future shared rate limiting: retain the current process-local limiter. Redis is the agreed future direction when deployment-wide enforcement is needed; defer implementation until then. Preserve rolling-window behavior and define Redis outage behavior, bounded storage/expiry, configuration, and multi-instance tests before switching.

Revisit the deferred deployment checks when hosting is selected. Local Docker and disposable CI results do not establish production ingress, access control, failover, or backup restoration.

See [deployment](deployment.md), [database lifecycle](database-lifecycle.md), [database settings](database-settings.md), [logging](logging.md), and [rate limiting](rate-limiting.md) for current contracts. Request expiry observed before the shared pre-commit check causes transaction rollback after outstanding work settles. A response or acquisition deadline does not cancel running SQL; expiry racing an already-started commit can still leave committed data without a successful response.

## 2. Business/API logic

Start this work after the system/server review. These items intentionally change item contracts and need separate discussion before implementation.

### Agreed direction and decisions still required

- Start optional `Idempotency-Key` support with POST item creation. Extend to other mutations only after defining a concrete replay benefit and contract for each operation.
- Define idempotency scope for this public API before implementation. NestJS's authenticated-actor scope cannot be copied unchanged; do not introduce authentication or use an IP address as client identity implicitly.
- Keep concurrency and replay protection independent. Versions prevent stale writes; idempotency prevents duplicate execution. An identical completed keyed retry replays its original response without another mutation or version increment.

### Item mutation and query safety

| Area                                     | Current gap                                                                                                                                                                                       | Follow-up and completion criteria                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request idempotency                      | There is no durable claim, request fingerprint, or replay store. Retrying creation can create another item.                                                                                       | Implement opt-in POST creation replay with validated opaque keys, an explicit public-API scope, request fingerprints, original status/body replay, conflicting-payload and in-flight conflict behavior, expiry, and cleanup. Coordinate across API instances using persistence, not an in-memory map. Test concurrent duplicates, lost-response retries, restart/replay, failure rollback, and expiry. |
| Replay transaction and response snapshot | Manager-based mutation transactions exist, but no replay record participates in them. Update rereads the row within its transaction after saving; there is no durable original-response snapshot. | Build on the existing transactional response-validation boundary. Commit the item and validated replay snapshot together using the same manager. Return/replay the accepted operation's representation, not a projection of later item state. Test replay-record failures without partial commits.                                                                                                     |

For keyed operations, a completed identical retry returns the original response snapshot, not a projection of the current item. A changed payload under the same unexpired key must conflict. Failed validation or a rolled-back transaction must not leave a successful replay record. Expiry and physical cleanup are separate concerns; define retention and bound response storage.

### Migration upgrade and rollback evidence

Fresh-schema migration validation does not establish upgrades over existing data, backfill correctness, or compatible rollback. The revision upgrade now has representative-data and offline downgrade evidence. Add equivalent evidence alongside future replay migrations when their schemas and contracts are defined:

- Exercise upgrades against representative existing rows; verify data preservation, defaults/backfills, and required indexes.
- Define deployment ordering and compatibility. Preserve the existing revision enforcement when adding replay state; old writers that bypass the contract must not coexist with new writers.
- Document and test the supported rollback strategy. A destructive down migration is not automatically a safe application rollback.

## Verification and release boundaries

Require CI for the exact candidate commit and evidence for its actual production image. Distinguish passed, failed, skipped, and unavailable checks. Disposable CI infrastructure does not establish deployment-owned conditions.

Add focused regression evidence alongside each change. Update the API, development, testing, and deployment guides with implementation changes. Keep this file limited to remaining work; remove an entry when its completion criteria are met.
