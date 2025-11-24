import { AppDataSource } from '@/config/database.config';
import { Item } from '@/database/entities/item.entity';
import type { CreateItemInput, UpdateItemInput } from '@/models/item.model';
import type { ListDTOParams } from '@/types/pagination';
import type { PaginationQuery } from '@/models/pagination.model';

export class ItemRepository {
  private repo = AppDataSource.getRepository(Item);

  public async create(data: CreateItemInput): Promise<Item> {
    const item = this.repo.create(data);
    await this.repo.save(item);

    return item;
  }

  async get_all(query: PaginationQuery): Promise<ListDTOParams<Item>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const [items, total] = await this.repo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total, page, limit };
  }

  async get_by_id(id: string): Promise<Item | null> {
    const item = await this.repo.findOne({ where: { id } });

    return item;
  }

  async update(obj: Item, data: UpdateItemInput): Promise<Item> {
    const merged = this.repo.merge(obj, data);

    return this.repo.save(merged);
  }

  async remove(obj: Item): Promise<Item> {
    return this.repo.remove(obj);
  }
}

export const itemRepository = new ItemRepository();
