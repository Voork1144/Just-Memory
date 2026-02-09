import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Correctness
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': 'warn',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-duplicate-case': 'error',
      'no-empty': ['warn', { allowEmptyCatch: false }],
      'no-loss-of-precision': 'error',
      'no-unsafe-finally': 'error',
      'no-prototype-builtins': 'warn',
      
      // Suspicious patterns
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'warn',
      'eqeqeq': ['warn', 'smart'],
      'no-throw-literal': 'error',
      'no-return-await': 'warn',
      'no-async-promise-executor': 'error',
      
      // Code quality
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      'no-console': 'off', // MCP server logs via console.error intentionally
    },
  },
];
