import { describe, expect, it } from 'vitest';
import {
  IdempotencyKeySchema,
  IdempotencyScopeSchema,
} from '@/common/library/models/idempotency.model';
import {
  defaultIdempotencyPolicy,
  IdempotencyPolicySchema,
  IDEMPOTENCY_RETENTION_MS,
} from '@/common/library/models/idempotency-policy.model';
import {
  canonicalJson,
  requestFingerprint,
  idempotencyScopeHash,
  validatePreparedResponse,
} from '@/common/helpers/idempotency.helper';
import { CreateItemSchema } from '@/api/v1/items/models/item-create.model';

const scope = {
  namespace: 'express:test',
  callerScope: 'public',
  operation: 'items.create',
  route: 'POST /api/v1/items',
};

describe('shared idempotency contracts', () => {
  it('accepts opaque case-sensitive ASCII keys up to 128 characters', () => {
    for (const key of ['A', 'a'.repeat(128), 'uuid:ABC-123_~'])
      expect(IdempotencyKeySchema.parse(key)).toBe(key);
    expect(idempotencyScopeHash(scope, 'A')).not.toBe(
      idempotencyScopeHash(scope, 'a'),
    );
  });
  it.each([
    '',
    'a'.repeat(129),
    'a b',
    'a,b',
    'a\n',
    'a\r',
    'a\t',
    'a\0',
    'é',
    '\x7f',
    ['a'],
    null,
    undefined,
    123,
  ])('rejects malformed key %#', (key) => {
    expect(IdempotencyKeySchema.safeParse(key).success).toBe(false);
  });
  it('separates every scope dimension without concatenation ambiguity', () => {
    const hash = idempotencyScopeHash(scope, 'key');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(idempotencyScopeHash({ ...scope }, 'key')).toBe(hash);
    for (const field of [
      'namespace',
      'callerScope',
      'operation',
      'route',
    ] as const)
      expect(
        idempotencyScopeHash(
          { ...scope, [field]: scope[field] + ':other' },
          'key',
        ),
      ).not.toBe(hash);
    expect(idempotencyScopeHash(scope, 'other')).not.toBe(hash);
    expect(
      idempotencyScopeHash(
        { ...scope, namespace: 'a:b', callerScope: 'c' },
        'key',
      ),
    ).not.toBe(
      idempotencyScopeHash(
        { ...scope, namespace: 'a', callerScope: 'b:c' },
        'key',
      ),
    );
    expect(
      IdempotencyScopeSchema.safeParse({ ...scope, operation: '' }).success,
    ).toBe(false);
    expect(
      IdempotencyScopeSchema.safeParse({ ...scope, callerScope: undefined })
        .success,
    ).toBe(false);
  });
  it('canonicalizes nested key order but preserves array order and string values', () => {
    expect(canonicalJson({ z: [1, { b: 2, a: 1 }], a: null })).toBe(
      canonicalJson({ a: null, z: [1, { a: 1, b: 2 }] }),
    );
    expect(canonicalJson({ optional: undefined })).toBe('{}');
    expect(canonicalJson({ optional: null })).not.toBe('{}');
    expect(requestFingerprint({ body: [1, 2] })).not.toBe(
      requestFingerprint({ body: [2, 1] }),
    );
    expect(requestFingerprint({ body: ' A ' })).not.toBe(
      requestFingerprint({ body: 'A' }),
    );
    const shared = { a: 1 };
    expect(canonicalJson([shared, shared])).toBe('[{"a":1},{"a":1}]');
  });
  it.each([
    NaN,
    Infinity,
    1n,
    undefined,
    () => 1,
    new Date(),
    new Map(),
    [undefined],
    Array(1),
  ])('fails closed for non-JSON values %#', (value) => {
    expect(() => canonicalJson(value)).toThrow();
  });
  it('rejects cycles instead of looping or fingerprinting an incomplete request', () => {
    const object: { child?: unknown } = {};
    object.child = object;
    expect(() => canonicalJson(object)).toThrow('circular');
  });
  it('fingerprints validated normalization, not unknown fields or transport noise', () => {
    const first = CreateItemSchema.parse({
      name: 'Item',
      price: '12.50',
      ignored: true,
    });
    const second = CreateItemSchema.parse({ price: 12.5, name: 'Item' });
    const input = { body: first, requestId: 'first', headers: { host: 'one' } };
    expect(requestFingerprint(input)).toBe(
      requestFingerprint({ body: second }),
    );
    expect(requestFingerprint({ body: first })).not.toBe(
      requestFingerprint({ body: { ...second, name: 'Changed' } }),
    );
    expect(requestFingerprint({ body: first })).not.toBe(
      requestFingerprint({ body: { ...second, description: null } }),
    );
    expect(requestFingerprint({ body: first, params: { id: 'one' } })).not.toBe(
      requestFingerprint({ body: first, params: { id: 'two' } }),
    );
    expect(requestFingerprint({ body: first, query: { page: 1 } })).not.toBe(
      requestFingerprint({ body: first, query: { page: 2 } }),
    );
  });
  it('keeps the agreed storage/cleanup defaults bounded', () => {
    expect(defaultIdempotencyPolicy).toEqual({
      maxResponseBytes: 65536,
      cleanupBatchSize: 100,
      cleanupMaxBatches: 10,
    });
    expect(IDEMPOTENCY_RETENTION_MS).toBe(86400000);
    for (const policy of [
      { maxResponseBytes: 0 },
      { maxResponseBytes: 65537 },
      { cleanupBatchSize: 0 },
      { cleanupMaxBatches: 0 },
      { cleanupBatchSize: 1000, cleanupMaxBatches: 11 },
    ])
      expect(IdempotencyPolicySchema.safeParse(policy).success).toBe(false);
  });
  it('measures prepared UTF-8 bytes and preserves the exact serialized string', () => {
    const json = JSON.stringify('é'.repeat(32767));
    expect(Buffer.byteLength(json)).toBe(65536);
    expect(validatePreparedResponse({ status: 201, json }).json).toBe(json);
    expect(() =>
      validatePreparedResponse({
        status: 201,
        json: JSON.stringify('é'.repeat(32768)),
      }),
    ).toThrow('storage limit');
    expect(() =>
      validatePreparedResponse({ status: 201, json: 'null' }, 3),
    ).toThrow('storage limit');
    expect(
      validatePreparedResponse({ status: 201, json: 'null' }, 4).json,
    ).toBe('null');
  });
  it('accepts only successful, valid JSON responses and proper bodyless statuses', () => {
    expect(validatePreparedResponse({ status: 204 })).toEqual({ status: 204 });
    expect(validatePreparedResponse({ status: 205 })).toEqual({ status: 205 });
    for (const response of [
      { status: 201 },
      { status: 204, json: 'null' },
      { status: 400, json: '{}' },
      { status: 500, json: '{}' },
      { status: 201, json: 'undefined' },
      { status: 201, json: '' },
    ])
      expect(() => validatePreparedResponse(response)).toThrow();
  });
});
