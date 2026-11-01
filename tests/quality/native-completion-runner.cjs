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

test('normal Simulator setup creates one owned pinned device and bounds exact-device failure cleanup', () => {
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
 return uuid
def run(args,timeout):
 calls.append((args,timeout))
 if 'bootstatus' in args: raise subprocess.TimeoutExpired(args,timeout)
q=Path('scripts/quality/native-ui-ios-created-device.py');t=importlib.util.spec_from_file_location('created',q);created=importlib.util.module_from_spec(t);t.loader.exec_module(created)
helper=types.SimpleNamespace(expected_target=created.expected_target,validate_device_identifier=lambda x:None,verify_created_device=lambda *args:{'verified':True})
try:m.prepare({'applicationSourceCommit':'a'*40,'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':m.RUNTIME}},read,run,helper)
except subprocess.TimeoutExpired:pass
else:raise AssertionError('Boot timeout was accepted')
assert [x[0][2] for x in calls]==['create','boot','bootstatus','shutdown','delete']
assert [x[1] for x in calls]==[120,120,300,20,20]
assert calls[0][0][-2:]==[m.DEVICE_TYPE,m.RUNTIME]
assert all(row[0][-1]==uuid for row in calls[-2:])
assert calls[0][0][3].startswith('Platinum completion ')
before=len(calls)
try:m.prepare({'nativeCompatibility':{'abi':'arm64','runtimeIdentifier':m.RUNTIME}},read,run,helper)
except ValueError:pass
else:raise AssertionError('Another runtime ABI was accepted')
assert len(calls)==before
print('Owned Simulator startup and bounded cleanup passed')
`;
  assert.match(execFileSync('python3', ['-c', script], { encoding: 'utf8' }), /passed/);
});

test('normal startup CLI uses bounded inherited-pipe reads and retains exact-device cleanup evidence', () => {
  const script = String.raw`
import hashlib,json,os,signal,subprocess,sys,tempfile,time
from pathlib import Path
starter=Path('scripts/quality/native-ui-start-ios-device.py').resolve()
uuid='11111111-1111-4111-8111-111111111111'
runtime='com.apple.CoreSimulator.SimRuntime.iOS-18-5'
device_type='com.apple.CoreSimulator.SimDeviceType.iPhone-16'
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);marker=root/'children';calls=root/'calls.jsonl';fake=root/'xcrun'
 devices=json.dumps({'devices':{runtime:[{'udid':uuid,'state':'Shutdown','isAvailable':True,'deviceTypeIdentifier':device_type}]}})
 runtimes=json.dumps({'runtimes':[{'identifier':runtime,'version':'18.5','isAvailable':True}]})
 fake.write_text('#!'+sys.executable+'\n'+
  'import json,os,subprocess,sys\nfrom pathlib import Path\nargs=sys.argv[1:]\n'+
  'with Path('+repr(str(calls))+').open("a") as out:out.write(json.dumps(args)+"\\n")\n'+
  'if args[:2]==["simctl","create"]:\n'+
  ' child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"])\n'+
  ' with Path('+repr(str(marker))+').open("a") as out:out.write(str(child.pid)+"\\n")\n'+
  ' print('+repr(uuid)+',flush=True)\n'+
  'elif args==["simctl","list","runtimes","--json"]:print('+repr(runtimes)+',flush=True)\n'+
  'elif args==["simctl","list","devices","--json"]:print('+repr(devices)+',flush=True)\n'+
  'elif args[:2]==["simctl","bootstatus"] and os.environ.get("TEST_BOOT_FAILURE")=="1":raise SystemExit(9)\n'+
  'elif args[:2] not in [["simctl","boot"],["simctl","bootstatus"],["simctl","shutdown"],["simctl","delete"]]:raise SystemExit(2)\n')
 fake.chmod(0o755)
 toolchain={'xcode':'Xcode 16.4\nBuild version 16F6','sdkVersion':'18.5'}
 manifest=root/'manifest.json';manifest.write_text(json.dumps({'applicationSourceCommit':'a'*40,'applicationSourceTree':'b'*40,'binarySha256':'c'*64,'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':runtime},'toolchain':toolchain}))
 # This test isolates the real startup CLI/pipe/cleanup behavior after a
 # controlled preflight handoff; actual immutable probes are tested separately.
 stages=['compatibility-host-architecture','compatibility-xcode-version','compatibility-simulator-sdk','compatibility-actual-mach-o','compatibility-app-signature']
 values=['x86_64',toolchain['xcode'],'18.5','x86_64','']
 commands=[{'stage':stage,'status':'completed','exitCode':0,'timeoutSeconds':30,'startedAtEpochMs':1000+i*100,'finishedAtEpochMs':1050+i*100,'elapsedSeconds':0.04,'stdoutTail':values[i],'stdoutTruncated':False} for i,stage in enumerate(stages)]
 immutable=root/'immutable.json';immutable.write_text(json.dumps({'schemaVersion':1,'kind':'native-ios-immutable-preflight','applicationSourceCommit':'a'*40,'applicationSourceTree':'b'*40,'binarySha256':'c'*64,'binaryManifestSha256':hashlib.sha256(manifest.read_bytes()).hexdigest(),'binaryPath':str(root/'PlatinumQA.app'),'developerDirectory':os.environ.get('DEVELOPER_DIR'),'immutableCompatibility':{'hostArchitecture':'x86_64','actualExecutableArchitecture':'x86_64','xcode':toolchain['xcode'],'sdkVersion':'18.5','codeSignatureVerified':True,'guestUnameInvoked':False},'commands':commands}))
 environment={**os.environ,'CI':'true','PATH':str(root)+os.pathsep+os.environ['PATH']}
 try:
  output=root/'device-setup.json';start=time.monotonic()
  result=subprocess.run([sys.executable,str(starter),'--manifest',str(manifest),'--output',str(output)],env=environment,capture_output=True,text=True,timeout=10)
  assert result.returncode!=0 and not calls.exists() and not output.exists()
  result=subprocess.run([sys.executable,str(starter),'--manifest',str(manifest),'--immutable-preflight',str(immutable),'--output',str(output)],env=environment,capture_output=True,text=True,timeout=10)
  assert result.returncode==0,result.stderr
  assert result.stdout==uuid+'\n' and time.monotonic()-start<5
  proof=json.loads(output.read_text());assert proof['created'] and proof['bootReady'] and proof['device']==uuid
  assert proof['immutablePreflightSha256']==hashlib.sha256(immutable.read_bytes()).hexdigest()
  assert proof['createdAfterImmutablePreflightAtEpochMs']>=proof['immutablePreflightFinishedAtEpochMs']==1450
  saved=json.loads((root/'device-setup-commands.json').read_text())['commands']
  assert [row['timeoutSeconds'] for row in saved]==[120,30,30,120,300]
  assert saved[0]['leaderCompletedBeforePipeEOF'] and saved[0]['exitCode']==0
  executed=[json.loads(line) for line in calls.read_text().splitlines()]
  assert [row[1] for row in executed]==['create','list','list','boot','bootstatus']
  assert executed[0][-2:]==[device_type,runtime]
  calls.write_text('');original=output.read_bytes()
  result=subprocess.run([sys.executable,str(starter),'--manifest',str(manifest),'--output',str(output),'--cleanup-device',uuid],env=environment,capture_output=True,text=True,timeout=10)
  assert result.returncode==0,result.stderr
  assert output.read_bytes()==original
  cleanup=json.loads((root/'device-setup-cleanup.json').read_text())
  assert cleanup['completed'] and cleanup['device']==uuid
  assert [row['timeoutSeconds'] for row in cleanup['commands']]==[20,20]
  assert [json.loads(line) for line in calls.read_text().splitlines()]==[['simctl','shutdown',uuid],['simctl','delete',uuid]]
  calls.write_text('')
  result=subprocess.run([sys.executable,str(starter),'--manifest',str(manifest),'--output',str(output),'--cleanup-device','22222222-2222-4222-8222-222222222222'],env=environment,capture_output=True,text=True,timeout=10)
  assert result.returncode!=0 and not calls.read_text()
  calls.write_text('');failure=root/'failure.json'
  result=subprocess.run([sys.executable,str(starter),'--manifest',str(manifest),'--immutable-preflight',str(immutable),'--output',str(failure)],env={**environment,'TEST_BOOT_FAILURE':'1'},capture_output=True,text=True,timeout=10)
  assert result.returncode!=0 and not failure.exists()
  saved=json.loads((root/'failure-commands.json').read_text())['commands']
  assert saved[4]['status']=='failed' and saved[4]['exitCode']==9
  assert [row['stage'] for row in saved[-2:]]==['simulator-shutdown','simulator-delete']
  assert all(row['status']=='completed' and row['timeoutSeconds']==20 for row in saved[-2:])
  executed=[json.loads(line) for line in calls.read_text().splitlines()]
  assert executed[-2:]==[['simctl','shutdown',uuid],['simctl','delete',uuid]]
  assert proof['name']!=executed[0][2]
 finally:
  if marker.exists():
   for pid in marker.read_text().splitlines():
    try:os.kill(int(pid),signal.SIGTERM)
    except ProcessLookupError:pass
print('Actual normal startup CLI handles inherited pipes and preserves owned cleanup')
`;
  assert.match(execFileSync('python3', ['-c', script], { encoding: 'utf8', timeout: 25000 }), /Actual normal startup CLI/);
});
