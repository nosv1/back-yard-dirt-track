// Lint for the coding standard (nosv1/nosv1 CODING.md; rules in eslint-standard.mjs, a copy of the hub's).
// npm run lint runs this with --max-warnings 0. This repo started under the standard: no suppressions file.
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { linterOptions, standardRules, testRuleOverrides, typeAwareRules } from './eslint-standard.mjs';

export default [
  { ignores: ['node_modules/**', 'build/**'] },
  { linterOptions },
  {
    // The page: browser modules, type-checked by tsconfig.json.
    files: ['src/**/*.js'],
    languageOptions: {
      sourceType: 'module', ecmaVersion: 2022, globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { ...standardRules, ...typeAwareRules },
  },
  {
    files: ['eslint.config.mjs', 'eslint-standard.mjs'],
    languageOptions: { sourceType: 'module', ecmaVersion: 2022, globals: globals.node },
  },
  {
    files: ['tests/**/*.mjs', 'tools/**/*.mjs'],
    languageOptions: { sourceType: 'module', ecmaVersion: 2022, globals: globals.node },
    rules: { ...standardRules, ...testRuleOverrides },
  },
];
