import { afterEach, describe, expect, it } from 'vitest';

import {
  closeServer,
  createApp,
  isServerRunning,
  registerServer,
} from '@/config/http-server.config';

afterEach(async () => {
  await closeServer();
});

describe('HTTP server configuration', () => {
  it('constructs the complete Express middleware stack', () => {
    const app = createApp();
    expect(app.get('trust proxy')).toBe(1);
    expect(app.get('x-powered-by')).toBe(false);
    expect(app.router.stack.length).toBeGreaterThan(10);
  });

  it('registers idempotently and closes the active server', async () => {
    expect(isServerRunning()).toBe(false);
    await registerServer();
    await new Promise(resolve => setImmediate(resolve));
    expect(isServerRunning()).toBe(true);
    await registerServer();
    expect(isServerRunning()).toBe(true);
    await closeServer();
    expect(isServerRunning()).toBe(false);
    await closeServer();
  });
});
