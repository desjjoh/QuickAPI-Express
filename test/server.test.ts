import { describe, it, expect } from 'vitest';
import { createApp } from '@/config/http-server.config';
import { env } from '@/config/env.config';

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
});
