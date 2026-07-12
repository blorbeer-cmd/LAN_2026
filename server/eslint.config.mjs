import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-test/**',
      'public/js/vendor/**',
      'public/js/**/*.test.js',
      'src/**/*.test.ts',
      'src/test/**',
      'agent-dist/**',
    ],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'no-misleading-character-class': 'off',
    },
  },
  {
    files: ['public/js/**/*.js', '../agent/src/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, io: 'readonly' },
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-assignment': 'off',
    },
  },
);
