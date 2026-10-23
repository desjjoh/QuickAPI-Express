import { createHash } from 'node:crypto';

const safeCodes = new Set([
  'APP_PENDING_MIGRATIONS',
  'DB_POOL_ACQUIRE_TIMEOUT',
  'DB_POOL_CAPACITY',
  'DB_POOL_CLOSED',
  'DB_CONNECT_TIMEOUT',
  'DB_TLS_CONFIG',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'HANDSHAKE_NO_SSL_SUPPORT',
  'HANDSHAKE_SSL_ERROR',
  'ER_DUP_ENTRY',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_DATA_TOO_LONG',
  'ER_BAD_NULL_ERROR',
  'ER_NO_REFERENCED_ROW_2',
  'ER_ROW_IS_REFERENCED_2',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENOENT',
  'EACCES',
  'EPERM',
]);
const safeNames = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'AggregateError',
  'QueryFailedError',
  'AbortError',
  'TimeoutError',
]);

/** Allowlist diagnostics; never serialize the exception or provider payload. */
export function errorDiagnostics(
  error: unknown,
): Record<string, string | number> {
  try {
    const value = error as {
      name?: unknown;
      code?: unknown;
      stack?: unknown;
      statusCode?: unknown;
      driverError?: { code?: unknown };
    } | null;
    const name =
      typeof value?.name === 'string' && safeNames.has(value.name)
        ? value.name
        : 'UnknownError';
    const code = value?.driverError?.code ?? value?.code;
    const frames =
      typeof value?.stack === 'string'
        ? value.stack
            .split('\n')
            .filter((line) => /^\s+at\s/.test(line))
            .join('\n')
        : '';

    return {
      errorType: name,
      ...(typeof code === 'string' && safeCodes.has(code)
        ? { errorCode: code }
        : {}),
      ...(code === 'APP_PENDING_MIGRATIONS'
        ? {
            errorHint:
              'Apply pending migrations before starting the API; existing schemas require verified migration history.',
          }
        : {}),
      ...(typeof value?.statusCode === 'number' &&
      Number.isInteger(value.statusCode) &&
      value.statusCode >= 100 &&
      value.statusCode <= 599
        ? { upstreamStatus: value.statusCode }
        : {}),
      ...(frames
        ? {
            errorFingerprint: createHash('sha256').update(frames).digest('hex'),
          }
        : {}),
    };
  } catch {
    // Even hostile/custom error getters must not break the error boundary.
    return { errorType: 'UnknownError' };
  }
}
