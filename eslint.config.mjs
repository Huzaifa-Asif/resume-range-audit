import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } } },
  { rules: { 'eqeqeq': ['error', 'always'], 'no-var': 'error', 'prefer-const': 'error', 'no-eval': 'error', 'no-throw-literal': 'error' } },
];
