import type { Request, Response, NextFunction } from 'express';
import { RequestTimeoutError } from '@/exceptions/http.exception';

interface Options {
  headerTimeout?: number;
  chunkTimeout?: number;
  totalTimeout?: number;
}

export function requestTimeout({
  headerTimeout = 5_000,
  chunkTimeout = 2_000,
  totalTimeout = 10_000,
}: Options = {}) {
  return (req: Request, _: Response, next: NextFunction) => {
    const start: number = Date.now();
    let receivedFirstChunk: boolean = false;
    let lastChunkTime: number = Date.now();

    req.socket.setTimeout(headerTimeout);
    req.socket.on('timeout', () => {
      req.destroy();
    });

    const totalTimer: NodeJS.Timeout = setTimeout(() => {
      req.destroy(new RequestTimeoutError('Request exceeded total timeout.'));
    }, totalTimeout);

    req.on('data', () => {
      const now = Date.now();

      if (!receivedFirstChunk) {
        receivedFirstChunk = true;

        if (now - start > headerTimeout)
          req.destroy(new RequestTimeoutError('Header timeout exceeded.'));
      }

      if (now - lastChunkTime > chunkTimeout)
        req.destroy(new RequestTimeoutError('Chunk timeout exceeded.'));

      lastChunkTime = now;
    });

    req.on('end', () => {
      clearTimeout(totalTimer);
    });

    return next();
  };
}
