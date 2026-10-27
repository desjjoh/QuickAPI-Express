import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppDataSource, initializeDatabase } from '@/config/database.config';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';
import { assertSafeTestDatabase } from '../helpers/database/safety';

assertSafeTestDatabase();
beforeAll(connectTestDatabase);
afterAll(disconnectTestDatabase);

describe('replay storage migration over populated item schema', () => {
  it('preserves items and revision history, refuses pending startup, creates its index and supports offline down/re-up', async () => {
    await resetTestDatabase();
    const source = new DataSource({ ...AppDataSource.options });
    await source.initialize();
    try {
      await source.undoLastMigration();
      await source.query(
        "INSERT INTO items (id, name, price, description, version, createdAt, updatedAt) VALUES ('replayupgrade001', 'Preserve', 12.34, NULL, 7, '2026-01-01 00:00:00.123456', '2026-02-01 00:00:00.654321')",
      );
      const snapshotSql =
        "SELECT id, name, price, description, version, DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s.%f') AS createdAt, DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s.%f') AS updatedAt FROM items ORDER BY id";
      const before = await source.query(snapshotSql);
      const [definition] = await source.query('SHOW CREATE TABLE items');
      const history = await source.query(
        'SELECT * FROM migrations ORDER BY id',
      );
      const pending = new DataSource({ ...AppDataSource.options });
      await expect(initializeDatabase(pending)).rejects.toHaveProperty(
        'code',
        'APP_PENDING_MIGRATIONS',
      );
      expect(pending.isInitialized).toBe(false);
      await source.runMigrations();
      expect(await source.query(snapshotSql)).toEqual(before);
      expect((await source.query('SHOW CREATE TABLE items'))[0]).toEqual(
        definition,
      );
      expect(
        await source.query('SELECT * FROM migrations ORDER BY id'),
      ).toEqual(expect.arrayContaining(history));
      expect(
        (await source.driver.createSchemaBuilder().log()).upQueries,
      ).toEqual([]);
      const indexes = await source.query('SHOW INDEX FROM request_idempotency');
      expect(
        indexes
          .filter(
            (row: { Key_name: string }) =>
              row.Key_name === 'IDX_request_idempotency_expiry',
          )
          .map((row: { Column_name: string }) => row.Column_name),
      ).toEqual(['state', 'expires_at']);
      expect(
        indexes.some(
          (row: { Key_name: string; Non_unique: number }) =>
            row.Key_name === 'PRIMARY' && Number(row.Non_unique) === 0,
        ),
      ).toBe(true);
      await source.undoLastMigration();
      expect(await source.query(snapshotSql)).toEqual(before);
      await source.runMigrations();
      expect(await source.query('SELECT * FROM request_idempotency')).toEqual(
        [],
      );
      expect(await source.showMigrations()).toBe(false);
    } finally {
      if (await source.showMigrations()) await source.runMigrations();
      await source.destroy();
      await resetTestDatabase();
    }
  });
});
