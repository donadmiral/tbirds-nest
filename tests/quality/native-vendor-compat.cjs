const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const request = createRequire(path.join(root, 'package.json'));
const fromPackage = name => createRequire(request.resolve(name + '/package.json'));
const queryRequest = fromPackage('query-string');
const expoRequest = fromPackage('@expo/config');
const decode = queryRequest('decode-uri-component');
const merge = expoRequest('deepmerge');
const sha = data => crypto.createHash('sha256').update(data).digest('hex');

test('actual consumers load the reviewed local sources and every recorded upstream/source hash matches', () => {
  const entries = [
    ['decode-uri-component-cjs', queryRequest, 'decode-uri-component', 'e82696ecdf0ee2c25bd90169cc7915e552d2ccb82a5006c55bc17aecdb55b919'],
    ['deepmerge-safe-cjs', expoRequest, 'deepmerge', '07da2fe622bdb3781eddce30b2d89d6c3bd55c1da66a9ce613cac7018b96e92d'],
  ];
  for (const [folder, consumer, alias, expected] of entries) {
    const dir = path.join(root, 'vendor', folder);
    const provenance = JSON.parse(fs.readFileSync(path.join(dir, 'PROVENANCE.json'), 'utf8'));
    const info = consumer(alias + '/package.json');
    assert.equal(info.name, '@platinumcircles/' + folder);
    assert.equal(info.private, true);
    assert.equal(fs.realpathSync(consumer.resolve(alias)), path.join(dir, 'index.cjs'));
    assert.equal(sha(fs.readFileSync(path.join(dir, 'index.cjs'))), expected);
    assert.equal(provenance.local.runtimeSha256, expected);
    assert.equal(sha(fs.readFileSync(path.join(dir, 'local.patch'))), provenance.local.patchSha256);
    for (const [file, hash] of Object.entries(provenance.upstream.filesSha256)) {
      assert.equal(sha(fs.readFileSync(path.join(dir, 'upstream', file))), hash, folder + '/' + file);
    }
    assert.match(fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8'), /Permission is hereby granted/);
  }
  const original = fs.readFileSync(path.join(root, 'vendor/decode-uri-component-cjs/upstream/index.js'), 'utf8');
  assert.equal(fs.readFileSync(queryRequest.resolve('decode-uri-component'), 'utf8'),
    original.replace('export default function decodeUriComponent(encodedURI) {', 'module.exports = function decodeUriComponent(encodedURI) {'));
});

test('the unchanged upstream 0.5.1 decoder regression suite passes through the callable CJS adaptation', () => {
  const source = fs.readFileSync(path.join(root, 'vendor/decode-uri-component-cjs/upstream/test.js'), 'utf8');
  let tests = 0, assertions = 0;
  const t = {
    is(a, b, message) { assertions++; assert.equal(a, b, message); },
    true(value) { assertions++; assert.equal(value, true); },
    throws(fn, expected) { assertions++; assert.throws(fn, expected); },
  };
  const ava = (...args) => {
    if (typeof args[0] === 'string') args.shift();
    const fn = args.shift(); tests++; fn(t, ...args);
  };
  const executable = source.replace("import test from 'ava';", '').replace("import m from './index.js';", '');
  vm.runInNewContext(executable, { test: ava, m: decode, Date }, { timeout: 3000 });
  assert.ok(tests >= 130, 'upstream vectors and type/performance cases must all execute');
  assert.ok(assertions > tests);
});

test('the real query-string 7 consumer preserves plus signs, Unicode, arrays, fragments and tolerant malformed decoding', () => {
  const query = request('query-string');
  const parsed = query.parse('full=Ana+Maria&literal=%2B&unicode=%F0%9F%98%80&bad=%C3%5A%A5&empty=&flag&tag=x&tag=y');
  assert.deepEqual({ ...parsed }, { bad: '%C3Z%A5', empty: '', flag: null, full: 'Ana Maria', literal: '+', tag: ['x', 'y'], unicode: '😀' });
  assert.deepEqual(query.parse('tag[]=one&tag[]=two', { arrayFormat: 'bracket' }).tag, ['one', 'two']);
  assert.deepEqual(query.parse('tag=one,two', { arrayFormat: 'comma' }).tag, ['one', 'two']);
  assert.deepEqual(query.parse('tag[0]=one&tag[1]=two', { arrayFormat: 'index' }).tag, ['one', 'two']);
  const roundtrip = query.parse(query.stringify({ literal: '+', name: 'José 😀', tag: ['one', 'two'], percent: '%zz' }));
  assert.deepEqual({ ...roundtrip }, { literal: '+', name: 'José 😀', percent: '%zz', tag: ['one', 'two'] });
  const url = query.parseUrl('https://example.invalid/path?name=Ana+Maria#part%20one', { parseFragmentIdentifier: true });
  assert.equal(url.fragmentIdentifier, 'part one'); assert.equal(url.query.name, 'Ana Maria');
});

test('both decoder denial-of-service shapes finish in bounded subprocesses through the actual query-string consumer', () => {
  const script = `const query=require(process.argv[1]);let payload='';for(let i=0;i<32000;i++)payload+='%'+Math.floor(i/256).toString(16).padStart(2,'0')+'%'+(i%256).toString(16).padStart(2,'0')+'x';payload+='%zz';const start=Date.now();const one=query.parse('x='+payload).x;const two=query.parse('x='+('%C3'.repeat(32000))+'%zz').x;if(typeof one!=='string'||typeof two!=='string')process.exit(2);process.stdout.write(JSON.stringify({elapsed:Date.now()-start,length:one.length}));`;
  const result = spawnSync(process.execPath, ['--max-old-space-size=96', '-e', script, request.resolve('query-string')], { timeout: 3000, encoding: 'utf8', maxBuffer: 4096 });
  assert.equal(result.error, undefined, 'dependency parsing must not monopolize the event loop');
  assert.equal(result.status, 0, result.stderr);
  const measured = JSON.parse(result.stdout); assert.ok(measured.elapsed < 1500); assert.ok(measured.length > 32000);
});

test('deepmerge fixes the reproduced null/primitive/null-prototype/own-key poison paths on both inputs', () => {
  const original = require(path.join(root, 'vendor/deepmerge-safe-cjs/upstream/dist/cjs.js'));
  const source = JSON.parse('{"session":{"__proto__":{"pcInheritedAdmin":true},"valid":1}}');
  assert.equal(original({ session: null }, source).session.pcInheritedAdmin, true, 'the retained upstream source must reproduce the reported defect');
  const placeholders = [null, undefined, 1, 'text', false, Object.create(null), JSON.parse('{"__proto__":{"pcInheritedAdmin":true}}')];
  for (const session of placeholders) {
    const result = merge({ session }, source);
    assert.equal(result.session.pcInheritedAdmin, undefined);
    assert.equal(Object.getPrototypeOf(result.session), Object.prototype);
    assert.equal(Object.hasOwn(result.session, '__proto__'), false);
    assert.equal(result.session.valid, 1);
  }
  for (const target of [Object.create(null), null, undefined, 1, false, JSON.parse('{"__proto__":{"pcInheritedAdmin":true}}')]) {
    const result = merge(target, JSON.parse('{"__proto__":{"pcInheritedAdmin":true},"valid":1}'));
    assert.equal(result.pcInheritedAdmin, undefined); assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(Object.hasOwn(result, '__proto__'), false); assert.equal(result.valid, 1);
  }
  const targetOnly = merge(JSON.parse('{"__proto__":{"pcInheritedAdmin":true},"ok":1}'), {});
  assert.equal(targetOnly.pcInheritedAdmin, undefined); assert.equal(targetOnly.ok, 1);
  assert.equal({}.pcInheritedAdmin, undefined);
  const malicious = Object.create(null);
  Object.defineProperty(malicious, '__proto__', { enumerable: true, get() { throw new Error('forbidden key was read'); } });
  assert.deepEqual(merge(malicious, malicious), {});
});

test('deepmerge keeps ordinary data, symbols, array/custom merge, clone controls and inherited-setter safety', () => {
  const original = require(path.join(root, 'vendor/deepmerge-safe-cjs/upstream/dist/cjs.js'));
  const symbol = Symbol('metadata'), date = new Date('2026-01-01T00:00:00Z'), regex = /fixture/;
  const a = { nested: { left: 1 }, list: [{ old: true }], date, regex, [symbol]: { a: 1 } };
  const b = { nested: { right: 2 }, list: [{ next: true }], [symbol]: { b: 2 } };
  assert.deepEqual(merge(a, b), original(a, b));
  assert.deepEqual(merge.all([a, b]), original.all([a, b]));
  assert.deepEqual(merge(a, b, { arrayMerge: (_left, right) => right }), original(a, b, { arrayMerge: (_left, right) => right }));
  let customCalls = 0;
  const custom = { customMerge: key => key === 'total' ? (x, y) => { customCalls++; return { value: x.value + y.value }; } : undefined };
  const customResult = merge({ total: { value: 2 } }, { total: { value: 3 } }, custom);
  assert.deepEqual(customResult, { total: { value: 5 } }); assert.equal(customCalls, 1);
  const kept = { value: 1 }; assert.equal(merge({}, { kept }, { clone: false }).kept, kept);
  assert.deepEqual(merge({ constructor: { name: 'schema' }, prototype: { label: 'word' } }, { constructor: { version: 2 }, prototype: { shown: true } }), { constructor: { name: 'schema', version: 2 }, prototype: { label: 'word', shown: true } });
  let called = 0;
  const key = '__pc_dependency_setter_fixture';
  Object.defineProperty(Object.prototype, key, { configurable: true, set() { called++; } });
  try {
    const target = {}; Object.defineProperty(target, key, { value: 'retained', enumerable: true });
    const result = merge(target, {}); assert.equal(result[key], 'retained'); assert.equal(called, 0);
  } finally { delete Object.prototype[key]; }
});

test('Expo actual modifyConfigAsync retains native/plugin options and prevents inherited config poisoning', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platinum-expo-merge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const original = { expo: { name: 'Dependency fixture', slug: 'dependency-fixture', extra: { session: null, preserved: true }, ios: { infoPlist: { UIBackgroundModes: ['audio'] } }, android: { permissions: ['RECORD_AUDIO'] }, plugins: [['fixture-plugin', { colors: { primary: '#fff' }, flags: ['original'] }]] } };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dependency-fixture', version: '1.0.0' }));
  const appPath = path.join(dir, 'app.json'); const before = JSON.stringify(original); fs.writeFileSync(appPath, before);
  const changes = JSON.parse('{"extra":{"session":{"__proto__":{"pcInheritedAdmin":true},"valid":1}},"ios":{"infoPlist":{"UIBackgroundModes":["voip"]}},"android":{"permissions":["POST_NOTIFICATIONS"]},"plugins":[["fixture-plugin",{"colors":{"secondary":"#000"},"flags":["added"]}]]}');
  const { modifyConfigAsync } = request('@expo/config');
  const result = await modifyConfigAsync(dir, changes, { skipPlugins: true, skipSDKVersionRequirement: true }, { dryRun: true });
  assert.equal(result.type, 'success');
  assert.equal(result.config.extra.session.pcInheritedAdmin, undefined); assert.equal(result.config.extra.session.valid, 1);
  assert.equal(result.config.extra.preserved, true);
  assert.deepEqual(result.config.ios.infoPlist.UIBackgroundModes, ['audio', 'voip']);
  assert.deepEqual(result.config.android.permissions, ['RECORD_AUDIO', 'POST_NOTIFICATIONS']);
  assert.deepEqual(result.config.plugins, [['fixture-plugin', { colors: { primary: '#fff', secondary: '#000' }, flags: ['original', 'added'] }]]);
  assert.equal(fs.readFileSync(appPath, 'utf8'), before, 'consumer test must remain a dry run');
});
