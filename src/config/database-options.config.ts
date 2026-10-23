import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import mysql, { type ConnectionOptions } from 'mysql2';
import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions.js';

import type { Env } from '@/config/env.config';
import { createBoundedMysqlPool } from '@/common/handlers/database-pool.handler';

/** Applied to application and CLI data sources alike; no automatic schema mutations. */
export function databaseTransportOptions(
  policy: Env,
): Pick<
  MysqlConnectionOptions,
  'driver' | 'poolSize' | 'connectTimeout' | 'ssl' | 'connectorPackage'
> {
  let ssl: MysqlConnectionOptions['ssl'];

  if (policy.DB_SSL) {
    let ca: string | undefined;

    if (policy.DB_SSL_CA_FILE) {
      try {
        ca = readFileSync(policy.DB_SSL_CA_FILE, 'utf8');
        const certificates = ca.match(
          /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
        );

        if (!certificates?.length) throw new Error('No PEM certificates.');
        for (const certificate of certificates)
          new X509Certificate(certificate);
      } catch {
        throw Object.assign(
          new Error('Unable to load valid database CA certificates.'),
          { code: 'DB_TLS_CONFIG' },
        );
      }
    }

    ssl = {
      rejectUnauthorized: true,
      verifyIdentity: true,
      minVersion: 'TLSv1.2',
      ...(ca ? { ca } : {}),
    } as MysqlConnectionOptions['ssl'];
  }

  return {
    connectorPackage: 'mysql2',
    poolSize: policy.DB_POOL_CONNECTION_LIMIT,
    connectTimeout: policy.DB_CONNECT_TIMEOUT_MS,
    ssl,
    driver: {
      ...mysql,
      createPool: (options: ConnectionOptions) =>
        createBoundedMysqlPool(options, {
          ...policy,
          DB_POOL_CONNECTION_LIMIT:
            options.connectionLimit ?? policy.DB_POOL_CONNECTION_LIMIT,
          DB_CONNECT_TIMEOUT_MS:
            options.connectTimeout ?? policy.DB_CONNECT_TIMEOUT_MS,
        }),
    },
  };
}
