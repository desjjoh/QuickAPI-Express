import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

extendZodWithOpenApi(z);

export const HealthResponseSchema = z
  .object({
    alive: z.boolean().openapi({ example: true }),
    uptime: z.number().openapi({ example: 123.45 }),
    timestamp: z.string().openapi({ example: '2025-08-14T12:00:00Z' }),
  })
  .openapi('HealthResponse');

export const ReadyResponseSchema = z
  .object({
    ready: z.boolean().openapi({ example: true }),
  })
  .openapi('ReadyResponse');

export const InfoResponseSchema = z
  .object({
    name: z.string().openapi({ example: 'QuickAPI-Express' }),
    version: z.string().openapi({ example: '1.0.0' }),
    environment: z.string().openapi({ example: 'development' }),
    hostname: z.string().openapi({ example: 'server-001' }),
    pid: z.number().openapi({ example: 12345 }),
  })
  .openapi('SystemInfoResponse');

export const SystemDiagnosticsSchema = z
  .object({
    uptime: z.number(),
    timestamp: z.number(),
    eventLoopLag: z.number(),
    db: z.enum(['connected', 'disconnected']),
  })
  .openapi('SystemDiagnostics');

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
export type InfoResponse = z.infer<typeof InfoResponseSchema>;
export type SystemDiagnostics = z.infer<typeof SystemDiagnosticsSchema>;
