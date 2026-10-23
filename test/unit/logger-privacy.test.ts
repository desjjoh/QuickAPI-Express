import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';

import { createLogger } from '@/config/logger.config';
import { errorDiagnostics } from '@/common/helpers/error-diagnostics.helper';
import { RequestContext } from '@/common/store/request-context.store';

function capture(production = true, level: 'debug' | 'info' = 'debug') {
  const lines: string[] = [];
  const log = createLogger(
    { production, level },
    {
      write: (line) => {
        lines.push(line);
      },
    },
  );

  return { log, lines };
}

describe('logger privacy and NestJS presentation', () => {
  it('shows actionable safe console diagnostics without raw exception messages', () => {
    const { log, lines } = capture(false);
    const error = Object.assign(new Error('private connection details'), {
      code: 'APP_PENDING_MIGRATIONS',
    });

    log.error({ error }, 'Application bootstrap failed.');
    expect(lines[0]).toContain('Application bootstrap failed.\n  error: ');
    expect(lines[0]).toContain('APP_PENDING_MIGRATIONS');
    expect(lines[0]).toContain(
      'Apply pending migrations before starting the API',
    );
    expect(lines[0]).not.toContain('private connection details');
  });

  it('writes production UTC timestamps and keeps request context without raw paths', () => {
    const { log, lines } = capture();

    RequestContext.run(
      {
        requestId: 'test-request',
        timestamp: 1,
        method: 'GET',
        ip: '127.0.0.1',
      },
      () => log.info('Application ready.'),
    );
    const entry = JSON.parse(lines[0]);

    expect(entry).toMatchObject({
      requestId: 'test-request',
      levelLabel: 'info',
      pid: process.pid,
      method: 'GET',
      ip: '127.0.0.1',
      msg: 'Application ready.',
    });
    expect(entry.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(entry).not.toHaveProperty('path');
    expect(RequestContext.get()).toBeUndefined();
  });

  it('preserves NestJS console layout and honors the configured level', () => {
    const { log, lines } = capture(false, 'info');

    log.debug('Hidden request.');
    RequestContext.run(
      { requestId: 'test-request', timestamp: 1, method: 'GET', ip: undefined },
      () => log.warn('HTTP request rejected.'),
    );
    expect(lines).toHaveLength(1);
    expect(stripVTControlCharacters(lines[0])).toMatch(
      new RegExp(
        `^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}\\.\\d{3} \\[${process.pid}\\] \\[warn \\] \\[test-request\\] HTTP request rejected\\.\\n$`,
      ),
    );
  });

  it('excludes request payloads, credentials, replay data, and raw diagnostics', () => {
    const { log, lines } = capture();
    const secret = 'private-value-never-log';
    const fields = [
      'req',
      'res',
      'request',
      'response',
      'body',
      'query',
      'params',
      'headers',
      'cookies',
      'cookie',
      'authorization',
      'password',
      'token',
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'secret',
      'apiKey',
      'api_key',
      'client_secret',
      'idempotencyKey',
      'replay',
      'payload',
      'stack',
      'sql',
      'sqlMessage',
    ];
    const sensitive = Object.fromEntries(
      fields.map((field) => [field, secret]),
    );

    log.info(
      { ...sensitive, extra: { ...sensitive }, status: 200 },
      'Safe event.',
    );
    expect(lines[0]).not.toContain(secret);
    expect(JSON.parse(lines[0])).toMatchObject({
      status: 200,
      msg: 'Safe event.',
    });
  });

  it('serializes error aliases using allowlisted diagnostics only', () => {
    const { log, lines } = capture();
    const failure = Object.assign(
      new Error('SELECT password FROM private_table'),
      {
        code: 'ER_DUP_ENTRY',
        query: 'private SQL',
        parameters: ['private payload'],
        cause: new Error('private cause'),
      },
    );

    log.error(
      { error: failure, err: failure, reason: failure },
      'Database operation failed.',
    );
    const entry = JSON.parse(lines[0]);

    for (const field of ['error', 'err', 'reason']) {
      expect(entry[field]).toEqual({
        errorType: 'Error',
        errorCode: 'ER_DUP_ENTRY',
        errorFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    }
    expect(lines[0]).not.toMatch(/private|SELECT|password/);
  });

  it('groups errors by stack frames independently of exception message', () => {
    const first = {
      name: 'QueryFailedError',
      stack: 'Error: secret one\n    at query (/app/repository.js:1:2)',
      driverError: { code: 'ECONNRESET' },
      statusCode: 503,
    };
    const second = {
      ...first,
      stack: first.stack.replace('secret one', 'secret two'),
    };

    expect(errorDiagnostics(first)).toEqual(errorDiagnostics(second));
    expect(errorDiagnostics(first)).toMatchObject({
      errorType: 'QueryFailedError',
      errorCode: 'ECONNRESET',
      upstreamStatus: 503,
    });
    expect(
      errorDiagnostics({
        name: 'private-name',
        code: 'private-code',
        statusCode: 999,
      }),
    ).toEqual({ errorType: 'UnknownError' });
  });

  it('survives arbitrary thrown values and hostile diagnostic getters', () => {
    const { log, lines } = capture();
    const hostile = Object.defineProperty({}, 'name', {
      get() {
        throw new Error('private getter');
      },
    });

    for (const error of [null, 'private string', hostile])
      log.error({ error }, 'Unexpected failure.');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(JSON.parse(line).error).toEqual({ errorType: 'UnknownError' });
      expect(line).not.toContain('private');
    }
  });
});
