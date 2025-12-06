import type { Request, Response, NextFunction } from 'express';
import {
  RequestHeaderFieldsTooLargeError,
  UnsupportedTransferEncodingError,
} from '@/exceptions/http.exception';

export interface HeaderLimits {
  maxHeaderCount: number;
  maxSingleHeaderBytes: number;
  maxTotalHeaderBytes: number;
  allowChunked: boolean;
}

const defaultLimits: HeaderLimits = {
  maxHeaderCount: 100,
  maxSingleHeaderBytes: 4_096,
  maxTotalHeaderBytes: 8_192,
  allowChunked: false,
};

export function enforceHeaderLimits(limits: HeaderLimits = defaultLimits) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const headers = req.headers;
    const headerEntries = Object.entries(headers);

    if (headerEntries.length > limits.maxHeaderCount) {
      return next(
        new RequestHeaderFieldsTooLargeError(
          `Too many headers (limit = ${limits.maxHeaderCount}).`,
        ),
      );
    }

    let totalBytes: number = 0;

    for (const [key, value] of headerEntries) {
      const keyBytes: number = Buffer.byteLength(key);
      const values: string[] = Array.isArray(value) ? value : [value ?? ''];

      for (const v of values) {
        const valueBytes: number = Buffer.byteLength(v);
        const size: number = keyBytes + valueBytes;

        totalBytes += size;

        if (size > limits.maxSingleHeaderBytes) {
          return next(
            new RequestHeaderFieldsTooLargeError(
              `Header exceeds per-header size limit (${limits.maxSingleHeaderBytes} bytes).`,
            ),
          );
        }
      }
    }

    if (totalBytes > limits.maxTotalHeaderBytes) {
      return next(
        new RequestHeaderFieldsTooLargeError(
          `Total header size exceeds limit (${limits.maxTotalHeaderBytes} bytes).`,
        ),
      );
    }

    const transferEncoding = req.headers['transfer-encoding'];

    if (!limits.allowChunked && typeof transferEncoding === 'string') {
      if (transferEncoding.toLowerCase().includes('chunked')) {
        return next(
          new UnsupportedTransferEncodingError('Chunked request bodies are not allowed.'),
        );
      }
    }

    next();
  };
}
