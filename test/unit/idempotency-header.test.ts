import { describe, expect, it } from 'vitest';
import { readIdempotencyKey } from '@/common/helpers/idempotency-header.helper';
import { jsonHandler } from '@/common/handlers/http-response.handler';

describe('HTTP idempotency header contract', () => {
  it('distinguishes absence from an opaque case-sensitive key without normalization', () => {
    expect(readIdempotencyKey({ headers: {}, rawHeaders: [] })).toBeUndefined();
    expect(
      readIdempotencyKey({
        headers: { 'idempotency-key': 'AbC_123' },
        rawHeaders: ['iDeMpOtEnCy-KeY', 'AbC_123'],
      }),
    ).toBe('AbC_123');
  });
  it.each([
    '',
    'a b',
    ' a',
    'a ',
    'a,b',
    'a\tb',
    'a'.repeat(129),
    'é',
    ['a'],
    ['a', 'b'],
  ])('rejects malformed/combined/array key %s', (key) => {
    expect(() =>
      readIdempotencyKey({
        headers: { 'idempotency-key': key },
        rawHeaders: ['Idempotency-Key', 'a'],
      }),
    ).toThrow(expect.objectContaining({ status: 400 }));
  });
  it('rejects repeated raw fields even if merged headers conceal them', () => {
    expect(() =>
      readIdempotencyKey({
        headers: { 'idempotency-key': 'same' },
        rawHeaders: ['Idempotency-Key', 'same', 'idempotency-key', 'same'],
      }),
    ).toThrow(expect.objectContaining({ status: 400 }));
    expect(() =>
      readIdempotencyKey({
        headers: {},
        rawHeaders: ['Idempotency-Key', 'removed'],
      }),
    ).toThrow();
  });
  it('requires explicit transaction opt-in at handler construction', () => {
    expect(() =>
      jsonHandler(
        () => 1,
        (value) => value,
        {
          idempotency: {
            callerScope: 'public',
            operation: 'create',
            route: 'POST /test',
          },
        },
      ),
    ).toThrow('transactional JSON handler');
  });
});
