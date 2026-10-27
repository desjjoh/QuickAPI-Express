import type { Request } from 'express';
import { BadRequestError } from '@/common/exceptions/http.exception';
import { IdempotencyKeySchema } from '@/common/library/models/idempotency.model';

/** Node combines duplicate fields; rawHeaders preserves their original count. */
export function readIdempotencyKey(
  req: Pick<Request, 'headers' | 'rawHeaders'>,
): string | undefined {
  let count = 0;

  for (let index = 0; index < req.rawHeaders.length; index += 2)
    if (req.rawHeaders[index].toLowerCase() === 'idempotency-key') count++;

  const value = req.headers['idempotency-key'];

  if (value === undefined && count === 0) return undefined;
  const parsed = IdempotencyKeySchema.safeParse(value);

  if (count > 1 || !parsed.success)
    throw new BadRequestError(
      'Idempotency-Key must be one opaque 1–128 character printable ASCII value without whitespace or commas.',
    );

  return parsed.data;
}
