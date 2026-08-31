import { describe, expect, it } from 'vitest';

import { collectRuntimeInfo } from '@/api/app/controllers/system.controller';

describe('system controller runtime information', () => {
  it('collects deterministic runtime values from injected dependencies', () => {
    expect(
      collectRuntimeInfo({
        runtime: {
          version: 'v24.10.0',
          platform: 'linux',
          arch: 'arm64',
          pid: 42,
          uptime: () => 12.5,
        },
        now: () => Date.parse('2026-08-31T12:00:12.500Z'),
        hostname: () => 'test-host',
        timezone: () => 'Etc/UTC',
      }),
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
