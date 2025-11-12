import { DataSource } from 'typeorm';

import { isDev } from '@/config/env-validation.config';

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: 'localhost',
  port: 3306,
  username: 'root',
  password: 'root',
  database: 'dev',
  entities: [],
  synchronize: isDev,
  logging: false,
});

export async function connectDatabase(): Promise<void> {
  await AppDataSource.initialize();
}

export async function destroyServer(): Promise<void> {
  return AppDataSource.destroy();
}
