import os from 'node:os';
import { env } from '@/config/env.config';
import { metricsRegistry } from '@/config/metrics.config';
import { LC } from '@/common/handlers/lifecycle.handler';

import { getEventLoopLag } from '@/common/helpers/timer.helpers';
import { isServerInitialized } from '@/config/database.config';

import type { HealthDTOInput } from '../models/health.model';
import type { ReadyDTOInput } from '../models/ready.model';
import type { RootResponse } from '../models/root.model';
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
    | 'cpus'
    | 'loadavg'
    | 'totalmem'
    | 'freemem'
    | 'type'
    | 'release'
    | 'uptime'
    | 'hostname'
  >;
  now?: () => number;
  timezone?: () => string;
  eventLoopLag?: () => Promise<number>;
  databaseReady?: () => boolean;
}

export class SystemService {
  private readonly runtime: SystemRuntimeSource;
  private readonly operatingSystem: NonNullable<
    SystemServiceDependencies['operatingSystem']
  >;
  private readonly now: () => number;
  private readonly timezone: () => string;
  private readonly eventLoopLag: () => Promise<number>;
  private readonly databaseReady: () => boolean;

  public constructor({
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

  public getRoot = (): RootResponse => ({
    message: 'Hello World! Welcome to Express.js',
  });

  /** Liveness remains independent of database connectivity. */
  public getHealth = (): HealthDTOInput => ({
    alive: LC.isAlive(),
    uptime: this.runtime.uptime(),
    timestamp: new Date(this.now()).toISOString(),
  });

  public getReady = async (): Promise<ReadyDTOInput> => {
    const checks = await LC.checkDependencies();

    return {
      startupComplete: LC.isReady(),
      timestamp: new Date(this.now()).toISOString(),
      checks,
    };
  };

  public getInfo = (): InfoResponse => ({
    name: env.APP_NAME,
    version: env.APP_VERSION,
    environment: env.NODE_ENV,
    ...this.collectRuntimeInfo(),
  });

  public getMetrics = (): Promise<string> => metricsRegistry.metrics();

  /** Collect application and runtime metadata for the information endpoint. */
  public collectRuntimeInfo(): Pick<
    InfoResponse,
    | 'hostname'
    | 'pid'
    | 'node_version'
    | 'platform'
    | 'architecture'
    | 'started_at'
    | 'timezone'
  > {
    return {
      hostname: this.operatingSystem.hostname(),
      pid: this.runtime.pid,
      node_version: this.runtime.version,
      platform: this.runtime.platform,
      architecture: this.runtime.arch,
      started_at: new Date(
        this.now() - this.runtime.uptime() * 1000,
      ).toISOString(),
      timezone: this.timezone(),
    };
  }

  /**
   * Count active runtime resources through Node's documented public API. Resource
   * entries are the supported approximation used for the `active_handles` contract.
   */
  public countActiveHandles(): number {
    return this.runtime.getActiveResourcesInfo().length;
  }

  /** Build a diagnostics snapshot from explicit application state. */
  public collectSystemDiagnostics(
    eventLoopLag: number,
    databaseReady: boolean,
  ): SystemDiagnostics {
    const cpus = this.operatingSystem.cpus();
    const [oneMinute, fiveMinutes, fifteenMinutes] =
      this.operatingSystem.loadavg();
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
  public getSystemDiagnostics = async (): Promise<SystemDiagnostics> => {
    const databaseReady = this.databaseReady();
    const eventLoopLag = await this.eventLoopLag();

    return this.collectSystemDiagnostics(eventLoopLag, databaseReady);
  };
}

export const systemService = new SystemService();
