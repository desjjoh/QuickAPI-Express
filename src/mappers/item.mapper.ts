import type { Item } from '@/entities/item.entity';
import { OutputValidationError } from '@/exceptions/http.exception';
import {
  type ItemListResponse,
  ItemListResponseSchema,
  type ItemResponse,
  ItemResponseSchema,
} from '@/models/item.model';
import type { ListDTOParams } from '@/types/pagination';

export function toItemDTO(entity: Item): ItemResponse {
  const { success, error, data } = ItemResponseSchema.safeParse(entity);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}

export function toItemListDTO(payload: ListDTOParams<Item>): ItemListResponse {
  const { success, error, data } = ItemListResponseSchema.safeParse({
    ...payload,
    data: payload.items.map(toItemDTO),
  });

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
