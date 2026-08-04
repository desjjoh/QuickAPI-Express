import { DataSource } from 'typeorm';
import path from 'path';
import { fileURLToPath } from 'url';

import { env } from '@/config/env.config';
import entities from '@/database/entities';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

export const AppDataSource = new DataSource({
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

export async function connectDatabase(): Promise<void> {
  await AppDataSource.initialize();
}

export async function destroyServer(): Promise<void> {
  return AppDataSource.destroy();
}

export function isServerInitialized(): boolean {
  return AppDataSource.isInitialized;
}
