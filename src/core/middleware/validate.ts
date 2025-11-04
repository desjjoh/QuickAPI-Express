/**
 * @fileoverview Request validation middleware using Zod.
 * @module core/middleware/validate
 * @description
 *  Provides centralized validation for incoming request bodies.
 *  Parses the request payload using a Zod schema and forwards errors
 *  as typed `BadRequestError` instances when validation fails.
 *
 * @remarks
 *  - Designed for use with Express route handlers.
 *  - Replaces `req.body` with the parsed and validated data.
 *  - If validation fails, a descriptive error is propagated to the error handler.
 *
 * @example
 *  import { validate } from "@/core/middleware/validate";
 *  import { CreateUserSchema } from "@/schemas/user.schema";
 *
 *  router.post("/users", validate(CreateUserSchema), (req, res) => {
 *    // req.body is now validated and strongly typed.
 *    res.json(req.body);
 *  });
 */

import { ZodError } from 'zod';
import type { ZodObject } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { BadRequestError } from '@/core/utils/http-error';

/**
 * Middleware factory that validates incoming request bodies.
 *
 * @param {ZodObject} schema - Zod schema used to validate the request body.
 * @returns Express-compatible middleware function.
 *
 * @throws {BadRequestError} When the request body fails schema validation.
 */
export const validate =
  (schema: ZodObject) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const data = schema.parse(req.body);
      req.body = data;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const message = err.issues.map(e => e.message).join(', ');
        next(new BadRequestError(`Validation failed: ${message}`));
      } else {
        next(err);
      }
    }
  };
