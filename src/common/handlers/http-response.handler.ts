import type { Request, RequestHandler, Response } from 'express';
import { AppDataSource } from '@/config/database.config';
import { runInTransaction } from '@/common/helpers/transaction.helper';
import { assertRequestActive } from '@/common/helpers/request-context.helper';
import { canRespond, trackHandler } from './request-lifecycle.handler';

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
};

/** Match Express JSON preparation before committing; sending occurs afterward. */
function prepareJson(body: unknown, req: Request): string | undefined {
  const replacer = req.app.get('json replacer');
  const spaces = req.app.get('json spaces');
  const json = JSON.stringify(body, replacer, spaces);

  if (req.app.get('json escape') && json)
    return json.replace(/[<>&]/g, (character) => {
      switch (character) {
        case '<':
          return '\\u003c';
        case '>':
          return '\\u003e';
        default:
          return '\\u0026';
      }
    });

  return json;
}

/** Transactional mutations prepare their response before the outer commit. */
export function jsonHandler<R extends object, T, DTO>(
  controller: Controller<R, T>,
  toDTO: (result: T) => DTO,
  { status = 200, transaction = false }: JsonOptions<DTO> = {},
): RequestHandler {
  if (transaction) {
    return trackHandler(async (req: Request, res: Response) => {
      const prepared = await runInTransaction(
        AppDataSource.manager,
        async () => {
          const result = await controller(
            (req.validated ?? { params: null, query: null, body: null }) as R,
          );

          assertRequestActive();
          const body = toDTO(result);
          const code = typeof status === 'function' ? status(body) : status;

          if (!Number.isInteger(code) || code < 100 || code > 999)
            throw new RangeError('Invalid HTTP response status.');

          return { code, json: prepareJson(body, req) };
        },
      );

      if (!canRespond(req, res)) return;

      res.status(prepared.code);
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
