import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '@/config/http-server.config';
import { parseEnv } from '@/config/env.config';
import { LC } from '@/common/handlers/lifecycle.handler';
import { systemService } from '@/api/app/services/system.service';
import { metricsRegistry } from '@/config/metrics.config';

function policy(overrides: NodeJS.ProcessEnv = {}) {
  return parseEnv({
    NODE_ENV: 'production',
    PORT: '3000',
    LOG_LEVEL: 'silent',
    DB_HOST: 'localhost',
    DB_PORT: '3306',
    DB_USER: 'unused',
    DB_PASSWORD: 'unused',
    DB_DATABASE: 'unused',
    ...overrides,
  });
}

afterEach(() => vi.restoreAllMocks());

describe('operational endpoint exposure', () => {
  it.each(['development', 'test', 'production'])(
    'applies %s defaults through the real middleware stack',
    async (NODE_ENV) => {
      const app = createApp(policy({ NODE_ENV }));
      const expected = NODE_ENV === 'production' ? 404 : 200;

      for (const path of [
        '/docs/',
        '/docs-json',
        '/redoc',
        '/info',
        '/system',
        '/metrics',
      ]) {
        expect((await request(app).get(path)).status, path).toBe(expected);
      }
    },
  );

  it.each([
    ['false', 'false', 'false'],
    ['true', 'false', 'false'],
    ['false', 'true', 'false'],
    ['false', 'false', 'true'],
    ['true', 'true', 'true'],
  ])(
    'independently controls docs=%s diagnostics=%s metrics=%s',
    async (DOCS_ENABLED, DIAGNOSTICS_ENABLED, METRICS_ENABLED) => {
      const app = createApp(
        policy({ DOCS_ENABLED, DIAGNOSTICS_ENABLED, METRICS_ENABLED }),
      );

      for (const [path, enabled] of [
        ['/docs/', DOCS_ENABLED],
        ['/docs-json', DOCS_ENABLED],
        ['/redoc', DOCS_ENABLED],
        ['/info', DIAGNOSTICS_ENABLED],
        ['/system', DIAGNOSTICS_ENABLED],
        ['/metrics', METRICS_ENABLED],
      ]) {
        expect((await request(app).get(path)).status, path).toBe(
          enabled === 'true' ? 200 : 404,
        );
      }
    },
  );

  it('blocks anonymous, forwarded, HEAD, trailing-slash, and documentation asset access when disabled', async () => {
    const diagnostics = vi.spyOn(systemService, 'getSystemDiagnostics');
    const info = vi.spyOn(systemService, 'collectRuntimeInfo');
    const metrics = vi.spyOn(metricsRegistry, 'metrics');
    const app = createApp(
      policy({
        NODE_ENV: 'development',
        DOCS_ENABLED: 'false',
        DIAGNOSTICS_ENABLED: 'false',
        METRICS_ENABLED: 'false',
      }),
    );

    for (const path of [
      '/docs',
      '/docs/',
      '/docs/swagger-ui-init.js',
      '/docs/swagger-ui.css',
      '/docs-json',
      '/redoc',
      '/INFO',
      '/system/',
      '/metrics/',
    ]) {
      expect(
        (await request(app).get(path).set('X-Forwarded-For', '127.0.0.1'))
          .status,
        path,
      ).toBe(404);
      expect((await request(app).head(path)).status, path).toBe(404);
    }
    expect(diagnostics).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
    expect(metrics).not.toHaveBeenCalled();
  });

  it.each(['up', 'down'] as const)(
    'keeps public probes minimal with a dependency %s',
    async (status) => {
      const check = vi
        .spyOn(LC, 'checkDependencies')
        .mockResolvedValue([
          { name: 'private-database-name', status, response_time_ms: 7 },
        ]);
      vi.spyOn(LC, 'isReady').mockReturnValue(true);
      const app = createApp(policy());
      const health = await request(app).get('/health');

      expect(health.status).toBe(200);
      expect(check).not.toHaveBeenCalled();
      const ready = await request(app).get('/ready');

      expect(ready.status).toBe(status === 'up' ? 200 : 503);
      expect(ready.body).toEqual({
        ready: status === 'up',
        status: status === 'up' ? 'ready' : 'not_ready',
        timestamp: expect.any(String),
      });
      expect(ready.text).not.toContain('private-database-name');
    },
  );
});
