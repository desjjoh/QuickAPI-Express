import { describe, expect, it } from 'vitest';
import { openApiSpec } from '@/config/docs.config';

// OpenAPI nodes are intentionally traversed dynamically in these contract assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonObject = Record<string, any>;

const schemas = (openApiSpec.components?.schemas ?? {}) as JsonObject;

function responseSchema(path: string, status: number): JsonObject {
  return (openApiSpec.paths as JsonObject)[path].get.responses[status].content['application/json']
    .schema;
}

function expectRequired(schema: string, properties: string[]): void {
  expect(schemas[schema].required).toEqual(properties);
  expect(Object.keys(schemas[schema].properties)).toEqual(properties);
}

describe('generated OpenAPI contract', () => {
  it('publishes every status and operations route with its response codes and schemas', () => {
    expect(Object.keys(openApiSpec.paths)).toEqual(
      expect.arrayContaining(['/', '/health', '/ready', '/info', '/system', '/metrics']),
    );
    expect(responseSchema('/', 200)).toEqual({ $ref: '#/components/schemas/RootResponse' });
    expect(responseSchema('/health', 200)).toEqual({
      $ref: '#/components/schemas/HealthResponse',
    });
    expect(responseSchema('/ready', 200)).toEqual({
      $ref: '#/components/schemas/ReadyResponse',
    });
    expect(responseSchema('/ready', 503)).toEqual({
      $ref: '#/components/schemas/ReadyResponse',
    });
    expect(responseSchema('/info', 200)).toEqual({
      $ref: '#/components/schemas/SystemInfoResponse',
    });
    expect(responseSchema('/system', 200)).toEqual({
      $ref: '#/components/schemas/SystemDiagnostics',
    });
    expect(Object.keys((openApiSpec.paths as JsonObject)['/ready'].get.responses)).toEqual([
      '200',
      '503',
    ]);
  });

  it('defines required health, readiness, information, and diagnostics properties', () => {
    expectRequired('RootResponse', ['message']);
    expectRequired('HealthResponse', ['alive', 'status', 'uptime', 'timestamp']);
    expectRequired('DependencyCheck', ['name', 'status', 'response_time_ms']);
    expectRequired('ReadyResponse', ['ready', 'status', 'timestamp', 'checks']);
    expectRequired('SystemInfoResponse', [
      'name',
      'version',
      'environment',
      'hostname',
      'pid',
      'node_version',
      'platform',
      'architecture',
      'started_at',
      'timezone',
    ]);
    expectRequired('CpuLoadAverage', ['one_minute', 'five_minutes', 'fifteen_minutes']);
    expectRequired('CpuDiagnostics', ['logical_core_count', 'model', 'load_average']);
    expectRequired('MemoryDiagnostics', [
      'total_bytes',
      'free_bytes',
      'used_bytes',
      'used_percent',
    ]);
    expectRequired('ProcessDiagnostics', [
      'rss_bytes',
      'heap_total_bytes',
      'heap_used_bytes',
      'external_bytes',
      'active_handles',
    ]);
    expectRequired('OsDiagnostics', ['type', 'release', 'uptime']);
    expectRequired('SystemDiagnostics', [
      'cpu',
      'memory',
      'process',
      'os',
      'uptime',
      'timestamp',
      'event_loop_lag',
      'database_status',
    ]);
  });

  it('preserves nested component references and status enums', () => {
    expect(schemas.HealthResponse.properties.status).toEqual({
      $ref: '#/components/schemas/HealthStatus',
    });
    expect(schemas.ReadyResponse.properties).toMatchObject({
      status: { $ref: '#/components/schemas/ReadyStatus' },
      checks: { items: { $ref: '#/components/schemas/DependencyCheck' } },
    });
    expect(schemas.DependencyCheck.properties.status).toEqual({
      $ref: '#/components/schemas/CheckStatus',
    });
    expect(schemas.CpuDiagnostics.properties.load_average).toEqual({
      $ref: '#/components/schemas/CpuLoadAverage',
    });
    expect(schemas.SystemDiagnostics.properties).toMatchObject({
      cpu: { $ref: '#/components/schemas/CpuDiagnostics' },
      memory: { $ref: '#/components/schemas/MemoryDiagnostics' },
      process: { $ref: '#/components/schemas/ProcessDiagnostics' },
      os: { $ref: '#/components/schemas/OsDiagnostics' },
    });
    expect(schemas.HealthStatus.enum).toEqual(['healthy', 'unhealthy']);
    expect(schemas.CheckStatus.enum).toEqual(['up', 'down']);
    expect(schemas.ReadyStatus.enum).toEqual(['ready', 'not_ready']);
    expect(schemas.SystemInfoResponse.properties.environment.enum).toEqual([
      'development',
      'test',
      'production',
    ]);
    expect(schemas.SystemDiagnostics.properties.database_status.enum).toEqual([
      'connected',
      'disconnected',
    ]);
  });

  it('documents metrics using the Prometheus media type rather than JSON', () => {
    const content = (openApiSpec.paths as JsonObject)['/metrics'].get.responses[200].content;
    expect(content).toEqual({
      'text/plain; version=0.0.4; charset=utf-8': {
        schema: { type: 'string', description: 'Prometheus text exposition format.' },
      },
    });
    expect(content).not.toHaveProperty('application/json');
  });

  it('publishes correctly typed examples', () => {
    const check = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if ('example' in record && typeof record.type === 'string') {
        const expected = record.type === 'integer' ? 'number' : record.type;
        expect(typeof record.example).toBe(expected);
      }
      Object.values(record).forEach(check);
    };
    check(openApiSpec);
  });
});
