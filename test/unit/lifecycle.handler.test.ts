import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/logger.config', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));

async function freshLifecycle() {
  vi.resetModules();
  return (await import('@/common/handlers/lifecycle.handler')).LC;
}

afterEach(() => {
  process.exitCode = 0;
});

describe('service lifecycle', () => {
  it('starts in registration order, stops in reverse order, and transitions readiness', async () => {
    const LC = await freshLifecycle();
    const calls: string[] = [];
    LC.register(
      ['one', 'two'].map(name => ({
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
    expect(calls).toEqual(['start:one', 'start:two', 'stop:one', 'start:one', 'start:two']);
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
});
