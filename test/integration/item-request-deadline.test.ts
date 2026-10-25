import request from 'supertest';
import { AppDataSource } from '@/config/database.config';
import { runInTransaction } from '@/common/helpers/transaction.helper';
import type { EntityManager } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '@/config/http-server.config';
import { env } from '@/config/env.config';
import { itemRepository } from '@/database/repositories/item.repo';
import type { ItemEntity } from '@/database/entities/_item.entity';
import { RequestWorkTracker } from '@/common/handlers/request-lifecycle.handler';
import { deferred } from '../helpers/http';

vi.mock('@/database/repositories/item.repo', () => ({
  itemRepository: {
    transaction: vi.fn(),
    get_by_id: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('item mutations after a response deadline', () => {
  it.each(['patch', 'put', 'delete'] as const)(
    'rolls back %s after a delayed lookup outlives its request',
    async (method) => {
      const commit = vi.fn();
      const rollback = vi.fn();
      const manager = {
        connection: AppDataSource,
        queryRunner: { isTransactionActive: true },
      } as unknown as EntityManager;
      vi.spyOn(AppDataSource.manager, 'transaction').mockImplementation(
        async (work: unknown) => {
          try {
            const result = await (
              work as (manager: EntityManager) => Promise<unknown>
            )(manager);
            commit();
            return result;
          } catch (error) {
            rollback();
            throw error;
          }
        },
      );
      vi.mocked(itemRepository.transaction).mockImplementation((work) =>
        runInTransaction(manager, work),
      );
      const lookup = deferred<ItemEntity>();
      vi.mocked(itemRepository.get_by_id).mockReturnValue(lookup.promise);
      const work = new RequestWorkTracker();
      const app = createApp({ ...env, REQUEST_TIMEOUT_MS: 30 }, work);
      const pending = request(app)[method]('/api/v1/items/abcdefghijklmnop');
      if (method !== 'delete') pending.send({ name: 'Updated', price: 7 });
      try {
        expect((await pending.timeout(1_000)).status).toBe(408);
        expect(itemRepository.get_by_id).toHaveBeenCalledTimes(1);
      } finally {
        lookup.resolve({ id: 'abcdefghijklmnop' } as ItemEntity);
        await work.drain();
      }
      expect(commit).not.toHaveBeenCalled();
      expect(rollback).toHaveBeenCalledTimes(1);
      expect(
        method === 'delete' ? itemRepository.remove : itemRepository.update,
      ).toHaveBeenCalledTimes(1);
    },
  );
});
