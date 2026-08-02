import { describe, it, expect } from 'vitest';
import { createApp } from '@/config/http-server.config';
import { env } from '@/config/env.config';
import { createApplicationServices } from '@/application';
import { AppDataSource } from '@/config/database.config';
import { LC } from '@/common/handlers/lifecycle.handler';

describe('Server lifecycle', () => {
  it('starts and stops without error', async () => {
    const app = createApp();

    const server = app.listen(env.PORT);
    const address = server.address();

    expect(address).not.toBeNull();
    if (address && typeof address !== 'string') {
      expect(address.port).toBeGreaterThan(0);
    }

    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  });

  it('cleans up the real database service when downstream application startup fails', async () => {
    const services = createApplicationServices();
    services[1] = {
      ...services[1]!,
      start: async () => {
        throw new Error('forced HTTP startup failure');
      },
    };
    LC.register(services);

    await expect(LC.startup()).rejects.toThrow('forced HTTP startup failure');
    expect(AppDataSource.isInitialized).toBe(false);
    expect(LC.isReady()).toBe(false);
  });
});
