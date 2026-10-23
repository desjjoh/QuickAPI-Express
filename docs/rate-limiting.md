# Bounded rate limiting

[Documentation index](../README.md#documentation)

## Request policy

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

## Configuration

Settings are optional validated integers. Empty, nonnumeric, fractional, zero, and
negative values are rejected at startup. Direct middleware construction validates
the same policy. Restart after changing environment values.

| Variable                 | Default | Allowed range                                             |
| ------------------------ | ------- | --------------------------------------------------------- |
| `RATE_LIMIT_WINDOW_MS`   | `60000` | 1 through 86400000 milliseconds (one day).                |
| `RATE_LIMIT_MAX`         | `200`   | 1 through 10000 admitted requests per client per window.  |
| `RATE_LIMIT_MAX_CLIENTS` | `10000` | 1 through 100000 concurrently retained client identities. |

The product of the two capacity settings must not exceed **2000000 timestamp
slots**. Raising the request quota may therefore require reducing client capacity.
At the default maximum occupancy, timestamp buffers occupy 16000000 bytes
(approximately 15.3 MiB), plus client records, map/key storage, and runtime overhead.
This is a timestamp-allocation bound, not a complete process-memory limit.

## Admission and storage lifecycle

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

## Rejections and retry timing

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

Middleware ordering remains unchanged: static assets bypass the API limiter;
operational endpoints, preflights, and other API requests reaching it share the
same per-client quota. This change introduces no path exemptions. CORS and body
parsing remain downstream. Browser applications needing to read `Retry-After`
must explicitly include it in `CORS_EXPOSED_HEADERS`.

Each application/middleware instance owns an independent store. Restarting the
process or recreating the app resets counters. There is no Redis/shared limiter,
persisted quota, or cross-replica coordination. Multiple API processes can each
admit the configured quota for the same client. A shared deployment-wide quota
requires an explicitly configured gateway or a separately implemented shared store.

## Regression evidence

[Unit tests](../test/unit/rate-limit.test.ts) cover exact window boundaries,
staggered admissions and buffer reuse, sustained rejection without history growth,
many distinct identities, expiry ordering, capacity exhaustion/recovery, independent
stores, and invalid storage budgets.
[HTTP tests](../test/integration/rate-limit.test.ts) verify remaining-window retry
headers, the 429/503 distinction, tracked clients at capacity, recovery after expiry,
and untrusted forwarding. Existing
[client-identity tests](../test/integration/http-policy.test.ts) retain trusted-peer,
untrusted-peer, and independent forwarded-client coverage.
