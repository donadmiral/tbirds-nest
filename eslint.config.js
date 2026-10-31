// eslint.config.js
// Expo's rules, with three adjustments for how this codebase is built:
// lazy require() of optional native modules is deliberate (older clients
// must not crash on import), apostrophes in on-screen text are fine, and
// web and admin lint themselves. Hook rules stay on as errors.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const js = require('@eslint/js');
const globals = require('globals');

module.exports = defineConfig([
  {
    files: ["**/*.{js,jsx,mjs,ts,tsx}"],
    extends: [expoConfig],
  },
  {
    files: ["**/*.cjs"],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  { ignores: ['dist/**', 'web/**', 'admin-web/**', 'supabase/**', 'modules/**/android/**', 'modules/**/ios/**', 'plugins/**', '.expo/**', 'vendor/*/upstream/**'] },
  {
    files: ["vendor/deepmerge-safe-cjs/index.cjs"],
    // Preserve the audited upstream bytes; its intentional catch binding is documented in PROVENANCE.
    rules: { "no-unused-vars": ["error", { caughtErrorsIgnorePattern: "^_$" }] },
  },
  {
    files: ["tools/dev-start.js", "*.config.js"],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["tools/camera-kit/runtime.js"],
    // These names are injected by the pinned Camera Kit bundle.
    languageOptions: { globals: { qc: "readonly", si: "readonly" } },
  },
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'import/first': 'off',
      'unicode-bom': 'off',
    },
  },
]);