import type { ItemEntity } from '@/database/entities/_item.entity';
import { describe, expect, it } from 'vitest';
import { OutputValidationError } from '@/common/exceptions/http.exception';
import { toItemDTO, toItemListDTO } from '@/api/v1/items/models/item.model';
import { toRootDTO } from '@/api/app/models/root.model';
import { toReadyDTO } from '@/api/app/models/ready.model';

const item = {
  id: 'A1b2C3d4E5f6G7h8',
  name: 'Sword',
  price: '12.50',
  description: 'Sharp',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
} as ItemEntity;

describe('output DTO validation', () => {
  it('returns validated entity and list DTOs', () => {
    expect(toItemDTO(item)).toMatchObject({ name: 'Sword', price: 12.5 });
    expect(toItemListDTO({ items: [item], total: 1, page: 1, limit: 25 })).toMatchObject({
      total: 1,
      page: 1,
      limit: 25,
      data: [{ price: 12.5 }],
    });
    expect(toRootDTO({ message: 'hello' })).toEqual({ message: 'hello' });
    expect(toReadyDTO({ ready: true })).toEqual({ ready: true });
  });

  it.each([
    () => toItemDTO({ ...item, id: 'bad' }),
    () => toItemListDTO({ items: [item], total: -1, page: 1, limit: 25 }),
    () => toRootDTO({ message: 1 } as never),
    () => toReadyDTO({ ready: 'yes' } as never),
  ])('turns invalid output into OutputValidationError', produce => {
    expect(produce).toThrow(OutputValidationError);
  });
});
