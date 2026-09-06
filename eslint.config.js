// eslint.config.js
// Expo's rules, with three adjustments for how this codebase is built:
// lazy require() of optional native modules is deliberate (older clients
// must not crash on import), apostrophes in on-screen text are fine, and
// web and admin lint themselves. Hook rules stay on as errors.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/**', 'web/**', 'admin-web/**', 'supabase/**', 'modules/**/android/**', 'modules/**/ios/**', 'plugins/**', '.expo/**'] },
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'import/first': 'off',
      'unicode-bom': 'off',
    },
  },
]);