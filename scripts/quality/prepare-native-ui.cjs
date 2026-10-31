const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
if (process.env.CI !== 'true' || process.env.EXPO_PUBLIC_APP_ENV !== 'qa'
  || process.env.EXPO_PUBLIC_SUPABASE_URL !== 'https://uaulhuelcfkjwojtymmw.supabase.co'
  || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'native-ui-synthetic-no-provider-key') {
  throw new Error('Full-app UI tests require a disposable QA checkout and the synthetic transport key.');
}
if (fs.existsSync('ios') || fs.existsSync('android')) throw new Error('Refusing to overwrite an existing native project.');
const original = fs.readFileSync('index.js', 'utf8');
if (original.includes('tests/native')) throw new Error('This checkout already contains a UI entry overlay.');
fs.mkdirSync('native-ui-logs/screenshots', { recursive: true });
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const file = path.join(directory, item.name);
    return item.isDirectory() ? files(file) : /\.(tsx?|jsx?|swift|kt)$/.test(file) ? [file] : [];
  });
}
const source = ['App.tsx', 'index.js', 'app.config.js', 'package-lock.json', ...files('src'), ...files('shared'),
  ...files('modules/boomerang/ios'), ...files('modules/boomerang/android/src/main')];
const hashes = Object.fromEntries(source.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
fs.writeFileSync('native-ui-logs/source.json', JSON.stringify({ commit: process.env.GITHUB_SHA, workflowRun: process.env.GITHUB_RUN_ID,
  mode: 'Complete production App and screens with an isolated synthetic HTTP/Realtime transport and CI-only entry overlay', hashes }, null, 2) + '\n');
fs.writeFileSync('index.js', "require('./tests/native/entry');\n");
console.log('Saved exact production source hashes and installed the disposable UI-only entry.');
