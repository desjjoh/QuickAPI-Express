import { Brackets, type EntityManager, type SelectQueryBuilder } from 'typeorm';

import { ConflictError } from '@/common/exceptions/http.exception';
import { runInTransaction } from '@/common/helpers/transaction.helper';
import { AppDataSource } from '@/config/database.config';
import type { ListDTOParams } from '@/common/library/models/pagination.model';
import type { Base } from '@/common/library/models/base.model';

import { ItemEntity } from '../entities/_item.entity';

type ItemData = Omit<Base<ItemEntity>, 'version'>;

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

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return runInTransaction(this.repo.manager, work);
  }

  private repository(manager?: EntityManager) {
    return manager ? manager.getRepository(ItemEntity) : this.repo;
  }

  // CREATE
  public async create(
    data: ItemData,
    manager?: EntityManager,
  ): Promise<ItemEntity> {
    const item: ItemEntity = this.repository(manager).create({
      name: data.name,
      price: data.price,
      description: data.description,
      version: 1,
    });

    await this.repository(manager).save(item);

    return item;
  }

  // READ
  public async get_all(): Promise<ItemEntity[]> {
    return this.repo.find({
      order: { createdAt: 'DESC' },
    });
  }

  async get_many(
    payload: ItemPaginationQuery,
  ): Promise<ListDTOParams<ItemEntity>> {
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

    const query: SelectQueryBuilder<ItemEntity> = this.repo
      .createQueryBuilder('item')
      .andWhere(
        new Brackets((searchQuery) => {
          searchQuery
            .where('item.name LIKE :pattern')
            .orWhere('item.description LIKE :pattern');
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

  async get_by_id(
    id: string,
    manager?: EntityManager,
  ): Promise<ItemEntity | null> {
    const item: ItemEntity | null = await this.repository(manager).findOne({
      where: { id },
    });

    return item;
  }

  /** A current locking read makes missing-vs-stale outcomes deterministic under races. */
  async get_by_id_for_update(
    id: string,
    manager: EntityManager,
  ): Promise<ItemEntity | null> {
    return this.repository(manager).findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  // UPDATE: always compare the caller's revision in SQL, including unchanged values.
  async update(
    obj: ItemEntity,
    data: Partial<ItemData>,
    expectedVersion: number,
    manager: EntityManager,
  ): Promise<ItemEntity> {
    const repository = this.repository(manager);
    const result = await repository
      .createQueryBuilder()
      .update(ItemEntity)
      .set({
        name: data.name,
        price: data.price,
        description: data.description,
        version: () => '`version` + 1',
      })
      .where('`id` = :id AND `version` = :version AND `version` < :maximum', {
        id: obj.id,
        version: expectedVersion,
        maximum: 4294967295,
      })
      .execute();

    if (result.affected !== 1)
      throw new ConflictError(
        'Item version conflict; reload the item before retrying.',
      );

    return repository.findOneOrFail({ where: { id: obj.id } });
  }

  // DELETE: use the same revision condition, returning the last persisted representation.
  async remove(
    obj: ItemEntity,
    expectedVersion: number,
    manager: EntityManager,
  ): Promise<ItemEntity> {
    const repository = this.repository(manager);
    const result = await repository
      .createQueryBuilder()
      .delete()
      .where({ id: obj.id, version: expectedVersion })
      .execute();

    if (result.affected !== 1)
      throw new ConflictError(
        'Item version conflict; reload the item before retrying.',
      );

    return repository.create({ ...obj });
  }
}

export const itemRepository = new ItemRepository();
