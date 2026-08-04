import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ItemRepository } from '@/database/repositories/item.repo';
import {
  connectTestDatabase,
  disconnectTestDatabase,
  resetTestDatabase,
} from '../helpers/database/database';

const repo = new ItemRepository();

async function seedItems() {
  return Promise.all([
    repo.create({ name: 'Bronze Sword', description: 'starter blade', price: 10 }),
    repo.create({ name: 'Iron Shield', description: 'sturdy guard', price: 30 }),
    repo.create({ name: 'Silver Sword', description: 'bright blade', price: 50 }),
    repo.create({ name: 'Golden Crown', description: 'royal treasure', price: 90 }),
  ]);
}

beforeAll(connectTestDatabase);
beforeEach(resetTestDatabase);
afterAll(disconnectTestDatabase);

describe('ItemRepository with migrated MySQL', () => {
  it('creates an item and gets it by ID', async () => {
    const created = await repo.create({
      name: 'Potion',
      description: 'restores health',
      price: 4.5,
    });

    expect(created).toMatchObject({ name: 'Potion', description: 'restores health', price: 4.5 });
    expect(created.id).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(await repo.get_by_id(created.id)).toMatchObject({ id: created.id, name: 'Potion' });
  });

  it('partially updates, fully replaces, and deletes an item', async () => {
    const created = await repo.create({ name: 'Old', description: 'remove me', price: 12 });
    const patched = await repo.update(created, { price: 15 });
    expect(patched).toMatchObject({ name: 'Old', description: 'remove me', price: '15.00' });

    const replaced = await repo.update(patched, { name: 'New', description: null, price: 20 });
    expect(replaced).toMatchObject({ name: 'New', description: null, price: '20.00' });

    const removed = await repo.remove(replaced);
    expect(removed).toMatchObject({
      id: created.id,
      name: 'New',
      description: null,
      price: '20.00',
    });

    expect(await repo.get_by_id(created.id)).toBeNull();
  });

  it('paginates and sorts by each supported field', async () => {
    await seedItems();

    const firstPage = await repo.get_many({ page: 1, limit: 2, sort: 'price', order: 'DESC' });
    const secondPage = await repo.get_many({ page: 2, limit: 2, sort: 'price', order: 'DESC' });
    expect(firstPage).toMatchObject({ total: 4, page: 1, limit: 2 });
    expect(firstPage.items.map(item => Number(item.price))).toEqual([90, 50]);
    expect(secondPage.items.map(item => Number(item.price))).toEqual([30, 10]);

    const byName = await repo.get_many({ page: 1, limit: 10, sort: 'name', order: 'ASC' });
    expect(byName.items.map(item => item.name)).toEqual([
      'Bronze Sword',
      'Golden Crown',
      'Iron Shield',
      'Silver Sword',
    ]);

    const byCreation = await repo.get_many({
      page: 1,
      limit: 10,
      sort: 'createdAt',
      order: 'DESC',
    });
    expect(byCreation.items).toHaveLength(4);
    expect(
      byCreation.items.every(
        (item, index, all) => index === 0 || all[index - 1]!.createdAt >= item.createdAt,
      ),
    ).toBe(true);
  });

  it('searches names and descriptions and treats empty search as no restriction', async () => {
    await seedItems();

    const name = await repo.get_many({ page: 1, limit: 10, search: ' sword ' });
    expect(name.items.map(item => item.name)).toEqual(['Bronze Sword', 'Silver Sword']);
    const description = await repo.get_many({ page: 1, limit: 10, search: 'guard' });
    expect(description.items.map(item => item.name)).toEqual(['Iron Shield']);
    expect((await repo.get_many({ page: 1, limit: 10, search: '   ' })).total).toBe(4);
  });

  it('applies minimum, maximum, and combined search/price filters', async () => {
    await seedItems();

    expect(
      (await repo.get_many({ page: 1, limit: 10, min_price: 50 })).items.map(item => item.name),
    ).toEqual(['Silver Sword', 'Golden Crown']);
    expect(
      (await repo.get_many({ page: 1, limit: 10, max_price: 30 })).items.map(item => item.name),
    ).toEqual(['Bronze Sword', 'Iron Shield']);
    expect(
      (
        await repo.get_many({
          page: 1,
          limit: 10,
          search: 'blade',
          min_price: 20,
          max_price: 60,
        })
      ).items.map(item => item.name),
    ).toEqual(['Silver Sword']);
  });

  it('does not let a name match outside the price range bypass price filtering', async () => {
    await seedItems();

    const result = await repo.get_many({
      page: 1,
      limit: 10,
      search: 'Golden Crown',
      min_price: 10,
      max_price: 50,
    });

    expect(result).toMatchObject({ total: 0, items: [] });
  });
});
