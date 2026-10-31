const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const root = path.resolve(__dirname, '../..');
const helper = path.join(root, 'scripts/quality/native-ui-ios-setup-probe.py');

test('actual setup probe preserves original failures and bounds private-free observations', () => {
  const source = String.raw`
import importlib.util,json,os,signal,subprocess,sys,tempfile,time,types,unittest
from pathlib import Path
from unittest import mock
spec=importlib.util.spec_from_file_location('probe',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Checks(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.probe=m.Probe(self.root)
 def tearDown(self):self.temp.cleanup()
 def identity(self,pid=7,name='simctl'):return {'pid':pid,'uid':os.getuid(),'startSeconds':1,'startMicroseconds':2,'executable':'/Applications/Xcode_16.4.app/Contents/Developer/usr/bin/'+name}
 def test_process_projection_is_bounded_and_keeps_names_not_paths_or_arguments(self):
  raw='\n'.join(str(i+1)+' 501 '+str(i/10)+' '+str(i*1024)+' /PRIVATE-PATH/Proc'+str(i) for i in range(100))+'\n200 0 300.0 4096 /usr/libexec/PerfPowerServices'
  result=m.bounded_process_projection(m.process_rows(raw));self.assertLessEqual(len(result['processes']),40);self.assertEqual(result['watchedCount'],1)
  self.assertTrue(any(r['name']=='PerfPowerServices' and r['uid']==0 for r in result['processes']));self.assertNotIn('PRIVATE-PATH',json.dumps(result))
 def test_process_projection_rejects_malformed_nonfinite_and_duplicate_rows(self):
  for raw in ['bad','1 501 NaN 10 name','1 501 -1 10 name','1 501 0 -10 name','1 501 0 10 name\n1 501 0 10 name']:
   with self.subTest(raw=raw):
    with self.assertRaises(ValueError):m.process_rows(raw)
 def test_memory_counters_are_numeric_and_page_size_is_retained(self):
  result=m.numeric_vm('Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 12.\nPages wired down: 34.\nignored: private text')
  self.assertEqual(result,{'pageSizeBytes':4096,'Pages free':12,'Pages wired down':34})
 def test_snapshots_do_not_warm_core_simulator_api(self):
  calls=[]
  def read(args,**kwargs):
   calls.append(args);self.assertLessEqual(kwargs['timeout'],3)
   return '17179869184\n3\n{ 1.5 2.5 3.5 }\n' if args[0].endswith('sysctl') else ('Pages free: 12.\n' if args[0].endswith('vm_stat') else '1 0 2.0 100 /sbin/launchd\n')
  self.probe.read=read;self.probe.snapshot('before-boot')
  self.assertEqual(len(calls),3);self.assertFalse(any('simctl' in args for args in calls))
  item=self.probe.records['snapshots'][0];self.assertEqual(item['physicalMemoryBytes'],17179869184);self.assertIn('elapsedSeconds',item)
 def test_service_requires_one_same_user_exact_signed_identity(self):
  identity=self.identity(9,m.SERVICE);row={'pid':9,'uid':os.getuid(),'name':m.SERVICE};calls=[]
  self.probe.read=lambda args,**kwargs:calls.append((args,kwargs)) or ''
  with mock.patch.object(m.support,'process_identity',return_value=identity):
   actual,proof=self.probe.service_identity([row],time.monotonic()+5)
   self.assertEqual(actual,identity);self.assertTrue(proof['appleSignatureVerified'])
   self.assertIn('=anchor apple and identifier "'+m.SERVICE+'"',calls[0][0])
   for rows in [[],[row,row],[{**row,'uid':os.getuid()+1}]]:
    self.assertIsNone(self.probe.service_identity(rows,time.monotonic()+5)[0])
  self.assertEqual(len(calls),1)
 def test_unsigned_or_changed_service_is_never_sampleable(self):
  identity=self.identity(9,m.SERVICE);row={'pid':9,'uid':os.getuid(),'name':m.SERVICE}
  self.probe.read=lambda *args,**kwargs:(_ for _ in ()).throw(ValueError('unsigned'))
  with mock.patch.object(m.support,'process_identity',return_value=identity):self.assertIsNone(self.probe.service_identity([row],time.monotonic()+5)[0])
  self.probe.read=lambda *args,**kwargs:''
  with mock.patch.object(m.support,'process_identity',side_effect=[identity,{**identity,'startMicroseconds':3}]):self.assertIsNone(self.probe.service_identity([row],time.monotonic()+5)[0])
 def test_original_timeout_is_persisted_before_observation_and_survives_observer_failure(self):
  pids=[]
  def diagnose(process):
   stored=json.loads((self.root/'probe.json').read_text());self.assertEqual(stored['commands'][-1]['status'],'timed-out');self.assertIsNone(process.poll());pids.append(process.pid);raise OSError('observer unavailable')
  self.probe.diagnose=diagnose
  with self.assertRaises(subprocess.TimeoutExpired):self.probe.run_stage('list-runtimes',[sys.executable,'-c','import time;print("partial",flush=True);time.sleep(30)','PRIVATE-ARGV'],.15,diagnose=True)
  row=json.loads((self.root/'probe.json').read_text())['commands'][0]
  self.assertEqual(row['status'],'timed-out');self.assertEqual(row['stdoutTail'],'partial\n');self.assertEqual(row['diagnosticIssue'],'OSError')
  self.assertNotIn('PRIVATE-ARGV',(self.root/'probe.json').read_text())
  with self.assertRaises(ProcessLookupError):os.kill(pids[0],0)
 def test_actual_timeout_reaps_owned_descendant(self):
  marker=self.root/'child.pid';child='import time;time.sleep(30)'
  script='import subprocess,sys,time;from pathlib import Path;p=subprocess.Popen([sys.executable,"-c",'+repr(child)+']);Path(sys.argv[1]).write_text(str(p.pid));time.sleep(30)'
  with self.assertRaises(subprocess.TimeoutExpired):self.probe.run_stage('create',[sys.executable,'-c',script,str(marker)],.2)
  stat=Path('/proc')/marker.read_text()/'stat'
  if stat.exists():self.assertEqual(stat.read_text().split()[2],'Z')
 def test_completed_leader_does_not_wait_for_descendant_pipe_eof(self):
  marker=self.root/'child.pid';child='import time;time.sleep(30)'
  script='import subprocess,sys;from pathlib import Path;p=subprocess.Popen([sys.executable,"-c",'+repr(child)+']);Path(sys.argv[1]).write_text(str(p.pid));print("ready",flush=True)'
  try:self.assertEqual(self.probe.run_stage('create',[sys.executable,'-c',script,str(marker)],.5),'ready')
  finally:
   if marker.exists():
    try:os.kill(int(marker.read_text()),signal.SIGTERM)
    except ProcessLookupError:pass
 def test_diagnostic_is_once_only_and_targets_only_owned_command_and_verified_service(self):
  owned=self.identity();service=self.identity(9,m.SERVICE);calls=[];process=types.SimpleNamespace(pid=7,poll=lambda:None)
  self.probe.records['commands']=[{'status':'timed-out'}];self.probe.persist();self.probe.snapshot=lambda *args:[];self.probe.service_identity=lambda *args:(service,{'appleSignatureVerified':True})
  def sample(identity,target,**kwargs):calls.append(identity);return {'complete':True}
  with mock.patch.object(m.support,'process_identity',return_value=owned),mock.patch.object(m.os,'getpgid',return_value=7),mock.patch.object(m.support,'sample_process',side_effect=sample):
   self.probe.diagnose(process);self.probe.diagnose(process)
  self.assertEqual(calls,[owned,service]);self.assertEqual(self.probe.records['diagnostic']['wallBudgetSeconds'],25)
 def test_support_hash_is_checked_before_any_helper_code_runs(self):
  directory=self.root/'untrusted';directory.mkdir();marker=self.root/'executed'
  (directory/'native-ui-ios-setup-probe.py').write_bytes(Path(sys.argv[1]).read_bytes())
  (directory/'native-ui-ios-audit-recovery.py').write_text('from pathlib import Path\nPath('+repr(str(marker))+').write_text("executed")')
  result=subprocess.run([sys.executable,str(directory/'native-ui-ios-setup-probe.py')],capture_output=True,text=True,timeout=5)
  self.assertNotEqual(result.returncode,0);self.assertIn('before import',result.stderr);self.assertFalse(marker.exists())
 def test_actual_main_keeps_original_order_deadlines_and_early_timeout_diagnosis(self):
  calls=[];instances=[];uuid='01234567-89AB-CDEF-0123-456789ABCDEF'
  class FakeProbe(m.Probe):
   def __init__(self,output):super().__init__(output);instances.append(self)
   def snapshot(self,label,deadline=None):calls.append(('snapshot:'+label,None,False));return []
   def run_stage(self,stage,args,timeout,diagnose=False):
    calls.append((stage,timeout,diagnose))
    return {'host-architecture':'x86_64','xcode-version':'Xcode 16.4\nBuild version 16F6','sdk-version':'18.5','create':uuid,'boot':'','bootstatus':'','list-runtimes':json.dumps({'runtimes':[{'identifier':m.RUNTIME,'isAvailable':True,'version':'18.5'}]})}[stage]
  before=Path.cwd();os.chdir(self.root)
  try:
   with mock.patch.object(m,'Probe',FakeProbe),mock.patch.object(m.platform,'system',return_value='Darwin'),mock.patch.object(m.resource,'setrlimit'),mock.patch.object(m.support,'bounded_command',return_value=types.SimpleNamespace(returncode=0)),mock.patch.dict(os.environ,{'CI':'true','DEVELOPER_DIR':m.DEVELOPER,'GITHUB_SHA':'a'*40,'GITHUB_RUN_ID':'7','ImageOS':'macos15','ImageVersion':'test-image','RUNNER_ARCH':'X64','PRIVATE_ENV':'DO-NOT-RETAIN'}):self.assertEqual(m.main(),0)
  finally:os.chdir(before)
  self.assertEqual([c[0] for c in calls],['host-architecture','xcode-version','sdk-version','snapshot:before-create','create','snapshot:before-boot','boot','bootstatus','snapshot:after-boot','list-runtimes'])
  real=[c for c in calls if c[1] is not None];self.assertEqual([c[1] for c in real],[30,30,30,120,120,300,30]);self.assertTrue(all(c[2] for c in real[1:]))
  self.assertEqual(set(instances[0].records['runnerImage']),{'ImageOS','ImageVersion','RUNNER_ARCH'});self.assertNotIn('DO-NOT-RETAIN',json.dumps(instances[0].records));self.assertFalse(instances[0].records['applicationOrReaderAcceptance'])
unittest.main(argv=['probe-tests'],verbosity=2)
`;
  const result = spawnSync('python3', ['-c', source, helper], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 12 tests/);
});

test('setup-only workflow has no app, Maestro, build, download or service-mutation steps', () => {
  const text = fs.readFileSync(path.join(root, '.github/workflows/native-ios-setup-diagnosis.yml'), 'utf8');
  const workflow = YAML.parse(text);
  assert.deepEqual(workflow.on.push.branches, ['codex/ios-setup-diagnosis-20261031']);
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const jobs = Object.values(workflow.jobs);
  assert.equal(jobs.length, 1);
  const job = jobs[0];
  assert.equal(job['runs-on'], 'macos-15-intel');
  assert.equal(job['timeout-minutes'], 15);
  assert.equal(job.env.DEVELOPER_DIR, '/Applications/Xcode_16.4.app/Contents/Developer');
  assert.equal(job.steps.length, 3);
  assert.equal(job.steps[1].run, 'python3 scripts/quality/native-ui-ios-setup-probe.py');
  assert.equal(job.steps[2].if, 'always()');
  assert.doesNotMatch(text, /download-artifact|npm ci|expo prebuild|brew install|pod install|maestro|killall|rm -rf/i);
});
