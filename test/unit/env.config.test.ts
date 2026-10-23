import { describe, expect, it } from 'vitest';
import { parseEnv } from '@/config/env.config';

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
  it('defaults to finite transport, response, drain, and shutdown deadlines', () => {
    expect(parseEnv(valid)).toMatchObject({
      HTTP_HEADERS_TIMEOUT_MS: 5_000,
      HTTP_REQUEST_TIMEOUT_MS: 10_000,
      REQUEST_TIMEOUT_MS: 10_000,
      HTTP_DRAIN_TIMEOUT_MS: 25_000,
      SHUTDOWN_TIMEOUT_MS: 30_000,
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
      APP_NAME: 'quickapi-express',
      APP_VERSION: '1.0.0',
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
