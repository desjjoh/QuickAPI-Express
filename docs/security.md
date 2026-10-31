# Security

[Documentation index](../README.md#documentation)

## Application access boundary

The item API has no authentication, account/session system, or authorization
middleware. Every reachable client can read and mutate items subject to validation,
rate limits, revision checks, and optional replay. Those controls do not establish
an identity or grant permission. Deploy only within the intended trust boundary;
add deliberate access control before exposing operations that require it.

Item idempotency uses a public namespace. A key is not a credential; callers sharing
a scope/key share replay/conflict behavior. Keep keys opaque and free of secrets
or personal data. See [API contracts](architecture.md#api-contracts) for client behavior and
[Idempotency](architecture.md#request-idempotency-implementation) for storage, retention, and extension rules.

## Operational access

Documentation, diagnostics, and metrics are independently configurable. Their
[exposure settings](configuration.md#operational-endpoint-exposure) default to
false in production and true in development/test. Disabled routes return 404;
enabling them does not authenticate callers. Access restrictions belong to the
ingress and network policy.

Restrict enabled `/metrics`, `/info`, and `/system` at the ingress/private network
and block direct public access to the listener. Enable documentation only for the
intended audience. `/health` and `/ready` remain public probes; readiness exposes
only `ready`, `status`, and `timestamp`, not dependency identities or timings.
See [Deployment](deployment.md#operational-endpoint-access) for operator procedures.

## Browser and trusted-proxy boundaries

CORS determines which browser origins can read responses; it does not protect the
public API from other clients. Use exact origins and allow `idempotency-key` in any
custom request-header list for browser mutation retries. Browser JavaScript cannot
read `Set-Cookie` even if it appears in exposed headers.

Proxy trust defaults to empty. Only allow actual ingress IPs/CIDRs. The ingress
must overwrite client-supplied forwarding headers, and the API listener must not
provide a bypass around network restrictions. `TRUST_PROXY` establishes forwarding
trust, not caller authorization. See [Configuration](configuration.md#proxy-and-cors-configuration)
and [Deployment](deployment.md#proxy-and-browser-access).

The bounded limiter is process-local; replicas do not share quotas and the app
has no Redis dependency. Client rotation and fleet-wide policy need deployment
consideration. See [Rate limiting](security.md#rate-limiting) for capacity and failure rules.

## Sensitive data and diagnostics

Use deployment-managed database credentials and verified TLS for encrypted MySQL
connections; local Compose credentials are not production credentials. Never bake
`.env`, CA secrets, or registry credentials into an image. See
[database TLS](configuration.md#database-capacity-and-tls).

Unexpected errors return a generic 500. Logs use safe error classifications and
stack-frame fingerprints rather than raw driver messages, SQL parameters,
credentials, or arbitrary request payloads. Request correlation and metric labels
use bounded route/method values. See [Logging](deployment.md#logging-and-metrics) for the exact privacy
and metric contracts. Log access/retention and backup recovery are deployment-owned.

## Dependency and image security

Security tooling consists of dependency audit and image-check
scripts under `.github/scripts/`, separate exact exception registers under
`security/`, and retained evidence. Express blocks **critical** production
dependency/image findings by severity; high and lower findings remain visible.
Development-only dependency findings are reported separately and are nonblocking.

## Pull request and branch CI lifecycle

1. `Dependency security` installs the lockfile with implicit npm auditing disabled,
   runs the dependency/image gate regressions, and invokes `security:audit`.
2. The audit reads production and full-tree npm reports. It validates command
   status, schema/counts, installed versions, advisory chains, and exception scope.
   Only package findings whose full set of paths is marked `dev` in the lockfile
   enter the development-only summary. Mixed-scope packages are not relabeled.
3. `Production image smoke test` builds the runtime image once and resolves its
   immutable Docker image ID. Both migration and API containers use that ID. Smoke also verifies the runtime
   is non-root and excludes bundled package managers and Corepack caches.
4. After smoke succeeds, `release-check.cjs image` exports that same ID, binds the
   archive to its runtime config, and invokes Trivy for OS and Node packages.
   The scanner container reads the archive; it has no Docker socket mount.
5. Scan evidence must identify the bound runtime config. The input archive hash
   must remain unchanged, and both package inventories must be present/nonempty.
   Temporary image exports are removed after success or failure; reports remain.
6. Audit and image reports are uploaded with `if: always()` and 14-day retention.
   The `Deployment gate` requires both jobs to succeed; failure,
   cancellation, or skipped prerequisites cannot approve a candidate.

Malformed, expired, or overlong exceptions and unavailable/invalid scan evidence
block independently of vulnerability severity. Unsupported/end-of-life image OS
also fails validation. Neither audit nor image scan ignores unfixed findings.
An exception never authorizes missing evidence or scanner failure.

## Local commands

```bash
npm run test:security
npm run security:audit
npm run smoke:production
```

`test:security` uses dependency-free Node tests with synthetic npm/Trivy reports
and fake command runners. It does not contact a registry, start Docker, or access
a database. `security:audit` contacts the configured npm registry without updating
packages. It needs neither Docker nor Bash.

After smoke succeeds, scan its recorded image from Git Bash:

```bash
image_id="$(node -p "require('./.release-check/smoke-image.json').imageId")"
npm run security:image -- "$image_id" .release-check/image-security
```

Or from PowerShell, using Git Bash for the existing smoke script:

```powershell
& 'C:\Program Files\Git\bin\bash.exe' .github/scripts/ci-smoke.sh
if ($LASTEXITCODE -ne 0) { throw 'Production smoke failed' }
$image = Get-Content .release-check/smoke-image.json -Raw | ConvertFrom-Json
npm.cmd run security:image -- $image.imageId .release-check/image-security
if ($LASTEXITCODE -ne 0) { throw 'Image security blocked or unavailable' }
```

Always select the image produced by the successful smoke run. Merely having a
local record does not prove that a subsequent smoke attempt succeeded. For a
release candidate, smoke can accept `SMOKE_IMAGE=sha256:...` and use that
existing image without rebuilding. Mutable tags are rejected for this override.

Trivy defaults to `aquasec/trivy:latest`, matching Nest's scanner-update approach.
`TRIVY_SCANNER_IMAGE` may explicitly select another scanner image for CI/local
tooling; this is not application runtime configuration and is not read from `.env`.
Each run pulls the selected reference, resolves its immutable ID, and records the
actual scanner ID/version used. Cached vulnerability databases live under ignored
`.release-check/trivy-cache/`. Docker and network access are required; failure to
obtain usable scanner evidence fails the gate rather than skipping it.

## Policy, reports, and release boundary

- [Dependency exceptions](security.md#dependency-exception-policy): exact GHSA,
  package and installed versions, owner, justification, UTC expiry within 30 days.
- [Image exceptions](security.md#container-exception-policy): exact
  vulnerability/package/version/path/target/type, owner, reason, review reference,
  and UTC expiry within 30 days. Registers start empty.
- `.release-check/dependency-audit/` contains production/full audit JSON, the gate
  result with development-only findings, and a readable summary.
- `.release-check/image-security/` contains full Trivy JSON, `result.json`,
  `image.json`, and a readable summary. `.release-check/smoke-image.json` records
  the immutable image selected by smoke testing.

High/lower findings still require triage. Excepted critical findings stay visible;
updates and remediation are preferable to risk acceptance. Scan results are
time-specific and do not establish application exploitability.

These base-CI checks approve the PR/branch candidate only. The [release workflow](deployment.md#release-and-rollback)
builds a separate candidate once, attaches SBOM/provenance, repeats smoke/scanning
on that artifact, and publishes/promotes its verified digest without rebuilding.
PR success does not automatically approve a later release image. Release-time
verification reuses the same critical-only vulnerability evaluator and exception
register, including fresh validation before publication.

## Rate limiting

The default policy remains 200 requests per client in the preceding 60 seconds.
The window rolls continuously; it does not reset at calendar-minute boundaries.
Only requests admitted by the limiter add timestamps. Rejections neither append
history nor extend the client's retention time. Requests subsequently rejected by
validation, routing, or another policy still consume their admitted quota.

Each request uses Express's resolved `req.ip`, or the existing shared `unknown`
fallback if no address is available. Proxy trust follows validated `TRUST_PROXY`:
direct/untrusted peers cannot change their identity by rotating forwarding headers;
trusted peers can supply client identities according to the ingress contract.
The limiter never parses `X-Forwarded-For` itself or changes address grouping.
See [proxy deployment requirements](deployment.md#proxy-and-browser-access).

### Admission and storage lifecycle

1. Read the monotonic process clock and remove expired clients from the front of
   the store. An entry expires one window after its last admitted request.
2. Resolve client identity and hash it to a fixed-size SHA-256 key. Hashing preserves
   equality of the exact resolved string and bounds retained key size; it is not
   an authentication or anonymization guarantee.
3. For an existing client, discard timestamps at or before `now - windowMs`.
   A timestamp exactly on the cutoff no longer counts.
4. If its quota is full, return 429 without adding a timestamp or moving its entry.
5. For an unseen client, allocate a record only when capacity is available.
   Otherwise return 503; no request is admitted without tracking.
6. On admission, record the timestamp in a fixed-size circular buffer, update the
   entry's expiry, and move it to the end of the client map before continuing.

Each client buffer contains at most `RATE_LIMIT_MAX` timestamps. Because every
client uses the same window and admissions use a monotonic clock, map order is also
expiry order. Cleanup removes expired entries from the front and stops at the first
active entry; it does not scan all active clients on every request. A request after
a long idle period can reclaim multiple expired records, bounded by client capacity.

There is no background cleanup timer. During complete inactivity, expired records
may remain allocated until the next request; retained clients and timestamp slots
remain capped. Requests use only in-process state, with no asynchronous store race.

### Rejections and retry timing

Both outcomes use the existing JSON error envelope and an integer `Retry-After`
header, rounded up to seconds with a minimum of 1.

| Status | Meaning                                              | Retry calculation                                                         |
| ------ | ---------------------------------------------------- | ------------------------------------------------------------------------- |
| 429    | This client's rolling-window quota is full.          | Time until its oldest counted admission expires.                          |
| 503    | The client is unseen and the tracking store is full. | Time until the earliest retained client entry is currently due to expire. |

Existing tracked clients remain subject to their own quotas when the store is full;
they may still be admitted if they have room. Active entries are never evicted to
make space for new identities, since doing so would let rotation reset quotas.
Rejected unseen identities do not allocate records.

`Retry-After` describes current state, not a reservation: later admitted requests
can extend entry lifetimes, and other clients can occupy newly available capacity.
Clients can therefore receive another rejection when retrying. The capacity policy
favors enforcement over admitting untracked requests. Many distinct identities can
temporarily deny admission to new clients; size and monitor deployment capacity
accordingly.

## HTTP and deployment boundaries

Middleware ordering is fixed: static assets bypass the API limiter;
operational endpoints, preflights, and other API requests reaching it share the
same per-client quota without path exemptions. CORS and body
parsing remain downstream. Browser applications needing to read `Retry-After`
must explicitly include it in `CORS_EXPOSED_HEADERS`.

Each application/middleware instance owns an independent store. Restarting the
process or recreating the app resets counters. There is no Redis/shared limiter,
persisted quota, or cross-replica coordination. Multiple API processes can each
admit the configured quota for the same client. A shared deployment-wide quota
requires an explicitly configured gateway or a separately implemented shared store.

## Dependency exception policy

Base CI audits production dependencies and the full tree using npm JSON reports,
with a two-minute deadline per audit. Both reports and lockfile evidence must be
available and consistent. Registry/command failures, malformed/incomplete reports,
unknown blocking advisory identifiers, and invalid policy fail closed. Only packages
whose installed paths are all dev-only enter the nonblocking development summary;
mixed-scope findings remain production findings.

The machine register is [dependency-audit-exceptions.json](../security/dependency-audit-exceptions.json).
Each entry must specify an exact GHSA advisory, package, exact installed versions,
owner, justification, and `expires` UTC timestamp at most 30 days ahead. Wildcards
and version ranges are invalid. Expired, duplicate, malformed, unused, or mismatched
exceptions fail the gate. Exceptions cannot waive missing evidence. Review explicit
risk acceptance, prefer compatible fixes, and remove exceptions after remediation.

## Container exception policy

The machine register is [container-vulnerability-exceptions.json](../security/container-vulnerability-exceptions.json).
An entry specifies exact `vulnerabilityId`, `packageName`, `installedVersion`,
`packagePath` (null only if absent in the finding), image `target`, result `type`,
`owner`, `reason`, `review` reference, and `expiresOn` (`YYYY-MM-DD`). No wildcard is
accepted. Expiry is at 00:00 UTC on that date and must be within 30 days of evaluation.
Expired, malformed, overlong, or duplicate entries fail even without a matching finding.

Unexcepted critical findings block even when no fix exists. High/lower findings
remain visible. Missing OS/Node inventories, unsupported/end-of-life OS, invalid
reports, scanner failure, or invalid policy also block approval. No exception
removes a finding from evidence or authorizes a broken scanner. Verify affected
paths and fixes before accepting risk; never bypass the gate or globally ignore
unfixed findings to work around one package.
