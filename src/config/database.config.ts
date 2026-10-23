import { DataSource, MigrationExecutor } from 'typeorm';
import path from 'path';
import { fileURLToPath } from 'url';

import { env } from '@/config/env.config';
import entities from '@/database/entities';
import { databaseTransportOptions } from '@/config/database-options.config';
import {
  DatabaseReadiness,
  startDatabaseOperation,
} from '@/common/handlers/database-readiness.handler';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

export const AppDataSource = new DataSource({
  ...databaseTransportOptions(env),
  type: 'mysql',
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,
  entities: entities,
  migrations: [path.join(configDirectory, '../database/migrations/*{.ts,.js}')],
  synchronize: false,
  migrationsRun: false,
  logging: false,
});

export const databaseReadiness = new DatabaseReadiness(AppDataSource, env);

/** Migrations are verified here but applied only by the explicit deployment command. */
export async function initializeDatabase(
  source: DataSource = AppDataSource,
): Promise<void> {
  try {
    await source.initialize();
    const verification = startDatabaseOperation(
      source,
      env.DB_MIGRATION_CHECK_TIMEOUT_MS,
      async (runner) => {
        const pending = await new MigrationExecutor(
          source,
          runner,
        ).getPendingMigrations();

        if (pending.length)
          throw Object.assign(
            new Error(
              'Database has pending migrations. Apply migrations before starting the API.',
            ),
            { code: 'APP_PENDING_MIGRATIONS' },
          );
      },
    );

    // Observe delayed acquisition cleanup even when the deadline rejects first.
    void verification.finished.catch(() => undefined);
    await verification.result;
    await verification.finished;
  } catch (error) {
    if (source.isInitialized) await source.destroy();

    throw error;
  }
}

export async function connectDatabase(): Promise<void> {
  await initializeDatabase();
  databaseReadiness.resume();
}

export async function destroyServer(): Promise<void> {
  databaseReadiness.stop();
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
}

export function isServerInitialized(): boolean {
  return AppDataSource.isInitialized;
}
