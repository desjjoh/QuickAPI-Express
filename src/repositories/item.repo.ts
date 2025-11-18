import { AppDataSource } from '@/config/database.config';
import { Item } from '@/entities/item.entity';
import type { CreateItemInput, UpdateItemInput } from '@/models/item.model';
import type { ListDTOParams } from '@/types/pagination';
import type { PaginationQuery } from '@/models/pagination.model';
import { NotFoundError } from '@/exceptions/http.exception';

export class ItemRepository {
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

  async get(id: string): Promise<Item> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundError();

    return item;
  }

  async update(id: string, data: UpdateItemInput): Promise<Item> {
    const item = await this.get(id);
    const merged = this.repo.merge(item, data);

    return this.repo.save(merged);
  }

  async remove(id: string): Promise<Item> {
    const item = await this.get(id);

    return this.repo.remove(item);
  }
}

export const itemRepository = new ItemRepository();
