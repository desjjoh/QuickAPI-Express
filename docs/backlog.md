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
- Follow the [pass-1 idempotency contract](idempotency.md): explicit public scope by operation/route, validated-input fingerprints, original response replay, and database-clock 24-hour retention. Do not introduce authentication or infer client identity from IP.
- Keep concurrency and replay protection independent. Versions prevent stale writes; idempotency prevents duplicate execution. An identical completed keyed retry replays its original response without another mutation or version increment.

### Atomic POST idempotency and replay

Implement phases 3 and 4 together using the [shared contract and failure matrix](idempotency.md).
No endpoint is enabled yet. Remaining work is deliberately split into small passes:

- **Pass 4:** POST item opt-in with key-header handling, CORS and OpenAPI; unchanged
  unkeyed behavior.
- **Pass 5:** lifecycle-owned bounded cleanup, expiry/restart/multi-instance/failure
  evidence, complete documentation and production-image smoke.

Item mutation, validated prepared response, and replay record must commit together.
Expired records do not replay, matching retries do not extend retention, and error
or rollback paths must not leave a completed replay record. Keep reusable machinery
outside the item domain; preserve current revision and price contracts.

### Migration upgrade and rollback evidence

Fresh-schema migration validation does not establish upgrades over existing data, backfill correctness, or compatible rollback. Revision and replay-storage upgrades now have representative-data and offline downgrade evidence. Add equivalent evidence alongside future migrations:

- Exercise upgrades against representative existing rows; verify data preservation, defaults/backfills, and required indexes.
- Define deployment ordering and compatibility. Preserve the existing revision enforcement when adding replay state; old writers that bypass the contract must not coexist with new writers.
- Document and test the supported rollback strategy. A destructive down migration is not automatically a safe application rollback.

## Verification and release boundaries

Require CI for the exact candidate commit and evidence for its actual production image. Distinguish passed, failed, skipped, and unavailable checks. Disposable CI infrastructure does not establish deployment-owned conditions.

Add focused regression evidence alongside each change. Update the API, development, testing, and deployment guides with implementation changes. Keep this file limited to remaining work; remove an entry when its completion criteria are met.
