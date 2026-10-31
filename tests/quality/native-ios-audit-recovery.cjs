const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');

const root = path.resolve(__dirname, '../..');
const helper = path.join(root, 'scripts/quality/native-ui-ios-audit-recovery.py');

test('actual recovery helper bounds reads/processes and preserves the original gate outcomes', () => {
  const code = String.raw`
import ctypes, importlib.util, json, os, plistlib, signal, subprocess, sys, tarfile, tempfile, time, unittest
from pathlib import Path
from unittest import mock
spec=importlib.util.spec_from_file_location('recovery',sys.argv[1]); m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class RecoveryTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
 def tearDown(self):self.temp.cleanup()
 def app(self):
  app=self.root/'PlatinumQA.app';app.mkdir()
  (app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':m.PACKAGE,'CFBundleExecutable':'PlatinumQA','DTPlatformName':'iphonesimulator','DTSDKName':'iphonesimulator18.5','MinimumOSVersion':'15.1'}))
  (app/'PlatinumQA').write_bytes(b'controlled Mach-O boundary double')
  return app
 def manifest(self):return {'nativeCompatibility':{'abi':'x86_64','runtimeIdentifier':m.RUNTIME,'sdk':'iphonesimulator18.5','minimumOSVersion':'15.1'},'toolchain':{'xcode':'Xcode 16.4\nBuild version 16F6','sdkVersion':'18.5'}}
 def reader(self,app,replace=None):
  values={('/usr/bin/uname','-m'):'x86_64',('xcodebuild','-version'):'Xcode 16.4\nBuild version 16F6',('xcrun','--sdk','iphonesimulator','--show-sdk-version'):'18.5',('xcrun','lipo',str(app/'PlatinumQA'),'-archs'):'x86_64',('codesign','--verify','--deep','--strict',str(app)):'',('xcrun','simctl','list','runtimes','--json'):json.dumps({'runtimes':[{'identifier':m.RUNTIME,'version':'18.5','isAvailable':True}]}),('xcrun','simctl','list','devices','--json'):json.dumps({'devices':{m.RUNTIME:[{'udid':'selected','state':'Booted'}]}})}
  if replace:values.update(replace)
  calls=[]
  def read(args,**_):calls.append(args);return values[tuple(args)]
  return read,calls
 def test_supported_compatibility_uses_actual_bundle_and_host_runtime(self):
  app=self.app();read,calls=self.reader(app)
  result=m.verify_compatibility(app,self.manifest(),'selected',read=read,host_system='Darwin')
  self.assertTrue(result['codeSignatureVerified']);self.assertFalse(result['guestUnameInvoked'])
  self.assertFalse(any('spawn' in row for row in calls));self.assertTrue(any('lipo' in row for row in calls))
 def test_incompatible_host_binary_toolchain_and_runtime_fail_closed(self):
  app=self.app()
  changes=[{('/usr/bin/uname','-m'):'arm64'},{('xcodebuild','-version'):'Xcode 17'},
   {('xcrun','--sdk','iphonesimulator','--show-sdk-version'):'18.4'},
   {('xcrun','lipo',str(app/'PlatinumQA'),'-archs'):'arm64 x86_64'},
   {('xcrun','simctl','list','runtimes','--json'):json.dumps({'runtimes':[]})},
   {('xcrun','simctl','list','devices','--json'):json.dumps({'devices':{m.RUNTIME:[{'udid':'selected','state':'Shutdown'}]}})}]
  for change in changes:
   with self.subTest(change=change):
    read,_=self.reader(app,change)
    with self.assertRaises(ValueError):m.verify_compatibility(app,self.manifest(),'selected',read=read,host_system='Darwin')
  read,_=self.reader(app)
  with self.assertRaises(ValueError):m.verify_compatibility(app,self.manifest(),'selected',read=read,host_system='Linux')
 def test_actual_bundle_identity_is_not_taken_on_trust(self):
  app=self.app();read,_=self.reader(app)
  (app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'wrong','CFBundleExecutable':'../escape','DTPlatformName':'iphoneos'}))
  with self.assertRaises(ValueError):m.verify_compatibility(app,self.manifest(),'selected',read=read,host_system='Darwin')
 def test_safe_retained_app_extraction_and_reuse_rejection(self):
  archive=self.root/'app.tar.gz';source=self.root/'source';source.mkdir();(source/'file').write_bytes(b'signed bytes')
  with tarfile.open(archive,'w:gz') as t:t.add(source,arcname='PlatinumQA.app')
  target=self.root/'extract';target.mkdir();result=m.extract_app(archive,target)
  self.assertEqual((result/'file').read_bytes(),b'signed bytes')
  with self.assertRaises(ValueError):m.extract_app(archive,target)
 def test_archive_escape_and_links_are_rejected(self):
  for name,kind in [('../escape',tarfile.REGTYPE),('PlatinumQA.app/link',tarfile.SYMTYPE),('PlatinumQA.app/device',tarfile.CHRTYPE)]:
   with self.subTest(name=name):
    archive=self.root/'bad.tar';item=tarfile.TarInfo(name);item.type=kind;item.linkname='/tmp/elsewhere'
    with tarfile.open(archive,'w') as t:t.addfile(item)
    with self.assertRaises(ValueError):m.extract_app(archive,self.root/'safe')
 def test_stable_json_and_all_bounded_negative_cases(self):
  p=self.root/'trace.json';p.write_bytes(b'{"a":1}');self.assertEqual(m.stable_json_bytes(p),p.read_bytes())
  for data in [b'',b'broken',b'[]',b'x'*(m.MAX_TRACE_BYTES+1)]:
   with self.subTest(size=len(data)):
    p.write_bytes(data)
    with self.assertRaises(ValueError):m.stable_json_bytes(p)
  link=self.root/'link.json';link.symlink_to(p)
  with self.assertRaises(OSError):m.stable_json_bytes(link)
 def test_snapshot_rejects_source_mutation_during_read(self):
  p=self.root/'trace.json';p.write_bytes(b'{"a":1}');original=os.read;changed=[False]
  def read(fd,n):
   data=original(fd,n)
   if not changed[0]:changed[0]=True;p.write_bytes(b'{"a":123}')
   return data
  with mock.patch.object(m.os,'read',side_effect=read):
   with self.assertRaises(ValueError):m.stable_json_bytes(p)
 def test_each_poll_resolves_current_container_and_labels_case_attribution(self):
  containers=[]
  for case in ['previous','current']:
   d=self.root/case/'Documents';d.mkdir(parents=True)
   (d/'native-ui-receipt.json').write_text(json.dumps({'audit':{'caseId':case}}))
   (d/'native-ui-auth-diagnostics.json').write_text(json.dumps({'marker':case}))
   containers.append(d.parent)
  calls=[]
  def container(*_):calls.append(1);return containers[min(len(calls)-1,1)]
  observer=m.Observer('device',self.root/'out',self.root/'app.log',{'used':False},expected_case='current',container=container)
  observer.snapshot();self.assertEqual(observer.records['snapshots']['latest/native-ui-receipt.json']['caseAttribution'],'not-established')
  first=dict(observer.records['snapshots']['first/native-ui-receipt.json'])
  observer.snapshot();self.assertEqual(len(calls),2)
  self.assertTrue(observer.records['snapshots']['latest/native-ui-receipt.json']['fixtureCaseMatchesExpectedAtThisPoll'])
  self.assertEqual(observer.records['snapshots']['first/native-ui-receipt.json'],first)
  self.assertFalse(first['fixtureCaseMatchesExpectedAtThisPoll'])
  self.assertEqual(observer.records['snapshots']['latest/native-ui-auth-diagnostics.json']['caseAttribution'],'not-established')
  self.assertEqual(json.loads((self.root/'out/latest/native-ui-auth-diagnostics.json').read_text())['marker'],'current')
  (containers[1]/'Documents/native-ui-receipt.json').write_text('incomplete')
  observer.snapshot();self.assertEqual(json.loads((self.root/'out/latest/native-ui-receipt.json').read_text())['audit']['caseId'],'current')
  self.assertIn('lastAttemptIssue',observer.records['snapshots']['latest/native-ui-receipt.json'])
 def test_observer_start_and_finish_failures_do_not_change_result_or_error(self):
  calls=[];value=object();failure=RuntimeError('original')
  class Bad:
   def start(self):raise OSError('observer unavailable')
   def finish(self):raise OSError('observer unavailable')
  def run(args,timeout,**kwargs):calls.append((args,timeout,kwargs));return value
  self.assertIs(m.observed_call(run,Bad,['exact'],180,marker=True),value)
  self.assertEqual(calls,[(['exact'],180,{'marker':True})])
  class EndsBad(Bad):
   def start(self):pass
  def reject(*args,**kwargs):raise failure
  with self.assertRaises(RuntimeError) as caught:m.observed_call(reject,EndsBad,['exact'],300)
  self.assertIs(caught.exception,failure)
 def test_process_binding_requires_exact_executable_uid_and_unique_pid(self):
  exe=self.root/'PlatinumQA';uid=os.getuid();one={'pid':41,'uid':uid,'startSeconds':10,'startMicroseconds':22,'executable':str(exe)}
  wrong={**one,'pid':42,'executable':str(exe)+'-other'}
  identify=lambda pid:{41:one,42:wrong}.get(pid)
  self.assertEqual(m.find_process(exe,read=lambda _:f'41 {uid}\n42 {uid}',identify=identify),one)
  with self.assertRaises(ValueError):m.find_process(exe,read=lambda _:f'42 {uid}',identify=identify)
  with self.assertRaises(ValueError):m.find_process(exe,read=lambda _:f'41 {uid}\n43 {uid}',identify=lambda pid:{**one,'pid':pid})
  self.assertEqual(ctypes.sizeof(m.ProcBsdInfo),136)
 def test_sample_uses_fixed_bounds_and_discards_reused_pid_output(self):
  identity={'pid':41,'uid':os.getuid(),'startSeconds':10,'startMicroseconds':22,'executable':str(self.root/'PlatinumQA')};calls=[]
  def execute(args,**kwargs):
   calls.append((args,kwargs));Path(args[-1]).write_text('controlled stack sample');return subprocess.CompletedProcess(args,0,b'',b'')
  target=self.root/'app.sample.txt'
  result=m.sample_process(identity,target,identify=lambda _:identity,execute=execute)
  self.assertTrue(result['complete']);self.assertEqual(calls[0][1],{'timeout':8,'limit':4096});self.assertIn('_sample-child',calls[0][0])
  seq=iter([identity,{**identity,'startMicroseconds':23}]);other=self.root/'other.sample.txt'
  result=m.sample_process(identity,other,identify=lambda _:next(seq),execute=execute)
  self.assertFalse(result['complete']);self.assertFalse(other.exists());self.assertFalse(other.with_name(other.name+'.partial').exists())
 def test_sample_failure_and_timeout_are_explicit_and_incomplete(self):
  identity={'pid':41,'uid':os.getuid(),'startSeconds':10,'startMicroseconds':22,'executable':'/selected/PlatinumQA'}
  def timeout(args,**kwargs):Path(args[-1]).write_text('partial');raise subprocess.TimeoutExpired(args,8)
  result=m.sample_process(identity,self.root/'app.sample.txt',identify=lambda _:identity,execute=timeout)
  self.assertFalse(result['complete']);self.assertEqual(result['issue'],'TimeoutExpired');self.assertEqual(list(self.root.iterdir()),[])
 def test_exact_busy_signal_samples_at_most_one_pair_per_shard(self):
  app_log=self.root/'app.log';app_log.write_bytes(b'old log')
  packages={}
  for role,pkg in [('app',m.PACKAGE),('driver',m.DRIVER_PACKAGE)]:
   bundle=self.root/role;bundle.mkdir();(bundle/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':pkg,'CFBundleExecutable':role}));(bundle/role).write_bytes(b'exec');packages[pkg]=bundle
  calls=[]
  def sample(identity,target):calls.append(target.name);return {'complete':True}
  observer=m.Observer('d',self.root/'observed',app_log,{'used':False},container=lambda d,p,k:packages[p],finder=lambda p:{'executable':str(p)},sample=sample)
  observer.snapshot=lambda label='latest':None
  with app_log.open('ab') as stream:stream.write(m.BUSY_MARKER)
  observer.inspect_stall();observer.inspect_stall();self.assertEqual(calls,['app.sample.txt','driver.sample.txt'])
 def test_busy_marker_split_across_polls_is_not_lost(self):
  log=self.root/'app.log';log.write_bytes(b'');observer=m.Observer('d',self.root/'out',log,{'used':False})
  observer.snapshot=lambda label='latest':None
  observer.container=lambda *args:(_ for _ in ()).throw(ValueError('no process'))
  cut=len(m.BUSY_MARKER)//2
  with log.open('ab') as stream:stream.write(m.BUSY_MARKER[:cut])
  observer.inspect_stall();self.assertIsNone(observer.records['sampleTrigger'])
  with log.open('ab') as stream:stream.write(m.BUSY_MARKER[cut:])
  observer.inspect_stall();self.assertEqual(observer.records['sampleTrigger']['kind'],'exact-main-run-loop-busy-30s-log')
  self.assertLessEqual(len(observer.carry),len(m.BUSY_MARKER)-1)
 def test_actual_owned_command_timeout_reaps_descendants(self):
  marker=self.root/'child.pid'
  child='import time;time.sleep(30)'
  code='import subprocess,sys,time;from pathlib import Path;p=subprocess.Popen([sys.executable,"-c",'+repr(child)+']);Path(sys.argv[1]).write_text(str(p.pid));time.sleep(30)'
  with self.assertRaises(subprocess.TimeoutExpired):m.bounded_command([sys.executable,'-c',code,str(marker)],timeout=.3)
  pid=int(marker.read_text());proc=Path('/proc')/str(pid)/'stat'
  if proc.exists():self.assertEqual(proc.read_text().split()[2],'Z')
 def test_actual_command_output_limit_stops_owned_process(self):
  with self.assertRaises(ValueError):m.bounded_command([sys.executable,'-c','import sys,time;sys.stdout.write("x"*100000);sys.stdout.flush();time.sleep(30)'],timeout=2,limit=1024)
 def test_completed_leader_does_not_wait_for_inherited_service_pipe_eof(self):
  marker=self.root/'inherited-child.pid';child='import time;time.sleep(30)'
  code='import subprocess,sys;from pathlib import Path;p=subprocess.Popen([sys.executable,"-c",'+repr(child)+']);Path(sys.argv[1]).write_text(str(p.pid));print("01234567-89AB-CDEF-0123-456789ABCDEF",flush=True)'
  try:
   result=m.bounded_command([sys.executable,'-c',code,str(marker)],timeout=.5)
   self.assertEqual(result.returncode,0);self.assertEqual(result.stdout.strip(),b'01234567-89AB-CDEF-0123-456789ABCDEF')
   self.assertTrue(result.leader_completed_before_pipe_eof)
   self.assertLess(result.elapsed_seconds,.5)
  finally:
   if marker.exists():
    try:os.kill(int(marker.read_text()),signal.SIGTERM)
    except ProcessLookupError:pass
 def test_real_timeout_retains_partial_output_and_setup_phase_metadata(self):
  path=self.root/'setup.json';records=[]
  args=[sys.executable,'-c','import sys,time;print("partial startup",flush=True);print("bounded diagnostic",file=sys.stderr,flush=True);time.sleep(30)']
  with self.assertRaises(subprocess.TimeoutExpired) as caught:m.setup_read(args,'create',.2,records,path)
  self.assertEqual(caught.exception.output,b'partial startup\n');self.assertEqual(caught.exception.stderr,b'bounded diagnostic\n')
  self.assertIsNone(caught.exception.leader_exit_code)
  row=json.loads(path.read_text())['commands'][0]
  self.assertEqual(row['status'],'timed-out');self.assertEqual(row['stdoutTail'],'partial startup\n');self.assertEqual(row['stderrTail'],'bounded diagnostic\n')
  self.assertLessEqual(row['stdoutBytes'],131072);self.assertLessEqual(row['stderrBytes'],4096)
  closed=[sys.executable,'-c','import os,time;os.write(1,b"before close");os.close(1);os.close(2);time.sleep(30)']
  with self.assertRaises(subprocess.TimeoutExpired) as ended:m.bounded_command(closed,timeout=.2)
  self.assertEqual(ended.exception.output,b'before close');self.assertIsNone(ended.exception.leader_exit_code)
 def test_diagnostic_junit_rejects_empty_failed_skipped_and_wrong_case(self):
  p=self.root/'junit.xml';good='<testsuites><testsuite tests="1" failures="0"><testcase name="Diagnostic warm tabs then saved memory reader" file="tests/native/diagnostics/ios-warm-tabs-reader.yaml" status="SUCCESS"/></testsuite></testsuites>'
  p.write_text(good);self.assertTrue(m.diagnostic_junit(p)['passed'])
  for text in ['',good.replace('SUCCESS','ERROR'),good.replace('/>','><skipped/></testcase>'),good.replace('reader.yaml','other.yaml'),'<testsuites/>']:
   with self.subTest(text=text):p.write_text(text);self.assertFalse(m.diagnostic_junit(p)['passed'])
unittest.main(argv=['recovery-tests'],verbosity=2)
`;
  const result = spawnSync('python3', ['-c', code, helper], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 19 tests/);
});

test('recovery workflow consumes the exact existing app and separates helper provenance', () => {
  const source = fs.readFileSync(path.join(root, '.github/workflows/native-audit-ios-recovery.yml'), 'utf8');
  const workflow = YAML.parse(source);
  assert.deepEqual(workflow.on.push.branches, ['codex/native-audit-ios-recovery-20261031']);
  assert.deepEqual(workflow.permissions, { contents: 'read', actions: 'read' });
  const job = workflow.jobs['recover-ios'];
  assert.equal(job['runs-on'], 'macos-15-intel');
  assert.equal(job.strategy['fail-fast'], false);
  assert.equal(job.strategy.matrix.include.length, 3);
  const baseline = job.steps.find(step => step.with?.path === 'baseline');
  assert.equal(baseline.with.ref, 'b568bd7b75bd25ad919afd8eac8d52300a5c3fcc');
  const download = job.steps.find(step => step.with?.name === 'native-audit-ios-binary');
  assert.equal(download.with['run-id'], 41229206389);
  assert.equal(download.with['github-token'], '${{ github.token }}');
  assert.match(source, /--recovery-source "\$RECOVERY_SOURCE"/);
  assert.equal(job.steps.at(-1).if, 'always()');
  assert.doesNotMatch(source, /npm ci|expo prebuild|xcodebuild .*build|codesign .*--sign|pod .*install/);
});

test('extra diagnostic preserves the existing warm flow and exact initial memory commands', () => {
  const parse = file => YAML.parseAllDocuments(fs.readFileSync(path.join(root, file), 'utf8')).map(row => row.toJSON());
  const [config, commands] = parse('tests/native/diagnostics/ios-warm-tabs-reader.yaml');
  const [, memory] = parse('tests/native/flows/memory-navigation.yaml');
  assert.equal(config.name, 'Diagnostic warm tabs then saved memory reader');
  assert.deepEqual(commands.slice(0, 3), [
    { runFlow: '../audit/flows/navigation-warm-tabs.yaml' },
    { tapOn: { id: 'main-tab-profile' } },
    { assertVisible: 'Alex Rivera' },
  ]);
  assert.deepEqual(commands.slice(3), memory.slice(0, 7));
  assert.equal(commands.at(-1).extendedWaitUntil.timeout, 15000);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'tests/native/audit/manifest.json'), 'utf8'));
  assert.equal(manifest.cases.length, 85);
  assert.equal(manifest.cases.some(row => row.flow.includes('diagnostic')), false);
});
