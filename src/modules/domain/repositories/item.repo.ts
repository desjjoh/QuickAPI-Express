import { Brackets, type SelectQueryBuilder } from 'typeorm';

import { AppDataSource } from '@/config/database.config';
import type { ListDTOParams } from '@/common/library/models/pagination.model';
import type { Base } from '@/common/library/models/base.model';

import { ItemEntity } from '../entities/_item.entity';

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
  private repo = AppDataSource.getRepository(ItemEntity);

  // CREATE
  public async create(data: Base<ItemEntity>): Promise<ItemEntity> {
    const item: ItemEntity = this.repo.create(data);
    await this.repo.save(item);

    return item;
  }

  // READ
  public async get_all(): Promise<ItemEntity[]> {
    return this.repo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async get_many(payload: ItemPaginationQuery): Promise<ListDTOParams<ItemEntity>> {
    const page: number = payload.page;
    const limit: number = payload.limit;

    const search: string = payload.search ?? '';

    const order: 'ASC' | 'DESC' = payload.order ?? 'ASC';
    const sort: 'createdAt' | 'name' | 'price' = payload.sort ?? 'price';
    const sortColumn: Record<typeof sort, string> = {
      createdAt: 'item.createdAt',
      name: 'item.name',
      price: 'item.price',
    };

    const query: SelectQueryBuilder<ItemEntity> = this.repo.createQueryBuilder('item').andWhere(
      new Brackets(searchQuery => {
        searchQuery.where('item.name LIKE :pattern').orWhere('item.description LIKE :pattern');
      }),
      { pattern: `%${search.trim()}%` },
    );

    if (payload.min_price !== undefined) {
      query.andWhere('item.price >= :min', { min: payload.min_price });
    }

    if (payload.max_price !== undefined) {
      query.andWhere('item.price <= :max', { max: payload.max_price });
    }

    const [items, total] = await query
      .orderBy({ [sortColumn[sort]]: order })
      .skip((payload.page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items, total, page, limit };
  }

  async get_by_id(id: string): Promise<ItemEntity | null> {
    const item: ItemEntity | null = await this.repo.findOne({ where: { id } });

    return item;
  }

  // UPDATE
  async update(obj: ItemEntity, data: Partial<Base<ItemEntity>>): Promise<ItemEntity> {
    const merged: ItemEntity = this.repo.merge(obj, data);
    await this.repo.save(merged);

    return this.repo.findOneOrFail({ where: { id: obj.id } });
  }

  // DELETE
  async remove(obj: ItemEntity): Promise<ItemEntity> {
    return this.repo.remove(obj);
  }
}

export const itemRepository = new ItemRepository();
