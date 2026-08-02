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
  it('uses package defaults and coerces numeric ports', () => {
    const result = parseEnv(valid);
    expect(result).toMatchObject({
      APP_NAME: 'quickapi-express',
      APP_VERSION: '1.0.0',
      PORT: 3000,
      DB_PORT: 3306,
    });
  });

  it.each(['1.2.3', '1.2.3-beta.1+build.7'])('accepts full SemVer %s', APP_VERSION => {
    expect(parseEnv({ ...valid, APP_VERSION }).APP_VERSION).toBe(APP_VERSION);
  });

  it.each(['1', 'v1.2.3', '01.2.3', '1.2'])('rejects invalid SemVer %s', APP_VERSION => {
    expect(() => parseEnv({ ...valid, APP_VERSION })).toThrow();
  });

  it.each(['staging', '', 'PRODUCTION'])('enforces the environment allowlist (%s)', NODE_ENV => {
    expect(() => parseEnv({ ...valid, NODE_ENV })).toThrow();
  });

  it.each(['NaN', '', '1.5', '-1', '65536'])('rejects invalid application port %j', PORT => {
    expect(() => parseEnv({ ...valid, PORT })).toThrow();
  });

  it('allows port zero only for test processes', () => {
    expect(parseEnv({ ...valid, NODE_ENV: 'test', PORT: '0' }).PORT).toBe(0);
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production', PORT: '0' })).toThrow();
  });

  it.each(['NaN', '', '1.5', '0', '65536'])('rejects invalid database port %j', DB_PORT => {
    expect(() => parseEnv({ ...valid, DB_PORT })).toThrow();
  });

  it.each(['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_DATABASE'] as const)(
    'rejects empty production database value %s during preflight',
    field => {
      expect(() => parseEnv({ ...valid, NODE_ENV: 'production', [field]: '  ' })).toThrow();
    },
  );
});
