const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../..');
const glob = require('glob');

test('the installed modern glob stops filesystem traversal when its caller cancels', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'platinum-glob-cancel-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  function fill(folder, depth) {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'fixture.txt'), 'synthetic');
    if (depth) for (const part of ['a', 'b']) fill(path.join(folder, part), depth - 1);
  }
  fill(directory, 5);
  const controller = new AbortController();
  const reason = new Error('Synthetic traversal cancellation');
  let reads = 0;
  const counted = { ...fs, readdir: (...args) => {
    if (++reads === 1) controller.abort(reason);
    return fs.readdir(...args);
  } };
  await assert.rejects(glob.glob('**', { cwd: directory, signal: controller.signal, fs: counted }), error => error === reason);
  const atRejection = reads;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(reads, atRejection, 'an aborted walk must not keep scheduling directory reads');
  assert.equal(reads, 1, 'cancellation at the first read prevents traversal into the fixture tree');
});

test('each app toolchain bounds the advisory pattern amplification in its actual modern matcher', () => {
  for (const project of ['', 'web', 'admin-web']) {
    const request = createRequire(path.join(root, project, 'package.json'));
    const parser = createRequire(request.resolve('@typescript-eslint/typescript-estree'));
    const { Minimatch } = parser('minimatch');
    const pattern = Array(30).fill('**/../a/b').join('/');
    const matcher = new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 64 });
    assert.ok(matcher.set.length <= 64, `${project || 'native'}: expansion must respect its explicit budget`);
    assert.equal(new Minimatch('src/**/*.{ts,tsx}').match('src/lib/fixture.ts'), true);
    assert.equal(new Minimatch('src/**/*.{ts,tsx}').match('src/lib/fixture.js'), false);
  }
});

test('Expo fingerprint keeps ordered exclusions, reinclusions and directory matching', () => {
  const paths = require('@expo/fingerprint/build/utils/Path.js');
  const patterns = paths.buildPathMatchObjects(['src/**', '!src/lib/**', '**/node_modules/**']);
  assert.equal(paths.isIgnoredPathWithMatchObjects('src/screens/Feed.tsx', patterns), true);
  assert.equal(paths.isIgnoredPathWithMatchObjects('src/lib/fixture.ts', patterns), false);
  assert.equal(paths.isIgnoredPathWithMatchObjects('node_modules/fixture/index.js', patterns), true);
  assert.equal(paths.isIgnoredPathWithMatchObjects('app.json', patterns), false);
  assert.ok(paths.buildDirMatchObjects(patterns).every(item => typeof item.match === 'function'));
});

test('the installed glob preserves sync and async project file discovery', async () => {
  for (const pattern of ['src/**/*.{ts,tsx}', 'modules/**/*.{swift,kt}', 'plugins/*.js']) {
    const options = { cwd: root, dot: true, nodir: true };
    const synchronous = glob.globSync(pattern, options).sort();
    assert.ok(synchronous.length > 0, pattern);
    assert.deepEqual((await glob.glob(pattern, options)).sort(), synchronous);
  }
});

test('legacy lint consumers retain their callable minimatch API and regexp compatibility', () => {
  for (const project of ['', 'web', 'admin-web']) {
    const request = createRequire(path.join(root, project, 'package.json'));
    const lint = createRequire(request.resolve('eslint'));
    const legacy = lint('minimatch');
    assert.equal(typeof legacy, 'function');
    assert.equal(legacy('src/lib/fixture.ts', 'src/**/*.ts'), true);
    assert.equal(legacy('src/lib/fixture.js', 'src/**/*.ts'), false);
    assert.equal(legacy.makeRe('src/**/*.ts').test('src/lib/fixture.ts'), true);
  }
});
