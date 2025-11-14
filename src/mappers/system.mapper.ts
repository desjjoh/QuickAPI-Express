import { OutputValidationError } from '@/exceptions/http.exception';
import {
  type HealthResponse,
  type ReadyResponse,
  type InfoResponse,
  type SystemDiagnostics,
  HealthResponseSchema,
  InfoResponseSchema,
  SystemDiagnosticsSchema,
  ReadyResponseSchema,
} from '@/models/system.model';

export function toHealthDTO(payload: HealthResponse): HealthResponse {
  const { success, error, data } = HealthResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}

export function toReadyDTO(payload: ReadyResponse): ReadyResponse {
  const { success, error, data } = ReadyResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}

export function toInfoDTO(payload: InfoResponse): InfoResponse {
  const { success, error, data } = InfoResponseSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}

export function toSystemDiagnosticsDTO(payload: SystemDiagnostics): SystemDiagnostics {
  const { success, error, data } = SystemDiagnosticsSchema.safeParse(payload);

  if (!success) throw new OutputValidationError('Failed to validate response DTO', error.issues);

  return data;
}
