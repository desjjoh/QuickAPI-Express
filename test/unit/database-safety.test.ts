import { describe, expect, it } from 'vitest';

import { assertSafeTestDatabase } from '../helpers/database/safety';

const safeEnvironment = {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_DATABASE: 'quickapi_disposable_test',
};

describe('test database safety', () => {
  it('accepts an explicitly disposable database on a local host', () => {
    expect(() => assertSafeTestDatabase(safeEnvironment)).not.toThrow();
  });

  it.each(['test', 'dev', 'development', 'staging', 'stage', 'production', 'prod'])(
    'rejects the protected database name %s',
    database => {
      expect(() => assertSafeTestDatabase({ ...safeEnvironment, DB_DATABASE: database })).toThrow(
        /ambiguous or protected/,
      );
    },
  );

  it('requires the test environment', () => {
    expect(() => assertSafeTestDatabase({ ...safeEnvironment, NODE_ENV: 'development' })).toThrow(
      /NODE_ENV must be exactly "test"/,
    );
  });

  it('rejects a remote host unless CI explicitly permits it', () => {
    expect(() => assertSafeTestDatabase({ ...safeEnvironment, DB_HOST: 'db.example.com' })).toThrow(
      /not a permitted local\/CI host/,
    );
  });
});
