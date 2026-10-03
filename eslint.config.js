import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// TypeScript owns type correctness. ESLint catches control-flow mistakes.
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.venv/**',
      '.worktrees/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'pytest-cache-*/**',
      'scripts/export-task-list-pdf.mjs',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
