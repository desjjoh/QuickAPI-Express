import type { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/logger.config', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

async function freshLifecycle() {
  vi.resetModules();
  return (await import('@/common/handlers/lifecycle.handler')).LC;
}

const processEvents = [
  'SIGINT',
  'SIGTERM',
  'uncaughtException',
  'unhandledRejection',
  'exit',
] as const;
const events: EventEmitter = process;
let baseline: Map<string, ReturnType<EventEmitter['listeners']>>;
beforeEach(() => {
  baseline = new Map(
    processEvents.map((event) => [event, events.listeners(event)]),
  );
});
afterEach(() => {
  for (const event of processEvents) {
    for (const listener of events.listeners(event)) {
      if (!baseline.get(event)?.includes(listener))
        events.removeListener(
          event,
          listener as Parameters<EventEmitter['removeListener']>[1],
        );
    }
  }
  process.exitCode = 0;
});

describe('service lifecycle', () => {
  it.each([
    ['uncaughtException', 'Uncaught exception.'],
    ['unhandledRejection', 'Unhandled promise rejection.'],
  ])(
    'uses fixed messages and safe serializer fields for %s',
    async (event, message) => {
      const LC = await freshLifecycle();
      const { logger } = await import('@/config/logger.config');
      const error = {
        toString() {
          throw new Error('Do not coerce provider failures.');
        },
      };

      LC.register([]);
      const listener = events
        .listeners(event)
        .find((candidate) => !baseline.get(event)?.includes(candidate));

      expect(listener).toBeDefined();
      listener!(error);
      await LC.shutdown(1);
      expect(logger.error).toHaveBeenCalledWith({ error }, message);
      expect(process.exitCode).toBe(1);
    },
  );

  it('shares pending startup and shutdown, quiesces immediately, and cleans up a late start', async () => {
    const LC = await freshLifecycle();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    LC.register([
      {
        name: 'database',
        start: () => gate,
        stop: () => {
          calls.push('database-stop');
        },
      },
      {
        name: 'http',
        start: () => {
          calls.push('http-start');
        },
        quiesce: () => {
          calls.push('http-quiesce');
        },
      },
    ]);
    const start = LC.startup();
    expect(LC.startup()).toBe(start);
    const shutdown = LC.shutdown();
    expect(LC.shutdown()).toBe(shutdown);
    expect(LC.isReady()).toBe(false);
    expect(calls).toEqual(['http-quiesce']);
    release();
    await Promise.all([start, shutdown]);
    expect(calls).toEqual(['http-quiesce', 'database-stop']);
    expect(LC.isReady()).toBe(false);
    await expect(LC.startup()).rejects.toThrow('shutdown');
  });

  it('starts in registration order, stops in reverse order, and transitions readiness', async () => {
    const LC = await freshLifecycle();
    const calls: string[] = [];
    LC.register(
      ['one', 'two'].map((name) => ({
        name,
        start: () => {
          calls.push(`start:${name}`);
        },
        stop: () => {
          calls.push(`stop:${name}`);
        },
      })),
    );
    expect(LC.isAlive()).toBe(true);
    expect(LC.isReady()).toBe(false);
    await LC.startup();
    expect(LC.isReady()).toBe(true);
    await LC.startup();
    await LC.shutdown();
    expect(LC.isReady()).toBe(false);
    expect(LC.isAlive()).toBe(false);
    await LC.shutdown();
    expect(calls).toEqual(['start:one', 'start:two', 'stop:two', 'stop:one']);
  });

  it('rolls back completed starts and permits retry after a failed start', async () => {
    const LC = await freshLifecycle();
    const calls: string[] = [];
    let fail = true;
    LC.register([
      {
        name: 'one',
        start: () => {
          calls.push('start:one');
        },
        stop: () => {
          calls.push('stop:one');
        },
      },
      {
        name: 'two',
        start: () => {
          calls.push('start:two');
          if (fail) {
            fail = false;
            throw new Error('start failed');
          }
        },
        stop: () => {
          calls.push('stop:two');
        },
      },
    ]);
    await expect(LC.startup()).rejects.toThrow('start failed');
    expect(LC.isReady()).toBe(false);
    await LC.startup();
    expect(LC.isReady()).toBe(true);
    expect(calls).toEqual([
      'start:one',
      'start:two',
      'stop:one',
      'start:one',
      'start:two',
    ]);
    await LC.shutdown();
  });

  it('continues reverse cleanup after failed stops and raises the exit code', async () => {
    const LC = await freshLifecycle();
    const stopped: string[] = [];
    LC.register([
      {
        name: 'one',
        start() {},
        stop: () => {
          stopped.push('one');
        },
      },
      {
        name: 'two',
        start() {},
        stop: () => {
          stopped.push('two');
          throw new Error('stop failed');
        },
      },
    ]);
    await LC.startup();
    await LC.shutdown();
    expect(stopped).toEqual(['two', 'one']);
    expect(process.exitCode).toBe(1);
  });

  it('reports false for unhealthy and rejected checks without skipping readiness state', async () => {
    const LC = await freshLifecycle();
    LC.register([
      { name: 'ok', check: () => true },
      {
        name: 'rejected',
        check: async () => {
          throw new Error('offline');
        },
      },
    ]);
    expect(await LC.areAllServicesHealthy()).toBe(false);
  });

  it('checks every dependency, bounds slow checks, and returns only structured results', async () => {
    const LC = await freshLifecycle();
    const checked: string[] = [];
    LC.register([
      {
        name: 'slow',
        check: () => new Promise<boolean>(() => undefined),
      },
      {
        name: 'throws',
        check: () => {
          checked.push('throws');
          throw new Error('secret dependency detail');
        },
      },
    ]);

    const results = await LC.checkDependencies(5);

    expect(checked).toEqual(['throws']);
    expect(results).toEqual([
      { name: 'slow', status: 'down', response_time_ms: expect.any(Number) },
      { name: 'throws', status: 'down', response_time_ms: expect.any(Number) },
    ]);
    expect(JSON.stringify(results)).not.toContain('secret dependency detail');
  });
});
