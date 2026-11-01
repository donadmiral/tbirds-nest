const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');

test('fresh original-journey consumer refuses unrelated, incomplete or changed producer bytes', () => {
  const code = String.raw`
import copy,importlib.util,json,tempfile,unittest
from pathlib import Path
p=Path('scripts/quality/completion-ios-journey.py');s=importlib.util.spec_from_file_location('consumer',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class BindingTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  self.scenarios=self.root/'scenarios.json';self.scenarios.write_text('{"cases":[]}')
  source={'commit':m.SOURCE,'workflowRun':str(m.PRODUCER_RUN),'audit':{'applicationSourceCommit':m.SOURCE}}
  (self.root/'source.json').write_text(json.dumps(source));(self.root/'qa.app.tar.gz').write_bytes(b'controlled producer archive boundary')
  self.manifest={'applicationSourceCommit':m.SOURCE,'applicationSourceTree':m.TREE,'platform':'ios','binarySha256':'b'*64,'sourceReceiptSha256':m.digest(self.root/'source.json'),'auditManifestSha256':m.digest(self.scenarios)}
  (self.root/'binary-manifest.json').write_text(json.dumps(self.manifest))
  self.binding={'schemaVersion':1,'ready':True,'applicationSourceCommit':m.SOURCE,'applicationSourceTree':m.TREE,'producerRunId':m.PRODUCER_RUN,'producerArtifactName':'native-audit-ios-binary','producerArtifactId':123,'producerArtifactZipBytes':456,'producerArtifactZipSha256':'c'*64,'appArchiveSha256':m.digest(self.root/'qa.app.tar.gz'),'binaryManifestSha256':m.digest(self.root/'binary-manifest.json'),'binarySha256':'b'*64,'sourceReceiptSha256':m.digest(self.root/'source.json')}
 def tearDown(self):self.temp.cleanup()
 def test_exact_download_accepts(self):self.assertEqual(m.verify_download(self.root,self.binding,self.scenarios),self.manifest)
 def test_every_bound_field_is_required_and_exact(self):
  for key in self.binding:
   with self.subTest(missing=key):
    changed=copy.deepcopy(self.binding);del changed[key]
    with self.assertRaises(ValueError):m.validate_binding(changed)
  for key,value in [('ready',False),('schemaVersion',True),('applicationSourceCommit','a'*40),('applicationSourceTree','a'*40),('producerRunId',1),('producerArtifactName','old-app'),('producerArtifactId',True),('producerArtifactZipBytes',0),('binarySha256','unverified')]:
   with self.subTest(changed=key):
    changed={**self.binding,key:value}
    with self.assertRaises(ValueError):m.validate_binding(changed)
 def test_each_changed_retained_file_is_rejected(self):
  for name in ['source.json','binary-manifest.json','qa.app.tar.gz']:
   with self.subTest(name=name):
    p=self.root/name;original=p.read_bytes();p.write_bytes(original+b' ')
    with self.assertRaises(ValueError):m.verify_download(self.root,self.binding,self.scenarios)
    p.write_bytes(original)
 def test_unrelated_manifest_is_rejected_even_with_an_updated_file_digest(self):
  for key,value in [('applicationSourceCommit','a'*40),('applicationSourceTree','a'*40),('platform','android'),('binarySha256','c'*64),('sourceReceiptSha256','c'*64),('auditManifestSha256','c'*64)]:
   with self.subTest(key=key):
    (self.root/'binary-manifest.json').write_text(json.dumps({**self.manifest,key:value}))
    changed={**self.binding,'binaryManifestSha256':m.digest(self.root/'binary-manifest.json')}
    with self.assertRaises(ValueError):m.verify_download(self.root,changed,self.scenarios)
 def test_wrong_producer_source_receipt_is_rejected_even_with_matching_manifest_hashes(self):
  (self.root/'source.json').write_text(json.dumps({'commit':m.SOURCE,'workflowRun':'historical','audit':{'applicationSourceCommit':m.SOURCE}}))
  altered_hash=m.digest(self.root/'source.json')
  (self.root/'binary-manifest.json').write_text(json.dumps({**self.manifest,'sourceReceiptSha256':altered_hash}))
  changed={**self.binding,'sourceReceiptSha256':altered_hash,'binaryManifestSha256':m.digest(self.root/'binary-manifest.json')}
  with self.assertRaises(ValueError):m.verify_download(self.root,changed,self.scenarios)
unittest.main(argv=['completion-binding'],verbosity=2)
`;
  const result = execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
  assert.equal(result.trim(), '');
});

test('fresh original journey keeps the exact reviewed path and reports a separate source-bound result', () => {
  const workflow = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/native-completion-journey.yml'), 'utf8'));
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  const job = workflow.jobs['original-journey'];
  assert.equal(job['runs-on'], 'macos-15-intel');
  assert.equal(job.env.MAESTRO_DRIVER_STARTUP_TIMEOUT, '180000');
  assert.equal(job.steps.find(step => step.with?.path === 'baseline').with.ref, 'f5be97445ef7223baeb60dd10e8cded05630b6c1');
  const download = job.steps.find(step => step.with?.['artifact-ids']);
  assert.equal(download.with['run-id'], 41259529351);
  assert.equal(download.with['artifact-ids'], '${{ steps.binding.outputs.artifact_id }}');
  assert.equal(job.steps.at(-1).if, 'always()');
  assert.doesNotMatch(JSON.stringify(job), /npm ci|expo prebuild|xcodebuild .*build|codesign .*--sign|pod .*install/);
  const native = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/native-product-audit.yml'), 'utf8'));
  assert.equal(native.on.push.paths.includes('.github/workflows/native-completion-journey.yml'), false);
  const ios = YAML.parse(fs.readFileSync(path.join(root, '.github/workflows/ios-native-compile.yml'), 'utf8'));
  assert.ok(ios.on.push.branches.includes('codex/completion-20261101'));
  assert.equal(ios.jobs['simulator-memory-export'].steps.find(step => step.run?.includes('test-ios-memory-movie')).run, 'bash scripts/quality/test-ios-memory-movie.sh');
});

test('native app timing requires the exact visit count and a populated frame before leaving', () => {
  const code = String.raw`
import copy,importlib.util
from pathlib import Path
p=Path('docs/quality/completion-20261101/native_runtime_analysis.py');s=importlib.util.spec_from_file_location('timing',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
events=[{'sequence':1,'phase':'tab-press','screen':'Messages','rowCount':0,'atMs':1,'atUnixMs':1001},{'sequence':2,'phase':'inbox-frame','screen':'Messages','rowCount':1,'atMs':101,'atUnixMs':1101}]
receipt={'schemaVersion':1,'mode':'synthetic-native-navigation-timing','dropped':0,'events':events}
proof=m.analyze_timing(receipt,1000,2000,expected_visits=1)
assert proof['withinLimit'] and proof['maxMs']==100
assert not m.analyze_timing(receipt,1000,2000,limit_ms=50,expected_visits=1)['withinLimit']
bad=[copy.deepcopy(receipt) for _ in range(8)]
bad[0]['events'][-1]['rowCount']=0
bad[1]['events'][-1]['phase']='tab-press';bad[1]['events'][-1]['screen']='Feed'
bad[2]['events'][0]['atUnixMs']=999
bad[3]['events'][-1]['sequence']=1
bad[4]['dropped']=1
bad[5]['schemaVersion']=True
bad[6]['events'][0]['atMs']=True
bad[7]['events'][0]['atMs']=float('nan')
for value in bad:
 try:m.analyze_timing(value,1000,2000,expected_visits=1)
 except ValueError:pass
 else:raise AssertionError('Missing, stale or malformed app timing passed')
try:m.analyze_timing(receipt,1000,2000)
except ValueError:pass
else:raise AssertionError('One visit satisfied the original three-visit contract')
print('Timing requirements preserved')
`;
  assert.match(execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8', timeout: 30000 }), /requirements preserved/);
});

test('reader timing requires both original pages and captions and catches a driver deadline overrun', () => {
  const code = String.raw`
import copy,importlib.util
from pathlib import Path
p=Path('docs/quality/completion-20261101/native_runtime_analysis.py');s=importlib.util.spec_from_file_location('timing',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
controls=[('tapOnElement','THE SMALL ADVENTURES, 2 memories'),('assertConditionCommand','Edit memory book'),('tapOnElement','Open book'),('assertConditionCommand','Page 1 of 2'),('assertConditionCommand','WE TOOK THE LONG WAY HOME'),('tapOnElement','Next memory'),('assertConditionCommand','Page 2 of 2'),('assertConditionCommand','THE STORIES WE KEEP')]
commands=[]
for index,(kind,text) in enumerate(controls):
 command={'selector':{'textRegex':text}} if kind=='tapOnElement' else {'condition':{'visible':{'textRegex':text}},'timeout':'15000'}
 commands.append({'command':{kind:command},'metadata':{'status':'COMPLETED','timestamp':1000+index*3000,'duration':100}})
assert m.analyze_reader_commands(commands,1000,25000)['bookTapToReadyAssertionMs']==3100
overrun=copy.deepcopy(commands);overrun[1]['metadata']['duration']=15001
assert not m.analyze_reader_commands(overrun,1000,25000)['withinOriginalDeadline']
bad=[copy.deepcopy(commands) for _ in range(5)]
bad[0].pop();bad[1].append(copy.deepcopy(commands[3]));bad[2][-1]['metadata']['status']='SKIPPED';bad[3][1]['command']['assertConditionCommand']['timeout']='30000';bad[4][3]['metadata']['timestamp']=1000
for rows in bad:
 try:m.analyze_reader_commands(rows,1000,25000)
 except ValueError:pass
 else:raise AssertionError('Incomplete or changed original reader accepted')
print('Reader deadlines and controls preserved')
`;
  assert.match(execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8', timeout: 30000 }), /controls preserved/);
});

test('owned cold Simulator creation and metadata complete when an exited parent leaves a service holding the output pipe', () => {
  const code = String.raw`
import importlib.util,json,os,signal,sys,tempfile,time
from pathlib import Path
def load(name,file):
 s=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
consumer=load('consumer','scripts/quality/completion-ios-journey.py')
starter=load('starter','scripts/quality/native-ui-start-ios-device.py')
created=load('created','scripts/quality/native-ui-ios-created-device.py')
helper=load('helper','scripts/quality/native-ui-ios-audit-recovery.py')
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);marker=root/'children';fake=root/'xcrun';uuid='11111111-1111-4111-8111-111111111111'
 device={'udid':uuid,'state':'Shutdown','isAvailable':True,'deviceTypeIdentifier':starter.DEVICE_TYPE}
 devices=json.dumps({'devices':{starter.RUNTIME:[device]}})
 runtimes=json.dumps({'runtimes':[{'identifier':starter.RUNTIME,'version':'18.5','isAvailable':True}]})
 # The exact startup command exits successfully after returning its owned UUID,
 # while a separately running service retains the parent's stdout/stderr.
 fake.write_text('#!'+sys.executable+'\n'+
  'import json,subprocess,sys\nfrom pathlib import Path\n'+
  'args=sys.argv[1:]\n'+
  'if args[:2]==["simctl","create"] or args==["simctl","list","devices","--json"]:\n'+
  ' child=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"])\n'+
  ' with Path('+repr(str(marker))+').open("a") as out:out.write(str(child.pid)+"\\n")\n'+
  ' print('+repr(uuid)+' if args[1]=="create" else '+repr(devices)+',flush=True)\n'+
  'elif args==["simctl","list","runtimes","--json"]:print('+repr(runtimes)+',flush=True)\n'+
  'elif args[:2] not in [["simctl","boot"],["simctl","bootstatus"]]:raise SystemExit(2)\n')
 fake.chmod(0o755);original_path=os.environ['PATH'];os.environ['PATH']=str(root)+os.pathsep+original_path
 try:
  records=[];output=root/'setup.json';start=time.monotonic()
  result=consumer.prepare_simulator({'applicationSourceCommit':consumer.SOURCE,'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':starter.RUNTIME}},starter,created,helper,records,output)
  assert result['bootReady'] and result['device']==uuid and result['created']
  assert result['name'].startswith('Platinum completion ') and len(result['name'].removeprefix('Platinum completion '))==32
  assert time.monotonic()-start<5,'Completed inventory waited for the inherited service pipe'
  saved=json.loads(output.read_text())['commands'];assert len(saved)==5
  assert [row['timeoutSeconds'] for row in saved]==[120,30,30,120,300]
  assert all(row['status']=='completed' and row['exitCode']==0 for row in saved)
  assert all(saved[index]['leaderCompletedBeforePipeEOF'] for index in [0,2])
  assert saved[0]['stdoutTail'].strip()==uuid
  assert json.loads(saved[2]['stdoutTail'])==json.loads(devices)
 finally:
  os.environ['PATH']=original_path
  if marker.exists():
   for pid in marker.read_text().splitlines():
    try:os.kill(int(pid),signal.SIGTERM)
    except ProcessLookupError:pass
print('Cold inventory uses bounded inherited-pipe handling without wider deadlines')
`;
  assert.match(execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8', timeout: 15000 }), /without wider deadlines/);
});

test('cold startup observation preserves the exact command, deadline and timeout without retrying', () => {
  const code = String.raw`
import importlib.util,subprocess,time
from pathlib import Path
p=Path('scripts/quality/completion-ios-startup-diagnostics.py');s=importlib.util.spec_from_file_location('observer',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
command=['xcrun','simctl','list','devices','--json'];reads=[];captures=[]
def quick(args,timeout):reads.append((args,timeout));return 'complete original inventory'
assert m.observed_read(command,30,quick,lambda:captures.append('unexpected'),delay_seconds=.03)=='complete original inventory'
assert reads==[(command,30)] and captures==[]
reads.clear();error=subprocess.TimeoutExpired(command,30,output=b'',stderr=b'')
def stalled(args,timeout):
 reads.append((args,timeout));time.sleep(.08);raise error
try:m.observed_read(command,30,stalled,lambda:captures.append('live'),delay_seconds=.01)
except subprocess.TimeoutExpired as observed:assert observed is error
else:raise AssertionError('Original startup timeout was hidden')
assert reads==[(command,30)] and captures==['live']
def failed_probe():raise ValueError('controlled diagnostic failure')
try:m.observed_read(command,30,stalled,failed_probe,delay_seconds=.01)
except subprocess.TimeoutExpired as observed:assert observed is error
else:raise AssertionError('Diagnostic failure replaced the real command result')
print('Observation does not retry, widen or mask startup')
`;
  assert.match(execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8', timeout: 5000 }), /does not retry, widen or mask/);
});

test('owned startup rejects another runtime and cleans only its returned UUID after metadata failure', () => {
  const code = String.raw`
import importlib.util,json,tempfile,types
from pathlib import Path
def load(name,file):
 s=importlib.util.spec_from_file_location(name,file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
consumer=load('consumer','scripts/quality/completion-ios-journey.py')
starter=load('starter','scripts/quality/native-ui-start-ios-device.py')
created=load('created','scripts/quality/native-ui-ios-created-device.py')
uuid='11111111-1111-4111-8111-111111111111';calls=[]
def read(command,stage,timeout,records,output):
 calls.append((command,stage,timeout))
 if command[2]=='create':return uuid
 if command[2:4]==['list','runtimes']:return '{"runtimes":[]}'
 if command[2] in ['shutdown','delete']:return ''
 raise AssertionError('Unexpected operation after invalid metadata')
helper=types.SimpleNamespace(setup_read=read,atomic_json=lambda p,v:Path(p).write_text(json.dumps(v)))
manifest={'applicationSourceCommit':consumer.SOURCE,'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':starter.RUNTIME}}
with tempfile.TemporaryDirectory() as directory:
 output=Path(directory)/'setup.json'
 try:consumer.prepare_simulator(manifest,starter,created,helper,[],output)
 except ValueError as error:assert 'available original runtime' in str(error)
 else:raise AssertionError('Missing pinned runtime passed setup')
 assert [row[0][2] for row in calls]==['create','list','shutdown','delete']
 assert [row[2] for row in calls]==[120,30,20,20]
 assert calls[0][0][-2:]==[created.DEVICE_TYPE,created.RUNTIME]
 assert all(row[0][-1]==uuid for row in calls[-2:])
 saved=json.loads((Path(directory)/'device-ownership.json').read_text())
 assert saved['device']==uuid and saved['created'] and all(row['completed'] for row in saved['cleanupAfterSetupFailure'])
 before=len(calls)
 try:consumer.prepare_simulator({'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':'com.apple.CoreSimulator.SimRuntime.iOS-26-0'}},starter,created,helper,[],output)
 except ValueError:pass
 else:raise AssertionError('Unbound runtime creation was accepted')
 assert len(calls)==before
print('Only the exact newly created device is cleaned after failed metadata')
`;
  assert.match(execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8', timeout: 5000 }), /exact newly created device/);
});

test('cold startup evidence selects only fixed Simulator executables without arguments or environment', () => {
  const code = String.raw`
import importlib.util
from pathlib import Path
p=Path('scripts/quality/completion-ios-startup-diagnostics.py');s=importlib.util.spec_from_file_location('observer',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
paths={11:'/Applications/Xcode_16.4.app/Contents/Developer/usr/bin/simctl',12:'/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/XPCServices/com.apple.CoreSimulator.CoreSimulatorService.xpc/Contents/MacOS/com.apple.CoreSimulator.CoreSimulatorService',13:'/tmp/simctl',14:'/Applications/Xcode_16.4.app/Contents/Developer/usr/bin/other',15:'/System/Library/PrivateFrameworks/CoreSimulator.framework/Resources/simdiskimaged',16:'/Applications/Xcode_16.4.app/Contents/Developer/usr/bin/simctl'}
owners={pid:501 for pid in paths};owners[15]=0;owners[16]=502
def identify(pid):return {'pid':pid,'uid':owners[pid],'startSeconds':1,'startMicroseconds':2,'executable':paths[pid]}
rows='\n'.join(f'{pid} 1 {owners[pid]} S 00:12 0:00.01' for pid in paths)
selected=m.selected_processes(rows,identify,501)
assert [row['pid'] for row in selected]==[11,12,15]
assert all(set(row)=={'pid','uid','startSeconds','startMicroseconds','executable','parentPid','state','processElapsed','cpuTime'} for row in selected)
try:m.selected_processes('unexpected output',identify,501)
except ValueError:pass
else:raise AssertionError('Malformed process inventory accepted')
print('Only fixed Simulator process identity and state are retained')
`;
  assert.match(execFileSync('python3', ['-c', code], { cwd: root, encoding: 'utf8', timeout: 5000 }), /Only fixed Simulator/);
});
