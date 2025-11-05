/**
 * @fileoverview Shared Zod schema for numeric identifier validation.
 * @module api/schemas/id
 * @description
 *  Defines a reusable schema for validating positive integer identifiers (IDs)
 *  across API routes and entity definitions. Extends Zod with OpenAPI metadata
 *  to ensure consistent schema generation in Swagger documentation.
 *
 * @remarks
 *  - Ensures all IDs are strictly positive integers.
 *  - Integrated with `@asteasolutions/zod-to-openapi` for automatic OpenAPI export.
 *  - Used across route parameters, DTOs, and entity references.
 *
 * @example
 *  import { UserIdSchema } from '@/schemas/id';
 *  const id = UserIdSchema.parse(42); // ✅ valid
 *  const bad = UserIdSchema.parse(-1); // ❌ throws ZodError
 */

import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

/**
 * Extends Zod with OpenAPI integration helpers.
 * Enables `.openapi()` annotations for schema documentation.
 */
extendZodWithOpenApi(z);

/**
 * Schema validating a positive integer ID.
 *
 * @constant
 * @type {z.ZodNumber}
 * @example
 *  UserIdSchema.parse(1); // ✅
 *  UserIdSchema.parse(0); // ❌ Invalid ID
 */
export const UserIdSchema = z.number().int().positive().openapi({ example: 1 });
