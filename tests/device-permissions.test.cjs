const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const scope = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../shared/devicePermissions.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, scope);
const { createPermissionBroker } = scope.exports;
const grant = { granted: true, canAskAgain: true, status: 'granted' };
const missing = { granted: false, canAskAgain: true, status: 'undetermined' };

test('a previous grant is read without requesting again, including concurrent callers', async () => {
  const ensure = createPermissionBroker(); let prompts = 0;
  const request = async () => { prompts++; return grant; };
  await Promise.all(Array.from({ length: 5 }, () => ensure('camera', async () => grant, request)));
  await ensure('camera', async () => grant, request);
  assert.equal(prompts, 0);
});
test('simultaneous native features share one missing-permission prompt', async () => {
  const ensure = createPermissionBroker(); let prompts = 0, current = missing;
  const request = async () => { prompts++; await new Promise(resolve => setImmediate(resolve)); return current = grant; };
  const results = await Promise.all(Array.from({ length: 6 }, () => ensure('microphone', async () => current, request)));
  assert.equal(prompts, 1); assert.ok(results.every(result => result.granted));
});
test('limited photos are accepted without opening another permission or expansion dialog', async () => {
  const ensure = createPermissionBroker(); let prompts = 0;
  const limited = { ...missing, status: 'granted', accessPrivileges: 'limited' };
  const result = await ensure('photos', async () => limited, async () => { prompts++; return grant; }, value => value.granted || value.accessPrivileges === 'limited');
  assert.equal(result.accessPrivileges, 'limited'); assert.equal(prompts, 0);
});
test('revocation in Settings is honored and permanent denial does not request again', async () => {
  const ensure = createPermissionBroker(); let prompts = 0, current = grant;
  const request = async () => { prompts++; return grant; };
  assert.equal((await ensure('camera', async () => current, request)).granted, true);
  current = { ...missing, status: 'denied', canAskAgain: false };
  assert.equal((await ensure('camera', async () => current, request)).granted, false);
  assert.equal(prompts, 0);
});
test('different native prompts never overlap and a failed one does not poison later requests', async () => {
  const ensure = createPermissionBroker(); let active = 0, maximum = 0;
  const request = async () => { maximum = Math.max(maximum, ++active); await new Promise(resolve => setImmediate(resolve)); active--; return grant; };
  await Promise.all(['camera', 'microphone', 'photos'].map(key => ensure(key, async () => missing, request)));
  assert.equal(maximum, 1);
  await assert.rejects(ensure('camera', async () => missing, async () => { throw new Error('native interrupted'); }), /native interrupted/);
  assert.equal((await ensure('camera', async () => missing, request)).granted, true);
});
