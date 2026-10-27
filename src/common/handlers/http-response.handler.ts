import type { Request, RequestHandler, Response } from 'express';
import { AppDataSource } from '@/config/database.config';
import { runInTransaction } from '@/common/helpers/transaction.helper';
import { assertRequestActive } from '@/common/helpers/request-context.helper';
import { canRespond, trackHandler } from './request-lifecycle.handler';
import { IdempotencyService } from '@/common/services/idempotency.service';
import { idempotencyNamespace } from '@/config/idempotency.config';
import {
  IdempotencyScopeSchema,
  type IdempotencyScope,
} from '@/common/library/models/idempotency.model';
import { readIdempotencyKey } from '@/common/helpers/idempotency-header.helper';
import { requestFingerprint } from '@/common/helpers/idempotency.helper';

const idempotencyService = new IdempotencyService();

type Controller<R, T> = (input: R) => T | Promise<T>;

/** Tracking includes controller work, DTO validation, and serialization. */
function responseHandler<R extends object, T>(
  controller: Controller<R, T>,
  write: (value: T, res: Response) => void,
): RequestHandler {
  return trackHandler(async (req: R, res: Response) => {
    const result = await controller(req);

    if (!canRespond(req, res)) return;

    write(result, res);
  });
}

type JsonOptions<DTO> = {
  status?: number | ((body: DTO) => number);
  transaction?: boolean;
  idempotency?: Omit<IdempotencyScope, 'namespace'>;
};

/** Transactional mutations prepare their response before the outer commit. */
export function jsonHandler<R extends object, T, DTO>(
  controller: Controller<R, T>,
  toDTO: (result: T) => DTO,
  { status = 200, transaction = false, idempotency }: JsonOptions<DTO> = {},
): RequestHandler {
  if (idempotency && !transaction)
    throw new Error('Idempotency requires a transactional JSON handler.');
  const scope = idempotency
    ? IdempotencyScopeSchema.parse({
        namespace: idempotencyNamespace,
        ...idempotency,
      })
    : undefined;

  if (transaction) {
    return trackHandler(async (req: Request, res: Response) => {
      const key = scope ? readIdempotencyKey(req) : undefined;
      const input = req.validated ?? { params: null, query: null, body: null };

      if (key !== undefined && !req.validated)
        throw new Error('Keyed handlers require validated request input.');
      const prepare = async () => {
        const result = await controller(input as R);

        assertRequestActive();
        const body = toDTO(result);
        const code = typeof status === 'function' ? status(body) : status;

        if (!Number.isInteger(code) || code < 100 || code > 999)
          throw new RangeError('Invalid HTTP response status.');

        return {
          status: code,
          json:
            key !== undefined && (code === 204 || code === 205)
              ? undefined
              : JSON.stringify(body),
        };
      };

      const prepared =
        scope && key !== undefined
          ? await idempotencyService.execute(
              scope,
              key,
              requestFingerprint(input),
              prepare,
            )
          : await runInTransaction(AppDataSource.manager, prepare);

      if (!canRespond(req, res)) return;

      res.status(prepared.status);
      if (!res.get('Content-Type')) res.type('application/json');
      res.send(prepared.json);
    });
  }

  return responseHandler<Request, T>(
    (req) =>
      controller(
        (req.validated ?? { params: null, query: null, body: null }) as R,
      ),
    (result, res) => {
      const body = toDTO(result);

      res
        .status(typeof status === 'function' ? status(body) : status)
        .json(body);
    },
  );
}

export function textHandler<R extends object>(
  controller: Controller<R, string>,
  contentType: string,
): RequestHandler {
  return responseHandler(controller, (result, res) => {
    res.set('Content-Type', contentType);
    res.end(result);
  });
}
