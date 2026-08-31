import type { ItemEntity } from '@/database/entities/_item.entity';
import { describe, expect, it } from 'vitest';
import { OutputValidationError } from '@/common/exceptions/http.exception';
import { toItemDTO, toItemListDTO } from '@/api/v1/items/models/item.model';
import { toRootDTO } from '@/api/app/models/root.model';
import { toReadyDTO } from '@/api/app/models/ready.model';
import { toInfoDTO } from '@/api/app/models/info.model';
import { toHealthDTO } from '@/api/app/models/health.model';
import { toDependencyCheckDTO } from '@/api/app/models/ready.model';
import { toSystemDiagnosticsDTO } from '@/api/app/models/system.model';

const info = {
  name: 'quickapi',
  version: '1.0.0',
  environment: 'test' as const,
  hostname: 'server-001',
  pid: 12345,
  node_version: 'v24.10.0',
  platform: 'linux',
  architecture: 'x64',
  started_at: '2026-08-31T12:00:00.000Z',
  timezone: 'Etc/UTC',
};

const item = {
  id: 'A1b2C3d4E5f6G7h8',
  name: 'Sword',
  price: '12.50',
  description: 'Sharp',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
} as ItemEntity;

const system = {
  cpu: {
    logical_core_count: 8,
    model: 'Test CPU',
    load_average: { one_minute: 0.1, five_minutes: 0.2, fifteen_minutes: 0.3 },
  },
  memory: {
    total_bytes: 16_000,
    free_bytes: 6_000,
    used_bytes: 10_000,
    used_percent: 62.5,
  },
  process: {
    rss_bytes: 1_000,
    heap_total_bytes: 800,
    heap_used_bytes: 500,
    external_bytes: 100,
    active_handles: 3,
  },
  os: { type: 'Linux', release: '6.8.0', uptime: 86_400 },
  uptime: 3_600,
  timestamp: 1_788_192_000_000,
  event_loop_lag: 1.25,
  database_status: 'connected' as const,
};

describe('output DTO validation', () => {
  it('returns validated entity and list DTOs', () => {
    expect(toItemDTO(item)).toMatchObject({ name: 'Sword', price: 12.5 });
    expect(toItemListDTO({ items: [item], total: 1, page: 1, limit: 25 })).toMatchObject({
      total: 1,
      page: 1,
      limit: 25,
      data: [{ price: 12.5 }],
    });
    expect(toRootDTO({ message: 'hello' })).toEqual({ message: 'hello' });
    expect(
      toReadyDTO({ startupComplete: true, timestamp: '2026-01-01T00:00:00.000Z', checks: [] }),
    ).toEqual({
      ready: true,
      status: 'ready',
      timestamp: '2026-01-01T00:00:00.000Z',
      checks: [],
    });
    expect(toInfoDTO(info)).toEqual(info);
  });

  it('validates health and derives its status from liveness', () => {
    expect(
      toHealthDTO({ alive: true, uptime: 12.5, timestamp: '2026-08-31T12:00:00.000Z' }),
    ).toEqual({
      alive: true,
      status: 'healthy',
      uptime: 12.5,
      timestamp: '2026-08-31T12:00:00.000Z',
    });
    expect(
      toHealthDTO({ alive: false, uptime: 12.5, timestamp: '2026-08-31T12:00:00.000Z' }),
    ).toMatchObject({ alive: false, status: 'unhealthy' });
  });

  it('validates dependency checks and derives readiness from startup and check state', () => {
    const up = { name: 'database', status: 'up' as const, response_time_ms: 2.5 };
    const down = { ...up, status: 'down' as const };
    expect(toDependencyCheckDTO(up)).toEqual(up);
    expect(
      toReadyDTO({
        startupComplete: true,
        timestamp: '2026-08-31T12:00:00.000Z',
        checks: [up],
      }),
    ).toMatchObject({ ready: true, status: 'ready', checks: [up] });
    expect(
      toReadyDTO({
        startupComplete: true,
        timestamp: '2026-08-31T12:00:00.000Z',
        checks: [down],
      }),
    ).toMatchObject({ ready: false, status: 'not_ready', checks: [down] });
    expect(
      toReadyDTO({
        startupComplete: false,
        timestamp: '2026-08-31T12:00:00.000Z',
        checks: [up],
      }),
    ).toMatchObject({ ready: false, status: 'not_ready' });
  });

  it('validates complete information metadata and every nested system diagnostics object', () => {
    expect(toInfoDTO(info)).toEqual(info);
    expect(toSystemDiagnosticsDTO(system)).toEqual(system);
  });

  it.each([
    () => toItemDTO({ ...item, id: 'bad' }),
    () => toItemListDTO({ items: [item], total: -1, page: 1, limit: 25 }),
    () => toRootDTO({ message: 1 } as never),
    () => toReadyDTO({ startupComplete: 'yes' } as never),
    () => toInfoDTO({ ...info, environment: 'staging' } as never),
    () => toInfoDTO({ ...info, pid: 1.5 }),
    () => toInfoDTO({ ...info, started_at: 'last Tuesday' }),
    () => toHealthDTO({ alive: true, uptime: -1, timestamp: '2026-08-31T12:00:00.000Z' }),
    () => toHealthDTO({ alive: true, uptime: 1, timestamp: 'not-a-timestamp' }),
    () => toDependencyCheckDTO({ name: '', status: 'up', response_time_ms: 1 }),
    () =>
      toDependencyCheckDTO({ name: 'database', status: 'unknown' as never, response_time_ms: 1 }),
    () => toDependencyCheckDTO({ name: 'database', status: 'up', response_time_ms: -0.1 }),
    () => toReadyDTO({ startupComplete: true, timestamp: 'not-a-timestamp', checks: [] }),
    () => toSystemDiagnosticsDTO({ ...system, cpu: { ...system.cpu, logical_core_count: 0 } }),
    () =>
      toSystemDiagnosticsDTO({
        ...system,
        cpu: { ...system.cpu, load_average: { ...system.cpu.load_average, one_minute: -1 } },
      }),
    () => toSystemDiagnosticsDTO({ ...system, memory: { ...system.memory, total_bytes: -1 } }),
    () => toSystemDiagnosticsDTO({ ...system, memory: { ...system.memory, used_percent: 101 } }),
    () => toSystemDiagnosticsDTO({ ...system, process: { ...system.process, rss_bytes: -1 } }),
    () => toSystemDiagnosticsDTO({ ...system, process: { ...system.process, active_handles: -1 } }),
    () => toSystemDiagnosticsDTO({ ...system, os: { ...system.os, uptime: -1 } }),
    () => toSystemDiagnosticsDTO({ ...system, uptime: -1 }),
    () => toSystemDiagnosticsDTO({ ...system, timestamp: -1 }),
    () => toSystemDiagnosticsDTO({ ...system, event_loop_lag: -1 }),
    () => toSystemDiagnosticsDTO({ ...system, database_status: 'starting' as never }),
  ])('turns invalid output into OutputValidationError', produce => {
    expect(produce).toThrow(OutputValidationError);
  });
});
