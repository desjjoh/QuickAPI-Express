import { DataSource } from 'typeorm';

import { isDev } from '@/config/env.config';
import { Item } from '@/entities/item.entity';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: 'localhost',
  port: 3306,
  username: 'root',
  password: 'root',
  database: 'dev',
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
