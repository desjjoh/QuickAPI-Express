import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = {
    andWhere: vi.fn(),
    orderBy: vi.fn(),
    skip: vi.fn(),
    take: vi.fn(),
    getManyAndCount: vi.fn(),
  };
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

import { ItemEntity } from '@/modules/domain/entities/_item.entity';
import { ItemRepository } from '@/modules/domain/repositories/item.repo';

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
    expect(mocks.repo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' } });
  });

  it('builds filtered, sorted pagination queries', async () => {
    const items = [Object.assign(new ItemEntity(), { name: 'Potion', price: 4 })];
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
    expect(mocks.query.orderBy).toHaveBeenCalledWith({ 'item.name': 'DESC' });
    expect(mocks.query.skip).toHaveBeenCalledWith(5);
    expect(mocks.query.take).toHaveBeenCalledWith(5);
  });

  it('uses pagination defaults when optional filters are absent', async () => {
    mocks.query.getManyAndCount.mockResolvedValue([[], 0]);
    await repository.get_many({ page: 1, limit: 10 });
    expect(mocks.query.orderBy).toHaveBeenCalledWith({ 'item.price': 'ASC' });
    expect(mocks.query.andWhere).toHaveBeenCalledOnce();
  });

  it('reads, updates, and removes an item', async () => {
    const item = Object.assign(new ItemEntity(), { id: 'item-id', name: 'Old', price: 1 });
    const merged = Object.assign(item, { name: 'New' });
    mocks.repo.findOne.mockResolvedValue(item);
    mocks.repo.merge.mockReturnValue(merged);
    mocks.repo.findOneOrFail.mockResolvedValue(merged);
    mocks.repo.create.mockImplementation(value => ({ ...value }));

    await expect(repository.get_by_id('item-id')).resolves.toBe(item);
    await expect(repository.update(item, { name: 'New' })).resolves.toBe(merged);
    expect(mocks.repo.save).toHaveBeenCalledWith(merged);
    await expect(repository.remove(merged)).resolves.toMatchObject({ id: 'item-id', name: 'New' });
    expect(mocks.repo.remove).toHaveBeenCalledWith(merged);
  });
});
