import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const IdSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{16}$/, 'Invalid ID format')
  .openapi({ example: 'A1b2C3d4E5f6G7h8' });

export const IdParams = z.object({
  id: IdSchema,
});

export type IdRouteParams = { id: string };
