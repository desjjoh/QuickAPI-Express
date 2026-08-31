import os from 'node:os';

import { getEventLoopLag } from '@/common/helpers/timer.helpers';
import { isServerInitialized } from '@/config/database.config';

import type { InfoResponse } from '../models/info.model';
import type { SystemDiagnostics } from '../models/system.model';

export interface SystemRuntimeSource {
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  pid: number;
  uptime(): number;
  memoryUsage(): NodeJS.MemoryUsage;
  getActiveResourcesInfo(): readonly string[];
}

export interface SystemServiceDependencies {
  runtime?: SystemRuntimeSource;
  operatingSystem?: Pick<
    typeof os,
    'cpus' | 'loadavg' | 'totalmem' | 'freemem' | 'type' | 'release' | 'uptime' | 'hostname'
  >;
  now?: () => number;
  timezone?: () => string;
  eventLoopLag?: () => Promise<number>;
  databaseReady?: () => boolean;
}

export class SystemService {
  private readonly runtime: SystemRuntimeSource;
  private readonly operatingSystem: NonNullable<SystemServiceDependencies['operatingSystem']>;
  private readonly now: () => number;
  private readonly timezone: () => string;
  private readonly eventLoopLag: () => Promise<number>;
  private readonly databaseReady: () => boolean;

  constructor({
    runtime = process,
    operatingSystem = os,
    now = Date.now,
    timezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    eventLoopLag = getEventLoopLag,
    databaseReady = isServerInitialized,
  }: SystemServiceDependencies = {}) {
    this.runtime = runtime;
    this.operatingSystem = operatingSystem;
    this.now = now;
    this.timezone = timezone;
    this.eventLoopLag = eventLoopLag;
    this.databaseReady = databaseReady;
  }

  /** Collect application and runtime metadata for the information endpoint. */
  collectRuntimeInfo(): Pick<
    InfoResponse,
    'hostname' | 'pid' | 'node_version' | 'platform' | 'architecture' | 'started_at' | 'timezone'
  > {
    return {
      hostname: this.operatingSystem.hostname(),
      pid: this.runtime.pid,
      node_version: this.runtime.version,
      platform: this.runtime.platform,
      architecture: this.runtime.arch,
      started_at: new Date(this.now() - this.runtime.uptime() * 1000).toISOString(),
      timezone: this.timezone(),
    };
  }

  /**
   * Count active runtime resources through Node's documented public API. Resource
   * entries are the supported approximation used for the `active_handles` contract.
   */
  countActiveHandles(): number {
    return this.runtime.getActiveResourcesInfo().length;
  }

  /** Build a diagnostics snapshot from explicit application state. */
  collectSystemDiagnostics(eventLoopLag: number, databaseReady: boolean): SystemDiagnostics {
    const cpus = this.operatingSystem.cpus();
    const [oneMinute, fiveMinutes, fifteenMinutes] = this.operatingSystem.loadavg();
    const totalBytes = this.operatingSystem.totalmem();
    const freeBytes = this.operatingSystem.freemem();
    const usedBytes = totalBytes - freeBytes;
    const memory = this.runtime.memoryUsage();

    return {
      cpu: {
        logical_core_count: cpus.length,
        model: cpus[0]?.model || 'unknown',
        load_average: {
          one_minute: oneMinute,
          five_minutes: fiveMinutes,
          fifteen_minutes: fifteenMinutes,
        },
      },
      memory: {
        total_bytes: totalBytes,
        free_bytes: freeBytes,
        used_bytes: usedBytes,
        used_percent: totalBytes === 0 ? 0 : (usedBytes / totalBytes) * 100,
      },
      process: {
        rss_bytes: memory.rss,
        heap_total_bytes: memory.heapTotal,
        heap_used_bytes: memory.heapUsed,
        external_bytes: memory.external,
        active_handles: this.countActiveHandles(),
      },
      os: {
        type: this.operatingSystem.type(),
        release: this.operatingSystem.release(),
        uptime: this.operatingSystem.uptime(),
      },
      uptime: this.runtime.uptime(),
      timestamp: this.now(),
      event_loop_lag: eventLoopLag,
      database_status: databaseReady ? 'connected' : 'disconnected',
    };
  }

  /** Collect live application diagnostics for the system endpoint. */
  async getSystemDiagnostics(): Promise<SystemDiagnostics> {
    const databaseReady = this.databaseReady();
    const eventLoopLag = await this.eventLoopLag();

    return this.collectSystemDiagnostics(eventLoopLag, databaseReady);
  }
}

export const systemService = new SystemService();
