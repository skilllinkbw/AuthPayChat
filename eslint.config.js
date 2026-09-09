import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.data/**',
      'coverage/**',
      // ── Generated / untracked build artifacts ──────────────────────────────
      'android/**',                // Capacitor-generated Android project + bundled assets
      'apps/web/android/**',       // generated Android duplicate under the web app
      '_build/**',                 // untracked one-off generator scripts
      '_chk.cjs',                  // untracked diagnostic script
      'BANK_REVIEW_PACKAGE/**',    // release documentation packages (not source)
      'AUTHEPAY_BANK_REVIEW_PACKAGE/**',
      'release/**',                // release output
      'apps/web/dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  { files: ['tests/**/*.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  {
    // Tracked Node scripts (.cjs) — these legitimately use require/process/console.
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      globals: {
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
    },
  },
);
