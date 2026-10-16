// Flat ESLint config: recommended JS + type-aware-ish TS rules, no type-checking for speed.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'public/**', 'tools/**', 'node_modules/**', '.venv/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Cloudflare Pages Functions run in the Workers runtime.
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { Response: 'readonly', Request: 'readonly', JSON: 'readonly', Date: 'readonly' },
    },
  },
  {
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },
);
