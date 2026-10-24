import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'reports/**',
      '.release-check/**',
    ],
  },
  { ...js.configs.recommended, files: ['**/*.{js,cjs,mjs,ts}'] },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts'],
  })),
  prettier,
  prettierRecommended,
  {
    files: ['**/*.{js,cjs,mjs,ts}'],
    languageOptions: { globals: globals.node },
    rules: { 'prettier/prettier': ['error', { endOfLine: 'auto' }] },
  },
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
    },
    rules: {
      'no-console': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/database/migrations/**/*.ts'],
    rules: {
      'lines-between-class-members': [
        'error',
        {
          enforce: [
            { blankLine: 'always', prev: '*', next: 'method' },
            { blankLine: 'always', prev: 'method', next: '*' },
          ],
        },
      ],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: ['const', 'let'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let'], next: ['const', 'let'] },
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: '*', next: ['return', 'throw', 'try'] },
      ],
    },
  },
];
