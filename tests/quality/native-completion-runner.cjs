const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { createNavigationTimingRecorder } = require('../native/navigation-timing.cjs');
const { navigationTimingOverlay, inboxTimingOverlay } = require('../../scripts/quality/native-ui-navigation-overlay.cjs');

test('navigation observation excludes content, preserves event order and bounds retained data', async () => {
  let clock = 0;
  const writes = [];
  const recorder = createNavigationTimingRecorder({ now: () => ++clock, wallNow: () => 1000 + clock,
    write: async value => { await Promise.resolve(); writes.push(JSON.parse(value)); } });
  recorder.record('tab-press', 'Messages');
  recorder.record('inbox-frame', 'Messages', 1);
  recorder.record('message-text', 'private-value');
  recorder.record('inbox-frame', 'Messages', 'private-value');
  await recorder.flush();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.at(-1).events.map(item => item.phase), ['tab-press', 'inbox-frame']);
  assert.equal(JSON.stringify(writes).includes('private-value'), false);
  for (let i = 0; i < 200; i++) recorder.record('tab-press', 'Feed');
  await recorder.flush();
  assert.equal(writes.at(-1).events.length, 128);
  assert.equal(writes.at(-1).dropped, 74);
});

test('navigation observers compile against exact production components without replacing their handlers', () => {
  for (const [file, overlay] of [
    ['src/navigation/AppNavigator.tsx', navigationTimingOverlay],
    ['src/screens/messages/ConversationsScreen.tsx', inboxTimingOverlay],
  ]) {
    const source = fs.readFileSync(file, 'utf8');
    const patched = overlay(source);
    const result = ts.transpileModule(patched, { fileName: file, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    assert.deepEqual(result.diagnostics, []);
    assert.equal((source.match(/onPress=/g) || []).length, (patched.match(/onPress=/g) || []).length);
    assert.throws(() => overlay('missing production anchor'));
  }
});

test('Simulator setup selects only the exact available shutdown device and bounds boot failures', () => {
  const script = String.raw`
import importlib.util,json,types,subprocess
from pathlib import Path
p=Path('scripts/quality/native-ui-start-ios-device.py');s=importlib.util.spec_from_file_location('start',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
uuid='11111111-1111-4111-8111-111111111111'
good={'udid':uuid,'state':'Shutdown','isAvailable':True,'deviceTypeIdentifier':m.DEVICE_TYPE}
assert m.select_existing({'devices':{m.RUNTIME:[good]}})==uuid
for key,value in [('state','Booted'),('isAvailable',False),('deviceTypeIdentifier','other')]:
 assert m.select_existing({'devices':{m.RUNTIME:[{**good,key:value}]}}) is None
assert m.select_existing({'devices':{'other':[good]}}) is None
calls=[]
def read(args,timeout):
 calls.append((args,timeout))
 return json.dumps({'devices':{m.RUNTIME:[good]}})
def run(args,timeout):
 calls.append((args,timeout))
 if 'bootstatus' in args: raise subprocess.TimeoutExpired(args,timeout)
helper=types.SimpleNamespace(validate_device_identifier=lambda x:None,verify_created_device=lambda *args:{'verified':True})
try:m.prepare({'applicationSourceCommit':'a'*40},read,run,helper)
except subprocess.TimeoutExpired:pass
else:raise AssertionError('Boot timeout was accepted')
assert [x[0][2] for x in calls]==['list','boot','bootstatus','shutdown']
assert [x[1] for x in calls]==[30,120,300,20]
print('Simulator selection and bounded cleanup passed')
`;
  assert.match(execFileSync('python3', ['-c', script], { encoding: 'utf8' }), /passed/);
});
