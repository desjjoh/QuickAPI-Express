import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '@/config/http-server.config';
import { env } from '@/config/env.config';
import { itemRepository } from '@/database/repositories/item.repo';
import type { ItemEntity } from '@/database/entities/_item.entity';
import { RequestWorkTracker } from '@/common/handlers/request-lifecycle.handler';
import { deferred } from '../helpers/http';

vi.mock('@/database/repositories/item.repo', () => ({
  itemRepository: { get_by_id: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

afterEach(() => vi.clearAllMocks());

describe('item mutations after a response deadline', () => {
  it.each(['patch', 'put', 'delete'] as const)(
    'does not start %s after a delayed lookup outlives its request',
    async (method) => {
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
      expect(itemRepository.update).not.toHaveBeenCalled();
      expect(itemRepository.remove).not.toHaveBeenCalled();
    },
  );
});
