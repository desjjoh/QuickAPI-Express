import type os from 'node:os';
import { describe, expect, it } from 'vitest';

import { SystemService } from '@/api/app/services/system.service';

const runtime = {
  version: 'v24.10.0',
  platform: 'linux' as const,
  arch: 'arm64',
  pid: 42,
  uptime: () => 12.5,
  memoryUsage: () => ({ rss: 100, heapTotal: 80, heapUsed: 60, external: 20, arrayBuffers: 5 }),
  getActiveResourcesInfo: () => ['TCPServerWrap', 'Timeout'],
};

const operatingSystem = {
  cpus: () => [{ model: 'Test CPU' }, { model: 'Test CPU' }] as os.CpuInfo[],
  loadavg: () => [1, 0.5, 0.25],
  totalmem: () => 1000,
  freemem: () => 250,
  type: () => 'TestOS',
  release: () => '1.0',
  uptime: () => 500,
  hostname: () => 'test-host',
};

describe('system service runtime information', () => {
  it('collects deterministic runtime values from injected dependencies', () => {
    expect(
      new SystemService({
        runtime,
        operatingSystem,
        now: () => Date.parse('2026-08-31T12:00:12.500Z'),
        timezone: () => 'Etc/UTC',
      }).collectRuntimeInfo(),
    ).toEqual({
      hostname: 'test-host',
      pid: 42,
      node_version: 'v24.10.0',
      platform: 'linux',
      architecture: 'arm64',
      started_at: '2026-08-31T12:00:00.000Z',
      timezone: 'Etc/UTC',
    });
  });
});

describe('system diagnostics', () => {
  it('collects the nested snake_case diagnostics contract', () => {
    expect(
      new SystemService({
        runtime,
        operatingSystem,
        now: () => 1788192000000,
      }).collectSystemDiagnostics(3.5, true),
    ).toEqual({
      cpu: {
        logical_core_count: 2,
        model: 'Test CPU',
        load_average: { one_minute: 1, five_minutes: 0.5, fifteen_minutes: 0.25 },
      },
      memory: { total_bytes: 1000, free_bytes: 250, used_bytes: 750, used_percent: 75 },
      process: {
        rss_bytes: 100,
        heap_total_bytes: 80,
        heap_used_bytes: 60,
        external_bytes: 20,
        active_handles: 2,
      },
      os: { type: 'TestOS', release: '1.0', uptime: 500 },
      uptime: 12.5,
      timestamp: 1788192000000,
      event_loop_lag: 3.5,
      database_status: 'connected',
    });
  });

  it('counts active resources using the public runtime API', () => {
    expect(new SystemService({ runtime, operatingSystem }).countActiveHandles()).toBe(2);
  });

  it('collects live state through injected service dependencies', async () => {
    const service = new SystemService({
      runtime,
      operatingSystem,
      now: () => 1788192000000,
      eventLoopLag: async () => 2.5,
      databaseReady: () => false,
    });

    await expect(service.getSystemDiagnostics()).resolves.toMatchObject({
      event_loop_lag: 2.5,
      database_status: 'disconnected',
    });
  });
});
