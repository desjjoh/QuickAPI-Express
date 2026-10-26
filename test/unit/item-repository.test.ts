import type { EntityManager } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = {
    update: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    andWhere: vi.fn(),
    orderBy: vi.fn(),
    skip: vi.fn(),
    take: vi.fn(),
    getManyAndCount: vi.fn(),
  };
  for (const method of ['update', 'set', 'where', 'delete'] as const)
    query[method].mockReturnValue(query);
  query.execute.mockResolvedValue({ affected: 1 });
  query.andWhere.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.skip.mockReturnValue(query);
  query.take.mockReturnValue(query);

  const repo = {
    create: vi.fn(),
    save: vi.fn(),
    find: vi.fn(),
    createQueryBuilder: vi.fn(() => query),
    findOne: vi.fn(),
    merge: vi.fn(),
    findOneOrFail: vi.fn(),
    remove: vi.fn(),
  };
  return { query, repo };
});

vi.mock('@/config/database.config', () => ({
  AppDataSource: { getRepository: vi.fn(() => mocks.repo) },
}));

import { ItemEntity } from '@/database/entities/_item.entity';
import { ItemRepository } from '@/database/repositories/item.repo';

const repository = new ItemRepository();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.andWhere.mockReturnValue(mocks.query);
  mocks.query.orderBy.mockReturnValue(mocks.query);
  mocks.query.skip.mockReturnValue(mocks.query);
  mocks.query.take.mockReturnValue(mocks.query);
});

describe('ItemRepository', () => {
  it('creates and lists items', async () => {
    const item = Object.assign(new ItemEntity(), { name: 'Potion', price: 4 });
    mocks.repo.create.mockReturnValue(item);
    mocks.repo.find.mockResolvedValue([item]);

    expect(await repository.create({ name: 'Potion', price: 4 })).toBe(item);
    expect(mocks.repo.save).toHaveBeenCalledWith(item);
    expect(await repository.get_all()).toEqual([item]);
    expect(mocks.repo.find).toHaveBeenCalledWith({
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  });

  it('builds filtered, sorted pagination queries', async () => {
    const items = [
      Object.assign(new ItemEntity(), { name: 'Potion', price: 4 }),
    ];
    mocks.query.getManyAndCount.mockResolvedValue([items, 1]);

    await expect(
      repository.get_many({
        page: 2,
        limit: 5,
        search: ' potion ',
        sort: 'name',
        order: 'DESC',
        min_price: 2,
        max_price: 8,
      }),
    ).resolves.toEqual({ items, total: 1, page: 2, limit: 5 });
    expect(mocks.query.andWhere).toHaveBeenCalledTimes(3);
    expect(mocks.query.orderBy).toHaveBeenCalledWith({
      'item.name': 'DESC',
      'item.id': 'DESC',
    });
    expect(mocks.query.skip).toHaveBeenCalledWith(5);
    expect(mocks.query.take).toHaveBeenCalledWith(5);
  });

  it('uses pagination defaults when optional filters are absent', async () => {
    mocks.query.getManyAndCount.mockResolvedValue([[], 0]);
    await repository.get_many({ page: 1, limit: 10 });
    expect(mocks.query.orderBy).toHaveBeenCalledWith({
      'item.price': 'ASC',
      'item.id': 'ASC',
    });
    expect(mocks.query.andWhere).toHaveBeenCalledOnce();
  });

  it('uses SQL revision conditions and rereads within the supplied manager', async () => {
    const item = Object.assign(new ItemEntity(), {
      id: 'item-id',
      name: 'Old',
      price: 1,
      version: 1,
    });
    const updated = { ...item, name: 'New', version: 2 };
    const manager = {
      getRepository: vi.fn(() => mocks.repo),
    } as unknown as EntityManager;
    mocks.repo.findOne.mockResolvedValue(item);
    mocks.repo.findOneOrFail.mockResolvedValue(updated);
    mocks.repo.create.mockImplementation((value) => ({ ...value }));
    await expect(repository.get_by_id('item-id')).resolves.toBe(item);
    await expect(
      repository.update(item, { name: 'New' }, 1, manager),
    ).resolves.toBe(updated);
    expect(mocks.query.where).toHaveBeenCalledWith(
      expect.stringContaining('`version` = :version'),
      { id: item.id, version: 1, maximum: 4294967295 },
    );
    expect(mocks.repo.save).not.toHaveBeenCalled();
    await expect(repository.remove(updated, 2, manager)).resolves.toEqual(
      updated,
    );
    expect(mocks.query.where).toHaveBeenLastCalledWith({
      id: item.id,
      version: 2,
    });
  });

  it('rejects failed revision conditions without returning a successful mutation', async () => {
    const manager = {
      getRepository: () => mocks.repo,
    } as unknown as EntityManager;
    const item = Object.assign(new ItemEntity(), { id: 'item-id', version: 1 });
    mocks.query.execute.mockResolvedValue({ affected: 0 });
    await expect(
      repository.update(item, { price: 2 }, 1, manager),
    ).rejects.toHaveProperty('status', 409);
    await expect(repository.remove(item, 1, manager)).rejects.toHaveProperty(
      'status',
      409,
    );
    expect(mocks.repo.findOneOrFail).not.toHaveBeenCalled();
  });
});
