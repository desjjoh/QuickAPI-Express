import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DataSource } from 'typeorm';

import { parseEnv } from '@/config/env.config';
import { databaseTransportOptions } from '@/config/database-options.config';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const caFile = fileURLToPath(new URL('../certs/ca.pem', import.meta.url));
const project = `quickapi-express-tls-${process.pid}`;
const composeFile = fileURLToPath(
  new URL('../../../docker-compose.tls-test.yml', import.meta.url),
);
function compose(args: string[]): string {
  return execFileSync(
    'docker',
    ['compose', '-f', composeFile, '-p', project, ...args],
    { cwd: root, encoding: 'utf8' },
  );
}

// Never attach to a pre-existing project, even on a developer's machine.
assert.equal(
  execFileSync(
    'docker',
    ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`],
    { encoding: 'utf8' },
  ).trim(),
  '',
);

try {
  compose(['up', '-d', '--wait']);
  const address = compose(['port', 'mysql-tls', '3306']).trim();
  const port = address.match(/:(\d+)$/)?.[1];

  assert.ok(port);
  const policy = parseEnv({
    NODE_ENV: 'test',
    PORT: '0',
    LOG_LEVEL: 'silent',
    DB_HOST: 'localhost',
    DB_PORT: port,
    DB_DATABASE: 'quickapi_tls_disposable_test',
    DB_USER: 'quickapi_test_user',
    DB_PASSWORD: 'quickapi_test_password',
    DB_SSL: 'true',
    DB_SSL_CA_FILE: caFile,
    DB_CONNECT_TIMEOUT_MS: '2000',
    DB_POOL_ACQUIRE_TIMEOUT_MS: '3000',
  });
  const candidate = (ca = true) =>
    new DataSource({
      type: 'mysql',
      host: policy.DB_HOST,
      port: policy.DB_PORT,
      username: policy.DB_USER,
      password: policy.DB_PASSWORD,
      database: policy.DB_DATABASE,
      ...databaseTransportOptions({
        ...policy,
        DB_SSL_CA_FILE: ca ? caFile : undefined,
      }),
    });
  const good = candidate();

  await good.initialize();
  const rows = await good.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'");

  assert.ok(rows[0].Value, 'Verified connection must actually use TLS');
  await good.destroy();
  process.stdout.write('TLS: trusted CA and matching DNS identity passed.\n');
  const untrusted = candidate(false);

  await assert.rejects(untrusted.initialize(), { code: 'HANDSHAKE_SSL_ERROR' });
  assert.equal(untrusted.isInitialized, false);
  process.stdout.write('TLS: untrusted certificate rejected.\n');

  for (const certificate of ['wrong-cert.pem']) {
    // This command targets only the newly created disposable TLS container.
    compose([
      'exec',
      '-T',
      'mysql-tls',
      'sh',
      '-ec',
      `cp /fixtures/${certificate} /tmp/quickapi-tls/server-cert.pem; chown mysql:mysql /tmp/quickapi-tls/server-cert.pem; MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e 'ALTER INSTANCE RELOAD TLS'`,
    ]);
    const rejected = candidate();

    await assert.rejects(rejected.initialize(), {
      code: 'HANDSHAKE_SSL_ERROR',
    });
    assert.equal(rejected.isInitialized, false);
    process.stdout.write(`TLS: ${certificate} rejected.\n`);
  }

  // Test-only reload allows the invalid context to replace the previous one.
  // The client must reject the expired certificate and never retry in plaintext.
  compose([
    'exec',
    '-T',
    'mysql-tls',
    'sh',
    '-ec',
    `cp /fixtures/expired-cert.pem /tmp/quickapi-tls/server-cert.pem; chown mysql:mysql /tmp/quickapi-tls/server-cert.pem; MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e 'ALTER INSTANCE RELOAD TLS NO ROLLBACK ON ERROR'`,
  ]);
  assert.match(compose(['logs', '--tail', '15']), /certificate has expired/);
  await assert.rejects(candidate().initialize(), {
    code: 'HANDSHAKE_SSL_ERROR',
    message: /certificate has expired/,
  });
  const plain = new DataSource({
    type: 'mysql',
    host: policy.DB_HOST,
    port: policy.DB_PORT,
    username: policy.DB_USER,
    password: policy.DB_PASSWORD,
    database: policy.DB_DATABASE,
    ...databaseTransportOptions({
      ...policy,
      DB_SSL: false,
      DB_SSL_CA_FILE: undefined,
    }),
  });

  await plain.initialize();
  await plain.destroy();
  process.stdout.write(
    'TLS: expired certificate rejected by client; no plaintext downgrade while plaintext control remains reachable.\n',
  );
} catch (error) {
  process.stderr.write(compose(['logs', '--tail', '50']));
  throw error;
} finally {
  compose(['down', '--volumes', '--remove-orphans']);
}
