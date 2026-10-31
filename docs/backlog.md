# Technical backlog

[Documentation index](../README.md#documentation)

This list contains unresolved follow-ups and explicitly deferred capabilities.
Implemented contracts and ongoing engineering requirements belong in the core
guides. Remove an item when its completion evidence is established.

## Manual release qualification

Confirm a successful manual `workflow_dispatch` dry run from `main`, without
publication. The workflow and offline gate checks are implemented; this follow-up
is qualification of the hosted manual path, not rebuilding the release system.
Check existing runs before scheduling another one and close this item if a
successful applicable run is already available.

## Deployment qualification

Deferred until a hosting environment is selected:

- Verify actual ingress/proxy trust, client-IP resolution, and browser CORS.
- Verify restricted metrics/diagnostics access and direct-port/public denial.
- Exercise traffic withdrawal, termination grace, and database outage/recovery.
- Verify deployed database CA/DNS, certificate rotation, and fleet connection sizing.
- Establish log access/retention and dashboard integration.
- Rehearse database backup restoration and compatible application rollback.

These require the deployed environment. Local Docker and disposable CI cannot
establish them. See [Deployment](deployment.md) for the implemented procedures.

## Shared rate limiting

Keep the process-local limiter until fleet-wide enforcement is required. Redis is
the intended future direction; it is not implemented. Before changing enforcement,
define outage behavior, bounded storage/expiry and configuration, preserve rolling
windows, and qualify multiple instances against the shared backend.
