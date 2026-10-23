import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/config/env.config';

const packageMetadata = createRequire(import.meta.url)(
  '../../package.json',
) as {
  name: string;
  version: string;
};

const valid = {
  NODE_ENV: 'development',
  PORT: '3000',
  LOG_LEVEL: 'info',
  DB_HOST: 'localhost',
  DB_PORT: '3306',
  DB_USER: 'user',
  DB_PASSWORD: 'secret',
  DB_DATABASE: 'app',
} satisfies NodeJS.ProcessEnv;

describe('environment configuration', () => {
  it('defaults to bounded database capacity, separate deadlines, and local non-TLS operation', () => {
    expect(parseEnv(valid)).toMatchObject({
      DB_POOL_CONNECTION_LIMIT: 10,
      DB_POOL_QUEUE_LIMIT: 50,
      DB_POOL_ACQUIRE_TIMEOUT_MS: 1000,
      DB_CONNECT_TIMEOUT_MS: 10000,
      DB_SSL: false,
    });
    expect(
      parseEnv({ ...valid, DB_POOL_QUEUE_LIMIT: '0' }).DB_POOL_QUEUE_LIMIT,
    ).toBe(0);
  });

  it.each(['', '-1', '1.5', 'NaN', 'Infinity'])(
    'rejects invalid database resource values %j',
    (value) => {
      for (const key of [
        'DB_POOL_CONNECTION_LIMIT',
        'DB_POOL_QUEUE_LIMIT',
        'DB_POOL_ACQUIRE_TIMEOUT_MS',
        'DB_CONNECT_TIMEOUT_MS',
      ])
        expect(() => parseEnv({ ...valid, [key]: value })).toThrow();
    },
  );

  it('rejects unbounded/excessive database resources and invalid TLS combinations', () => {
    for (const [key, value] of [
      ['DB_POOL_CONNECTION_LIMIT', '0'],
      ['DB_POOL_CONNECTION_LIMIT', '1001'],
      ['DB_POOL_QUEUE_LIMIT', '10001'],
      ['DB_POOL_ACQUIRE_TIMEOUT_MS', '0'],
      ['DB_CONNECT_TIMEOUT_MS', '0'],
      ['DB_SSL', 'yes'],
      ['DB_SSL_CA_FILE', ''],
      ['DB_SSL_CA_FILE', 'ca.pem'],
    ])
      expect(() => parseEnv({ ...valid, [key]: value })).toThrow();
    expect(() =>
      parseEnv({ ...valid, DB_SSL: 'true', DB_HOST: '127.0.0.1' }),
    ).toThrow();
    expect(
      parseEnv({ ...valid, DB_SSL: 'true', DB_SSL_CA_FILE: 'ca.pem' }),
    ).toMatchObject({ DB_SSL: true, DB_SSL_CA_FILE: 'ca.pem' });
  });

  it.each(['development', 'test', 'production'])(
    'uses deliberate operational exposure defaults in %s',
    (NODE_ENV) => {
      const enabled = NODE_ENV !== 'production';

      expect(parseEnv({ ...valid, NODE_ENV })).toMatchObject({
        DOCS_ENABLED: enabled,
        DIAGNOSTICS_ENABLED: enabled,
        METRICS_ENABLED: enabled,
      });
      expect(
        parseEnv({
          ...valid,
          NODE_ENV,
          DOCS_ENABLED: 'false',
          DIAGNOSTICS_ENABLED: 'true',
          METRICS_ENABLED: 'false',
        }),
      ).toMatchObject({
        DOCS_ENABLED: false,
        DIAGNOSTICS_ENABLED: true,
        METRICS_ENABLED: false,
      });
    },
  );

  it.each(['', 'yes', '1', 'TRUE', ' false '])(
    'rejects ambiguous exposure flags %j',
    (value) => {
      for (const key of [
        'DOCS_ENABLED',
        'DIAGNOSTICS_ENABLED',
        'METRICS_ENABLED',
      ])
        expect(() => parseEnv({ ...valid, [key]: value })).toThrow();
    },
  );

  it('preserves the rate quota with bounded client capacity by default', () => {
    expect(parseEnv(valid)).toMatchObject({
      RATE_LIMIT_WINDOW_MS: 60_000,
      RATE_LIMIT_MAX: 200,
      RATE_LIMIT_MAX_CLIENTS: 10_000,
    });
  });

  it.each(['', '0', '-1', '1.5', 'NaN', 'Infinity'])(
    'rejects invalid rate limiter values %j',
    (value) => {
      for (const key of [
        'RATE_LIMIT_WINDOW_MS',
        'RATE_LIMIT_MAX',
        'RATE_LIMIT_MAX_CLIENTS',
      ])
        expect(() => parseEnv({ ...valid, [key]: value })).toThrow();
    },
  );

  it('rejects excessive individual limits and combined timestamp allocation', () => {
    expect(() =>
      parseEnv({ ...valid, RATE_LIMIT_WINDOW_MS: '86400001' }),
    ).toThrow();
    expect(() => parseEnv({ ...valid, RATE_LIMIT_MAX: '10001' })).toThrow();
    expect(() =>
      parseEnv({ ...valid, RATE_LIMIT_MAX_CLIENTS: '100001' }),
    ).toThrow();
    expect(() =>
      parseEnv({
        ...valid,
        RATE_LIMIT_MAX: '201',
        RATE_LIMIT_MAX_CLIENTS: '10000',
      }),
    ).toThrow();
    expect(
      parseEnv({
        ...valid,
        RATE_LIMIT_MAX: '10000',
        RATE_LIMIT_MAX_CLIENTS: '200',
      }).RATE_LIMIT_MAX,
    ).toBe(10_000);
  });
  it('defaults to finite transport, response, drain, and shutdown deadlines', () => {
    expect(parseEnv(valid)).toMatchObject({
      HTTP_HEADERS_TIMEOUT_MS: 5_000,
      HTTP_REQUEST_TIMEOUT_MS: 10_000,
      REQUEST_TIMEOUT_MS: 10_000,
      HTTP_DRAIN_TIMEOUT_MS: 25_000,
      SHUTDOWN_TIMEOUT_MS: 30_000,
      DB_READINESS_TIMEOUT_MS: 1_000,
      DB_READINESS_CACHE_MS: 1_000,
      DB_MIGRATION_CHECK_TIMEOUT_MS: 5_000,
    });
  });

  it.each(['', '0', '-1', '1.5', 'NaN', '2147483648'])(
    'rejects invalid finite deadlines %j',
    (value) => {
      for (const key of [
        'HTTP_HEADERS_TIMEOUT_MS',
        'HTTP_REQUEST_TIMEOUT_MS',
        'REQUEST_TIMEOUT_MS',
        'HTTP_DRAIN_TIMEOUT_MS',
        'SHUTDOWN_TIMEOUT_MS',
        'DB_READINESS_TIMEOUT_MS',
        'DB_READINESS_CACHE_MS',
        'DB_MIGRATION_CHECK_TIMEOUT_MS',
      ]) {
        expect(() => parseEnv({ ...valid, [key]: value })).toThrow();
      }
    },
  );

  it('requires headers to fit the receive budget and reserves shutdown cleanup time', () => {
    expect(() =>
      parseEnv({ ...valid, HTTP_HEADERS_TIMEOUT_MS: '11000' }),
    ).toThrow();
    expect(() =>
      parseEnv({ ...valid, HTTP_DRAIN_TIMEOUT_MS: '30000' }),
    ).toThrow();
  });

  it('defaults to direct access and the existing localhost CORS policy', () => {
    expect(parseEnv(valid)).toMatchObject({
      TRUST_PROXY: [],
      CORS_ORIGINS: ['http://localhost:3000'],
      CORS_METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      CORS_ALLOWED_HEADERS: [
        'content-type',
        'authorization',
        'x-requested-with',
      ],
      CORS_EXPOSED_HEADERS: ['authorization', 'set-cookie'],
      CORS_CREDENTIALS: true,
      CORS_MAX_AGE_SECONDS: 86_400,
    });
  });

  it('parses explicit proxy addresses and configurable CORS policy', () => {
    expect(
      parseEnv({
        ...valid,
        TRUST_PROXY: ' 192.0.2.10, 10.20.0.0/16, ::1, fd00::/64 ',
        CORS_ORIGINS: 'https://web.example, https://admin.example:8443',
        CORS_METHODS: 'GET, POST',
        CORS_ALLOWED_HEADERS: 'Content-Type, X-Trace-Client',
        CORS_EXPOSED_HEADERS: '',
        CORS_CREDENTIALS: 'false',
        CORS_MAX_AGE_SECONDS: '0',
      }),
    ).toMatchObject({
      TRUST_PROXY: ['192.0.2.10', '10.20.0.0/16', '::1', 'fd00::/64'],
      CORS_ORIGINS: ['https://web.example', 'https://admin.example:8443'],
      CORS_METHODS: ['GET', 'POST'],
      CORS_ALLOWED_HEADERS: ['Content-Type', 'X-Trace-Client'],
      CORS_EXPOSED_HEADERS: [],
      CORS_CREDENTIALS: false,
      CORS_MAX_AGE_SECONDS: 0,
    });
  });

  it('allows explicitly empty proxy trust', () => {
    expect(parseEnv({ ...valid, TRUST_PROXY: '  ' }).TRUST_PROXY).toEqual([]);
  });

  it.each([
    ['TRUST_PROXY', 'true'],
    ['TRUST_PROXY', '1'],
    ['TRUST_PROXY', '0.0.0.0/0'],
    ['TRUST_PROXY', '::/0'],
    ['TRUST_PROXY', '10.0.0.1/33'],
    ['TRUST_PROXY', '::1/129'],
    ['TRUST_PROXY', '10.0.0.1/-1'],
    ['TRUST_PROXY', '127.0.0.1,'],
    ['TRUST_PROXY', 'proxy.example'],
    ['TRUST_PROXY', '127.0.0.1/8/8'],
    ['CORS_ORIGINS', '*'],
    ['CORS_ORIGINS', 'null'],
    ['CORS_ORIGINS', ''],
    ['CORS_ORIGINS', 'https://web.example/path'],
    ['CORS_ORIGINS', 'https://user:secret@web.example'],
    ['CORS_ORIGINS', 'https://web.example?query'],
    ['CORS_METHODS', ''],
    ['CORS_METHODS', 'GET,BOGUS'],
    ['CORS_ALLOWED_HEADERS', 'content-type,'],
    ['CORS_ALLOWED_HEADERS', 'bad header'],
    ['CORS_EXPOSED_HEADERS', 'bad\r\nheader'],
    ['CORS_CREDENTIALS', 'yes'],
    ['CORS_CREDENTIALS', ''],
    ['CORS_MAX_AGE_SECONDS', ''],
    ['CORS_MAX_AGE_SECONDS', '-1'],
    ['CORS_MAX_AGE_SECONDS', '1.5'],
    ['CORS_MAX_AGE_SECONDS', '86401'],
  ])('rejects invalid HTTP policy %s=%j', (key, value) => {
    expect(() => parseEnv({ ...valid, [key]: value })).toThrow();
  });

  it('uses package defaults and coerces numeric ports', () => {
    const result = parseEnv(valid);
    expect(result).toMatchObject({
      APP_NAME: packageMetadata.name,
      APP_VERSION: packageMetadata.version,
      PORT: 3000,
      DB_PORT: 3306,
    });
  });

  it.each(['1.2.3', '1.2.3-beta.1+build.7'])(
    'accepts full SemVer %s',
    (APP_VERSION) => {
      expect(parseEnv({ ...valid, APP_VERSION }).APP_VERSION).toBe(APP_VERSION);
    },
  );

  it.each(['1', 'v1.2.3', '01.2.3', '1.2'])(
    'rejects invalid SemVer %s',
    (APP_VERSION) => {
      expect(() => parseEnv({ ...valid, APP_VERSION })).toThrow();
    },
  );

  it.each(['staging', '', 'PRODUCTION'])(
    'enforces the environment allowlist (%s)',
    (NODE_ENV) => {
      expect(() => parseEnv({ ...valid, NODE_ENV })).toThrow();
    },
  );

  it.each(['NaN', '', '1.5', '-1', '65536'])(
    'rejects invalid application port %j',
    (PORT) => {
      expect(() => parseEnv({ ...valid, PORT })).toThrow();
    },
  );

  it('allows port zero only for test processes', () => {
    expect(parseEnv({ ...valid, NODE_ENV: 'test', PORT: '0' }).PORT).toBe(0);
    expect(() =>
      parseEnv({ ...valid, NODE_ENV: 'production', PORT: '0' }),
    ).toThrow();
  });

  it.each(['NaN', '', '1.5', '0', '65536'])(
    'rejects invalid database port %j',
    (DB_PORT) => {
      expect(() => parseEnv({ ...valid, DB_PORT })).toThrow();
    },
  );

  it.each(['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'] as const)(
    'rejects empty production database value %s during preflight',
    (field) => {
      expect(() =>
        parseEnv({ ...valid, NODE_ENV: 'production', [field]: '  ' }),
      ).toThrow();
    },
  );
});
