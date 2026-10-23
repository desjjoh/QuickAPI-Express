import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/config/database.config', () => ({
  AppDataSource: {
    isInitialized: false,
    initialize: vi.fn(),
    query: vi.fn(),
  },
}));

import { AppDataSource } from '@/config/database.config';
import {
  connectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('direct database test safety', () => {
  it('rejects an unsafe target before opening a connection', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_HOST', '127.0.0.1');
    vi.stubEnv('DB_DATABASE', 'test');

    await expect(connectTestDatabase()).rejects.toThrow(
      'Unsafe test database configuration',
    );
    expect(AppDataSource.initialize).not.toHaveBeenCalled();
  });

  it('rejects an unsafe fixture reset before any SQL can run', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DB_HOST', '127.0.0.1');
    vi.stubEnv('DB_DATABASE', 'production');

    await expect(resetTestDatabase()).rejects.toThrow(
      'Unsafe test database configuration',
    );
    expect(AppDataSource.query).not.toHaveBeenCalled();
  });
});
