import {
  itemRepository,
  type ItemRepository,
} from '@/database/repositories/item.repo';
import type { ListDTOParams } from '@/common/library/models/pagination.model';
import type { ItemEntity } from '@/database/entities/_item.entity';
import { NotFoundError } from '@/common/exceptions/http.exception';
import type { IdRouteParams } from '@/common/library/models/parameters.model';
import type { CreateItemInput } from '../models/item-create.model';
import type { UpdateItemInput } from '../models/item-update.model';
import type { ItemPaginationQuery } from '../models/pagination-query.model';

type ItemPersistence = Pick<
  ItemRepository,
  'create' | 'get_many' | 'get_by_id' | 'update' | 'remove' | 'transaction'
>;

export class ItemService {
  public constructor(private readonly repo: ItemPersistence = itemRepository) {}

  public create = ({ body }: { body: CreateItemInput }): Promise<ItemEntity> =>
    this.repo.transaction((manager) => this.repo.create(body, manager));

  public list = ({
    query,
  }: {
    query: ItemPaginationQuery;
  }): Promise<ListDTOParams<ItemEntity>> => this.repo.get_many(query);

  public get = async ({
    params,
  }: {
    params: IdRouteParams;
  }): Promise<ItemEntity> => {
    const item = await this.repo.get_by_id(params.id);

    return this.requireItem(item);
  };

  public update = ({
    params,
    body,
  }: {
    params: IdRouteParams;
    body: UpdateItemInput;
  }): Promise<ItemEntity> =>
    this.repo.transaction(async (manager) => {
      const item = await this.repo.get_by_id(params.id, manager);

      return this.repo.update(this.requireItem(item), body, manager);
    });

  public replace = ({
    params,
    body,
  }: {
    params: IdRouteParams;
    body: CreateItemInput;
  }): Promise<ItemEntity> =>
    this.repo.transaction(async (manager) => {
      const item = await this.repo.get_by_id(params.id, manager);

      return this.repo.update(
        this.requireItem(item),
        {
          ...body,
          description: body.description ?? null,
        },
        manager,
      );
    });

  public remove = ({
    params,
  }: {
    params: IdRouteParams;
  }): Promise<ItemEntity> =>
    this.repo.transaction(async (manager) => {
      const item = await this.repo.get_by_id(params.id, manager);

      return this.repo.remove(this.requireItem(item), manager);
    });

  private requireItem(item: ItemEntity | null): ItemEntity {
    if (!item)
      throw new NotFoundError('No item exists with the provided identifier.');

    return item;
  }
}

export const itemService = new ItemService();
