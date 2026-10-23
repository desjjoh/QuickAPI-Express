import { connect, isIP, type Socket } from 'node:net';
import mysql, {
  type ConnectionOptions,
  type Pool,
  type PoolConnection,
} from 'mysql2';

import { HttpError } from '@/common/exceptions/http.exception';

export type DatabasePoolPolicy = {
  DB_POOL_CONNECTION_LIMIT: number;
  DB_POOL_QUEUE_LIMIT: number;
  DB_POOL_ACQUIRE_TIMEOUT_MS: number;
  DB_CONNECT_TIMEOUT_MS: number;
};

export class DatabaseUnavailableError extends HttpError {
  constructor(code: string) {
    super(503, 'Database temporarily unavailable.', code);
  }
}

type Callback = (error: Error | null, connection?: PoolConnection) => void;
type Waiter = {
  callback: Callback;
  timer: NodeJS.Timeout;
  settled: boolean;
  socket?: Socket;
};

/** Own the bounded/cancellable wait queue; mysql2 retains ownership of idle connections. */
export function createBoundedMysqlPool(
  options: ConnectionOptions,
  policy: DatabasePoolPolicy,
): Pool {
  if (
    options.ssl &&
    (typeof options.ssl !== 'object' ||
      options.ssl.rejectUnauthorized !== true ||
      options.ssl.verifyIdentity !== true ||
      !options.host ||
      isIP(options.host))
  ) {
    throw new DatabaseUnavailableError('DB_TLS_CONFIG');
  }

  const waiting = new Set<Waiter>();
  const connecting = new Set<Waiter>();
  let occupied = 0;
  let closed = false;
  let creating: Waiter | undefined;
  const pool = mysql.createPool({
    ...options,
    connectionLimit: policy.DB_POOL_CONNECTION_LIMIT,
    waitForConnections: false,
    queueLimit: 0,
    // mysql2 invokes this public stream factory synchronously when creating a connection.
    stream: () => {
      const socket = connect({
        host: options.host,
        port: options.port ?? 3306,
      });

      if (creating) creating.socket = socket;

      return socket;
    },
  });
  const getConnection = pool.getConnection.bind(pool);
  const end = pool.end.bind(pool);

  function finish(
    waiter: Waiter,
    error: Error | null,
    connection?: PoolConnection,
  ) {
    if (waiter.settled) return false;

    waiter.settled = true;
    clearTimeout(waiter.timer);
    waiting.delete(waiter);
    waiter.callback(error, connection);

    return true;
  }

  function pump() {
    while (
      !closed &&
      occupied < policy.DB_POOL_CONNECTION_LIMIT &&
      waiting.size
    ) {
      const waiter = waiting.values().next().value!;

      waiting.delete(waiter);
      begin(waiter);
    }
  }

  function begin(waiter: Waiter) {
    occupied++;
    connecting.add(waiter);
    let returned = false;
    let connection: PoolConnection | undefined;

    const releaseSlot = () => {
      if (returned) return;

      returned = true;
      connection?.off('error', lost);
      connection?.off('end', lost);
      occupied--;
      pump();
    };

    const lost = () => releaseSlot();
    const connectionTimer = setTimeout(() => {
      finish(waiter, new DatabaseUnavailableError('DB_CONNECT_TIMEOUT'));
      // This socket belongs to an unfinished handshake, never to running SQL.
      waiter.socket?.destroy(
        new Error('Database connection setup deadline exceeded.'),
      );
    }, policy.DB_CONNECT_TIMEOUT_MS);

    creating = waiter;
    getConnection((error, acquired) => {
      clearTimeout(connectionTimer);
      connecting.delete(waiter);
      connection = acquired;
      if (error || !acquired) {
        releaseSlot();
        finish(
          waiter,
          error ?? new DatabaseUnavailableError('DB_CONNECTION_FAILED'),
        );

        return;
      }

      if (closed || waiter.settled) {
        acquired.release();
        releaseSlot();

        return;
      }

      acquired.once('error', lost);
      acquired.once('end', lost);
      const lease = new Proxy(acquired, {
        get(target, property) {
          if (property === 'release' || property === 'destroy')
            return () => {
              if (returned) return;

              if (property === 'destroy') target.destroy();
              else target.release();
              releaseSlot();
            };

          const value = Reflect.get(target, property, target);

          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      finish(waiter, null, lease);
    });
    creating = undefined;
  }

  pool.getConnection = (callback) => {
    if (closed) {
      callback(
        new DatabaseUnavailableError('DB_POOL_CLOSED'),
        undefined as never,
      );

      return;
    }

    if (
      occupied >= policy.DB_POOL_CONNECTION_LIMIT &&
      waiting.size >= policy.DB_POOL_QUEUE_LIMIT
    ) {
      callback(
        new DatabaseUnavailableError('DB_POOL_CAPACITY'),
        undefined as never,
      );

      return;
    }

    const waiter: Waiter = {
      callback: (error, connection) => callback(error, connection!),
      settled: false,
      timer: setTimeout(() => {
        finish(waiter, new DatabaseUnavailableError('DB_POOL_ACQUIRE_TIMEOUT'));
        waiter.socket?.destroy(
          new Error('Database acquisition deadline exceeded.'),
        );
      }, policy.DB_POOL_ACQUIRE_TIMEOUT_MS),
    };

    if (occupied < policy.DB_POOL_CONNECTION_LIMIT) begin(waiter);
    else waiting.add(waiter);
  };

  pool.end = (callback = () => undefined) => {
    closed = true;
    for (const waiter of [...waiting, ...connecting]) {
      finish(waiter, new DatabaseUnavailableError('DB_POOL_CLOSED'));
      waiter.socket?.destroy(new Error('Database pool closed.'));
    }

    end(callback);
  };

  return pool;
}
