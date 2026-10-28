# Database transport and capacity

[Documentation index](../README.md#documentation)

## Configuration

All settings are optional and take effect after restart. Examples appear commented
out in `.env.example`, `.env`, and `.env.test`; existing active values are preserved.

| Setting                      | Default | Validation and purpose                                                                                                     |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `DB_POOL_CONNECTION_LIMIT`   | `10`    | Integer 1–1000; maximum leased/connecting connections per data source/process.                                             |
| `DB_POOL_QUEUE_LIMIT`        | `50`    | Integer 0–10000; maximum waiting acquisitions. Zero fails immediately when capacity is occupied; it never means unlimited. |
| `DB_POOL_ACQUIRE_TIMEOUT_MS` | `1000`  | Integer 1–2147483647; total caller wait for a lease, including queue time and connection setup.                            |
| `DB_CONNECT_TIMEOUT_MS`      | `10000` | Integer 1–2147483647; maximum connection setup through completion of authentication/TLS.                                   |
| `DB_SSL`                     | `false` | Exactly `true` or `false`; explicitly enable for encrypted deployments.                                                    |
| `DB_SSL_CA_FILE`             | Unset   | Nonempty readable PEM CA bundle path. Requires `DB_SSL=true`; omit to use Node's default trust roots.                      |

Empty numeric/boolean values, fractional limits, and excessive values fail environment
validation. CA files are loaded and validated when constructing database options;
an unreadable or invalid bundle fails startup with `DB_TLS_CONFIG`.
Paths are interpreted relative to the process working directory unless absolute.

Pool limits multiply by application instance count. Ten connections across five
instances can use fifty server connections, plus migration tools, administrative
clients, or other applications. Select capacity against MySQL's server limit and
leave headroom. A larger pool is not automatically faster.

## Acquisition lifecycle

The application uses mysql2's native pool for physical and idle connection ownership,
with an adapter owning the FIFO wait queue. The native queue is disabled. Application,
readiness, and CLI TypeORM data sources share the same configuration path.

1. A free slot starts acquisition. Otherwise a caller joins the bounded wait queue.
2. A full queue fails immediately with `DB_POOL_CAPACITY`.
3. Each caller's acquisition deadline starts when acquisition is requested. Expiry
   removes a queued caller and reports `DB_POOL_ACQUIRE_TIMEOUT`. Expired callers
   cannot later receive a lease or start their SQL.
4. If a new connection is being established, a separate connection timer spans the
   full handshake. mysql2's own timer stops on initial server data, so the adapter
   also covers partial greetings, authentication, and TLS stalls. Expiry reports
   `DB_CONNECT_TIMEOUT` and closes only that unleased connection's socket.
5. The first acquisition or connection deadline to expire wins. A connection arriving
   after expiry is released without executing the caller's SQL. Connecting slots stay
   accounted for until the native acquisition callback settles.
6. Successful handoff clears both timers. A per-acquisition lease releases its slot
   once on release, destruction, or fatal connection loss, then admits the next waiter.
   Releasing an old lease again cannot release a newer borrow of the same connection.

Pool saturation and acquisition/connection deadline errors use a generic HTTP 503
when propagated through the API. No `Retry-After` is guessed: a useful retry time
depends on running work finishing. Ordinary driver failures retain the existing
error mapping. Raw SQL/credentials are not returned or logged by this adapter.

**Acquisition expiry is not SQL cancellation.** After handoff, acquisition/connection
timers no longer own the lease and never terminate a running mutation. There is no
new business-query timeout or automatic write retry. An HTTP deadline or disconnect
does not establish rollback or the final database outcome. Read-only readiness
probes retain their separate owned-query cancellation behavior.

## TLS policy

With `DB_SSL=true`, connections require TLS 1.2 or newer, a trusted certificate
chain, and a DNS server identity matching `DB_HOST`. There is no verification-bypass
setting and no plaintext fallback. A private CA should be mounted into the process
and selected with `DB_SSL_CA_FILE`; never use the committed test certificates.

TLS requires a **DNS hostname**, not an IP literal. The installed mysql2 driver
skips its pre-authentication identity check for IP hosts; configuration rejects that
combination rather than checking identity after credentials have already been sent.
Use a DNS name listed in the server certificate's SAN. Local plaintext development
can continue using `127.0.0.1` with TLS off. Production defaults do not silently turn
TLS on: enable it deliberately for the deployment and configure its CA/hostname.

Example deployment overrides:

```dotenv
DB_HOST=mysql.internal.example
DB_SSL=true
DB_SSL_CA_FILE=/run/secrets/mysql-ca.pem
DB_POOL_CONNECTION_LIMIT=10
DB_POOL_QUEUE_LIMIT=50
DB_POOL_ACQUIRE_TIMEOUT_MS=1000
DB_CONNECT_TIMEOUT_MS=10000
```

Use the same settings and mounted CA for deployment migration commands. Certificate
changes require replacing the mounted file and restarting processes so new options
and pools are created. Never log CA contents or introduce credential-bearing error
messages to diagnose failures; recognized transport codes use safe diagnostics.

## Readiness, shutdown, and verification

The [database lifecycle](database-lifecycle.md) is preserved: on-demand single-flight
probes and brief result caching report outage/recovery through the application pool,
while `/health` stays independent. Startup still checks committed migration history
without applying migrations. The connection deadline is not an overall TypeORM
initialization deadline; later ORM metadata queries have their existing behavior.

Shutdown withdraws readiness and closes admission, drains accepted HTTP/handler work
and active replay cleanup, then stops readiness and destroys the data source. Pool closure rejects waiting
acquisitions and closes unfinished connection attempts. The overall shutdown
watchdog is the final bound for stuck work; pool closure follows the accepted-work
drain.

Unit tests verify queue limits, timer cleanup, late leases, idempotent release,
configuration validation, and CA loading. Real MySQL tests cover exhaustion, generic
503s, expired SQL never starting, same-pool readiness recovery, blocked mutations
surviving acquisition budgets, pool close, and silent/partial-greeting handshake
cleanup. Existing HTTP/database drain and process shutdown tests remain required.

`npm run test:database:tls` requires Docker Compose and creates its own dynamically
published, disposable MySQL service. It proves encrypted queries with a trusted CA
and matching identity, client rejection of untrusted/wrong-name certificates, and
no plaintext downgrade after invalid TLS. A test-only MySQL TLS reload exposes the
expired fixture; the client must reject its expiry while a plaintext control can
still reach that isolated server. Failure assertions check TLS error codes, so a
connection timeout cannot masquerade as successful certificate verification.
It always tears down its own project and leaves development/normal test databases
alone. CI runs this as part of the existing integration gate. Native MySQL users
can run the ordinary database suites without this additional Docker-only check.

The public TLS fixtures are test-only and expire in 2046. Deployment verification
still needs the real CA chain, DNS name, network rules, server capacity, certificate
rotation, and platform termination grace. No schema migration is added by these
transport settings, and item fields/CRUD behavior are unchanged.
