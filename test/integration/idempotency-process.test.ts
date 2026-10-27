import { spawn, type ChildProcess } from 'node:child_process';
import request from 'supertest';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { AppDataSource } from '@/config/database.config';
import { idempotencyNamespace } from '@/config/idempotency.config';
import { idempotencyScopeHash } from '@/common/helpers/idempotency.helper';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';

type Event = {
  type: string;
  port?: number;
  ready?: boolean;
  databaseOpen?: boolean;
};
type Worker = {
  child: ChildProcess;
  events: Event[];
  exit: Promise<number | null>;
  wait: (type: string) => Promise<Event>;
};
const children: Worker[] = [];
function worker(mode = 'normal'): Worker {
  const child: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', 'test/helpers/idempotency-process.ts', mode],
    {
      env: {
        ...process.env,
        PORT: '0',
        LOG_LEVEL: 'fatal',
        REQUEST_TIMEOUT_MS: '5000',
        HTTP_DRAIN_TIMEOUT_MS: mode === 'stuck-cleanup' ? '200' : '2000',
        SHUTDOWN_TIMEOUT_MS: mode === 'stuck-cleanup' ? '800' : '4000',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  const events: Event[] = [];
  const waiters = new Set<() => void>();
  let output = '';
  child.stdout?.on('data', (data) => {
    output += data;
  });
  child.stderr?.on('data', (data) => {
    output += data;
  });
  child.on('message', (event: Event) => {
    events.push(event);
    for (const notify of waiters) notify();
  });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  const wait = (type: string) =>
    new Promise<Event>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(new Error(`Missing child ${type}: ${output}`));
      }, 6000);
      const check = () => {
        const event = events.find((event) => event.type === type);
        if (event) {
          clearTimeout(timer);
          waiters.delete(check);
          resolve(event);
        }
      };
      waiters.add(check);
      check();
    });
  const fixture = { child, events, exit, wait };
  children.push(fixture);
  return fixture;
}
beforeAll(connectTestDatabase);
beforeEach(resetTestDatabase);
afterAll(disconnectTestDatabase);
afterEach(async () => {
  for (const fixture of children.splice(0)) {
    if (fixture.child.exitCode === null) fixture.child.kill();
    await fixture.exit;
  }
});
const path = '/api/v1/items';
const key = 'process-key';
const input = { name: 'Durable', price: 4.5 };
const hash = idempotencyScopeHash(
  {
    namespace: idempotencyNamespace,
    callerScope: 'public',
    operation: 'items.create',
    route: 'POST /api/v1/items',
  },
  key,
);
async function counts() {
  const [row] = await AppDataSource.query(
    'SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM request_idempotency) AS replays',
  );
  return { items: Number(row.items), replays: Number(row.replays) };
}
async function stop(fixture: ReturnType<typeof worker>) {
  fixture.child.send('shutdown');
  expect(await fixture.exit).toBe(0);
}
async function free() {
  const [row] = await AppDataSource.query('SELECT IS_FREE_LOCK(?) AS free', [
    hash,
  ]);
  return Number(row.free);
}

describe('idempotency across real API processes', () => {
  it('recovers a committed but undelivered HTTP response after process restart', async () => {
    const first = worker('lost-response');
    const a = await first.wait('listening');
    await expect(
      request(`http://127.0.0.1:${a.port}`)
        .post(path)
        .set('Idempotency-Key', key)
        .send(input),
    ).rejects.toThrow();
    await first.wait('committed-without-response');
    const [stored] = await AppDataSource.query(
      'SELECT response_json FROM request_idempotency WHERE scope_hash = ?',
      [hash],
    );
    expect(await counts()).toEqual({ items: 1, replays: 1 });
    await stop(first);
    const second = worker();
    const b = await second.wait('listening');
    const replay = await request(`http://127.0.0.1:${b.port}`)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    expect(replay.text).toBe(stored.response_json);
    expect(await counts()).toEqual({ items: 1, replays: 1 });
    await stop(second);
  }, 15000);
  it('fences another process, commits once, replays after restart and replaces logically expired state', async () => {
    const first = worker('hold');
    const second = worker();
    const [a, b] = await Promise.all([
      first.wait('listening'),
      second.wait('listening'),
    ]);
    const origin = `http://127.0.0.1:${a.port}`;
    const other = `http://127.0.0.1:${b.port}`;
    const pending = request(origin)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .then((response) => response);
    await first.wait('work-started');
    await request(other)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(409);
    await request(other)
      .post(path)
      .set('Idempotency-Key', key)
      .send({ ...input, name: 'Mismatch' })
      .expect(409);
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    first.child.send('release');
    const original = await pending;
    expect(original.status).toBe(201);
    // The client can lose/discard this response after commit; another process replays persisted bytes.
    await stop(first);
    await stop(second);
    const restarted = worker();
    const c = await restarted.wait('listening');
    const replay = await request(`http://127.0.0.1:${c.port}`)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    expect(replay.text).toBe(original.text);
    expect(replay.headers['x-request-id']).not.toBe(
      original.headers['x-request-id'],
    );
    expect(await counts()).toEqual({ items: 1, replays: 1 });
    await AppDataSource.query(
      'UPDATE request_idempotency SET expires_at = UTC_TIMESTAMP(3) WHERE scope_hash = ?',
      [hash],
    );
    const replacement = await request(`http://127.0.0.1:${c.port}`)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    expect(replacement.body.id).not.toBe(original.body.id);
    expect(await counts()).toEqual({ items: 2, replays: 1 });
    await stop(restarted);
  }, 15000);

  it('rolls back an uncommitted item/claim on process termination and permits another process to recover', async () => {
    const first = worker('crash');
    const a = await first.wait('listening');
    const pending = request(`http://127.0.0.1:${a.port}`)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .then(
        () => undefined,
        () => undefined,
      );
    await first.wait('work-started');
    first.child.kill('SIGKILL');
    await first.exit;
    await pending;
    await expect.poll(free, { timeout: 2000 }).toBe(1);
    expect(await counts()).toEqual({ items: 0, replays: 0 });
    const second = worker();
    const b = await second.wait('listening');
    await request(`http://127.0.0.1:${b.port}`)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .expect(201);
    expect(await counts()).toEqual({ items: 1, replays: 1 });
    await stop(second);
  }, 15000);

  it('quiesces immediately and drains accepted keyed work before database shutdown', async () => {
    const fixture = worker('hold');
    const a = await fixture.wait('listening');
    const pending = request(`http://127.0.0.1:${a.port}`)
      .post(path)
      .set('Idempotency-Key', key)
      .send(input)
      .then(
        () => undefined,
        () => undefined,
      );
    await fixture.wait('work-started');
    fixture.child.send('shutdown');
    expect(await fixture.wait('quiesced')).toMatchObject({ ready: false });
    expect(
      fixture.events.some((event) => event.type === 'database-stopped'),
    ).toBe(false);
    fixture.child.send('release');
    await pending;
    expect(await fixture.exit).toBe(0);
    expect(await counts()).toEqual({ items: 1, replays: 1 });
    await expect.poll(free).toBe(1);
  }, 10000);

  it('waits for active cleanup before database shutdown and does not start more batches', async () => {
    const fixture = worker('cleanup');
    await fixture.wait('listening');
    fixture.child.send('sweep');
    await fixture.wait('cleanup-started');
    fixture.child.send('shutdown');
    await fixture.wait('quiesced');
    expect(
      fixture.events.some((event) => event.type === 'database-stopped'),
    ).toBe(false);
    fixture.child.send('release-cleanup');
    expect(await fixture.wait('cleanup-finished')).toMatchObject({
      databaseOpen: true,
    });
    expect(await fixture.exit).toBe(0);
    expect(
      fixture.events.filter((event) => event.type === 'cleanup-started'),
    ).toHaveLength(1);
    expect(
      fixture.events.findIndex((event) => event.type === 'cleanup-finished'),
    ).toBeLessThan(
      fixture.events.findIndex((event) => event.type === 'database-stopped'),
    );
  }, 10000);

  it('forces a failing finite exit for stuck cleanup instead of closing MySQL underneath it', async () => {
    const fixture = worker('stuck-cleanup');
    await fixture.wait('listening');
    fixture.child.send('sweep');
    await fixture.wait('cleanup-started');
    fixture.child.send('shutdown');
    await fixture.wait('quiesced');
    expect(await fixture.exit).toBe(1);
    expect(
      fixture.events.some((event) => event.type === 'database-stopped'),
    ).toBe(false);
  }, 10000);
});
