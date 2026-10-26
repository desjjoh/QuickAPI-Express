import { describe, expect, it, vi } from 'vitest';
import { ItemService } from '@/api/v1/items/services/items.service';
import type { ItemEntity } from '@/database/entities/_item.entity';
import type { EntityManager } from 'typeorm';
import type { ItemRepository } from '@/database/repositories/item.repo';

const item: ItemEntity = {
  id: 'abcdefghijklmnop',
  version: 1,
  name: 'Original',
  price: 2,
  description: 'Keep',
  createdAt: new Date(),
  updatedAt: new Date(),
};
function fixture() {
  const manager = {} as EntityManager;
  const repository = {
    transaction: vi.fn(
      async <T>(work: (manager: EntityManager) => Promise<T>) => work(manager),
    ) as ItemRepository['transaction'],
    create: vi.fn().mockResolvedValue(item),
    get_many: vi.fn(),
    get_by_id: vi.fn().mockResolvedValue(item),
    get_by_id_for_update: vi.fn().mockResolvedValue(item),
    update: vi.fn().mockResolvedValue(item),
    remove: vi.fn().mockResolvedValue(item),
  };
  return { manager, repository, service: new ItemService(repository) };
}

describe('item application service', () => {
  it('preserves omitted PATCH fields and clears an omitted PUT description', async () => {
    const { service, repository, manager } = fixture();
    await service.update({
      params: { id: item.id },
      body: { price: 4, expected_version: 1 },
    });
    expect(repository.update).toHaveBeenLastCalledWith(
      item,
      { price: 4 },
      1,
      manager,
    );
    await service.replace({
      params: { id: item.id },
      body: { name: 'Replacement', price: 5, expected_version: 1 },
    });
    expect(repository.update).toHaveBeenLastCalledWith(
      item,
      {
        name: 'Replacement',
        price: 5,
        description: null,
      },
      1,
      manager,
    );
    expect(repository.get_by_id_for_update).toHaveBeenLastCalledWith(
      item.id,
      manager,
    );
  });

  it.each(['get', 'update', 'replace', 'remove'] as const)(
    'preserves the missing-item contract for %s without a write',
    async (method) => {
      const { service, repository } = fixture();
      repository.get_by_id.mockResolvedValue(null);
      repository.get_by_id_for_update.mockResolvedValue(null);
      const pending =
        method === 'get'
          ? service[method]({ params: { id: item.id } })
          : service[method]({
              params: { id: item.id },
              body: { name: 'Changed', price: 3, expected_version: 1 },
            });
      await expect(pending).rejects.toMatchObject({
        status: 404,
        message: 'No item exists with the provided identifier.',
      });
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.remove).not.toHaveBeenCalled();
    },
  );

  it.each(['update', 'replace', 'remove'] as const)(
    'rejects stale %s before a write',
    async (method) => {
      const { service, repository } = fixture();
      repository.get_by_id_for_update.mockResolvedValue({
        ...item,
        version: 2,
      });
      await expect(
        service[method]({
          params: { id: item.id },
          body: { expected_version: 1, name: 'Changed', price: 3 },
        }),
      ).rejects.toHaveProperty('status', 409);
      expect(repository.update).not.toHaveBeenCalled();
      expect(repository.remove).not.toHaveBeenCalled();
    },
  );

  it('uses the transaction manager for creation and deletion', async () => {
    const { service, repository, manager } = fixture();
    await service.create({ body: { name: 'New', price: 1 } });
    expect(repository.create).toHaveBeenCalledExactlyOnceWith(
      { name: 'New', price: 1 },
      manager,
    );
    await service.remove({
      params: { id: item.id },
      body: { expected_version: 1 },
    });
    expect(repository.get_by_id_for_update).toHaveBeenCalledExactlyOnceWith(
      item.id,
      manager,
    );
    expect(repository.remove).toHaveBeenCalledExactlyOnceWith(item, 1, manager);
    expect(repository.transaction).toHaveBeenCalledTimes(2);
  });
});
