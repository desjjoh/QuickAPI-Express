const protectedDatabaseNames = new Set([
  'test',
  'dev',
  'development',
  'staging',
  'stage',
  'production',
  'prod',
]);

const localAndCiHosts = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  'mysql-test',
  'quickapi-test-mysql',
]);

/** Refuse to authorize destructive test-database operations unless every guard is explicit. */
export function assertSafeTestDatabase(environment: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];
  const database = environment.DB_DATABASE?.trim().toLowerCase() ?? '';
  const host = environment.DB_HOST?.trim().toLowerCase() ?? '';

  if (environment.NODE_ENV !== 'test') errors.push('NODE_ENV must be exactly "test"');

  if (!/^[a-z0-9_]+_disposable_test$/.test(database)) {
    errors.push('DB_DATABASE must end in the explicit "_disposable_test" convention');
  }

  if (protectedDatabaseNames.has(database)) {
    errors.push(`DB_DATABASE "${database}" is ambiguous or protected`);
  }

  const additionallyAllowedHosts = (environment.TEST_DB_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  const permittedHosts = new Set([...localAndCiHosts, ...additionallyAllowedHosts]);

  if (!permittedHosts.has(host)) {
    errors.push(
      `DB_HOST "${host || '(empty)'}" is not a permitted local/CI host; ` +
        'explicitly permit CI hosts with TEST_DB_ALLOWED_HOSTS',
    );
  }

  if (errors.length > 0) {
    throw new Error(`Unsafe test database configuration:\n- ${errors.join('\n- ')}`);
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  assertSafeTestDatabase();
  process.stdout.write('Test database safety checks passed.\n');
}
