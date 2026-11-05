const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const transforms = require('./native-connected-observation-overlay.cjs');
const env = process.env, expected = 'https://uaulhuelcfkjwojtymmw.supabase.co';
if (env.CI !== 'true' || env.EXPO_PUBLIC_APP_ENV !== 'qa' || env.EXPO_PUBLIC_SUPABASE_URL !== expected
  || env.PHYSICAL_BACKEND !== 'connected') throw new Error('Connected physical build requires explicit disposable QA mode.');
let keyRole;
try { keyRole = JSON.parse(Buffer.from((env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').split('.')[1] || '', 'base64url').toString()).role; } catch {}
if (!(env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').startsWith('sb_publishable_') && keyRole !== 'anon') {
  throw new Error('Connected QA may use only a publishable or anon key.');
}
if (['ios', 'android', 'metro.config.js'].some(file => fs.existsSync(file))) throw new Error('Disposable clean native checkout required.');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(file => file && fs.existsSync(file)
  && /\.(?:[cm]?[jt]sx?|swift|kt|json|ya?ml|sh|py)$/.test(file)
  && /^(?:src\/|shared\/|modules\/|plugins\/|scripts\/quality\/|tests\/native\/|App\.|index\.|app\.|package)/.test(file));
const hashes = Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(file))]));
const overlays = [];
fs.mkdirSync('native-ui-logs/overlays', { recursive: true });
function overlay(file, value, reason) {
  const before = hash(fs.readFileSync(file));
  fs.writeFileSync(file, value);
  const retained = 'overlays/' + file.replaceAll('/', '__');
  fs.writeFileSync('native-ui-logs/' + retained, value);
  overlays.push({ file, before, after: hash(value), reason, retained });
}
overlay('src/components/PostCarousel.tsx', transforms.carousel(fs.readFileSync('src/components/PostCarousel.tsx', 'utf8')),
  'Observe actual image display and native decoded/progressing video. Report remote or decrypted-local without capability URLs.');
overlay('src/services/offlineFeedMedia.ts', transforms.cache(fs.readFileSync('src/services/offlineFeedMedia.ts', 'utf8')),
  'Record only metadata after the original native AES-GCM seal/open succeeds. Preserve admission, transport, keys, crypto, disk and returns.');
overlay('index.js', "require('./tests/native/connected-entry');\n",
  'Install passive bounded QA observations, then the actual App. No request, auth, media, native player or cache substitutions.');
fs.writeFileSync('native-ui-logs/source.json', JSON.stringify({ commit: env.GITHUB_SHA, workflowRun: env.GITHUB_RUN_ID,
  mode: 'Connected existing QA backend with normal production App/auth/network/encrypted original cache',
  project: 'uaulhuelcfkjwojtymmw', syntheticBackend: false, disposableDebuggableQa: true, overlays, hashes }, null, 2) + '\n');
console.log('Prepared connected QA observations with exact original and overlay source hashes.');
