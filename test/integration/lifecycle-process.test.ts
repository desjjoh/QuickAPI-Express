import { spawn, type ChildProcess } from 'node:child_process';
import { get } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0))
    if (child.exitCode === null) child.kill();
});

type Event = {
  type: string;
  port?: number;
  ready?: boolean;
  databaseOpen?: boolean;
  code?: string;
};
function childFixture(mode: string) {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'test/helpers/lifecycle-process.ts', mode],
    {
      env: {
        ...process.env,
        LOG_LEVEL: 'fatal',
        REQUEST_TIMEOUT_MS: '1000',
        HTTP_HEADERS_TIMEOUT_MS: '200',
        HTTP_REQUEST_TIMEOUT_MS: '1000',
        HTTP_DRAIN_TIMEOUT_MS: '200',
        SHUTDOWN_TIMEOUT_MS: '500',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  children.push(child);
  const events: Event[] = [];
  const waiters = new Set<() => void>();
  let output = '';
  child.stdout?.on('data', (data) => {
    output += String(data);
  });
  child.stderr?.on('data', (data) => {
    output += String(data);
  });
  child.on('message', (event: Event) => {
    events.push(event);
    for (const notify of waiters) notify();
  });
  const wait = (type: string): Promise<Event> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Child event ${type} missing: ${output}`));
      }, 5_000);
      const check = () => {
        const event = events.find((event) => event.type === type);
        if (event) {
          cleanup();
          resolve(event);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        waiters.delete(check);
      };
      waiters.add(check);
      check();
    });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code));
  });
  return { child, wait, exit, events, output: () => output };
}

describe('process shutdown boundary', () => {
  it('cleans up an already-started database when the actual HTTP bind fails', async () => {
    const fixture = childFixture('bind-failure');
    expect(await fixture.wait('startup-failed')).toMatchObject({
      code: 'EADDRINUSE',
      databaseOpen: false,
      ready: false,
    });
    expect(await fixture.exit).toBe(1);
  });
  it('withdraws readiness immediately and exits cleanly after accepted work drains', async () => {
    const fixture = childFixture('normal');
    const listening = await fixture.wait('listening');
    const response = new Promise<string>((resolve, reject) => {
      get({ host: '127.0.0.1', port: listening.port, agent: false }, (res) => {
        let result = '';
        res.on('data', (data) => {
          result += String(data);
        });
        res.once('end', () => resolve(result));
      }).once('error', reject);
    });
    await fixture.wait('started');
    fixture.child.send('shutdown');
    expect((await fixture.wait('quiesced')).ready).toBe(false);
    expect(fixture.events.some((event) => event.type === 'database-stop')).toBe(
      false,
    );
    fixture.child.send('release');
    expect(JSON.parse(await response)).toEqual({ databaseOpen: true });
    expect(await fixture.exit).toBe(0);
    expect(
      fixture.events.find((event) => event.type === 'work-finished')
        ?.databaseOpen,
    ).toBe(true);
    expect(
      fixture.events.findIndex((event) => event.type === 'database-stop'),
    ).toBeGreaterThan(
      fixture.events.findIndex((event) => event.type === 'work-finished'),
    );
  });

  it.each(['stuck', 'stuck-work'])(
    'forces a failing exit for %s even after a failed HTTP drain',
    async (mode) => {
      const fixture = childFixture(mode);
      const listening = await fixture.wait('listening');
      const client = get({
        host: '127.0.0.1',
        port: listening.port,
        agent: false,
      });
      client.on('error', () => undefined);
      await fixture.wait('started');
      fixture.child.send('shutdown');
      await fixture.wait('quiesced');
      expect(await fixture.exit).toBe(1);
      expect(fixture.output()).toContain('Shutdown deadline exceeded');
      client.destroy();
    },
  );
});
