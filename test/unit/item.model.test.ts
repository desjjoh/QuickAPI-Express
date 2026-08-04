import { describe, expect, it } from 'vitest';

import type { ItemEntity } from '@/database/entities/_item.entity';
import { toItemDTO } from '@/api/v1/items/models/item.model';

describe('toItemDTO', () => {
  it('converts the maximum MySQL DECIMAL(10, 2) string to the documented number', () => {
    const entity = {
      id: 'A1b2C3d4E5f6G7h8',
      name: 'Precise item',
      price: '99999999.99',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    } as ItemEntity;

    const dto = toItemDTO(entity);

    expect(dto.price).toBe(99_999_999.99);
    expect(typeof dto.price).toBe('number');
  });

  it('preserves a null description returned by the database', () => {
    const entity = {
      id: 'A1b2C3d4E5f6G7h8',
      name: 'Item without a description',
      price: '12.50',
      description: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    } as ItemEntity;

    expect(toItemDTO(entity)).toMatchObject({ description: null, price: 12.5 });
  });
});
