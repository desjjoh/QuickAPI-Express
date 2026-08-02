import { defineConfig, defineProject } from 'vitest/config';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: [path.resolve(__dirname, 'test/setup.ts')],
    projects: [
      defineProject({
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'src'),
          },
        },
        test: {
          name: 'unit',
          environment: 'node',
          globals: true,
          setupFiles: [path.resolve(__dirname, 'test/setup.ts')],
          include: ['test/unit/**/*.test.ts'],
        },
      }),
      defineProject({
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'src'),
          },
        },
        test: {
          name: 'integration',
          environment: 'node',
          globals: true,
          fileParallelism: false,
          setupFiles: [path.resolve(__dirname, 'test/setup.ts')],
          include: ['test/integration/**/*.test.ts'],
        },
      }),
      defineProject({
        resolve: {
          alias: {
            '@': path.resolve(__dirname, 'src'),
          },
        },
        test: {
          name: 'e2e',
          environment: 'node',
          globals: true,
          fileParallelism: false,
          setupFiles: [path.resolve(__dirname, 'test/setup.ts')],
          include: ['test/e2e/**/*.test.ts'],
        },
      }),
    ],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'reports/junit.xml',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/index.ts', // Process entrypoint: only composes lifecycle services and starts the app.
        'dist/**',
      ],
      reporter: ['text', 'json', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: 15,
        functions: 15,
        statements: 15,
        branches: 10,
        'src/config/{env,http-server}.config.ts': {
          lines: 35,
          statements: 35,
        },
        'src/common/middleware/{error-handler,validate-request}.middleware.ts': {
          lines: 40,
          statements: 40,
          branches: 25,
        },
        'src/modules/api/v1/items/models/*.ts': {
          lines: 40,
          statements: 40,
        },
        'src/modules/domain/{entities,repositories}/**/*.ts': {
          lines: 20,
          statements: 20,
        },
        'src/common/handlers/lifecycle.handler.ts': {
          lines: 20,
          statements: 20,
        },
      },
    },
  },
});
