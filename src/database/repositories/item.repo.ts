import { AppDataSource } from '@/config/database.config';
import { Item } from '@/database/entities/item.entity';

import type { ListDTOParams } from '@/library/models/pagination.model';
import type { SelectQueryBuilder } from 'typeorm';
import type { Base } from '@/library/models/base.model';

type ItemPaginationQuery = {
  page: number;
  limit: number;

  search?: string;

  sort?: 'createdAt' | 'name' | 'price';
  order?: 'ASC' | 'DESC';

  min_price?: number;
  max_price?: number;
};

export class ItemRepository {
  private repo = AppDataSource.getRepository(Item);

  // CREATE
  public async create(data: Base<Item>): Promise<Item> {
    const item: Item = this.repo.create(data);
    await this.repo.save(item);

    return item;
  }

  // READ
  public async get_all(): Promise<Item[]> {
    return this.repo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async get_many(payload: ItemPaginationQuery): Promise<ListDTOParams<Item>> {
    const page: number = payload.page;
    const limit: number = payload.limit;

    const search: string = payload.search ?? '';

    const order: 'ASC' | 'DESC' = payload.order ?? 'ASC';
    const sort: 'createdAt' | 'name' | 'price' = payload.sort ?? 'price';

    const query: SelectQueryBuilder<Item> = this.repo
      .createQueryBuilder('item')
      .andWhere('item.name LIKE :pattern')
      .orWhere('item.description LIKE :pattern', { pattern: `%${search.trim()}%` });

    if (payload.min_price !== undefined) {
      query.andWhere('item.price >= :min', { min: payload.min_price });
    }

    if (payload.max_price !== undefined) {
      query.andWhere('item.price <= :max', { max: payload.max_price });
    }

    const [items, total] = await query
      .orderBy({ [sort]: order })
      .skip((payload.page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items, total, page, limit };
  }

  async get_by_id(id: string): Promise<Item | null> {
    const item: Item | null = await this.repo.findOne({ where: { id } });

    return item;
  }

  // UPDATE
  async update(obj: Item, data: Partial<Base<Item>>): Promise<Item> {
    const merged: Item = this.repo.merge(obj, data);
    await this.repo.save(merged);

    return this.repo.findOneOrFail({ where: { id: obj.id } });
  }

  // DELETE
  async remove(obj: Item): Promise<Item> {
    return this.repo.remove(obj);
  }
}

export const itemRepository = new ItemRepository();
