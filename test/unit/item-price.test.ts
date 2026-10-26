import { describe, expect, it } from 'vitest';
import { PriceSchema } from '@/common/library/models/price.model';
import { ItemPaginationQuerySchema } from '@/api/v1/items/models/pagination-query.model';

const prices = [0.01, 0.07, 0.29, 1.01, 1.13, 1.15, 2.03, 12.5, 99_999_999.99];

describe('exact item price input contract', () => {
  it.each(prices)(
    'accepts numeric and two-place decimal spelling for %s without rounding',
    (value) => {
      expect(PriceSchema.parse(value)).toBe(value);
      expect(PriceSchema.parse(value.toFixed(2))).toBe(value);
    },
  );

  it.each([
    0,
    -1,
    0.001,
    1.001,
    1.2300000000000002,
    99_999_999.99000001,
    100_000_000,
    NaN,
    Infinity,
    -Infinity,
    undefined,
    null,
    true,
    false,
    [],
    [1],
    {},
    '',
    ' ',
    '1.234',
    '1.230',
    '1e2',
    '0x10',
    '+1',
    '.5',
    '1.',
    ' 1.00',
    '1.00 ',
    '1\n',
    '1\r',
    'NaN',
    'Infinity',
  ])('rejects invalid price %#', (value) => {
    expect(PriceSchema.safeParse(value).success).toBe(false);
  });

  it('accepts decimal filters and rejects invalid shapes instead of coercing them', () => {
    expect(
      ItemPaginationQuerySchema.parse({ min_price: '1.13', max_price: '2.03' }),
    ).toMatchObject({ min_price: 1.13, max_price: 2.03 });
    for (const value of ['', ' ', '1.001', '1e2', ['1'], true, null]) {
      expect(
        ItemPaginationQuerySchema.safeParse({ min_price: value }).success,
      ).toBe(false);
      expect(
        ItemPaginationQuerySchema.safeParse({ max_price: value }).success,
      ).toBe(false);
    }
    expect(
      ItemPaginationQuerySchema.safeParse({
        min_price: '1.14',
        max_price: '1.13',
      }).success,
    ).toBe(false);
  });

  it('bounds both the page and its computed offset without imposing a new page cap', () => {
    expect(
      ItemPaginationQuerySchema.parse({
        page: String(Number.MAX_SAFE_INTEGER),
        limit: '1',
      }).page,
    ).toBe(Number.MAX_SAFE_INTEGER);
    expect(
      ItemPaginationQuerySchema.safeParse({
        page: String(Number.MAX_SAFE_INTEGER + 1),
        limit: '1',
      }).success,
    ).toBe(false);
    expect(
      ItemPaginationQuerySchema.safeParse({
        page: String(Number.MAX_SAFE_INTEGER),
        limit: '100',
      }).success,
    ).toBe(false);
    expect(
      ItemPaginationQuerySchema.parse({ page: '2', limit: '100' }),
    ).toMatchObject({ page: 2, limit: 100 });
  });
});
