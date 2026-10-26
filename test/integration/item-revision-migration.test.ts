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

describe('item revision upgrade over representative existing data', () => {
  it('backfills revisions, preserves data/timestamps, refuses pending startup, and rehearses an offline schema downgrade', async () => {
    await resetTestDatabase();
    const source = new DataSource({ ...AppDataSource.options });
    await source.initialize();
    try {
      expect(await source.showMigrations()).toBe(false);
      await source.undoLastMigration();
      expect(await source.showMigrations()).toBe(true);
      await source.query(`INSERT INTO items (id, name, price, description, createdAt, updatedAt) VALUES
        ('upgradefixture01', 'Existing item', 12.34, NULL, '2026-01-01 00:00:00.123456', '2026-02-01 00:00:00.654321'),
        ('upgradefixture02', 'Another item', 99999999.99, 'Preserve this', '2026-03-01', '2026-03-02')`);
      const before = await source.query('SELECT * FROM items ORDER BY id');
      const timestampsSql =
        "SELECT id, DATE_FORMAT(createdAt, '%Y-%m-%d %H:%i:%s.%f') AS createdAt, DATE_FORMAT(updatedAt, '%Y-%m-%d %H:%i:%s.%f') AS updatedAt FROM items ORDER BY id";
      const timestamps = await source.query(timestampsSql);
      const pending = new DataSource({ ...AppDataSource.options });
      await expect(initializeDatabase(pending)).rejects.toHaveProperty(
        'code',
        'APP_PENDING_MIGRATIONS',
      );
      expect(pending.isInitialized).toBe(false);
      await source.runMigrations();
      const after = await source.query('SELECT * FROM items ORDER BY id');
      expect(after).toEqual(
        before.map((row: object) => ({ ...row, version: 1 })),
      );
      expect(await source.query(timestampsSql)).toEqual(timestamps);
      expect(await source.showMigrations()).toBe(false);
      expect(
        (await source.driver.createSchemaBuilder().log()).upQueries,
      ).toEqual([]);
      const [definition] = await source.query('SHOW CREATE TABLE items');
      expect(definition['Create Table']).toContain('PRIMARY KEY (`id`)');
      // Downgrade is rehearsed offline only; it intentionally destroys revision history.
      await source.query('UPDATE items SET version = 7 WHERE id = ?', [
        'upgradefixture01',
      ]);
      const beforeDowngrade = await source.query(
        'SELECT id, name, price, description, createdAt, updatedAt FROM items ORDER BY id',
      );
      await source.undoLastMigration();
      expect(await source.query('SELECT * FROM items ORDER BY id')).toEqual(
        beforeDowngrade,
      );
      await source.runMigrations();
      expect(
        (await source.query('SELECT version FROM items ORDER BY id')).map(
          (row: { version: number }) => row.version,
        ),
      ).toEqual([1, 1]);
    } finally {
      // Restore this disposable schema even if an assertion fails after downgrade.
      if (await source.showMigrations()) await source.runMigrations();
      await source.destroy();
      await resetTestDatabase();
    }
  });
});
