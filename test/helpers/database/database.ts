import { AppDataSource } from '@/config/database.config';
import { assertSafeTestDatabase } from './safety';

/** Connect to the disposable database after its migrations have been applied by the test wrapper. */
export async function connectTestDatabase(): Promise<void> {
  assertSafeTestDatabase();

  if (!AppDataSource.isInitialized) await AppDataSource.initialize();
  if (await AppDataSource.showMigrations()) {
    throw new Error('Disposable test database has pending migrations');
  }
}

/** Reset mutable tables without dropping the schema or migration history. */
export async function resetTestDatabase(): Promise<void> {
  assertSafeTestDatabase();

  if (!AppDataSource.isInitialized)
    throw new Error('Test database is not connected');

  await AppDataSource.query('DELETE FROM `items`');
}

export async function disconnectTestDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
}
