import type { Request, RequestHandler, Response } from 'express';
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

/** DTO mapping happens only while a response can still be sent. */
export function jsonHandler<R extends object, T, DTO>(
  controller: Controller<R, T>,
  toDTO: (result: T) => DTO,
  { status = 200 }: { status?: number | ((body: DTO) => number) } = {},
): RequestHandler {
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
