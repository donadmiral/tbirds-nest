const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const { createFixture } = require('../native/audit/backend-fixture.cjs');
const { OWNER, NAVIGATION_BOOK } = require('../native/memory-fixture.cjs');
const manifest = require('../native/audit/manifest.json');
const root = path.resolve(__dirname, '../..');
const selected = manifest.cases.find(row => row.id === 'memory-cover-settings');
const ORIGIN = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const SAVE = '/rest/v1/rpc/save_memory_book_creative_presentation';
const READ = '/rest/v1/rpc/get_memory_book';
const clone = value => JSON.parse(JSON.stringify(value));

function load(file) {
  const absolute = path.resolve(root, file), module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { URL, AbortController, setTimeout, clearTimeout, module, exports: module.exports,
    require: name => load(path.resolve(path.dirname(absolute), name + '.ts')) });
  return module.exports;
}
const { saveMemoryCreativeBook } = load('shared/memoryBookPersistence.ts');
function python(script, payload) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-save-receipt-'));
  try {
    const input = path.join(directory, 'input.json');
    fs.writeFileSync(input, JSON.stringify(payload));
    return spawnSync('python3', ['-c', script, input], { cwd: root, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}


async function exercise({ save = true, readback = true, rejected = false, duplicate = false } = {}) {
  const fixture = createFixture();
  const sdk = createClient(ORIGIN, 'native-ui-synthetic-no-provider-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fixture.fetch },
  });
  const auth = await sdk.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal(auth.error, null);
  fixture.selectAuditCase(selected.id, selected.fixtureScenario);
  const initial = await sdk.rpc('get_memory_book', { p_album: NAVIGATION_BOOK });
  assert.equal(initial.error, null);
  const book = initial.data;
  const options = { ownerId: OWNER, albumId: NAVIGATION_BOOK, revision: rejected ? 50 : book.presentation_revision,
    audience: book.audience, isCurrent: () => true,
    draft: { title: 'AUDIT BOOK TITLE', subtitle: book.subtitle, color: book.cover_color, design: book.cover_design,
      coverStoryId: book.cover_story_id, artwork: book.cover_artwork, film: book.film_settings } };
  if (save) {
    if (rejected) await assert.rejects(saveMemoryCreativeBook(sdk, options));
    else await saveMemoryCreativeBook(sdk, options);
    if (duplicate) await saveMemoryCreativeBook(sdk, { ...options, revision: 1 });
  }
  if (readback) {
    const fresh = await sdk.rpc('get_memory_book', { p_album: NAVIGATION_BOOK });
    assert.equal(fresh.error, null);
  }
  const receipt = clone(fixture.receipt);
  await sdk.auth.signOut();
  return receipt;
}

function validate(receipts, caseValue = selected) {
  const script = String.raw`
import importlib.util,json,os,sys,tempfile
from pathlib import Path
source=Path(os.environ.get('PLATINUM_MEMORY_SAVE_RUNNER','scripts/quality/native-ui-audit-runner.py'))
spec=importlib.util.spec_from_file_location('runner',source);runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
payload=json.loads(Path(sys.argv[1]).read_text());results=[]
with tempfile.TemporaryDirectory() as directory:
 for index,receipt in enumerate(payload['receipts']):
  target=Path(directory)/str(index);target.write_text(json.dumps(receipt));results.append(runner.validate_receipt(target,payload['case']))
print(json.dumps(results))
`;
  const result = python(script, { receipts, case: caseValue });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(result.stdout);
}

test('real creative save and Supabase readback pass the case-specific persistence gate', async () => {
  assert.deepEqual(selected.state.routes[0].params, { ownerId: OWNER, albumId: NAVIGATION_BOOK });
  const receipt = await exercise();
  const [result] = validate([receipt]);
  assert.equal(result.passed, true);
  assert.deepEqual(result.memorySave, { passed: true, saveRequestCount: 1, committedSaveCount: 1,
    savedRevision: 1, readbacksAfterSave: 1 });
  assert.equal(receipt.bookReads[0].revision, 0);
  assert.equal(receipt.bookReads.at(-1).title, 'AUDIT BOOK TITLE');
});

test('retained Android failure with no actual save cannot pass even if its UI is marked successful', () => {
  const file = 'tests/fixtures/memory-save-d46-failure/fixture-receipt.json';
  const receipt = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  assert.equal(receipt.requests.some(row => row.path === SAVE), false);
  assert.equal(validate([receipt])[0].passed, false);
});

test('a preview without save, a rejected save, and duplicate committed saves all fail', async () => {
  const receipts = await Promise.all([exercise({ save: false }), exercise({ rejected: true }), exercise({ duplicate: true })]);
  for (const result of validate(receipts)) {
    assert.equal(result.passed, false);
    assert.equal(result.issue, 'memory-save-requires-one-committed-request');
  }
});

test('a committed save without a new data read cannot count as persistence', async () => {
  assert.equal(validate([await exercise({ readback: false })])[0].passed, false);
});

test('wrong save method, owner, book, title or revision fails without leaking receipt values', async () => {
  const original = await exercise();
  const edits = [
    r => { r.requests.find(row => row.path === SAVE).method = 'GET'; },
    r => { r.requests.find(row => row.path === SAVE).owner = 'PRIVATE-SENTINEL'; },
    r => { r.mutations.find(row => row.rpc === 'save_memory_book_creative_presentation').owner = 'PRIVATE-SENTINEL'; },
    r => { r.mutations.find(row => row.rpc === 'save_memory_book_creative_presentation').id = 'PRIVATE-SENTINEL'; },
    r => { r.mutations.find(row => row.rpc === 'save_memory_book_creative_presentation').title = 'PRIVATE-SENTINEL'; },
    ...[0, 2, true, '1', null].map(value => r => { r.mutations.find(row => row.rpc === 'save_memory_book_creative_presentation').revision = value; }),
  ];
  const results = validate(edits.map(edit => { const receipt = clone(original); edit(receipt); return receipt; }));
  assert.ok(results.every(result => result.passed === false));
  assert.doesNotMatch(JSON.stringify(results), /PRIVATE-SENTINEL/);
});

test('duplicate requests and commits cannot be hidden by one matching readback', async () => {
  const receipt = await exercise();
  const duplicateRequest = clone(receipt);
  duplicateRequest.requests.push(clone(receipt.requests.find(row => row.path === SAVE)));
  const duplicateMutation = clone(receipt);
  duplicateMutation.mutations.push(clone(receipt.mutations.find(row => row.rpc === 'save_memory_book_creative_presentation')));
  const missingMutation = clone(receipt);
  missingMutation.mutations = [];
  assert.ok(validate([duplicateRequest, duplicateMutation, missingMutation]).every(result => !result.passed));
});

test('every read must map to one request and the expected owner, book, title and revision', async () => {
  const original = await exercise();
  const edits = [
    r => { r.bookReads.pop(); },
    r => { r.bookReads.push(clone(r.bookReads.at(-1))); },
    r => { r.requests.push({ method: 'POST', path: READ, owner: OWNER }); },
    r => { r.bookReads.at(-1).id = 'wrong-book'; },
    r => { r.bookReads.at(-1).owner = 'wrong-owner'; },
    r => { r.bookReads.at(-1).title = 'UNSAVED PREVIEW'; },
    r => { r.bookReads.at(-1).revision = 0; },
    r => { r.bookReads.at(-1).revision = true; },
    r => { r.requests.filter(row => row.path === READ).at(-1).owner = 'wrong-owner'; },
    r => { r.requests.filter(row => row.path === READ).at(-1).method = 'GET'; },
  ];
  assert.ok(validate(edits.map(edit => { const receipt = clone(original); edit(receipt); return receipt; }))
    .every(result => result.passed === false));
});

test('pre-save matching text and a post-save stale read both fail the ordered readback check', async () => {
  const receipt = await exercise();
  const stale = clone(receipt); stale.bookReads[stale.bookReads.length - 1] = clone(stale.bookReads[0]);
  const reversed = clone(receipt); reversed.bookReads.reverse();
  const saveLast = clone(receipt);
  const saveIndex = saveLast.requests.findIndex(row => row.path === SAVE);
  saveLast.requests.push(...saveLast.requests.splice(saveIndex, 1));
  const noBaseline = clone(receipt);
  noBaseline.requests.splice(noBaseline.requests.findIndex(row => row.path === READ), 1);
  noBaseline.bookReads.shift();
  assert.ok(validate([stale, reversed, saveLast, noBaseline]).every(result => !result.passed));
});

test('malformed evidence fails closed instead of passing or crashing the runner', async () => {
  const original = await exercise(), receipts = [];
  for (const key of ['requests', 'mutations', 'bookReads']) {
    for (const value of [null, {}, 'PRIVATE-SENTINEL', [null], ['PRIVATE-SENTINEL']]) {
      const receipt = clone(original); receipt[key] = value; receipts.push(receipt);
    }
  }
  const results = validate(receipts);
  assert.ok(results.every(result => result.passed === false && result.issue === 'malformed-memory-save-receipt'));
  assert.doesNotMatch(JSON.stringify(results), /PRIVATE-SENTINEL/);
});

test('other declared cases keep their existing receipt contract', async () => {
  const receipt = await exercise({ save: false });
  const other = manifest.cases.find(row => row.id === 'memory-reader-controls');
  receipt.audit.caseId = other.id;
  delete receipt.bookReads;
  delete receipt.mutations;
  const [result] = validate([receipt], other);
  assert.equal(result.passed, true);
  assert.equal(result.memorySave, undefined);
});

test('passing UI cannot bypass missing persistence, and the runner continues to the next case', async () => {
  const receipt = await exercise({ readback: false });
  const script = String.raw`
import importlib.util,json,os,sys,tempfile,types
from pathlib import Path
source=Path(os.environ.get('PLATINUM_MEMORY_SAVE_RUNNER','scripts/quality/native-ui-audit-runner.py'))
s=importlib.util.spec_from_file_location('runner',source);r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
p=json.loads(Path(sys.argv[1]).read_text());first=p['case'];second={**first,'id':'memory-reader-controls','name':'Reader controls','flow':'flows/memory-reader-controls.yaml'};cases=[first,second];calls=[]
def execute(args,**kwargs):
 case=cases[len(calls)];calls.append(case['id']);Path(args[args.index('--output')+1]).write_text('<testsuites><testsuite tests="1" failures="0"><testcase name="'+case['name']+'" status="SUCCESS" file="tests/native/audit/'+case['flow']+'"/></testsuite></testsuites>');return types.SimpleNamespace(returncode=0)
def collect(platform,device,target):
 receipt=json.loads(json.dumps(p['receipt']));receipt['audit']['caseId']=target.name;(target/'native-ui-receipt.json').write_text(json.dumps(receipt));return []
with tempfile.TemporaryDirectory() as d:
 results=r.run_cases(cases,'android','isolated',Path(d),execute,collect)
 assert calls==[first['id'],second['id']]
 assert all(result['junit']['passed'] for result in results)
 assert [result['status'] for result in results]==['failed','passed']
 assert results[0]['fixture']['issue']=='memory-save-read-correlation-missing'
 print('Missing persistence rejected despite successful UI; next case completed')
`;
  const result = python(script, { receipt, case: selected });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
