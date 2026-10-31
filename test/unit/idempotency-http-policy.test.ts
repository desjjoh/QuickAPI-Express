import express, { type Request } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { resolveIdempotencyScope } from '@/common/handlers/http-response.handler';
import { PUBLIC_IDEMPOTENCY_SCOPE } from '@/common/library/models/idempotency.model';
import { idempotencyScopeHash } from '@/common/helpers/idempotency.helper';

describe('HTTP idempotency identity', () => {
  it('derives mounted templates without IDs, query strings or trailing slashes', async () => {
    const app = express();
    const router = express.Router();
    router.patch('/:id', (req, res) => {
      const scope = resolveIdempotencyScope(req, { operation: 'items.update' });
      expect(scope.callerScope).toBe(PUBLIC_IDEMPOTENCY_SCOPE);
      expect(idempotencyScopeHash(scope, 'key')).toBe(
        idempotencyScopeHash(
          { ...scope, callerScope: 'public', route: 'PATCH /api/v1/items/:id' },
          'key',
        ),
      );
      res.json(scope);
    });
    app.use('/api/v1/items', router);
    const first = await request(app)
      .patch('/api/v1/items/one?sort=name')
      .expect(200);
    const second = await request(app).patch('/api/v1/items/two/').expect(200);
    expect(first.body).toEqual(second.body);
    expect(first.body.route).toBe('PATCH /api/v1/items/:id');
  });

  it('preserves collection and root identities', () => {
    for (const [baseUrl, expected] of [
      ['/api/v1/items', 'POST /api/v1/items'],
      ['', 'POST /'],
    ]) {
      expect(
        resolveIdempotencyScope(
          { method: 'POST', baseUrl, route: { path: '/' } } as Request,
          { operation: 'create' },
        ).route,
      ).toBe(expected);
    }
  });

  it('supports explicit route and static or trusted request scope overrides', () => {
    const req = { method: 'POST', baseUrl: '/tenants/123' } as Request;
    for (const scope of [
      'tenant:123',
      (request: Request) => {
        expect(request).toBe(req);
        return 'tenant:123';
      },
    ]) {
      expect(
        resolveIdempotencyScope(req, {
          operation: 'create',
          route: 'POST /tenants/:tenant/items',
          scope,
        }),
      ).toMatchObject({
        callerScope: 'tenant:123',
        route: 'POST /tenants/:tenant/items',
      });
    }
  });

  it('rejects unavailable route metadata and invalid resolver output', () => {
    expect(() =>
      resolveIdempotencyScope({} as Request, { operation: 'create' }),
    ).toThrow();
    for (const scope of [() => '', () => 'x'.repeat(129)]) {
      expect(() =>
        resolveIdempotencyScope({} as Request, {
          operation: 'create',
          route: 'POST /items',
          scope,
        }),
      ).toThrow();
    }
  });
});
