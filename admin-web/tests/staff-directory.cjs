const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/staffDirectory.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { module: moduleObject, exports: moduleObject.exports });
const { staffIdentities } = moduleObject.exports;

test('staff lookups run with bounded concurrency and preserve identity order', async () => {
  let active = 0, peak = 0;
  const rows = Array.from({ length: 31 }, (_, i) => ({ user_id: String(i) }));
  const users = await staffIdentities(rows, async id => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { data: { user: { id } }, error: null };
  });
  assert.equal(peak, 4);
  assert.equal(JSON.stringify(users.map(user => user.id)), JSON.stringify(rows.map(row => row.user_id)));
});
test('missing or mismatched staff identities do not produce a misleading directory', async () => {
  for (const result of [
    { data: { user: null }, error: null },
    { data: { user: { id: 'other' } }, error: null },
    { data: { user: { id: 'expected' } }, error: { message: 'unavailable' } },
  ]) await assert.rejects(staffIdentities([{ user_id: 'expected' }], async () => result), /Staff identity lookup failed/);
});
test('empty staff directory makes no identity requests', async () => {
  assert.equal((await staffIdentities([], () => { throw new Error('Unexpected lookup'); })).length, 0);
});
