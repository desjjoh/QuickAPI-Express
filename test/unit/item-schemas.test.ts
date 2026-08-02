import { describe, expect, it } from 'vitest';
import { CreateItemSchema } from '@/modules/api/v1/items/models/item-create.model';
import { UpdateItemSchema } from '@/modules/api/v1/items/models/item-update.model';
import { ItemPaginationQuerySchema } from '@/modules/api/v1/items/models/pagination-query.model';

describe('item input schemas', () => {
  it('accepts creation and partial update payloads', () => {
    expect(CreateItemSchema.parse({ name: 'n', price: '1.25', description: '' })).toEqual({
      name: 'n',
      price: 1.25,
      description: '',
    });
    expect(UpdateItemSchema.parse({ description: 'updated' })).toEqual({ description: 'updated' });
  });

  it('rejects an empty update', () => expect(UpdateItemSchema.safeParse({}).success).toBe(false));

  it.each([
    ['', false],
    ['a', true],
    ['a'.repeat(120), true],
    ['a'.repeat(121), false],
  ] as const)('applies name boundary to length %s', (name, success) =>
    expect(CreateItemSchema.safeParse({ name, price: 1 }).success).toBe(success),
  );

  it.each([
    [undefined, true],
    [null, true],
    ['', true],
    ['a'.repeat(500), true],
    ['a'.repeat(501), false],
  ] as const)('applies description boundaries', (description, success) =>
    expect(CreateItemSchema.safeParse({ name: 'item', price: 1, description }).success).toBe(
      success,
    ),
  );

  it.each([
    [0, false],
    [-1, false],
    ['nope', false],
    [Number.NaN, false],
    [99_999_999.99, true],
    [100_000_000, false],
  ] as const)('requires a finite positive price (%j)', (price, success) =>
    expect(CreateItemSchema.safeParse({ name: 'item', price }).success).toBe(success),
  );
});

describe('item query schema', () => {
  it('coerces pagination and price filters', () =>
    expect(
      ItemPaginationQuerySchema.parse({ page: '2', limit: '100', min_price: '5', max_price: '10' }),
    ).toMatchObject({ page: 2, limit: 100, min_price: 5, max_price: 10 }));
  it.each([{ page: '0' }, { page: '1.5' }, { limit: '0' }, { limit: '101' }, { limit: 'wat' }])(
    'rejects invalid pagination %#',
    query => expect(ItemPaginationQuerySchema.safeParse(query).success).toBe(false),
  );
  it.each([{ min_price: '1.5' }, { min_price: 'wat' }, { max_price: 'NaN' }])(
    'rejects invalid price coercion %#',
    query => expect(ItemPaginationQuerySchema.safeParse(query).success).toBe(false),
  );
  it('rejects crossed price bounds', () =>
    expect(ItemPaginationQuerySchema.safeParse({ min_price: '11', max_price: '10' }).success).toBe(
      false,
    ));
});
