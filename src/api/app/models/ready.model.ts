import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';

import { OutputValidationError } from '@/common/exceptions/http.exception';

extendZodWithOpenApi(z);

export const CheckStatusSchema = z.enum(['up', 'down']).openapi('CheckStatus', {
  description: 'Availability status for a required dependency.',
  example: 'up',
});

export type CheckStatus = z.infer<typeof CheckStatusSchema>;

export const DependencyCheckSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .openapi({ description: 'Registered dependency name.', example: 'database' }),
    status: CheckStatusSchema,
    response_time_ms: z.number().nonnegative().openapi({
      description: 'Time taken to evaluate the dependency, in milliseconds.',
      example: 2.4,
    }),
  })
  .openapi('DependencyCheck');

export type DependencyCheck = z.infer<typeof DependencyCheckSchema>;

const ReadyStatusSchema = z.enum(['ready', 'not_ready']).openapi('ReadyStatus', {
  description: 'Status derived from startup completion and all dependency checks.',
  example: 'ready',
});

export const ReadyResponseSchema = z
  .object({
    ready: z.boolean().openapi({
      description:
        'Indicates whether the application has successfully completed startup and is ready to accept traffic.',
      example: true,
    }),
    status: ReadyStatusSchema,
    timestamp: z.iso.datetime().openapi({
      description: 'ISO-8601 timestamp representing when readiness was evaluated.',
      example: '2025-08-14T12:00:00.000Z',
    }),
    checks: z.array(DependencyCheckSchema),
  })
  .openapi('ReadyResponse', {
    description: 'Readiness check response used for load balancers and orchestration systems.',
  });

export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;
export type ReadyDTOInput = {
  startupComplete: boolean;
  timestamp: string;
  checks: DependencyCheck[];
};

export function toDependencyCheckDTO(payload: DependencyCheck): DependencyCheck {
  const { success, error, data } = DependencyCheckSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}

export function toReadyDTO(payload: ReadyDTOInput): ReadyResponse {
  const checks: DependencyCheck[] | undefined = Array.isArray(payload.checks)
    ? payload.checks.map(toDependencyCheckDTO)
    : payload.checks;
  const ready: boolean =
    payload.startupComplete === true &&
    Array.isArray(checks) &&
    checks.every(check => check.status === 'up');
  const { success, error, data } = ReadyResponseSchema.safeParse({
    ready,
    status: ready ? 'ready' : 'not_ready',
    timestamp: payload.timestamp,
    checks,
  });

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
