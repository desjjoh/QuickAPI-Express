import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { OutputValidationError } from '@/common/exceptions/http.exception';

extendZodWithOpenApi(z);

const bytes = z.number().int().nonnegative();

export const CpuDiagnosticsSchema = z
  .object({
    logical_core_count: z.number().int().positive().openapi({ example: 8 }),
    model: z.string().min(1).openapi({ example: 'Intel(R) Core(TM) i7-1185G7' }),
    load_average: z
      .object({
        one_minute: z.number().nonnegative().openapi({ example: 0.42 }),
        five_minutes: z.number().nonnegative().openapi({ example: 0.36 }),
        fifteen_minutes: z.number().nonnegative().openapi({ example: 0.31 }),
      })
      .openapi('CpuLoadAverage'),
  })
  .openapi('CpuDiagnostics');

export const MemoryDiagnosticsSchema = z
  .object({
    total_bytes: bytes.openapi({ example: 17179869184 }),
    free_bytes: bytes.openapi({ example: 6442450944 }),
    used_bytes: bytes.openapi({ example: 10737418240 }),
    used_percent: z.number().min(0).max(100).openapi({ example: 62.5 }),
  })
  .openapi('MemoryDiagnostics');

export const ProcessDiagnosticsSchema = z
  .object({
    rss_bytes: bytes.openapi({ example: 78643200 }),
    heap_total_bytes: bytes.openapi({ example: 33554432 }),
    heap_used_bytes: bytes.openapi({ example: 25165824 }),
    external_bytes: bytes.openapi({ example: 2097152 }),
    active_handles: z.number().int().nonnegative().openapi({ example: 7 }),
  })
  .openapi('ProcessDiagnostics');

export const OsDiagnosticsSchema = z
  .object({
    type: z.string().min(1).openapi({ example: 'Linux' }),
    release: z.string().min(1).openapi({ example: '6.8.0' }),
    uptime: z.number().nonnegative().openapi({ example: 123456 }),
  })
  .openapi('OsDiagnostics');

export const SystemDiagnosticsSchema = z
  .object({
    cpu: CpuDiagnosticsSchema,
    memory: MemoryDiagnosticsSchema,
    process: ProcessDiagnosticsSchema,
    os: OsDiagnosticsSchema,
    uptime: z.number().nonnegative().openapi({
      description: 'Application process uptime in seconds.',
      example: 3600,
    }),
    timestamp: z.number().int().nonnegative().openapi({
      description: 'Snapshot time in milliseconds since the UNIX epoch.',
      example: 1788192000000,
    }),
    event_loop_lag: z.number().nonnegative().openapi({
      description: 'Estimated event loop delay in milliseconds.',
      example: 4.2,
    }),
    database_status: z.enum(['connected', 'disconnected']).openapi({
      description: 'Current database initialization status.',
      example: 'connected',
    }),
  })
  .openapi('SystemDiagnostics', {
    description: 'Low-level system diagnostics useful for monitoring and health dashboards.',
  });

export type CpuDiagnostics = z.infer<typeof CpuDiagnosticsSchema>;
export type MemoryDiagnostics = z.infer<typeof MemoryDiagnosticsSchema>;
export type ProcessDiagnostics = z.infer<typeof ProcessDiagnosticsSchema>;
export type OsDiagnostics = z.infer<typeof OsDiagnosticsSchema>;
export type SystemDiagnostics = z.infer<typeof SystemDiagnosticsSchema>;

export function toSystemDiagnosticsDTO(payload: SystemDiagnostics): SystemDiagnostics {
  const { success, error, data } = SystemDiagnosticsSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
