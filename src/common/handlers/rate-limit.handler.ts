import { createHash } from 'node:crypto';
import {
  RateLimitPolicySchema,
  type RateLimitPolicy,
} from '@/common/library/models/rate-limit-policy.model';

type ClientWindow = {
  timestamps: Float64Array;
  head: number;
  count: number;
  expiresAt: number;
};

type Decision =
  | { allowed: true }
  | { allowed: false; status: 429 | 503; retryAfterSeconds: number };

/** One bounded rolling-window store per middleware instance; no shared enforcement. */
export class RollingWindowLimiter {
  private readonly policy: RateLimitPolicy;
  private readonly clients = new Map<string, ClientWindow>();
  private storedRequests = 0;

  constructor(
    policy: { windowMs: number; max: number; maxClients?: number },
    private readonly now: () => number = () => performance.now(),
  ) {
    this.policy = RateLimitPolicySchema.parse(policy);
  }

  public get usage() {
    return {
      clients: this.clients.size,
      storedRequests: this.storedRequests,
      timestampSlots: this.clients.size * this.policy.max,
    };
  }

  public admit(identity: string): Decision {
    const now = this.now();

    this.expireClients(now);

    // Fixed-size keys also bound memory for unusually long forwarded identities.
    // Hash the resolved identity verbatim; do not reinterpret forwarding headers.
    const key = createHash('sha256').update(identity).digest('hex');
    let client = this.clients.get(key);

    if (!client) {
      if (this.clients.size >= this.policy.maxClients) {
        const earliest = this.clients.values().next().value!;

        return this.reject(503, earliest.expiresAt, now);
      }

      client = {
        timestamps: new Float64Array(this.policy.max),
        head: 0,
        count: 0,
        expiresAt: now + this.policy.windowMs,
      };
    }

    const cutoff = now - this.policy.windowMs;

    while (client.count && client.timestamps[client.head] <= cutoff) {
      client.head = (client.head + 1) % this.policy.max;
      client.count--;
      this.storedRequests--;
    }

    if (client.count === this.policy.max)
      return this.reject(
        429,
        client.timestamps[client.head] + this.policy.windowMs,
        now,
      );

    const tail = (client.head + client.count) % this.policy.max;

    client.timestamps[tail] = now;
    client.count++;
    client.expiresAt = now + this.policy.windowMs;
    this.storedRequests++;

    // Equal windows and a monotonic clock keep insertion order equal to expiry order.
    // Rejections never move an entry or extend its expiry.
    this.clients.delete(key);
    this.clients.set(key, client);

    return { allowed: true };
  }

  private expireClients(now: number): void {
    for (const [key, client] of this.clients) {
      if (client.expiresAt > now) break;

      this.clients.delete(key);
      this.storedRequests -= client.count;
    }
  }

  private reject(
    status: 429 | 503,
    availableAt: number,
    now: number,
  ): Decision {
    return {
      allowed: false,
      status,
      retryAfterSeconds: Math.max(1, Math.ceil((availableAt - now) / 1_000)),
    };
  }
}
