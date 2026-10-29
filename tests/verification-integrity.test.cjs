const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(path) {
  const output = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '..', path), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module = { exports: {} }; new Function('module','exports','require',output)(module,module.exports,require); return module.exports;
}
const { safeEvidenceUrl, prepareVerificationEvidence, currentVerificationStatus } = load('shared/verification.ts');
const { createVerificationCache } = load('shared/verificationCache.ts');
const { reportAccount } = load('shared/accountReporting.ts');
test('account reports preserve failed submission and handle an existing open report', async () => {
  const payloads=[];
  const client={from:table=>({insert:async payload=>{assert.equal(table,'user_reports');payloads.push(payload);return {error:null};}})};
  await reportAccount(client,'me','other','impersonation','Official website: https://example.org');
  assert.equal(payloads[0].reason,'impersonation'); assert.equal(payloads[0].reported_id,'other');
  await assert.rejects(()=>reportAccount(client,'me','me','impersonation'),/another account/);
  await assert.rejects(()=>reportAccount({from:()=>({insert:async()=>({error:{code:'500'}})})},'me','other','spam'),/not sent/);
  assert.match(await reportAccount({from:()=>({insert:async()=>({error:{code:'23505'}})})},'me','other','spam'),/already have an open report/);
});
test('evidence rejects executable URLs, embedded credentials and malformed payloads', () => {
  for (const link of ['javascript:alert(1)','data:text/html,evil','https://user:secret@example.org','//example.org',{},'https://example.org/a b','https://example.org\\@evil.test']) assert.equal(safeEvidenceUrl(link), null);
  assert.equal(safeEvidenceUrl('https://example.org/person'), 'https://example.org/person');
  assert.throws(() => prepareVerificationEvidence('public_figure','Educator','A sufficiently descriptive statement.','',''), /1–8/);
  assert.throws(() => prepareVerificationEvidence('official','Official','A sufficiently descriptive statement.','https://example.org',''), /office/);
});
test('active server flag is authoritative over old approved/revoked application', () => {
  assert.equal(currentVerificationStatus({status:'approved',tier:'official'},{is_verified:false,verified_tier:'official'}), 'revoked');
  assert.equal(currentVerificationStatus(null,{is_verified:true}), 'approved');
  assert.equal(currentVerificationStatus({status:'submitted',tier:'official'},{is_verified:false}), 'submitted');
});
test('badges batch requests, fail closed on stale tier and release listeners', async () => {
  const calls = [], seen = [];
  const cache = createVerificationCache(async ids => { calls.push(ids); return [{id:'a',is_verified:true,verified_tier:'official'},{id:'b',is_verified:false,verified_tier:'business'}]; });
  const unsubA = cache.subscribe('a', value => seen.push(['a',value]));
  const unsubB = cache.subscribe('b', value => seen.push(['b',value]));
  const unsubOther = cache.subscribe('a', () => {});
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [['a','b']]);
    assert.equal(cache.peek('a'), 'official'); assert.equal(cache.peek('b'), null);
    assert.deepEqual(seen.at(-2), ['a','official']); assert.deepEqual(seen.at(-1), ['b',null]);
  } finally { unsubA(); unsubB(); unsubOther(); }
});
test('badges discard revoked cached claims and hide unconfirmed results on refresh failure', async () => {
  const now = Date.now, originalInterval = global.setInterval, originalClear = global.clearInterval;
  let clock = 1, refresh, grants = true, fail = false;
  Date.now = () => clock; global.setInterval = callback => {refresh=callback; return 1;}; global.clearInterval = () => {};
  let stop;
  try {
    const seen=[];
    const cache = createVerificationCache(async () => {if (fail) throw Error('offline'); return [{id:'a',is_verified:grants,verified_tier:'official'}];});
    stop=cache.subscribe('a', tier => seen.push(tier)); await new Promise(resolve => setImmediate(resolve));
    assert.equal(cache.peek('a'),'official'); grants=false; clock+=61_000; refresh(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(cache.peek('a'),null); assert.equal(seen.at(-1),null);
    grants=true; clock+=61_000; refresh(); await new Promise(resolve => setImmediate(resolve)); assert.equal(cache.peek('a'),'official');
    fail=true; clock+=61_000; refresh(); await new Promise(resolve => setImmediate(resolve)); assert.equal(seen.at(-1),null);
  } finally { stop?.(); Date.now=now; global.setInterval=originalInterval; global.clearInterval=originalClear; }
});
