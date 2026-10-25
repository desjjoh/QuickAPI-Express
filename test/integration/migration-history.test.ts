import { DataSource, MigrationExecutor } from 'typeorm';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { AppDataSource, initializeDatabase } from '@/config/database.config';
import { env } from '@/config/env.config';
import { assertSafeTestDatabase } from '../helpers/database/safety';

assertSafeTestDatabase();
const expectedBaseline = 'SchemaUpdate1792778193584';
const previousBaseline = 'SchemaUpdate1785694410039';
const previousTimestamp = 1785694410039;
const id = 'historyfixture01';
const candidates: DataSource[] = [];
let control: Awaited<ReturnType<typeof createConnection>>;
let originalHistory: RowDataPacket[];
let originalBaseline: RowDataPacket;

beforeAll(async () => {
  control = await createConnection({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
  });
  originalHistory = await history();
  const baseline = originalHistory.find((row) => row.name === expectedBaseline);
  if (!baseline)
    throw new Error(
      'Apply the committed baseline to the disposable database before this test',
    );
  originalBaseline = baseline;
});

beforeEach(async () => {
  // Reproduce an existing current schema whose history still names the old baseline.
  await control.query(
    'UPDATE migrations SET timestamp = ?, name = ? WHERE id = ?',
    [previousTimestamp, previousBaseline, originalBaseline.id],
  );
  await control.query(
    'INSERT INTO items (id, name, price, description) VALUES (?, ?, 12.34, ?)',
    [id, 'Preserve existing data', 'Baseline history reconciliation'],
  );
});

afterEach(async () => {
  try {
    for (const candidate of candidates.splice(0))
      if (candidate.isInitialized) await candidate.destroy();
  } finally {
    // Restore only this guarded disposable database's saved migration history.
    await control.query('DELETE FROM migrations');
    for (const row of originalHistory)
      await control.query(
        'INSERT INTO migrations (id, timestamp, name) VALUES (?, ?, ?)',
        [row.id, row.timestamp, row.name],
      );
    await control.query('DELETE FROM items WHERE id = ?', [id]);
  }
});

afterAll(async () => {
  await control?.end();
});

function candidate() {
  const source = new DataSource({ ...AppDataSource.options });
  candidates.push(source);
  return source;
}
async function history() {
  const [rows] = await control.query<RowDataPacket[]>(
    'SELECT id, timestamp, name FROM migrations ORDER BY id',
  );
  return rows;
}
async function snapshot() {
  const [rows] = await control.query<RowDataPacket[]>(
    'SELECT * FROM items ORDER BY id',
  );
  return rows;
}
async function connections() {
  const [rows] = await control.query<RowDataPacket[]>('SHOW PROCESSLIST');
  return rows
    .filter((row) => row.db === env.DB_DATABASE)
    .map((row) => Number(row.Id))
    .sort();
}

describe('real MySQL migration history mismatch', () => {
  it('refuses startup without changing existing rows, schema, or history and closes its connection', async () => {
    const source = candidate();
    const before = await snapshot();
    const migrations = await history();
    const leases = await connections();
    const [definition] = await control.query<RowDataPacket[]>(
      'SHOW CREATE TABLE items',
    );
    await expect(initializeDatabase(source)).rejects.toHaveProperty(
      'code',
      'APP_PENDING_MIGRATIONS',
    );
    expect(source.isInitialized).toBe(false);
    await expect
      .poll(connections, { timeout: 2_000, interval: 20 })
      .toEqual(leases);
    expect(await snapshot()).toEqual(before);
    expect(await history()).toEqual(migrations);
    const [after] = await control.query<RowDataPacket[]>(
      'SHOW CREATE TABLE items',
    );
    expect(after).toEqual(definition);
  });

  it('does not treat a duplicate-table migration failure as successful application or repair history', async () => {
    const source = candidate();
    const before = await snapshot();
    const migrations = await history();
    await source.initialize();
    expect(await source.showMigrations()).toBe(true);
    await expect(source.runMigrations()).rejects.toMatchObject({
      driverError: { code: 'ER_TABLE_EXISTS_ERROR' },
    });
    expect(await source.showMigrations()).toBe(true);
    expect(await snapshot()).toEqual(before);
    expect(await history()).toEqual(migrations);
  });

  it('records an explicitly verified equivalent baseline without running its CREATE TABLE or losing data', async () => {
    const source = candidate();
    const before = await snapshot();
    const migrations = await history();
    await source.initialize();
    // This proof authorizes fake application in this fixture only. Production
    // reconciliation still requires backup, manual schema/history review, and approval.
    const difference = await source.driver.createSchemaBuilder().log();
    expect(difference.upQueries).toEqual([]);
    const pending = await new MigrationExecutor(source).getPendingMigrations();
    expect(pending.map((migration) => migration.name)).toEqual([
      expectedBaseline,
    ]);
    await source.runMigrations({ fake: true });
    expect(await source.showMigrations()).toBe(false);
    expect(await snapshot()).toEqual(before);
    const after = await history();
    expect(after).toHaveLength(migrations.length + 1);
    expect(after).toEqual(expect.arrayContaining(migrations));
    expect(after).toContainEqual(
      expect.objectContaining({
        name: expectedBaseline,
        timestamp: 1792778193584,
      }),
    );
    await source.destroy();
    await initializeDatabase(source);
    expect(source.isInitialized).toBe(true);
    expect(await snapshot()).toEqual(before);
  });
});
