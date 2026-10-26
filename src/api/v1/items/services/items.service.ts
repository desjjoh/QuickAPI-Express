import {
  itemRepository,
  type ItemRepository,
} from '@/database/repositories/item.repo';
import type { ListDTOParams } from '@/common/library/models/pagination.model';
import type { ItemEntity } from '@/database/entities/_item.entity';
import {
  ConflictError,
  NotFoundError,
} from '@/common/exceptions/http.exception';
import type { IdRouteParams } from '@/common/library/models/parameters.model';
import type { CreateItemInput } from '../models/item-create.model';
import type { ReplaceItemInput } from '../models/item-replace.model';
import type { ItemVersionInput } from '../models/item-version.model';
import type { UpdateItemInput } from '../models/item-update.model';
import type { ItemPaginationQuery } from '../models/pagination-query.model';

type ItemPersistence = Pick<
  ItemRepository,
  | 'create'
  | 'get_many'
  | 'get_by_id'
  | 'get_by_id_for_update'
  | 'update'
  | 'remove'
  | 'transaction'
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
      const { expected_version, ...changes } = body;
      const item = this.requireVersion(
        await this.repo.get_by_id_for_update(params.id, manager),
        expected_version,
      );

      return this.repo.update(item, changes, expected_version, manager);
    });

  public replace = ({
    params,
    body,
  }: {
    params: IdRouteParams;
    body: ReplaceItemInput;
  }): Promise<ItemEntity> =>
    this.repo.transaction(async (manager) => {
      const { expected_version, ...changes } = body;
      const item = this.requireVersion(
        await this.repo.get_by_id_for_update(params.id, manager),
        expected_version,
      );

      return this.repo.update(
        item,
        { ...changes, description: changes.description ?? null },
        expected_version,
        manager,
      );
    });

  public remove = ({
    params,
    body,
  }: {
    params: IdRouteParams;
    body: ItemVersionInput;
  }): Promise<ItemEntity> =>
    this.repo.transaction(async (manager) => {
      const item = this.requireVersion(
        await this.repo.get_by_id_for_update(params.id, manager),
        body.expected_version,
      );

      return this.repo.remove(item, body.expected_version, manager);
    });

  private requireVersion(
    item: ItemEntity | null,
    expectedVersion: number,
  ): ItemEntity {
    const current = this.requireItem(item);

    if (current.version !== expectedVersion)
      throw new ConflictError(
        'Item version conflict; reload the item before retrying.',
      );

    return current;
  }

  private requireItem(item: ItemEntity | null): ItemEntity {
    if (!item)
      throw new NotFoundError('No item exists with the provided identifier.');

    return item;
  }
}

export const itemService = new ItemService();
