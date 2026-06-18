// Flat ESLint config. Intentionally lenient (report-only in CI for one release,
// per docs/IMPROVEMENT-PLAN.md Phase 1) — the goal is a machine floor under
// hook-dependency correctness and obvious mistakes, not a style crusade.
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default [
  { ignores: ['dist/**', 'coverage/**', 'public/**', 'node_modules/**'] },
  js.configs.recommended,
  // Frontend — browser + React + JSX
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // Backend + tooling — Node
  {
    files: ['server/**/*.js', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  // Tests — node:test globals
  {
    files: ['**/*.test.js', '**/*.test.jsx'],
    languageOptions: { globals: { ...globals.node } },
  },
];
