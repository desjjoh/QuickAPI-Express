import { defineConfig } from 'vitest/config';

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
    include: ['test/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
