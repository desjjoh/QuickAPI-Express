import { describe, expect, it } from 'vitest';
import { openApiSpec } from '@/config/docs.config';

describe('generated OpenAPI contract', () => {
  it('keeps root and readiness responses distinct and publishes correctly typed examples', () => {
    const root = openApiSpec.paths['/']?.get?.responses?.[200];
    const ready = openApiSpec.paths['/ready']?.get?.responses?.[200];
    expect(root).toBeDefined();
    expect(ready).toBeDefined();
    expect(JSON.stringify(root)).not.toBe(JSON.stringify(ready));
    const schemas = openApiSpec.components?.schemas ?? {};
    expect(schemas).toHaveProperty('RootResponse');
    expect(schemas).toHaveProperty('ReadyResponse');
    expect(schemas.RootResponse).not.toEqual(schemas.ReadyResponse);

    const check = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if ('example' in record && typeof record.type === 'string') {
        const expected = record.type === 'integer' ? 'number' : record.type;
        expect(typeof record.example).toBe(expected);
      }
      Object.values(record).forEach(check);
    };
    check(openApiSpec);
  });
});
