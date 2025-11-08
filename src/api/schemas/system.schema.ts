import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number().describe('Service uptime in seconds'),
  timestamp: z.string().datetime(),
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
  timestamp: z.string().datetime(),
});
