import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number().describe('Service uptime in seconds'),
  timestamp: z.iso.datetime(),
});

export const ReadyResponseSchema = z.object({
  status: z.enum(['ready', 'error']),
  db: z.enum(['connected', 'unreachable']),
});

export const MetricsResponseSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number(),
  rss: z.number().describe('Resident Set Size - total memory usage'),
  heapUsed: z.number().describe('Heap memory currently in use'),
  timestamp: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
