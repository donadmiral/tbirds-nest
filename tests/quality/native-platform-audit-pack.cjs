const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const { StackRouter, TabRouter } = require('@react-navigation/routers');
const { createClient } = require('@supabase/supabase-js');
const { createFixture, TICKET } = require('../native/audit/backend-fixture.cjs');
const manifest = require('../native/audit/manifest.json');
const origin = 'https://uaulhuelcfkjwojtymmw.supabase.co';
const owner = '10000000-0000-4000-8000-000000000001';

function client(fixture) {
  return createClient(origin, 'native-ui-synthetic-no-provider-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fixture.fetch } });
}
async function signed(id, scenario) {
  const fixture = createFixture(); const sdk = client(fixture);
  const result = await sdk.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal(result.error, null); fixture.selectAuditCase(id, scenario);
  return { fixture, sdk };
}

test('every executable case has one explicit flow, immutable identity and meaningful mandatory assertion', () => {
  assert.equal(new Set(manifest.cases.map(c => c.id)).size, manifest.cases.length);
  for (const item of manifest.cases) {
    const docs = YAML.parseAllDocuments(fs.readFileSync('tests/native/audit/' + item.flow, 'utf8')).map(x => x.toJSON());
    assert.equal(docs[0].appId, 'app.platinumcircles.mobile.qa'); assert.equal(docs[0].name, item.name);
    assert(Array.isArray(docs[1]) && docs[1].length > 2, item.id);
    assert(docs[1].some(command => command.assertVisible || command.extendedWaitUntil), item.id);
    assert(!JSON.stringify(docs).includes('"optional":true'), item.id);
    assert(!JSON.stringify(docs).includes('"point":'), item.id);
    assert(fs.existsSync(item.source), item.id);
  }
});

test('declared nested entry states survive the installed real stack/tab routers', () => {
  const nav = fs.readFileSync('src/navigation/AppNavigator.tsx', 'utf8');
  const names = [...nav.matchAll(/<RootStack\.Screen name="([^"]+)"/g)].map(x => x[1]).concat('NativeMemoryCaptureFixture', 'NativeAuditLauncher');
  const root = StackRouter({});
  for (const item of manifest.cases.filter(x => x.state)) {
    const hydrated = root.getRehydratedState({ ...item.state, stale: true }, { routeNames: [...new Set(names)], routeParamList: {}, routeGetIdList: {} });
    assert.equal(hydrated.routes[hydrated.index].name, item.state.routes[0].name, item.id);
    const child = item.state.routes[0].state;
    if (child) {
      const tab = TabRouter({ initialRouteName: 'Feed' }).getRehydratedState({ ...child, stale: true }, { routeNames: ['Feed', 'Market', 'Jobs', 'Messages', 'Profile'], routeParamList: {}, routeGetIdList: {} });
      assert.equal(tab.routes[tab.index].name, child.routes[0].name, item.id);
      const stack = child.routes[0].state;
      const leaf = StackRouter({}).getRehydratedState({ ...stack, stale: true }, { routeNames: [stack.routes[0].name], routeParamList: {}, routeGetIdList: {} });
      assert.deepEqual(leaf.routes[0].params, stack.routes[0].params, item.id);
    }
  }
});

test('actual SDK sees the original ticket body with empty history; no invented backfill', async () => {
  const { sdk } = await signed('support-original-body', 'fresh-ticket');
  const ticket = await sdk.from('support_tickets').select('*').eq('id', TICKET).maybeSingle();
  const history = await sdk.from('support_messages').select('*').eq('ticket_id', TICKET).order('created_at');
  assert.equal(ticket.error, null); assert.equal(ticket.data.body, 'Original support question from the member.');
  assert.deepEqual(history.data, []);
});

for (const [id, mode, table, field] of [
  ['support-list-error', 'list-error', 'support_tickets', 'user_id'],
  ['support-ticket-read-error', 'ticket-read-error', 'support_tickets', 'id'],
  ['support-history-error', 'history-error', 'support_messages', 'ticket_id'],
]) test('actual SDK preserves controlled ' + mode, async () => {
  const { sdk } = await signed(id, mode);
  const result = await sdk.from(table).select('*').eq(field, field === 'user_id' ? owner : TICKET);
  assert(result.error); assert.equal(result.status, 503); assert.equal(result.data, null);
});

test('actual RPC rolls back both reply and reopen when the status write fails', async () => {
  const { sdk, fixture } = await signed('support-reopen-error', 'status-write-error');
  const reply = await sdk.rpc('send_member_support_reply', { p_expected_user: owner, p_ticket_id: TICKET,
    p_request_id: 'b0000000-0000-4000-8000-000000000001', p_body: 'Synthetic reply' });
  assert(reply.error); assert.equal(reply.status, 503);
  const ticket = await sdk.from('support_tickets').select('*').eq('id', TICKET).maybeSingle();
  const history = await sdk.from('support_messages').select('*').eq('ticket_id', TICKET);
  assert.equal(ticket.data.status, 'solved'); assert.deepEqual(history.data, []);
  assert.deepEqual(fixture.receipt.audit.mutations, []);
  assert.deepEqual(fixture.receipt.audit.state.messageIds, []);
});

test('actual RPC returns one exact replayable receipt and rejects a reused key with different content', async () => {
  const { sdk, fixture } = await signed('support-ticket', 'baseline');
  const input = { p_expected_user: owner, p_ticket_id: TICKET, p_request_id: 'b0000000-0000-4000-8000-000000000002', p_body: '  Synthetic reply  ' };
  const first = await sdk.rpc('send_member_support_reply', input);
  const replay = await sdk.rpc('send_member_support_reply', input);
  assert.equal(first.error, null); assert.equal(first.data.replayed, false);
  assert.equal(first.data.body, 'Synthetic reply'); assert.equal(first.data.ticket_status, 'open');
  assert.deepEqual(replay.data, { ...first.data, replayed: true });
  assert.equal(fixture.receipt.audit.mutations.length, 1);
  assert.deepEqual(fixture.receipt.audit.state.messageIds, [input.p_request_id]);
  const conflict = await sdk.rpc('send_member_support_reply', { ...input, p_body: 'Different message' });
  assert.equal(conflict.error.code, '22023'); assert.equal(conflict.error.message, 'SUPPORT_REQUEST_CONFLICT');
  assert.equal(fixture.receipt.audit.mutations.length, 1);
});

test('actual SDK creates and reads back a ticket by the supplied UUID without inventing history', async () => {
  const { sdk, fixture } = await signed('support-fresh-ticket-body', 'baseline');
  const input = { id: 'c0000000-0000-4000-8000-000000000001', user_id: owner, kind: 'support', subject: 'Fresh audit ticket', body: 'Original fresh question' };
  const created = await sdk.from('support_tickets').insert(input).select('*').single();
  assert.equal(created.error, null); assert.equal(created.data.id, input.id); assert.equal(created.data.body, input.body);
  const again = await sdk.from('support_tickets').insert(input).select('*').single();
  assert.equal(again.error.code, '23505');
  const readback = await sdk.from('support_tickets').select('*').eq('id', input.id).eq('user_id', owner).maybeSingle();
  assert.deepEqual(readback.data, created.data);
  const list = await sdk.from('support_tickets').select('*').eq('user_id', owner).order('created_at', { ascending: false }).limit(10);
  assert.equal(list.data.length, 2); assert.equal(list.data[0].id, input.id);
  assert.deepEqual((await sdk.from('support_messages').select('*').eq('ticket_id', input.id)).data, []);
  assert.equal(fixture.receipt.audit.mutations.length, 1);
});

test('actual RPC rejects wrong owner, missing ticket, malformed identifiers and unsupported arguments', async () => {
  const { sdk, fixture } = await signed('support-ticket', 'baseline');
  const input = { p_expected_user: owner, p_ticket_id: TICKET, p_request_id: 'b0000000-0000-4000-8000-000000000003', p_body: 'Synthetic reply' };
  assert.equal((await sdk.rpc('send_member_support_reply', { ...input, p_expected_user: '10000000-0000-4000-8000-000000000002' })).error.message, 'SUPPORT_ACCOUNT_CHANGED');
  assert.equal((await sdk.rpc('send_member_support_reply', { ...input, p_ticket_id: 'a0000000-0000-4000-8000-000000000099' })).error.message, 'SUPPORT_TICKET_UNAVAILABLE');
  assert.equal((await sdk.rpc('send_member_support_reply', { ...input, p_request_id: '------------------------------------' })).error.code, '22023');
  assert.equal((await sdk.rpc('send_member_support_reply', { ...input, p_body: '  ' })).error.code, '22023');
  assert.equal((await sdk.rpc('send_member_support_reply', { ...input, unexpected: true })).status, 501);
  assert.deepEqual(fixture.receipt.audit.mutations, []);
});

test('legacy direct reply insertion also rolls back under the actual trigger failure contract', async () => {
  const { sdk, fixture } = await signed('support-reopen-error', 'status-write-error');
  const reply = await sdk.from('support_messages').insert({ ticket_id: TICKET, sender: 'member', sender_id: owner, body: 'Legacy reply' });
  assert.equal(reply.status, 503);
  assert.deepEqual(fixture.receipt.audit.state.messageIds, []);
  assert.equal(fixture.receipt.audit.state.tickets[0].status, 'solved');
  assert.deepEqual(fixture.receipt.audit.mutations, []);
});

test('missing ticket remains null and no positive fallback record is created', async () => {
  const { sdk } = await signed('support-missing-ticket', 'missing-ticket');
  const result = await sdk.from('support_tickets').select('*').eq('id', TICKET).maybeSingle();
  assert.equal(result.error, null); assert.equal(result.data, null);
});

test('Support fixture rejects unsigned access, another owner, unsupported methods/fields and outside origins', async () => {
  const fixture = createFixture();
  assert.equal((await fixture.fetch(origin + '/rest/v1/support_tickets')).status, 401);
  const sdk = client(fixture);
  await sdk.auth.signInWithPassword({ email: 'qa.jordan@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal((await fixture.fetch(origin + '/rest/v1/support_tickets')).status, 403);
  await sdk.auth.signInWithPassword({ email: 'qa.alex@example.invalid', password: 'FixtureOnly-2026!' });
  assert.equal((await fixture.fetch(origin + '/rest/v1/support_tickets', { method: 'DELETE' })).status, 501);
  assert.equal((await fixture.fetch(origin + '/rest/v1/support_tickets?arbitrary=eq.x')).status, 501);
  assert.equal((await fixture.fetch('https://example.invalid/rest/v1/support_tickets')).status, 501);
  assert.equal(fixture.receipt.networkForwarded, false);
});

test('scenario selection rejects unknown/mismatched/repeated state and preserves base memory methods', async () => {
  const { fixture } = await signed('support-ticket', 'baseline');
  assert.throws(() => fixture.selectAuditCase('unknown', 'baseline'));
  assert.throws(() => fixture.selectAuditCase('support-ticket', 'history-error'));
  assert.throws(() => fixture.selectAuditCase('support-ticket', 'baseline'));
  assert.equal(typeof fixture.authorizeMemoryMedia, 'function');
  assert.equal(typeof fixture.recordAccountReadback, 'function');
});

test('actual Python runner continues after failure and rejects empty/skipped/malformed/unbound reports', () => {
  const script = String.raw`
import importlib.util,json,pathlib,tempfile,types,unittest,subprocess,sys,os,time
p=pathlib.Path('scripts/quality/native-ui-audit-runner.py');s=importlib.util.spec_from_file_location('runner',p);r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
class Checks(unittest.TestCase):
 def case(self,i='one'): return {'id':i,'group':'support','kind':'entry-smoke','name':'Case '+i,'flow':'flows/'+i+'.yaml','fixtureScenario':'baseline'}
 def xml(self,c,status='SUCCESS'): return '<testsuites><testsuite tests="1" failures="0"><testcase name="'+c['name']+'" status="'+status+'" file="tests/native/audit/'+c['flow']+'"/></testsuite></testsuites>'
 def test_continue(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);cases=[self.case('one'),self.case('two')];calls=[]
   def execute(args,**kw):
    c=cases[len(calls)];calls.append(c['id']);pathlib.Path(args[args.index('--output')+1]).write_text(self.xml(c));return types.SimpleNamespace(returncode=1 if c['id']=='one' else 0)
   def collect(platform,device,target):
    c=next(c for c in cases if c['id']==target.name);(target/'native-ui-receipt.json').write_text(json.dumps({'mode':'synthetic-native-ui','networkForwarded':False,'unhandled':[],'requests':[{'path':'/auth/v1/token'}],'audit':{'caseId':c['id'],'scenario':'baseline','rejected':[]}}));return []
   result=r.run_cases(cases,'android','fixture-device',root,execute,collect)
   self.assertEqual(calls,['one','two']);self.assertEqual([x['status'] for x in result],['failed','passed']);self.assertEqual([x['attempts'] for x in result],[1,1])
 def test_bad_reports(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'junit.xml';c=self.case()
   for xml in ['', '<broken', '<testsuites/>',self.xml(c,'SKIPPED'),self.xml(c).replace('Case one','Case other'),self.xml(c).replace('/one.yaml','/other.yaml'),self.xml(c).replace('/>','><failure/></testcase>',1)]:
    p.write_text(xml);self.assertFalse(r.validate_junit(p,c)['passed'],xml)
 def test_real_timeout_continues_and_terminates_owned_child(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);cases=[self.case('one'),self.case('two')];calls=[];pidfile=root/'owned-child.pid'
   def execute(args,**kw):
    c=cases[len(calls)];calls.append(c['id'])
    if c['id']=='one':
     child="import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)"
     parent="import subprocess,sys,pathlib,time; p=subprocess.Popen([sys.executable,'-c',"+repr(child)+"]);pathlib.Path("+repr(str(pidfile))+").write_text(str(p.pid));time.sleep(60)"
     return r.run_owned([sys.executable,'-c',parent],timeout=.3,stdout=kw['stdout'],stderr=kw['stderr'])
    self.assertEqual(kw['timeout'],180)
    pathlib.Path(args[args.index('--output')+1]).write_text(self.xml(c));return r.run_owned([sys.executable,'-c','pass'],timeout=2,stdout=kw['stdout'],stderr=kw['stderr'])
   def collect(platform,device,target):
    c=next(c for c in cases if c['id']==target.name);(target/'native-ui-receipt.json').write_text(json.dumps({'mode':'synthetic-native-ui','networkForwarded':False,'unhandled':[],'requests':[{'path':'/auth/v1/token'}],'audit':{'caseId':c['id'],'scenario':'baseline','rejected':[]}}));return []
   result=r.run_cases(cases,'android','fixture-device',root,execute,collect)
   self.assertEqual(calls,['one','two']);self.assertTrue(result[0]['timedOut']);self.assertEqual([x['status'] for x in result],['failed','passed'])
   pid=int(pidfile.read_text());state=subprocess.run(['ps','-o','stat=','-p',str(pid)],capture_output=True,text=True).stdout.strip()
   self.assertTrue(not state or state.startswith('Z'),'A live owned descendant remained: '+state)
 def test_fixture_failure(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'receipt.json';c=self.case();p.write_text('{}');self.assertFalse(r.validate_receipt(p,c)['passed']);p.write_text('{');self.assertFalse(r.validate_receipt(p,c)['passed'])
 def test_binary_binding(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'app.apk';p.write_bytes(b'fixture');m={'applicationSourceCommit':'a'*40,'applicationSourceTree':'b'*40,'platform':'android','packageId':r.PACKAGE,'kind':'disposable-native-audit','configuration':'Release','auditManifestSha256':'x','nativeCompatibility':{'abi':'x86_64'},'toolchain':{'java':'fixture'},'sourceReceiptSha256':'y','binarySha256':r.binary_digest(p)}
   r.validate_binary(m,p,'android','a'*40,'b'*40)
   for key,value in [('applicationSourceCommit','c'*40),('applicationSourceTree','c'*40),('platform','ios'),('packageId','production.app'),('binarySha256','0'*64)]:
    changed={**m,key:value}
    with self.assertRaises(ValueError):r.validate_binary(changed,p,'android','a'*40,'b'*40)
unittest.main()
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('disposable preparation retains exact anchors and rejects a second overlay before native build', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-audit-prepare-'));
  try {
    for (const file of ['scripts/quality/prepare-native-ui-audit.cjs', 'scripts/quality/native-ui-audit-runner.py', 'scripts/quality/native-ui-audit-binary.py', 'scripts/quality/native-ui-ios-compatibility.py', 'tests/native/audit/manifest.json', 'tests/native/entry.js', 'src/navigation/AppNavigator.tsx']) {
      fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true }); fs.copyFileSync(file, path.join(directory, file));
    }
    fs.mkdirSync(path.join(directory, 'native-ui-logs/overlays'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'native-ui-logs/source.json'), JSON.stringify({ commit: 'a'.repeat(40), overlays: [] }));
    const env = { ...process.env, CI: 'true', EXPO_PUBLIC_APP_ENV: 'qa', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'native-ui-synthetic-no-provider-key', GITHUB_SHA: 'a'.repeat(40) };
    const run = () => spawnSync(process.execPath, ['scripts/quality/prepare-native-ui-audit.cjs'], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(run().status, 0); const source = JSON.parse(fs.readFileSync(path.join(directory, 'native-ui-logs/source.json')));
    assert.equal(source.audit.overlays.length, 3); assert.equal(Object.keys(source.audit.inputs).length, 5);
    assert.equal(source.audit.inputs['scripts/quality/native-ui-ios-compatibility.py'], createHash('sha256').update(fs.readFileSync(path.join(directory, 'scripts/quality/native-ui-ios-compatibility.py'))).digest('hex'));
    assert.equal(source.audit.applicationSourceCommit, 'a'.repeat(40)); assert.notEqual(run().status, 0);
    const entry = fs.readFileSync(path.join(directory, 'tests/native/entry.js'), 'utf8');
    assert(entry.indexOf("require('@daily-co/react-native-daily-js')") < entry.indexOf("require('../../App')"));
    assert(entry.indexOf("require('@daily-co/react-native-daily-js')") < entry.indexOf('fixture.persistAuditBaseline()'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
