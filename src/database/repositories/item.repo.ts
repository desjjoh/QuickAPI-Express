import { AppDataSource } from '@/config/database.config';
import { Item } from '@/database/entities/item.entity';
import type { CreateItemInput, ItemPaginationQuery, UpdateItemInput } from '@/models/item.model';
import type { ListDTOParams } from '@/types/pagination';

export class ItemRepository {
  private repo = AppDataSource.getRepository(Item);

  public async create(data: CreateItemInput): Promise<Item> {
    const item: Item = this.repo.create(data);
    await this.repo.save(item);

    return item;
  }

  async get_all(payload: ItemPaginationQuery): Promise<ListDTOParams<Item>> {
    const page: number = payload.page ?? 1;
    const limit: number = payload.limit ?? 25;

    const search: string = payload.search ?? '';

    const order: 'ASC' | 'DESC' = payload.order ?? 'ASC';
    const sort: 'createdAt' | 'name' | 'price' = payload.sort ?? 'price';

    const [items, total] = await this.repo
      .createQueryBuilder('item')
      .where('item.name like :pattern OR item.description like :pattern', {
        pattern: `%${search.trim()}%`,
      })
      .orderBy({ [sort]: order })
      .skip((page - 1) * limit)
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
