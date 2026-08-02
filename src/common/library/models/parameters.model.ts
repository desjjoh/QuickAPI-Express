import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const IdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{16}$/, 'Invalid ID format')
  .openapi({
    description: 'A 16-character alphanumeric identifier used to uniquely reference a resource.',
    example: 'A1b2C3d4E5f6G7h8',
  });

export const IdParams = z
  .object({
    id: IdSchema,
  })
  .openapi('IdParams', {
    description: 'Path parameters including the unique resource identifier.',
  });

export type IdRouteParams = { id: string };
