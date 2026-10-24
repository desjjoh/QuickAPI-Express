import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const bash =
  process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe')
    : 'bash';

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runWrapper(
  project: string,
  failures: Record<string, string> = {},
  args: string[] = [],
) {
  const directory = mkdtempSync(join(tmpdir(), 'quickapi-wrapper-'));
  directories.push(directory);
  const log = join(directory, 'commands.log');
  const npm = join(directory, 'npm');
  writeFileSync(
    npm,
    `#!/usr/bin/env bash
printf '<%s>' "$@" >> "$WRAPPER_LOG"
printf '\\n' >> "$WRAPPER_LOG"
case "$2" in
  test:db:safety) exit "\${FAIL_SAFETY:-0}" ;;
  test:infra:up)
    if [[ -n "\${SIGNAL_START:-}" ]]; then kill "-\${SIGNAL_START}" "$PPID"; fi
    exit "\${FAIL_START:-0}" ;;
  test:infra:prepare) exit "\${FAIL_PREPARE:-0}" ;;
  test:infra:down) exit "\${FAIL_CLEANUP:-0}" ;;
  *) exit "\${FAIL_TEST:-0}" ;;
esac
`,
  );
  chmodSync(npm, 0o755);
  const result = spawnSync(
    bash,
    ['test/helpers/database/run-with-infra.sh', project, ...args],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: directory + delimiter + process.env.PATH,
        WRAPPER_LOG: log.replaceAll('\\', '/'),
        ...failures,
      },
      timeout: 10000,
    },
  );
  if (result.error) throw result.error;
  return {
    ...result,
    commands: existsSync(log)
      ? readFileSync(log, 'utf8').trim().split('\n')
      : [],
  };
}

describe('database command orchestration', () => {
  it.each(['integration', 'e2e', 'migration'])(
    'runs %s once and forwards argument boundaries',
    (project) => {
      const result = runWrapper(project, {}, [
        '--help',
        'argument with spaces',
      ]);
      expect(result.status, result.stderr).toBe(0);
      const command = `test:${project}:run`;
      expect(result.commands).toEqual([
        '<run><test:db:safety>',
        '<run><test:infra:up>',
        '<run><test:infra:prepare>',
        `<run><${command}><--><--help><argument with spaces>`,
        '<run><test:infra:down>',
      ]);
    },
  );

  it('rejects unsupported projects before any infrastructure command', () => {
    const result = runWrapper('unknown');
    expect(result.status).toBe(2);
    expect(result.commands).toEqual([]);
  });

  it('does not start or tear down infrastructure when target safety fails', () => {
    const result = runWrapper('integration', { FAIL_SAFETY: '17' });
    expect(result.status).toBe(17);
    expect(result.commands).toEqual(['<run><test:db:safety>']);
  });

  it.each(['FAIL_START', 'FAIL_PREPARE', 'FAIL_TEST'])(
    'preserves %s while cleanup also fails',
    (stage) => {
      const result = runWrapper('integration', {
        [stage]: '19',
        FAIL_CLEANUP: '23',
      });
      expect(result.status).toBe(19);
      expect(result.commands.at(-1)).toBe('<run><test:infra:down>');
      expect(
        result.commands.filter((line) => line.includes('test:infra:down')),
      ).toHaveLength(1);
      if (stage === 'FAIL_START')
        expect(result.commands.join()).not.toContain('test:infra:prepare');
      if (stage !== 'FAIL_TEST')
        expect(result.commands.join()).not.toContain('test:integration:run');
    },
  );

  it('fails the wrapper when only cleanup fails', () => {
    const result = runWrapper('e2e', { FAIL_CLEANUP: '23' });
    expect(result.status).toBe(23);
  });

  it.each([
    ['INT', 130],
    ['TERM', 143],
  ] as const)(
    'cleans up once and preserves the %s signal exit status',
    (signal, status) => {
      const result = runWrapper('integration', { SIGNAL_START: signal });
      expect(result.status, result.stderr).toBe(status);
      expect(result.commands).toEqual([
        '<run><test:db:safety>',
        '<run><test:infra:up>',
        '<run><test:infra:down>',
      ]);
    },
  );

  it('executes the safety CLI on this platform and refuses a protected schema', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve('test/helpers/database/safety.ts')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          DB_HOST: '127.0.0.1',
          DB_DATABASE: 'dev',
        },
        timeout: 10000,
      },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Unsafe test database configuration');
  });
});
