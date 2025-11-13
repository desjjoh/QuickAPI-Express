import { AppDataSource } from '@/config/typeorm.config';
import { Item } from '@/entities/item.entity';
import type { CreateItemInput, UpdateItemInput } from '@/models/item.model';
import type { ListDTOParams } from '@/types/pagination';
import type { PaginationQuery } from '@/models/pagination.model';

export class ItemService {
  private repo = AppDataSource.getRepository(Item);

  public async create(data: CreateItemInput): Promise<Item> {
    const item = this.repo.create(data);
    await this.repo.save(item);

    return item;
  }

  async list(query: PaginationQuery): Promise<ListDTOParams<Item>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;

    const [items, total] = await this.repo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total, page, limit };
  }

  async get(id: number): Promise<Item> {
    return this.repo.findOneOrFail({ where: { id } });
  }

  async update(id: number, data: UpdateItemInput): Promise<Item> {
    const item = await this.get(id);
    const merged = this.repo.merge(item, data);

    return this.repo.save(merged);
  }

  async remove(id: number): Promise<Item> {
    const item = await this.get(id);
    return this.repo.remove(item);
  }
}

export const itemService = new ItemService();
