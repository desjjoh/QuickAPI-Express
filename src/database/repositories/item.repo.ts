import { AppDataSource } from '@/config/database.config';
import { Item } from '@/database/entities/item.entity';
import type { CreateItemInput, ItemPaginationQuery, UpdateItemInput } from '@/models/item.model';
import type { ListDTOParams } from '@/types/pagination';
import type { SelectQueryBuilder } from 'typeorm';

export class ItemRepository {
  private repo = AppDataSource.getRepository(Item);

  public async create(data: CreateItemInput): Promise<Item> {
    const item: Item = this.repo.create(data);
    await this.repo.save(item);

    return item;
  }

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

  async update(obj: Item, data: UpdateItemInput): Promise<Item> {
    const merged: Item = this.repo.merge(obj, data);

    return this.repo.save(merged);
  }

  async remove(obj: Item): Promise<Item> {
    return this.repo.remove(obj);
  }
}

export const itemRepository = new ItemRepository();
