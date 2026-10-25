import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '@/config/database.config';
import { jsonHandler } from '@/common/handlers/http-response.handler';
import { RequestWorkTracker } from '@/common/handlers/request-lifecycle.handler';
import { requestTimeout } from '@/common/middleware/request-timeout.middleware';
import { errorHandler } from '@/common/middleware/error-handler.middleware';
import { deferred } from '../helpers/http';

afterEach(() => vi.restoreAllMocks());

describe('transactional JSON handler commit ordering', () => {
  it.each([true, false])(
    'sends success only after a successful commit (commit succeeds: %s)',
    async (succeeds) => {
      const app = express();
      const work = new RequestWorkTracker();
      const prepared = deferred();
      const commit = deferred();
      let ended = false;
      let responseStatus: number | undefined;
      app.use(work.admit, requestTimeout(1000));
      app.use((_req, res, next) => {
        res.once('finish', () => {
          ended = true;
        });
        next();
      });
      vi.spyOn(AppDataSource.manager, 'transaction').mockImplementation(
        async (callback: unknown) => {
          const result = await (
            callback as (manager: EntityManager) => Promise<unknown>
          )(AppDataSource.manager);
          prepared.resolve();
          await commit.promise;
          if (!succeeds) throw new Error('Commit failed');
          return result;
        },
      );
      const dto = vi.fn(() => ({ value: 1 }));
      app.post(
        '/',
        jsonHandler(() => 1, dto, { transaction: true, status: 201 }),
      );
      app.use(errorHandler);
      const pending = request(app)
        .post('/')
        .then((response) => {
          responseStatus = response.status;
          return response;
        });
      try {
        await prepared.promise;
        expect(ended).toBe(false);
        expect(responseStatus).toBeUndefined();
        expect(dto).toHaveBeenCalledTimes(1);
        commit.resolve();
        const response = await pending;
        expect(response.status).toBe(succeeds ? 201 : 500);
        if (succeeds) expect(response.body).toEqual({ value: 1 });
        else expect(response.body.message).toBe('Internal Server Error');
        expect(dto).toHaveBeenCalledTimes(1);
      } finally {
        commit.resolve();
        await pending;
        await work.drain();
      }
    },
  );
});
