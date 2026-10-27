import { createHash } from 'node:crypto';
import {
  IdempotencyKeySchema,
  IdempotencyScopeSchema,
  PreparedJsonResponseSchema,
  type IdempotencyFingerprintInput,
  type IdempotencyScope,
  type PreparedJsonResponse,
} from '@/common/library/models/idempotency.model';
import {
  IdempotencyPolicySchema,
  defaultIdempotencyPolicy,
} from '@/common/library/models/idempotency-policy.model';

/** JSON-compatible validated values only; object undefined fields are omitted. */
export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (entry: unknown): string => {
    if (entry === null) return 'null';
    if (typeof entry === 'string' || typeof entry === 'boolean')
      return JSON.stringify(entry);
    if (typeof entry === 'number' && Number.isFinite(entry))
      return JSON.stringify(entry);
    if (typeof entry !== 'object' || entry === null)
      throw new Error(
        'Fingerprint input must contain only JSON-compatible values.',
      );
    if (ancestors.has(entry))
      throw new Error('Fingerprint input must not be circular.');
    if (
      !Array.isArray(entry) &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(entry))
    )
      throw new Error('Fingerprint input must use plain JSON objects.');
    ancestors.add(entry);

    try {
      if (Array.isArray(entry)) {
        // Reject holes/undefined instead of silently conflating them with null.
        return '[' + Array.from(entry, encode).join(',') + ']';
      }

      const object = entry as Record<string, unknown>;

      return (
        '{' +
        Object.keys(object)
          .sort()
          .filter((key) => object[key] !== undefined)
          .map((key) => JSON.stringify(key) + ':' + encode(object[key]))
          .join(',') +
        '}'
      );
    } finally {
      ancestors.delete(entry);
    }
  };

  return encode(value);
}

export function requestFingerprint({
  body,
  params,
  query,
}: IdempotencyFingerprintInput): string {
  return createHash('sha256')
    .update('v1:' + canonicalJson({ body, params, query }))
    .digest('hex');
}

export function idempotencyScopeHash(
  scope: IdempotencyScope,
  key: string,
): string {
  const validated = IdempotencyScopeSchema.parse(scope);
  const acceptedKey = IdempotencyKeySchema.parse(key);

  return createHash('sha256')
    .update(
      JSON.stringify([
        'idempotency-v1',
        validated.namespace,
        validated.callerScope,
        validated.operation,
        validated.route,
        acceptedKey,
      ]),
    )
    .digest('hex');
}

/** Validate bytes before JSON parsing; never rewrite the already-prepared string. */
export function validatePreparedResponse(
  response: PreparedJsonResponse,
  maxResponseBytes: number = defaultIdempotencyPolicy.maxResponseBytes,
): PreparedJsonResponse {
  const limit =
    IdempotencyPolicySchema.shape.maxResponseBytes.parse(maxResponseBytes);
  const accepted = PreparedJsonResponseSchema.parse(response);
  const bodyless = accepted.status === 204 || accepted.status === 205;

  if (bodyless ? accepted.json !== undefined : accepted.json === undefined)
    throw new Error('Prepared response body does not match its status.');
  if (accepted.json !== undefined) {
    if (Buffer.byteLength(accepted.json, 'utf8') > limit)
      throw new Error(
        'Prepared response exceeds the idempotency storage limit.',
      );

    try {
      JSON.parse(accepted.json);
    } catch {
      throw new Error('Prepared response must contain valid JSON.');
    }
  }

  return accepted;
}
