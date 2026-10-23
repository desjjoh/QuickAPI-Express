import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import * as prettier from 'prettier';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const directory = new URL('../src/database/migrations/', import.meta.url);

await mkdir(directory, { recursive: true });
const previous = new Set(await readdir(directory));
const result = spawnSync(
  process.execPath,
  [
    '--import',
    'tsx',
    require.resolve('typeorm/cli.js'),
    'migration:generate',
    'src/database/migrations/SchemaUpdate',
    '-d',
    'src/config/database.config.ts',
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: 'inherit' },
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const generated = (await readdir(directory))
  .filter((name) => name.endsWith('.ts') && !previous.has(name))
  .map((name) => fileURLToPath(new URL(name, directory)));

if (generated.length) {
  // TypeORM emits runtime imports for interfaces; ESM/verbatimModuleSyntax needs types.
  // Fix only newly generated files so historical migrations remain untouched.
  const eslint = new ESLint({
    cwd: root,
    fix: true,
    overrideConfig: {
      rules: { '@typescript-eslint/consistent-type-imports': 'error' },
    },
  });
  const results = await eslint.lintFiles(generated);

  await ESLint.outputFixes(results);
  for (const file of generated) {
    const config = await prettier.resolveConfig(file);
    const source = await readFile(file, 'utf8');

    // Explicitly format new files even though historical migrations are ignored.
    await writeFile(
      file,
      await prettier.format(source, { ...config, filepath: file }),
    );
  }
  if (results.some((entry) => entry.errorCount > 0)) {
    const formatter = await eslint.loadFormatter('stylish');

    process.stderr.write(formatter.format(results));
    process.exitCode = 1;
  }
}
