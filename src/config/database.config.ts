import { DataSource } from 'typeorm';

import { env, isDev } from '@/config/env.config';
import { Item } from '@/entities/item.entity';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,
  entities: [Item],
  synchronize: isDev,
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
