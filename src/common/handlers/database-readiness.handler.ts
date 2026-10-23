import type { DataSource, QueryRunner } from 'typeorm';
import type { PoolConnection } from 'mysql2';

type DatabaseOperation<T> = {
  result: Promise<T>;
  finished: Promise<void>;
  cancel: () => void;
};

/** Owns only its query runner; never destroys the application pool or another request's lease. */
export function startDatabaseOperation<T>(
  source: DataSource,
  timeoutMs: number,
  operation: (runner: QueryRunner) => Promise<T>,
): DatabaseOperation<T> {
  const runner = source.createQueryRunner();
  let connection: PoolConnection | undefined;
  let expired = false;
  let complete = false;

  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  let interrupt!: (error: Error) => void;

  const result = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });

  const interrupted = new Promise<never>((_yes, no) => {
    interrupt = no;
  });

  // Cancellation can precede acquisition; observe rejection before the query race is installed.
  void interrupted.catch(() => undefined);

  const cancel = () => {
    if (complete || expired) return;

    expired = true;

    const error = new Error(
      'Database operation deadline exceeded or operation stopped.',
    );

    connection?.destroy();
    reject(error);
    interrupt(error);
  };

  const timer = setTimeout(cancel, timeoutMs);

  const finished = (async () => {
    try {
      // mysql2 cannot cancel a queued getConnection. Keep ownership until it settles,
      // then release a late lease without running SQL. Callers retain single flight.
      connection = (await runner.connect()) as PoolConnection;

      if (expired) return;

      const value = await Promise.race([operation(runner), interrupted]);

      if (!expired) resolve(value);
    } catch (error) {
      connection?.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    } finally {
      complete = true;
      clearTimeout(timer);
      await runner.release();
    }
  })();

  return { result, finished, cancel };
}

/** On-demand, shared checks; timing out callers must not start more queued acquisitions. */
export class DatabaseReadiness {
  private active:
    | { operation: DatabaseOperation<unknown>; result: Promise<boolean> }
    | undefined;
  private cached: { healthy: boolean; expires: number } | undefined;

  private stopped = false;

  constructor(
    private readonly source: DataSource,
    private readonly policy: {
      DB_READINESS_TIMEOUT_MS: number;
      DB_READINESS_CACHE_MS: number;
    },
  ) {}

  public check(): Promise<boolean> {
    if (this.stopped || !this.source.isInitialized)
      return Promise.resolve(false);

    if (this.active) return this.active.result;

    if (this.cached && performance.now() < this.cached.expires)
      return Promise.resolve(this.cached.healthy);

    const operation = startDatabaseOperation(
      this.source,
      this.policy.DB_READINESS_TIMEOUT_MS,
      (runner) => runner.query('SELECT 1'),
    );

    const remember = (healthy: boolean) => {
      if (!this.stopped)
        this.cached = {
          healthy,
          expires: performance.now() + this.policy.DB_READINESS_CACHE_MS,
        };

      return healthy;
    };

    const active = {
      operation,
      result: operation.result.then(
        () => remember(true),
        () => remember(false),
      ),
    };

    this.active = active;

    void operation.finished
      .catch(() => remember(false))
      .finally(() => {
        if (this.active === active) this.active = undefined;
      });

    return active.result;
  }

  public stop(): void {
    this.stopped = true;
    this.cached = undefined;
    this.active?.operation.cancel();
  }

  public resume(): void {
    this.stopped = false;
    this.cached = undefined;
  }
}
