import { describe, expect, it } from 'vitest';
import { env } from '@/config/env.config';
import { databaseTransportOptions } from '@/config/database-options.config';
import { fileURLToPath } from 'node:url';

const ca = fileURLToPath(new URL('../helpers/certs/ca.pem', import.meta.url));

describe('database transport options', () => {
  it('enforces CA, DNS identity, and minimum TLS verification without an insecure switch', () => {
    expect(
      databaseTransportOptions({
        ...env,
        DB_HOST: 'localhost',
        DB_SSL: true,
        DB_SSL_CA_FILE: ca,
      }),
    ).toMatchObject({
      connectorPackage: 'mysql2',
      ssl: {
        rejectUnauthorized: true,
        verifyIdentity: true,
        minVersion: 'TLSv1.2',
        ca: expect.stringContaining('BEGIN CERTIFICATE'),
      },
    });
    expect(
      databaseTransportOptions({
        ...env,
        DB_SSL: false,
        DB_SSL_CA_FILE: undefined,
      }).ssl,
    ).toBeUndefined();
  });

  it.each(['does-not-exist.pem', 'server-key.pem'])(
    'rejects an unreadable or invalid CA file %s',
    (file) => {
      expect(() =>
        databaseTransportOptions({
          ...env,
          DB_SSL: true,
          DB_SSL_CA_FILE: fileURLToPath(
            new URL(`../helpers/certs/${file}`, import.meta.url),
          ),
        }),
      ).toThrow('Unable to load valid database CA certificates.');
    },
  );
});
