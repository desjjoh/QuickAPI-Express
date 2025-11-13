import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const IdSchema = z.coerce.number().int().positive().openapi({ example: 1 });
export const IdParams = z.object({
  id: IdSchema.transform(Number),
});

export type IdRouteParams = { id: string };
