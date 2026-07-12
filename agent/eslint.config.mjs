import eslint from '@eslint/js';
import globals from 'globals';

export default [
  eslint.configs.recommended,
  {
    files: ['src/**/*.js'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      globals: globals.node,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'commonjs' },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': 'off',
      'preserve-caught-error': 'off',
    },
  },
];
